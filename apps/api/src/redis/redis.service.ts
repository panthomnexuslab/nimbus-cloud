import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from '../config/app-config.service';

/**
 * Centralized Redis client. We expose two connections:
 *
 *  - `client` for routine commands (rate limiting, locks, caching)
 *  - `subscriber` for pub/sub fan-out used by the realtime WebSocket
 *    gateway. ioredis requires a dedicated connection for subscribers.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  public client!: Redis;
  public subscriber!: Redis;
  public publisher!: Redis;

  constructor(private readonly cfg: AppConfigService) {}

  async onModuleInit() {
    this.client = new Redis(this.cfg.redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    this.subscriber = this.client.duplicate();
    this.publisher = this.client.duplicate();

    for (const c of [this.client, this.subscriber, this.publisher]) {
      c.on('error', (err) => this.logger.error(`Redis error: ${err.message}`));
    }

    await this.client.ping();
    this.logger.log('Redis connected');
  }

  async onModuleDestroy() {
    await Promise.allSettled([
      this.client?.quit(),
      this.subscriber?.quit(),
      this.publisher?.quit(),
    ]);
  }

  /** Atomic increment with a TTL — used by rate-limit + brute-force counters. */
  async incrWithTtl(key: string, ttlSeconds: number): Promise<number> {
    const multi = this.client.multi();
    multi.incr(key);
    multi.expire(key, ttlSeconds, 'NX');
    const [count] = (await multi.exec()) ?? [];
    return Number((count?.[1] as number) ?? 0);
  }

  /** Acquire a short-lived distributed lock via SET NX EX. */
  async acquireLock(key: string, ttlSeconds: number, token: string): Promise<boolean> {
    const result = await this.client.set(key, token, 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async releaseLock(key: string, token: string): Promise<void> {
    const lua =
      'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';
    await this.client.eval(lua, 1, key, token);
  }
}
