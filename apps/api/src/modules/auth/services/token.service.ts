import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuditAction, DeviceLogEvent, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AppConfigService } from '../../../config/app-config.service';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  AccessTokenPayload,
  RefreshTokenPayload,
} from '../../../common/types/auth.types';
import { generateOpaqueToken, sha256Hex } from '../../../common/utils/crypto-utils';
import { AuditService } from '../../audit/audit.service';

export interface IssuedTokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
  refreshTokenId: string;
}

/**
 * Issues and rotates the JWT + opaque-refresh token pair.
 *
 * Refresh token contract:
 *  - The refresh token sent to the client is "<rtId>.<rawSecret>".
 *  - We persist only the SHA-256 of the rawSecret, keyed by `tokenHash`.
 *  - Each call to `rotate()` writes the new token row, links the old
 *    via `replacedById`, and revokes the old.
 *  - If a caller presents a previously-rotated token, we mark
 *    `replayedAt` and revoke the entire session (`revokeSession`).
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly cfg: AppConfigService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  signAccessToken(payload: AccessTokenPayload): {
    token: string;
    expiresAt: Date;
  } {
    const token = this.jwt.sign(payload, {
      secret: this.cfg.jwtAccessSecret,
      issuer: this.cfg.jwtIssuer,
      audience: this.cfg.jwtAudience,
      expiresIn: this.cfg.jwtAccessTtl,
      algorithm: 'HS512',
    });
    return {
      token,
      expiresAt: new Date(Date.now() + this.cfg.jwtAccessTtl * 1000),
    };
  }

  async issuePair(args: {
    userId: string;
    sessionId: string;
    role: AccessTokenPayload['role'];
    mfa: boolean;
    tx?: Prisma.TransactionClient;
  }): Promise<IssuedTokenPair> {
    const access = this.signAccessToken({
      sub: args.userId,
      sid: args.sessionId,
      role: args.role,
      mfa: args.mfa,
    });

    const refreshTtl = this.cfg.jwtRefreshTtl;
    const refreshExpiresAt = new Date(Date.now() + refreshTtl * 1000);
    const refreshId = randomUUID();
    const { raw: secret, hash: secretHash } = generateOpaqueToken();
    const refreshToken = `${refreshId}.${secret}`;

    const client = args.tx ?? this.prisma;
    await client.refreshToken.create({
      data: {
        id: refreshId,
        userId: args.userId,
        sessionId: args.sessionId,
        tokenHash: secretHash,
        expiresAt: refreshExpiresAt,
      },
    });

    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken,
      refreshTokenId: refreshId,
      refreshTokenExpiresAt: refreshExpiresAt,
    };
  }

  /**
   * Rotate a refresh token. Detects replay (token already replaced) and
   * burns the whole session if so.
   */
  async rotate(rawToken: string): Promise<{
    pair: IssuedTokenPair;
    sessionId: string;
    userId: string;
  }> {
    const parsed = this.parseRefreshToken(rawToken);
    if (!parsed) throw new UnauthorizedException('Malformed refresh token');

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.refreshToken.findUnique({
        where: { id: parsed.id },
        include: { session: { include: { user: true } } },
      });
      if (!existing) throw new UnauthorizedException('Refresh token not recognised');
      if (existing.tokenHash !== sha256Hex(parsed.secret)) {
        // Hash mismatch — token tampered.
        throw new UnauthorizedException('Refresh token mismatch');
      }
      if (existing.revokedAt) {
        // Already rotated; this is replay. Burn the entire session.
        await tx.refreshToken.update({
          where: { id: existing.id },
          data: { replayedAt: new Date() },
        });
        await tx.session.update({
          where: { id: existing.sessionId },
          data: { revokedAt: new Date() },
        });
        await tx.refreshToken.updateMany({
          where: { sessionId: existing.sessionId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.deviceLog.create({
          data: {
            userId: existing.userId,
            sessionId: existing.sessionId,
            event: DeviceLogEvent.TOKEN_REPLAYED,
            metadata: { tokenId: existing.id },
          },
        });
        this.logger.warn(
          `Refresh token replay detected for session ${existing.sessionId}; session revoked.`,
        );
        // Audit outside of the transaction-affecting writes; AuditService
        // takes its own write so we don't accidentally chain inside a
        // failed tx. Fire-and-forget; failures get logged.
        void this.audit.append({
          userId: existing.userId,
          action: AuditAction.TOKEN_REUSE_DETECTED,
          resource: `session:${existing.sessionId}`,
          metadata: { tokenId: existing.id },
        });
        throw new UnauthorizedException('Token replay detected');
      }
      if (existing.expiresAt < new Date()) {
        throw new UnauthorizedException('Refresh token expired');
      }
      if (existing.session.revokedAt) {
        throw new UnauthorizedException('Session revoked');
      }

      const pair = await this.issuePair({
        userId: existing.userId,
        sessionId: existing.sessionId,
        role: existing.session.user.role,
        mfa: existing.session.mfaSatisfied,
        tx,
      });

      await tx.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date(), replacedById: pair.refreshTokenId },
      });
      await tx.session.update({
        where: { id: existing.sessionId },
        data: { lastSeenAt: new Date() },
      });
      await tx.deviceLog.create({
        data: {
          userId: existing.userId,
          sessionId: existing.sessionId,
          event: DeviceLogEvent.TOKEN_REFRESH,
        },
      });

      return { pair, sessionId: existing.sessionId, userId: existing.userId };
    });
  }

  async revokeRefreshToken(id: string): Promise<void> {
    await this.prisma.refreshToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } }),
      this.prisma.refreshToken.updateMany({
        where: { sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  async verifyAccess(token: string): Promise<AccessTokenPayload> {
    return this.jwt.verifyAsync<AccessTokenPayload>(token, {
      secret: this.cfg.jwtAccessSecret,
      issuer: this.cfg.jwtIssuer,
      audience: this.cfg.jwtAudience,
    });
  }

  parseRefreshToken(raw: string): { id: string; secret: string } | null {
    const idx = raw.indexOf('.');
    if (idx <= 0 || idx === raw.length - 1) return null;
    return { id: raw.slice(0, idx), secret: raw.slice(idx + 1) };
  }

  decodeRefreshTokenPayload(raw: string): RefreshTokenPayload | null {
    const parsed = this.parseRefreshToken(raw);
    if (!parsed) return null;
    return { sub: '', sid: '', jti: parsed.id };
  }
}
