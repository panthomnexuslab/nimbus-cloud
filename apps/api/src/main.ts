import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType, Logger as NestLogger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { HttpLoggingInterceptor } from './common/interceptors/http-logging.interceptor';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';

/**
 * Bootstraps the NestJS application with a hardened security baseline:
 *
 *  - Helmet (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, ...)
 *  - Strict CORS allowlist
 *  - JSON body limit (defense-in-depth against billion-laughs / DoS)
 *  - Cookie parser (signed cookies for refresh + CSRF)
 *  - Versioned URI prefix (/api/v1)
 *  - class-validator global pipe with `forbidNonWhitelisted` (strip + reject
 *    unknown fields)
 *  - Trust proxy when behind Nginx so req.ip is real client ip
 *  - Pino structured logging
 */
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  // pino HTTP logger
  app.useLogger(app.get(Logger));

  const config = app.get(AppConfigService);

  // Trust the first proxy hop (Nginx) so `req.ip` reflects the real client IP.
  app.set('trust proxy', 1);

  // Helmet baseline — CSP is deliberately strict; relax only via env if needed.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:', config.publicStorageUrl],
          mediaSrc: ["'self'", 'blob:', config.publicStorageUrl],
          connectSrc: ["'self'", config.publicStorageUrl, ...config.corsOrigins],
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: config.isProduction ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      hsts: config.isProduction
        ? { maxAge: 63072000, includeSubDomains: true, preload: true }
        : false,
    }),
  );

  // Strict CORS allowlist with credentials (for cookies).
  app.enableCors({
    origin: (origin, cb) => {
      if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
      return cb(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Authorization',
      'Content-Type',
      'X-CSRF-Token',
      'X-Device-Fingerprint',
      'X-Requested-With',
    ],
    exposedHeaders: ['X-CSRF-Token', 'X-Request-Id'],
    maxAge: 600,
  });

  // Cookie parser (signed cookies). CSRF uses a dedicated secret.
  app.use(cookieParser(config.csrfSecret));

  // Versioned URI prefix.
  app.setGlobalPrefix(config.apiPrefix, {
    exclude: ['health', 'metrics', 'docs', 'docs-json'],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // Body size limits (defense-in-depth; multipart uploads stream past Nest).
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { limit: '1mb', extended: true });

  // Global pipes / filters / interceptors.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      forbidUnknownValues: true,
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter(app.get(Logger)));
  app.useGlobalInterceptors(
    new HttpLoggingInterceptor(),
    new ResponseEnvelopeInterceptor(),
  );

  // OpenAPI / Swagger docs (kept off in production by default).
  if (config.swaggerEnabled) {
    const docBuilder = new DocumentBuilder()
      .setTitle('Nimbus Cloud API')
      .setDescription('Private. Secure. Everywhere.')
      .setVersion('0.1.0')
      .addBearerAuth()
      .addCookieAuth('nbs.refresh')
      .build();
    const doc = SwaggerModule.createDocument(app, docBuilder);
    SwaggerModule.setup('docs', app, doc, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  // Graceful shutdown.
  app.enableShutdownHooks();

  await app.listen(config.port, '0.0.0.0');
  NestLogger.log(
    `🌩  Nimbus API listening on http://0.0.0.0:${config.port}/${config.apiPrefix} (env=${config.nodeEnv})`,
    'Bootstrap',
  );
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
