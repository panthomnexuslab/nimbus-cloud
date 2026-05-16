import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { Request, Response } from 'express';

/**
 * Concise per-request log line — pino-http already logs every request,
 * but this adds an additional structured "outcome" line that includes
 * status code and elapsed time, plus a marker for security-sensitive
 * routes.
 */
@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request & { id?: string }>();
    const res = context.switchToHttp().getResponse<Response>();
    const start = Date.now();
    return next.handle().pipe(
      tap({
        next: () => this.log(req, res, start),
        error: () => this.log(req, res, start),
      }),
    );
  }

  private log(req: Request & { id?: string }, res: Response, start: number) {
    const ms = Date.now() - start;
    const sec = req.originalUrl.includes('/auth/') || req.originalUrl.includes('/admin/');
    this.logger.log(
      `${req.method} ${req.originalUrl} -> ${res.statusCode} ${ms}ms` +
        (sec ? ' [security-route]' : ''),
    );
  }
}
