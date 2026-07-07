import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/** Logs method, path, status and latency for every HTTP request. */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest();
    const { method, url } = req;
    const reqId = req.headers?.['x-request-id'] as string | undefined;
    const start = Date.now();

    return next.handle().pipe(
      tap(() => {
        const res = context.switchToHttp().getResponse();
        const prefix = reqId ? `[${reqId}] ` : '';
        this.logger.log(`${prefix}${method} ${url} ${res.statusCode} +${Date.now() - start}ms`);
      }),
    );
  }
}
