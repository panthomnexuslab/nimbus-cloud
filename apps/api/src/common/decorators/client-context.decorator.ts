import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { UAParser } from 'ua-parser-js';

export interface ClientContext {
  ip: string;
  userAgent: string;
  fingerprint?: string;
  browser?: string;
  os?: string;
  device?: string;
  requestId?: string;
}

/**
 * Convenience accessor that synthesizes a normalized client context
 * (IP, parsed UA, opt-in device fingerprint header) for use in audit
 * logs and risk-scoring.
 */
export const Client = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ClientContext => {
    const req = ctx.switchToHttp().getRequest<Request & { id?: string }>();
    const ua = req.headers['user-agent'] ?? '';
    const parsed = new UAParser(ua).getResult();
    const fingerprint =
      (req.headers['x-device-fingerprint'] as string | undefined)?.slice(0, 256) ?? undefined;
    return {
      ip: req.ip ?? req.socket?.remoteAddress ?? 'unknown',
      userAgent: typeof ua === 'string' ? ua.slice(0, 512) : '',
      fingerprint,
      browser: parsed.browser.name,
      os: parsed.os.name,
      device: parsed.device.type ?? 'desktop',
      requestId: req.id,
    };
  },
);
