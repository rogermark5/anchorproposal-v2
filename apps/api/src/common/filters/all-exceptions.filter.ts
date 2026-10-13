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
    const requestId = (host.switchToHttp().getRequest() as { requestId?: string }).requestId;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      message = typeof res === 'string' ? res : (res as { message?: string }).message || message;
    }
    const databaseError = exception as { code?: string; meta?: { target?: string[] } } | null;
    if (databaseError?.code === 'P2002' && databaseError.meta?.target?.includes('normalizedJobUrl')) {
      status = HttpStatus.CONFLICT;
      message = 'This profile already has an application for this job link.';
    }

    this.logger.error(exception);

    response.status(status).json({
      statusCode: status,
      message: Array.isArray(message) ? message : [message],
      requestId,
      timestamp: new Date().toISOString(),
    });
  }
}
