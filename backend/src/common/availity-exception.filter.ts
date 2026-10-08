import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { AvailityRestError } from '../availity-rest/availity-rest.service';
import { OptumRequestError } from '../optum/optum.contracts';
import { SftpOperationError } from '../sftp/sftp.service';

@Catch()
export class AvailityExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AvailityRestError || exception instanceof SftpOperationError) {
      response.status(exception.statusCode).json({
        error: exception.message,
        op: exception.op,
        upstream: exception.upstream,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const record = body && typeof body === 'object' ? (body as { message?: string | string[] }) : undefined;
      const message = typeof body === 'string' ? body : record?.message;
      const rendered = Array.isArray(message) ? message.join('\n') : message || exception.message;
      const op = exception instanceof OptumRequestError ? exception.step : 'http';
      response.status(status).json({
        error: rendered,
        op,
        upstream: typeof body === 'string' ? body : JSON.stringify(body),
      });
      return;
    }

    const message = exception instanceof Error ? exception.message : 'Unhandled error';
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: message,
      op: 'unhandled',
      upstream: message,
    });
  }
}
