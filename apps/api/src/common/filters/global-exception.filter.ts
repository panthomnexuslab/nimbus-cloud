import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Logger as PinoLogger } from 'nestjs-pino';
import { Prisma } from '@prisma/client';

interface ErrorEnvelope {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

/**
 * Maps every uncaught error to a stable, redaction-safe error envelope.
 *
 * Notes:
 *  - We never leak Prisma constraint targets or stack traces to clients.
 *  - HttpExceptions keep their declared status code.
 *  - All non-HTTP errors are coerced to 500 with code `INTERNAL_ERROR`.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();

    const { status, code, message, details } = this.classify(exception);

    const envelope: ErrorEnvelope = {
      ok: false,
      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
        requestId: req.id,
      },
    };

    if (status >= 500) {
      this.logger.error({
        msg: 'unhandled exception',
        err: this.serialize(exception),
        path: req.originalUrl,
        method: req.method,
        requestId: req.id,
      });
    } else if (status === 429 || status === 401 || status === 403) {
      this.logger.warn({
        msg: 'rejected request',
        code,
        status,
        path: req.originalUrl,
        method: req.method,
        requestId: req.id,
        ip: req.ip,
      });
    }

    res.status(status).json(envelope);
  }

  private classify(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details?: unknown;
  } {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      const status = exception.getStatus();
      if (typeof response === 'string') {
        return { status, code: this.codeFromStatus(status), message: response };
      }
      const r = response as { message?: unknown; error?: unknown; code?: unknown };
      const message = Array.isArray(r.message)
        ? 'Validation failed'
        : typeof r.message === 'string'
          ? r.message
          : this.codeFromStatus(status);
      return {
        status,
        code: typeof r.code === 'string' ? r.code : this.codeFromStatus(status),
        message,
        details: Array.isArray(r.message) ? r.message : undefined,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // Map common Prisma errors to safe responses without leaking column names.
      if (exception.code === 'P2002') {
        return {
          status: HttpStatus.CONFLICT,
          code: 'CONFLICT',
          message: 'Resource already exists',
        };
      }
      if (exception.code === 'P2025') {
        return {
          status: HttpStatus.NOT_FOUND,
          code: 'NOT_FOUND',
          message: 'Resource not found',
        };
      }
      if (exception.code === 'P2003') {
        return {
          status: HttpStatus.BAD_REQUEST,
          code: 'FK_CONSTRAINT',
          message: 'Foreign key constraint failed',
        };
      }
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    };
  }

  private codeFromStatus(s: number): string {
    switch (s) {
      case 400: return 'BAD_REQUEST';
      case 401: return 'UNAUTHORIZED';
      case 403: return 'FORBIDDEN';
      case 404: return 'NOT_FOUND';
      case 409: return 'CONFLICT';
      case 422: return 'UNPROCESSABLE_ENTITY';
      case 429: return 'TOO_MANY_REQUESTS';
      default: return s >= 500 ? 'INTERNAL_ERROR' : 'ERROR';
    }
  }

  private serialize(e: unknown): unknown {
    if (e instanceof Error) {
      return { name: e.name, message: e.message, stack: e.stack };
    }
    return e;
  }
}
