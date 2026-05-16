import type { UserRole } from '@prisma/client';

/** Access token payload. Short-lived (default 15m). */
export interface AccessTokenPayload {
  sub: string;        // user id
  sid: string;        // session id
  role: UserRole;
  mfa: boolean;       // whether MFA has been satisfied for this session
  iat?: number;
  exp?: number;
}

/** Refresh token payload — opaque token id + session id. */
export interface RefreshTokenPayload {
  sub: string;
  sid: string;
  jti: string;        // refresh token id (db row)
  iat?: number;
  exp?: number;
}
