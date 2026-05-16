import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

import { AppConfigModule } from './config/app-config.module';
import { AppConfigService } from './config/app-config.service';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';

import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { FoldersModule } from './modules/folders/folders.module';
import { FilesModule } from './modules/files/files.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { StorageModule } from './modules/storage/storage.module';
import { SharingModule } from './modules/sharing/sharing.module';
import { RecycleBinModule } from './modules/recycle-bin/recycle-bin.module';
import { AuditModule } from './modules/audit/audit.module';
import { MalwareModule } from './modules/malware/malware.module';
import { SecurityModule } from './modules/security/security.module';
import { AdminModule } from './modules/admin/admin.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { HealthModule } from './modules/health/health.module';
import { CryptoModule } from './modules/crypto/crypto.module';

import { CsrfMiddleware } from './common/middleware/csrf.middleware';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { IpBanGuard } from './common/guards/ip-ban.guard';
import { MiddlewareConsumer, NestModule } from '@nestjs/common';

/**
 * Top-level application module. Wiring is intentionally explicit so an
 * auditor can see every cross-cutting concern (rate limiting, CSRF,
 * IP-ban guard, request-id, structured logging) in one place.
 */
@Module({
  imports: [
    // Config (validated, strongly typed)
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    AppConfigModule,

    // Structured logging with redaction
    LoggerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (cfg: AppConfigService) => ({
        pinoHttp: {
          level: cfg.logLevel,
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers["x-csrf-token"]',
              'req.body.password',
              'req.body.newPassword',
              'req.body.confirmPassword',
              'req.body.totpCode',
              'res.headers["set-cookie"]',
              '*.passwordHash',
              '*.tokenHash',
              '*.secretHash',
              '*.sessionTokenHash',
            ],
            censor: '[REDACTED]',
          },
          transport: cfg.isProduction
            ? undefined
            : {
                target: 'pino-pretty',
                options: { singleLine: true, translateTime: 'SYS:HH:MM:ss.l' },
              },
          customProps: (req) => ({ requestId: (req as { id?: string }).id }),
        },
      }),
    }),

    // Global rate limiter (per-IP). Per-endpoint stricter limits live on
    // the AuthController.
    ThrottlerModule.forRootAsync({
      imports: [AppConfigModule],
      inject: [AppConfigService],
      useFactory: (cfg: AppConfigService) => [
        {
          name: 'default',
          ttl: cfg.rateLimitTtl * 1000,
          limit: cfg.rateLimitMax,
        },
      ],
    }),

    // Cron jobs (recycle-bin purge, upload expiry, etc.)
    ScheduleModule.forRoot(),

    // Infrastructure
    PrismaModule,
    RedisModule,
    StorageModule,
    CryptoModule,

    // Domain modules
    AuthModule,
    UsersModule,
    FoldersModule,
    FilesModule,
    UploadsModule,
    SharingModule,
    RecycleBinModule,
    AuditModule,
    MalwareModule,
    SecurityModule,
    AdminModule,
    RealtimeModule,
    NotificationsModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: IpBanGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
    // CSRF protection on all mutating requests. GET / HEAD / OPTIONS exempt.
    consumer.apply(CsrfMiddleware).forRoutes('*');
  }
}
