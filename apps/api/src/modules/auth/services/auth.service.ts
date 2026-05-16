import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuditAction, DeviceLogEvent, UserStatus, type User } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { AppConfigService } from '../../../config/app-config.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { AuditService } from '../../audit/audit.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { CryptoService } from '../../crypto/crypto.service';
import type { ClientContext } from '../../../common/decorators/client-context.decorator';
import { sha256Hex } from '../../../common/utils/crypto-utils';
import type { RegisterDto } from '../dto/register.dto';
import type { LoginDto } from '../dto/login.dto';
import type { TotpSetup } from './totp.service';
import { PasswordService } from './password.service';
import { TokenService, type IssuedTokenPair } from './token.service';
import { TotpService } from './totp.service';
import { SessionService } from './session.service';
import { OAuthService, type OAuthProfile } from './oauth.service';

export interface LoginResult {
  status: 'OK' | 'TOTP_REQUIRED';
  user?: Pick<User, 'id' | 'email' | 'displayName' | 'role' | 'avatarUrl'>;
  pair?: IssuedTokenPair;
  sessionId?: string;
}

/**
 * Top-level auth orchestrator. Anything that involves a credential
 * transition (register, login, refresh, logout, 2fa setup/verify,
 * oauth, change-password) goes through this class so we can keep audit
 * + notification + brute-force counters in one place.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly cfg: AppConfigService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly password: PasswordService,
    private readonly tokens: TokenService,
    private readonly totp: TotpService,
    private readonly sessions: SessionService,
    private readonly oauth: OAuthService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly crypto: CryptoService,
  ) {}

  // --- Register ---------------------------------------------------------
  async register(dto: RegisterDto, ctx: ClientContext) {
    const email = dto.email.toLowerCase().trim();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      // Don't disclose existence — return generic message + fake delay.
      await this.password.hash(randomBytes(16).toString('hex'));
      throw new BadRequestException({
        code: 'REGISTER_FAILED',
        message: 'Unable to register with the provided details.',
      });
    }
    const passwordHash = await this.password.hash(dto.password);
    const dek = this.crypto.randomKey();
    const wrapped = this.crypto.wrapWithKek(dek);

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        displayName: dto.displayName ?? email.split('@')[0],
        status: UserStatus.ACTIVE, // OTP/email-verify flow is a follow-up
        emailVerifiedAt: new Date(),
        wrappedDek: wrapped.blob,
        dekVersion: wrapped.kekVersion,
        storageQuotaBytes: this.cfg.defaultQuotaBytes,
      },
    });
    await this.audit.append({
      userId: user.id,
      action: AuditAction.USER_REGISTERED,
      resource: `user:${user.id}`,
      client: ctx,
    });
    return { id: user.id, email: user.email };
  }

  // --- Login ------------------------------------------------------------
  async login(dto: LoginDto, ctx: ClientContext): Promise<LoginResult> {
    const email = dto.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { twoFactor: true, recoveryCodes: true },
    });

    if (!user || !user.passwordHash) {
      await this.password.hash(randomBytes(16).toString('hex')); // const-time
      await this.recordFailedAttempt(email, ctx.ip);
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    }
    if (user.status === UserStatus.LOCKED || user.status === UserStatus.DISABLED) {
      throw new ForbiddenException({ code: 'ACCOUNT_LOCKED', message: 'Account is locked' });
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException({ code: 'ACCOUNT_LOCKED', message: 'Account is locked' });
    }
    const ok = await this.password.verify(user.passwordHash, dto.password);
    if (!ok) {
      await this.recordFailedAttempt(email, ctx.ip);
      await this.bumpFailedCount(user.id);
      await this.audit.append({
        userId: user.id,
        action: AuditAction.LOGIN_FAILED,
        resource: `user:${user.id}`,
        client: ctx,
        metadata: { reason: 'bad-password' },
      });
      await this.prisma.deviceLog.create({
        data: {
          userId: user.id,
          event: DeviceLogEvent.LOGIN_FAILED,
          ipAddress: ctx.ip,
          userAgent: ctx.userAgent,
          metadata: { reason: 'bad-password' },
        },
      });
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    }

    // 2FA?
    if (user.twoFactor?.enabled) {
      const code = dto.totpCode?.trim();
      const recovery = dto.recoveryCode?.trim();
      if (!code && !recovery) {
        return { status: 'TOTP_REQUIRED' };
      }
      let mfaOk = false;
      if (code) {
        mfaOk = this.totp.verify(user.twoFactor.secretCipher, code);
      } else if (recovery) {
        mfaOk = await this.consumeRecoveryCode(user.id, recovery);
      }
      if (!mfaOk) {
        await this.prisma.deviceLog.create({
          data: {
            userId: user.id,
            event: DeviceLogEvent.MFA_FAILED,
            ipAddress: ctx.ip,
            userAgent: ctx.userAgent,
          },
        });
        throw new UnauthorizedException({ code: 'MFA_FAILED', message: 'Invalid 2FA code' });
      }
    }

    // Clear failed counters and issue tokens within a single tx.
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
      const { session } = await this.sessions.create(
        {
          userId: user.id,
          client: ctx,
          mfaSatisfied: !!user.twoFactor?.enabled,
          rememberDevice: dto.rememberDevice,
          deviceName: dto.deviceName,
        },
        tx,
      );
      const pair = await this.tokens.issuePair({
        userId: user.id,
        sessionId: session.id,
        role: user.role,
        mfa: !!user.twoFactor?.enabled,
        tx,
      });
      return { sessionId: session.id, pair };
    });

    await this.redis.client.del(`nbs:login:ip:${ctx.ip}`, `nbs:login:email:${email}`);
    await this.prisma.deviceLog.create({
      data: {
        userId: user.id,
        event: DeviceLogEvent.LOGIN_SUCCESS,
        sessionId: result.sessionId,
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
      },
    });
    if (user.loginAlertsEnabled) {
      await this.notifications.suspiciousLoginCheck(user.id, ctx);
    }
    await this.audit.append({
      userId: user.id,
      action: AuditAction.LOGIN_SUCCESS,
      resource: `session:${result.sessionId}`,
      client: ctx,
      metadata: { mfa: !!user.twoFactor?.enabled },
    });
    return {
      status: 'OK',
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
        avatarUrl: user.avatarUrl,
      },
      pair: result.pair,
      sessionId: result.sessionId,
    };
  }

  // --- OAuth ------------------------------------------------------------
  async oauthLogin(profile: OAuthProfile, ctx: ClientContext) {
    const user = await this.oauth.findOrCreate(profile);
    const { session } = await this.sessions.create({
      userId: user.id,
      client: ctx,
      mfaSatisfied: true, // delegated to provider
      rememberDevice: true,
    });
    const pair = await this.tokens.issuePair({
      userId: user.id,
      sessionId: session.id,
      role: user.role,
      mfa: true,
    });
    await this.prisma.deviceLog.create({
      data: {
        userId: user.id,
        event: DeviceLogEvent.LOGIN_SUCCESS,
        sessionId: session.id,
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
        metadata: { provider: profile.provider },
      },
    });
    await this.audit.append({
      userId: user.id,
      action: AuditAction.LOGIN_SUCCESS,
      resource: `session:${session.id}`,
      client: ctx,
      metadata: { oauth: profile.provider },
    });
    if (user.loginAlertsEnabled) {
      await this.notifications.suspiciousLoginCheck(user.id, ctx);
    }
    return { user, pair, sessionId: session.id };
  }

  // --- Refresh ----------------------------------------------------------
  async refresh(rawToken: string) {
    return this.tokens.rotate(rawToken);
  }

  // --- Logout -----------------------------------------------------------
  async logout(sessionId: string, userId: string, ctx?: ClientContext) {
    await this.sessions.revoke(sessionId, userId);
    await this.prisma.deviceLog.create({
      data: { userId, event: DeviceLogEvent.LOGOUT, sessionId },
    });
    await this.audit.append({
      userId,
      action: AuditAction.LOGOUT,
      resource: `session:${sessionId}`,
      client: ctx,
    });
  }

  // --- 2FA --------------------------------------------------------------
  async setupTwoFactor(userId: string): Promise<TotpSetup> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException();
    const setup = await this.totp.setup(user.email);
    await this.prisma.twoFactor.upsert({
      where: { userId },
      create: { userId, secretCipher: setup.secretCipher, enabled: false },
      update: { secretCipher: setup.secretCipher, enabled: false, confirmedAt: null },
    });
    return setup;
  }

  async confirmTwoFactor(userId: string, code: string) {
    const tf = await this.prisma.twoFactor.findUnique({ where: { userId } });
    if (!tf) throw new BadRequestException({ code: 'NO_2FA_SETUP', message: 'No 2FA setup in progress' });
    const ok = this.totp.verify(tf.secretCipher, code);
    if (!ok) throw new UnauthorizedException({ code: 'INVALID_2FA', message: 'Invalid 2FA code' });
    await this.prisma.twoFactor.update({
      where: { userId },
      data: { enabled: true, confirmedAt: new Date() },
    });
    const recoveryCodes = await this.generateRecoveryCodes(userId);
    await this.audit.append({
      userId,
      action: AuditAction.MFA_ENABLED,
      resource: `user:${userId}`,
    });
    return { enabled: true, recoveryCodes };
  }

  async disableTwoFactor(userId: string, code: string) {
    const tf = await this.prisma.twoFactor.findUnique({ where: { userId } });
    if (!tf?.enabled) throw new BadRequestException({ code: 'NO_2FA', message: '2FA not enabled' });
    const ok = this.totp.verify(tf.secretCipher, code);
    if (!ok) throw new UnauthorizedException({ code: 'INVALID_2FA', message: 'Invalid 2FA code' });
    await this.prisma.$transaction([
      this.prisma.twoFactor.delete({ where: { userId } }),
      this.prisma.recoveryCode.deleteMany({ where: { userId } }),
    ]);
    await this.audit.append({
      userId,
      action: AuditAction.MFA_DISABLED,
      resource: `user:${userId}`,
    });
  }

  async generateRecoveryCodes(userId: string): Promise<string[]> {
    const codes = Array.from({ length: 10 }, () => randomBytes(6).toString('hex'));
    await this.prisma.recoveryCode.deleteMany({ where: { userId } });
    await this.prisma.recoveryCode.createMany({
      data: await Promise.all(
        codes.map(async (c) => ({ userId, codeHash: await this.password.hash(c) })),
      ),
    });
    return codes;
  }

  private async consumeRecoveryCode(userId: string, code: string): Promise<boolean> {
    const codes = await this.prisma.recoveryCode.findMany({
      where: { userId, usedAt: null },
    });
    for (const rc of codes) {
      if (await this.password.verify(rc.codeHash, code)) {
        await this.prisma.recoveryCode.update({
          where: { id: rc.id },
          data: { usedAt: new Date() },
        });
        return true;
      }
    }
    return false;
  }

  // --- Internal counters ------------------------------------------------
  private async recordFailedAttempt(email: string, ip: string) {
    await this.redis.incrWithTtl(`nbs:login:ip:${ip}`, this.cfg.loginLockoutWindow);
    if (email) {
      await this.redis.incrWithTtl(`nbs:login:email:${email}`, this.cfg.loginLockoutWindow);
    }
  }

  private async bumpFailedCount(userId: string) {
    const u = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: { increment: 1 } },
    });
    if (u.failedLoginCount >= this.cfg.loginLockoutThreshold) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { lockedUntil: new Date(Date.now() + this.cfg.loginLockoutWindow * 1000) },
      });
    }
  }

  // --- Password change --------------------------------------------------
  async changePassword(userId: string, current: string, next: string, ctx?: ClientContext) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.passwordHash) throw new NotFoundException();
    const ok = await this.password.verify(user.passwordHash, current);
    if (!ok) throw new UnauthorizedException({ code: 'INVALID_PASSWORD', message: 'Current password is incorrect' });
    const hash = await this.password.hash(next);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: hash } });
    await this.sessions.revokeAllForUser(userId);
    await this.prisma.deviceLog.create({
      data: { userId, event: DeviceLogEvent.PASSWORD_CHANGED, ipAddress: ctx?.ip, userAgent: ctx?.userAgent },
    });
    await this.audit.append({
      userId,
      action: AuditAction.PASSWORD_CHANGED,
      resource: `user:${userId}`,
      client: ctx,
    });
  }

  // --- Session lookup helper --------------------------------------------
  hashSessionId(sessionId: string): string {
    return sha256Hex(sessionId);
  }
}
