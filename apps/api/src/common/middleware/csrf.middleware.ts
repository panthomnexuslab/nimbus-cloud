import { Injectable, Logger, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppConfigService } from '../../config/app-config.service';

/**
 * Double-submit cookie CSRF protection.
 *
 *   1. On every request we ensure the client has a `nbs.csrf` cookie. If
 *      missing, we mint a fresh token (random + HMAC) and set the
 *      cookie (NOT HttpOnly so JS can read it for the header).
 *   2. For mutating requests (POST/PUT/PATCH/DELETE) we require the
 *      `X-CSRF-Token` header to equal the cookie. Authorization
 *      headers from bearer-token API clients bypass CSRF (no
 *      browser-origin replay risk).
 *
 * Bearer tokens are not vulnerable to CSRF (no ambient credentials),
 * so we skip when `Authorization: Bearer ...` is present AND no
 * session cookie is in use.
 */
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  private readonly logger = new Logger(CsrfMiddleware.name);
  private static readonly COOKIE = 'nbs.csrf';
  private static readonly HEADER = 'x-csrf-token';
  private static readonly SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
  // Endpoints that intentionally don't need CSRF (set-cookie endpoints
  // that bootstrap the session). Use sparingly.
  private static readonly EXEMPT_PATHS = [
    /\/auth\/login$/,
    /\/auth\/register$/,
    /\/auth\/refresh$/,
    /\/auth\/google(\/callback)?$/,
    /\/health$/,
    /\/share\/[^/]+\/(view|download)$/, // public share endpoints
    /\/uploads\/[^/]+\/parts\/\d+$/, // multipart part PUTs (signed urls); bearer-auth required
  ];

  constructor(private readonly cfg: AppConfigService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const existing = req.cookies?.[CsrfMiddleware.COOKIE];
    let token = typeof existing === 'string' && this.verify(existing) ? existing : null;
    if (!token) {
      token = this.mint();
      res.cookie(CsrfMiddleware.COOKIE, token, {
        httpOnly: false, // must be readable from JS so SPA can echo via header
        secure: this.cfg.cookieSecure,
        sameSite: this.cfg.cookieSameSite,
        domain: this.cfg.cookieDomain,
        path: '/',
        maxAge: 60 * 60 * 24 * 7 * 1000,
      });
      res.setHeader('X-CSRF-Token', token);
    }

    if (CsrfMiddleware.SAFE_METHODS.has(req.method)) return next();

    const path = req.originalUrl.split('?')[0];
    if (CsrfMiddleware.EXEMPT_PATHS.some((rx) => rx.test(path))) return next();

    const header = req.header(CsrfMiddleware.HEADER);
    if (!header || !this.tokensMatch(header, token)) {
      this.logger.warn(`CSRF rejected ${req.method} ${path} ip=${req.ip}`);
      throw new UnauthorizedException('Invalid CSRF token');
    }
    next();
  }

  private mint(): string {
    const raw = randomBytes(24).toString('base64url');
    const mac = createHmac('sha256', this.cfg.csrfSecret).update(raw).digest('base64url');
    return `${raw}.${mac}`;
  }

  private verify(token: string): boolean {
    const [raw, mac] = token.split('.');
    if (!raw || !mac) return false;
    const expected = createHmac('sha256', this.cfg.csrfSecret).update(raw).digest('base64url');
    return this.timingSafeStrEq(mac, expected);
  }

  private tokensMatch(a: string, b: string): boolean {
    return this.timingSafeStrEq(a, b);
  }

  private timingSafeStrEq(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  }
}
