import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { AppConfigService } from '../../../config/app-config.service';
import { RedisService } from '../../../redis/redis.service';

/**
 * Brute-force guard for `/auth/login`. We use TWO counters:
 *  - per-IP   : protects against credential stuffing from a single source
 *  - per-email: protects against targeted attacks across IPs (Tor/proxies)
 *
 * Crossing the threshold within the window triggers a lockout window
 * (HTTP 429). Successful login resets both counters.
 */
@Injectable()
export class LoginGuard implements CanActivate {
  constructor(
    private readonly cfg: AppConfigService,
    private readonly redis: RedisService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { body: { email?: string } }>();
    const ip = req.ip ?? 'unknown';
    const email = (req.body?.email ?? '').toLowerCase().slice(0, 254);

    const ipKey = `nbs:login:ip:${ip}`;
    const emailKey = email ? `nbs:login:email:${email}` : null;

    const ipCount = await this.redis.client.get(ipKey);
    if (Number(ipCount) >= this.cfg.loginLockoutThreshold) {
      throw new HttpException(
        {
          code: 'LOGIN_LOCKED_IP',
          message: 'Too many failed login attempts from this IP. Try again later.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (emailKey) {
      const emailCount = await this.redis.client.get(emailKey);
      if (Number(emailCount) >= this.cfg.loginLockoutThreshold) {
        throw new ForbiddenException({
          code: 'ACCOUNT_LOCKED',
          message: 'This account is temporarily locked due to repeated failed sign-ins.',
        });
      }
    }
    return true;
  }
}
