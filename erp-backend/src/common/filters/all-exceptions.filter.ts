import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';

interface ErrorCodeMap {
  [key: number]: string;
}

const ERROR_CODES: ErrorCodeMap = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'BUSINESS_RULE_VIOLATION',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
  502: 'INTEGRATION_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let details: any[] | undefined;
    let code = 'INTERNAL_ERROR';
    // Structured fields an exception may expose to clients (e.g. the approval
    // request a blocked action is waiting on).
    let extra: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        const res = exceptionResponse as any;
        message = res.message || exception.message;
        code = res.error || ERROR_CODES[status] || 'INTERNAL_ERROR';
        if (res.approvalRequestId) {
          extra = { approvalRequestId: res.approvalRequestId, requestNumber: res.requestNumber };
        }

        if (Array.isArray(res.message)) {
          details = res.message.map((msg: string) => ({ message: msg }));
          message = 'Validation failed';
          code = 'VALIDATION_ERROR';
        }
      }
    } else if (exception instanceof Error) {
      // Unexpected errors (database, bugs) can reveal internals: clients get a
      // generic message in production; the full error is logged below.
      message = process.env.APP_ENV === 'production' ? 'Internal server error' : exception.message;
    }

    code = ERROR_CODES[status] || code;

    this.logger.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        requestId: (request as any).requestId,
        tenantId: (request as any).user?.tenantId,
        path: request.url,
        method: request.method,
        statusCode: status,
        error: {
          code,
          message: exception instanceof Error ? exception.message : message,
          ...(status >= 500 && exception instanceof Error && { stack: exception.stack }),
        },
      }),
    );

    response.status(status).json({
      success: false,
      error: {
        code,
        message,
        ...(details && { details }),
        ...extra,
      },
    });
  }
}
