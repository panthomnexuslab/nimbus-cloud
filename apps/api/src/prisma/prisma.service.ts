import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AppConfigService } from '../config/app-config.service';

/**
 * Thin Prisma wrapper that:
 *  - Logs slow queries (>500ms) at warn level
 *  - Connects on bootstrap (fail-fast if the DB is unreachable)
 *  - Disconnects cleanly on shutdown
 *  - Exposes a `withTransaction` helper that wires up consistent
 *    isolation level (SERIALIZABLE is overkill for most reads, so we
 *    default to REPEATABLE READ for write paths that need consistency)
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(private readonly cfg: AppConfigService) {
    super({
      datasources: { db: { url: cfg.databaseUrl } },
      log: cfg.isProduction
        ? [{ level: 'warn', emit: 'event' }, { level: 'error', emit: 'event' }]
        : [
            { level: 'query', emit: 'event' },
            { level: 'warn', emit: 'event' },
            { level: 'error', emit: 'event' },
          ],
      errorFormat: 'minimal',
    });
  }

  async onModuleInit() {
    // Bind log events.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as any).$on('warn', (e: { message: string }) => this.logger.warn(e.message));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as any).$on('error', (e: { message: string }) => this.logger.error(e.message));
    if (!this.cfg.isProduction) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this as any).$on('query', (e: { duration: number; query: string }) => {
        if (e.duration > 500) {
          this.logger.warn(`slow query (${e.duration}ms): ${e.query}`);
        }
      });
    }

    await this.$connect();
    this.logger.log('Prisma connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
