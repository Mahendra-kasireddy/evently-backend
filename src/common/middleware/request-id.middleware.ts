import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

/**
 * Assigns a correlation ID to every request. Honours an `x-request-id` supplied
 * by an upstream load balancer / reverse proxy; otherwise generates one. The ID
 * is echoed back on the response and normalized onto the request headers so the
 * logging interceptor can tag every log line — essential for tracing a single
 * request across multiple backend instances behind a load balancer.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const existing = req.headers['x-request-id'];
    const id = (Array.isArray(existing) ? existing[0] : existing) || randomUUID();
    req.headers['x-request-id'] = id;
    res.setHeader('x-request-id', id);
    next();
  }
}
