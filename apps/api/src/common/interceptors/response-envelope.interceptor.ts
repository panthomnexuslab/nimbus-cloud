import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import type { Request } from 'express';

/**
 * Wraps every successful JSON response in the shape:
 *
 *   { ok: true, data: <payload>, requestId: "<uuid>" }
 *
 * Skipped automatically for:
 *  - `StreamableFile` (download/stream responses)
 *  - responses that already declare `ok: true|false` (idempotent)
 *  - SSR-friendly raw responses on `/health`, `/metrics`
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request & { id?: string }>();
    if (req.originalUrl?.startsWith('/health') || req.originalUrl?.startsWith('/metrics')) {
      return next.handle();
    }
    return next.handle().pipe(
      map((data) => {
        if (data instanceof StreamableFile) return data;
        if (data && typeof data === 'object' && 'ok' in (data as object)) return data;
        return { ok: true, data, requestId: req.id };
      }),
    );
  }
}
