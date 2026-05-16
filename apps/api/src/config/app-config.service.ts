import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { z } from 'zod';

/**
 * Schema-validated, fail-fast configuration. Any missing or malformed
 * variable causes the API to refuse to boot — this avoids "works in dev,
 * silently broken in prod" classes of bugs.
 */
const StorageDriverSchema = z.enum(['r2', 's3', 'local']);

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  API_PREFIX: z.string().default('api/v1'),
  APP_BASE_URL: z.string().url().default('http://localhost:4000'),
  WEB_BASE_URL: z.string().url().default('http://localhost:3000'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL: z.coerce.number().int().positive().default(60 * 60 * 24 * 30),
  JWT_ISSUER: z.string().default('nimbus-cloud'),
  JWT_AUDIENCE: z.string().default('nimbus-cloud-clients'),

  COOKIE_DOMAIN: z.string().default('localhost'),
  COOKIE_SECURE: z
    .union([z.boolean(), z.string()])
    .transform((v) => v === true || v === 'true')
    .default(false),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  CSRF_SECRET: z.string().min(16),

  TOTP_ISSUER: z.string().default('Nimbus Cloud'),

  GOOGLE_OAUTH_ENABLED: z
    .union([z.boolean(), z.string()])
    .transform((v) => v === true || v === 'true')
    .default(false),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_CALLBACK_URL: z.string().default('http://localhost:4000/api/v1/auth/google/callback'),

  STORAGE_DRIVER: StorageDriverSchema.default('local'),
  STORAGE_LOCAL_ROOT: z.string().default('./.data/storage'),
  STORAGE_QUARANTINE_BUCKET: z.string().default('nimbus-quarantine'),
  STORAGE_BUCKET: z.string().default('nimbus-files'),
  STORAGE_PUBLIC_URL: z.string().url().default('http://localhost:4000/files'),

  R2_ACCOUNT_ID: z.string().default(''),
  R2_ACCESS_KEY_ID: z.string().default(''),
  R2_SECRET_ACCESS_KEY: z.string().default(''),
  R2_REGION: z.string().default('auto'),
  R2_ENDPOINT: z.string().default(''),

  S3_ACCESS_KEY_ID: z.string().default(''),
  S3_SECRET_ACCESS_KEY: z.string().default(''),
  S3_REGION: z.string().default('us-east-1'),
  S3_ENDPOINT: z.string().default(''),

  MASTER_KEK_HEX: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'MASTER_KEK_HEX must be 64 hex chars (32 bytes)'),

  RATE_LIMIT_TTL: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  LOGIN_LOCKOUT_THRESHOLD: z.coerce.number().int().positive().default(5),
  LOGIN_LOCKOUT_WINDOW: z.coerce.number().int().positive().default(900),

  CLAMAV_ENABLED: z
    .union([z.boolean(), z.string()])
    .transform((v) => v === true || v === 'true')
    .default(false),
  CLAMAV_HOST: z.string().default('localhost'),
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
  CLAMAV_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),

  DEFAULT_STORAGE_QUOTA_BYTES: z.coerce.bigint().default(200n * 1024n * 1024n * 1024n),
  DEFAULT_MAX_UPLOAD_BYTES: z.coerce.bigint().default(10n * 1024n * 1024n * 1024n),

  ADMIN_BOOTSTRAP_EMAIL: z.string().email().optional().or(z.literal('')),
  ADMIN_BOOTSTRAP_PASSWORD: z.string().min(12).optional().or(z.literal('')),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  SWAGGER_ENABLED: z
    .union([z.boolean(), z.string()])
    .transform((v) => v === true || v === 'true')
    .optional(),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

@Injectable()
export class AppConfigService implements OnModuleInit {
  private readonly logger = new Logger(AppConfigService.name);
  private readonly cfg: AppConfig;

  constructor() {
    const parsed = ConfigSchema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `  • ${i.path.join('.')}: ${i.message}`)
        .join('\n');
      throw new Error(`Invalid environment configuration:\n${issues}`);
    }
    this.cfg = parsed.data;
  }

  onModuleInit() {
    this.logger.log(
      `Loaded config: env=${this.cfg.NODE_ENV} storage=${this.cfg.STORAGE_DRIVER} ` +
        `redis=${this.redact(this.cfg.REDIS_URL)} db=${this.redact(this.cfg.DATABASE_URL)}`,
    );
  }

  private redact(url: string): string {
    return url.replace(/\/\/[^@]+@/, '//[REDACTED]@');
  }

  // Convenience getters ---------------------------------------------------
  get nodeEnv() { return this.cfg.NODE_ENV; }
  get isProduction() { return this.cfg.NODE_ENV === 'production'; }
  get isDevelopment() { return this.cfg.NODE_ENV === 'development'; }
  get isTest() { return this.cfg.NODE_ENV === 'test'; }
  get port() { return this.cfg.PORT; }
  get apiPrefix() { return this.cfg.API_PREFIX; }
  get appBaseUrl() { return this.cfg.APP_BASE_URL; }
  get webBaseUrl() { return this.cfg.WEB_BASE_URL; }
  get corsOrigins() {
    return this.cfg.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  }

  get databaseUrl() { return this.cfg.DATABASE_URL; }
  get redisUrl() { return this.cfg.REDIS_URL; }

  get jwtAccessSecret() { return this.cfg.JWT_ACCESS_SECRET; }
  get jwtRefreshSecret() { return this.cfg.JWT_REFRESH_SECRET; }
  get jwtAccessTtl() { return this.cfg.JWT_ACCESS_TTL; }
  get jwtRefreshTtl() { return this.cfg.JWT_REFRESH_TTL; }
  get jwtIssuer() { return this.cfg.JWT_ISSUER; }
  get jwtAudience() { return this.cfg.JWT_AUDIENCE; }

  get cookieDomain() { return this.cfg.COOKIE_DOMAIN; }
  get cookieSecure() { return this.cfg.COOKIE_SECURE; }
  get cookieSameSite() { return this.cfg.COOKIE_SAMESITE; }
  get csrfSecret() { return this.cfg.CSRF_SECRET; }

  get totpIssuer() { return this.cfg.TOTP_ISSUER; }

  get googleOAuthEnabled() { return this.cfg.GOOGLE_OAUTH_ENABLED; }
  get googleClientId() { return this.cfg.GOOGLE_CLIENT_ID; }
  get googleClientSecret() { return this.cfg.GOOGLE_CLIENT_SECRET; }
  get googleCallbackUrl() { return this.cfg.GOOGLE_CALLBACK_URL; }

  get storageDriver() { return this.cfg.STORAGE_DRIVER; }
  get storageLocalRoot() { return this.cfg.STORAGE_LOCAL_ROOT; }
  get storageQuarantineBucket() { return this.cfg.STORAGE_QUARANTINE_BUCKET; }
  get storageBucket() { return this.cfg.STORAGE_BUCKET; }
  get publicStorageUrl() { return this.cfg.STORAGE_PUBLIC_URL; }

  get r2() {
    return {
      accountId: this.cfg.R2_ACCOUNT_ID,
      accessKeyId: this.cfg.R2_ACCESS_KEY_ID,
      secretAccessKey: this.cfg.R2_SECRET_ACCESS_KEY,
      region: this.cfg.R2_REGION,
      endpoint:
        this.cfg.R2_ENDPOINT ||
        (this.cfg.R2_ACCOUNT_ID
          ? `https://${this.cfg.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
          : ''),
    };
  }

  get s3() {
    return {
      accessKeyId: this.cfg.S3_ACCESS_KEY_ID,
      secretAccessKey: this.cfg.S3_SECRET_ACCESS_KEY,
      region: this.cfg.S3_REGION,
      endpoint: this.cfg.S3_ENDPOINT,
    };
  }

  get masterKek(): Buffer { return Buffer.from(this.cfg.MASTER_KEK_HEX, 'hex'); }

  get rateLimitTtl() { return this.cfg.RATE_LIMIT_TTL; }
  get rateLimitMax() { return this.cfg.RATE_LIMIT_MAX; }
  get authRateLimitMax() { return this.cfg.AUTH_RATE_LIMIT_MAX; }
  get loginLockoutThreshold() { return this.cfg.LOGIN_LOCKOUT_THRESHOLD; }
  get loginLockoutWindow() { return this.cfg.LOGIN_LOCKOUT_WINDOW; }

  get clamavEnabled() { return this.cfg.CLAMAV_ENABLED; }
  get clamavHost() { return this.cfg.CLAMAV_HOST; }
  get clamavPort() { return this.cfg.CLAMAV_PORT; }
  get clamavTimeoutMs() { return this.cfg.CLAMAV_TIMEOUT_MS; }

  get defaultQuotaBytes() { return this.cfg.DEFAULT_STORAGE_QUOTA_BYTES; }
  get defaultMaxUploadBytes() { return this.cfg.DEFAULT_MAX_UPLOAD_BYTES; }

  get adminBootstrap() {
    if (!this.cfg.ADMIN_BOOTSTRAP_EMAIL || !this.cfg.ADMIN_BOOTSTRAP_PASSWORD) return null;
    return {
      email: this.cfg.ADMIN_BOOTSTRAP_EMAIL,
      password: this.cfg.ADMIN_BOOTSTRAP_PASSWORD,
    };
  }

  get logLevel() { return this.cfg.LOG_LEVEL; }

  get swaggerEnabled() {
    if (typeof this.cfg.SWAGGER_ENABLED === 'boolean') return this.cfg.SWAGGER_ENABLED;
    return !this.isProduction;
  }
}
