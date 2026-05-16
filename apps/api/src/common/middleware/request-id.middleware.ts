import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

/**
 * Attaches a uuid request id (or honours an inbound `X-Request-Id`) to
 * every request so it can flow through the logger, error responses, and
 * the audit log chain.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request & { id?: string }, res: Response, next: NextFunction) {
    const incoming = (req.headers['x-request-id'] as string | undefined)?.trim();
    const id = incoming && /^[a-zA-Z0-9-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    req.id = id;
    res.setHeader('X-Request-Id', id);
    next();
  }
}
