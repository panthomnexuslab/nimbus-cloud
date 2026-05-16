import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, type Profile, type VerifyCallback } from 'passport-google-oauth20';
import { AppConfigService } from '../../../config/app-config.service';
import type { OAuthProfile } from '../services/oauth.service';

/**
 * Conditionally registered: if `GOOGLE_OAUTH_ENABLED=false`, this
 * strategy still exists but throws on use so a misconfigured server
 * doesn't silently accept tokens.
 */
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly enabled: boolean;

  constructor(cfg: AppConfigService) {
    super({
      clientID: cfg.googleClientId || 'disabled',
      clientSecret: cfg.googleClientSecret || 'disabled',
      callbackURL: cfg.googleCallbackUrl,
      scope: ['email', 'profile'],
    });
    this.enabled = cfg.googleOAuthEnabled && !!cfg.googleClientId;
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ) {
    if (!this.enabled) {
      return done(new UnauthorizedException('Google OAuth is disabled'));
    }
    const email = profile.emails?.[0]?.value;
    const verified =
      // Older typings call this `verified`, newer ones expose it differently.
      (profile.emails?.[0] as unknown as { verified?: boolean })?.verified ?? true;
    if (!email) return done(new UnauthorizedException('No email on Google profile'));
    const mapped: OAuthProfile = {
      provider: 'google',
      providerUserId: profile.id,
      email,
      emailVerified: verified,
      displayName: profile.displayName ?? '',
      avatarUrl: profile.photos?.[0]?.value,
    };
    return done(null, mapped);
  }
}
