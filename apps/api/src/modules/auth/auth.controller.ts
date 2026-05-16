import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';

import { AuthService } from './services/auth.service';
import { LoginGuard } from './guards/login.guard';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { TwoFactorVerifyDto, TwoFactorDisableDto } from './dto/two-factor.dto';
import { ChangePasswordDto } from './dto/password.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Client, type ClientContext } from '../../common/decorators/client-context.decorator';
import type { AccessTokenPayload } from '../../common/types/auth.types';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { OAuthProfile } from './services/oauth.service';
import type { IssuedTokenPair } from './services/token.service';

/**
 * Refresh token cookie name. HttpOnly, Secure (in prod), SameSite=Lax/strict
 * by config. The path is scoped to /auth/refresh + /auth/logout so it's
 * never sent on data endpoints — limits exposure.
 */
const REFRESH_COOKIE = 'nbs.refresh';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cfg: AppConfigService,
    private readonly prisma: PrismaService,
  ) {}

  // ------------------------------------------------------------------ Register
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto, @Client() client: ClientContext) {
    return this.auth.register(dto, client);
  }

  // ------------------------------------------------------------------ Login
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(LoginGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Client() client: ClientContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(dto, client);
    if (result.status === 'TOTP_REQUIRED') {
      return { status: 'TOTP_REQUIRED' };
    }
    if (!result.pair || !result.user) throw new UnauthorizedException();
    this.setRefreshCookie(res, result.pair);
    return {
      status: 'OK',
      user: result.user,
      accessToken: result.pair.accessToken,
      accessTokenExpiresAt: result.pair.accessTokenExpiresAt.toISOString(),
    };
  }

  // ------------------------------------------------------------------ Refresh
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!raw) throw new UnauthorizedException({ code: 'NO_REFRESH', message: 'No refresh token' });
    const { pair } = await this.auth.refresh(raw);
    this.setRefreshCookie(res, pair);
    return {
      accessToken: pair.accessToken,
      accessTokenExpiresAt: pair.accessTokenExpiresAt.toISOString(),
    };
  }

  // ------------------------------------------------------------------ Logout
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentUser() user: AccessTokenPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(user.sid, user.sub);
    res.clearCookie(REFRESH_COOKIE, this.cookieOpts());
  }

  // ------------------------------------------------------------------ Me
  @Get('me')
  async me(@CurrentUser() user: AccessTokenPayload) {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: {
        id: true,
        email: true,
        displayName: true,
        avatarUrl: true,
        role: true,
        storageQuotaBytes: true,
        storageUsedBytes: true,
        emailVerifiedAt: true,
        twoFactor: { select: { enabled: true } },
        loginAlertsEnabled: true,
      },
    });
    if (!dbUser) throw new UnauthorizedException();
    return {
      ...dbUser,
      storageQuotaBytes: dbUser.storageQuotaBytes?.toString() ?? null,
      storageUsedBytes: dbUser.storageUsedBytes.toString(),
      twoFactorEnabled: dbUser.twoFactor?.enabled ?? false,
    };
  }

  // ------------------------------------------------------------------ Password
  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.changePassword(user.sub, dto.currentPassword, dto.newPassword);
    res.clearCookie(REFRESH_COOKIE, this.cookieOpts());
  }

  // ------------------------------------------------------------------ 2FA
  @Post('2fa/setup')
  async setup2fa(@CurrentUser() user: AccessTokenPayload) {
    const { otpauthUri, qrCodeDataUrl, secret } = await this.auth.setupTwoFactor(user.sub);
    return { otpauthUri, qrCodeDataUrl, secret };
  }

  @Post('2fa/verify')
  async verify2fa(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: TwoFactorVerifyDto,
  ) {
    return this.auth.confirmTwoFactor(user.sub, dto.code);
  }

  @Post('2fa/disable')
  @HttpCode(HttpStatus.NO_CONTENT)
  async disable2fa(
    @CurrentUser() user: AccessTokenPayload,
    @Body() dto: TwoFactorDisableDto,
  ) {
    await this.auth.disableTwoFactor(user.sub, dto.code);
  }

  @Post('recovery-codes/regenerate')
  async regenerateCodes(@CurrentUser() user: AccessTokenPayload) {
    const codes = await this.auth.generateRecoveryCodes(user.sub);
    return { codes };
  }

  // ------------------------------------------------------------------ Google OAuth
  @Public()
  @Get('google')
  @UseGuards(AuthGuard('google'))
  async googleStart() {
    // Passport redirects to Google.
  }

  @Public()
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(
    @Req() req: Request & { user?: OAuthProfile },
    @Client() client: ClientContext,
    @Res() res: Response,
  ) {
    if (!req.user) {
      res.redirect(`${this.cfg.webBaseUrl}/auth/login?error=oauth`);
      return;
    }
    const result = await this.auth.oauthLogin(req.user, client);
    this.setRefreshCookie(res, result.pair);
    const fragment = new URLSearchParams({
      accessToken: result.pair.accessToken,
      expiresAt: result.pair.accessTokenExpiresAt.toISOString(),
    });
    res.redirect(`${this.cfg.webBaseUrl}/auth/oauth-callback#${fragment.toString()}`);
  }

  // ------------------------------------------------------------------ Helpers
  private cookieOpts() {
    return {
      httpOnly: true,
      secure: this.cfg.cookieSecure,
      sameSite: this.cfg.cookieSameSite,
      domain: this.cfg.cookieDomain,
      path: '/api/v1/auth',
    };
  }

  private setRefreshCookie(res: Response, pair: IssuedTokenPair) {
    res.cookie(REFRESH_COOKIE, pair.refreshToken, {
      ...this.cookieOpts(),
      expires: pair.refreshTokenExpiresAt,
    });
  }
}
