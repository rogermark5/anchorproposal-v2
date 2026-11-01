import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = host.switchToHttp().getRequest() as { requestId?: string; method?: string; path?: string };
    const requestId = request.requestId;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      message = typeof res === 'string' ? res : (res as { message?: string }).message || message;
    }
    const databaseError = exception as { code?: string; meta?: { target?: string[] } } | null;
    if (['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(databaseError?.code || '')) {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      message = 'The database is temporarily unavailable or busy. Your session is kept; please try again shortly.';
      response.setHeader('Retry-After', '2');
    }
    if (databaseError?.code === 'P2002' && databaseError.meta?.target?.includes('normalizedJobUrl')) {
      status = HttpStatus.CONFLICT;
      message = 'This profile already has an application for this job link.';
    }

    this.logger.error(`[${requestId}] ${request.method} ${request.path} HTTP ${status}: ${exception instanceof Error ? exception.message : message}`);

    response.status(status).json({
      statusCode: status,
      message: Array.isArray(message) ? message : [message],
      requestId,
      timestamp: new Date().toISOString(),
    });
  }
}
