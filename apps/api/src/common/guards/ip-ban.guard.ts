import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { RedisService } from '../../redis/redis.service';

/**
 * Cheap, Redis-backed IP-ban check that runs before any route handler.
 *
 * Admins ban an IP via `POST /admin/ip-bans`; that writes to Postgres
 * AND populates `nbs:banned-ip:<ip>` with an optional TTL. We only read
 * Redis here for hot-path performance.
 */
@Injectable()
export class IpBanGuard implements CanActivate {
  constructor(private readonly redis: RedisService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const ip = req.ip ?? req.socket.remoteAddress ?? '';
    if (!ip) return true;
    const banned = await this.redis.client.exists(`nbs:banned-ip:${ip}`);
    if (banned) {
      throw new ForbiddenException({
        code: 'IP_BANNED',
        message: 'Your IP is temporarily banned',
      });
    }
    return true;
  }
}
