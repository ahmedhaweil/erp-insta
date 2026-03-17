import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url } = request;
    const requestId = request.requestId || 'unknown';
    const tenantId = request.user?.tenantId || 'anonymous';
    const userId = request.user?.sub || 'anonymous';
    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          const response = context.switchToHttp().getResponse();
          this.logger.log(
            JSON.stringify({
              level: 'info',
              timestamp: new Date().toISOString(),
              requestId,
              tenantId,
              userId,
              method,
              url,
              statusCode: response.statusCode,
              duration,
            }),
          );
        },
        error: (error) => {
          const duration = Date.now() - startTime;
          this.logger.error(
            JSON.stringify({
              level: 'error',
              timestamp: new Date().toISOString(),
              requestId,
              tenantId,
              userId,
              method,
              url,
              statusCode: error.status || 500,
              duration,
              error: { message: error.message },
            }),
          );
        },
      }),
    );
  }
}
