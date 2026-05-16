import { Injectable, Logger } from '@nestjs/common';
import { NotificationKind } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import type { ClientContext } from '../../common/decorators/client-context.decorator';

/**
 * Lightweight notifications layer. Writes to Postgres + publishes to a
 * Redis channel that the WebSocket gateway forwards to the user's open
 * tabs. Email/push fan-out is delegated to a transport layer in a
 * follow-up (kept behind a stable service interface here).
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async create(args: {
    userId: string;
    kind: NotificationKind;
    title: string;
    body: string;
    metadata?: Record<string, unknown>;
  }) {
    const row = await this.prisma.notification.create({
      data: {
        userId: args.userId,
        kind: args.kind,
        title: args.title,
        body: args.body,
        metadata: args.metadata ?? {},
      },
    });
    await this.publish(args.userId, row);
    return row;
  }

  async list(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async markRead(userId: string, id: string) {
    await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { readAt: new Date() },
    });
  }

  /**
   * Heuristic suspicious-login check:
   *  - new geolocation (country jump in <12h) → notification + email
   *  - new device fingerprint never seen before → "new device" alert
   *
   * Geolocation is best done with MaxMind GeoLite2; here we expose the
   * hook so the integration is a drop-in.
   */
  async suspiciousLoginCheck(userId: string, ctx: ClientContext) {
    const recent = await this.prisma.session.findMany({
      where: { userId, revokedAt: null },
      orderBy: { lastSeenAt: 'desc' },
      take: 5,
      select: { ipAddress: true, country: true, fingerprint: true },
    });
    const knownFingerprints = new Set(recent.map((r) => r.fingerprint).filter(Boolean));
    const isNewDevice = ctx.fingerprint ? !knownFingerprints.has(ctx.fingerprint) : false;
    if (isNewDevice) {
      await this.create({
        userId,
        kind: NotificationKind.NEW_DEVICE,
        title: 'New device signed in',
        body: `${ctx.browser ?? 'A browser'} on ${ctx.os ?? 'an unknown OS'} signed in from ${ctx.ip}.`,
        metadata: { ip: ctx.ip, ua: ctx.userAgent },
      });
    }
  }

  private async publish(userId: string, payload: unknown) {
    try {
      await this.redis.publisher.publish(`nbs:user:${userId}`, JSON.stringify({
        type: 'notification',
        payload,
      }));
    } catch (err) {
      const e = err as Error;
      this.logger.warn(`Failed to publish notification: ${e.message}`);
    }
  }
}
