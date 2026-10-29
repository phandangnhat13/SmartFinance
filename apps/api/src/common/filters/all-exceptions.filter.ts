import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import type { ApiErrorBody } from '@smart-finance/shared-types';

const CODE_BY_STATUS: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_ERROR',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'INTERNAL_ERROR',
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = CODE_BY_STATUS[status];
    let message = 'Đã xảy ra lỗi hệ thống';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      let explicitCode: string | undefined;
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const obj = body as Record<string, unknown>;
        if (Array.isArray(obj.message)) {
          message = 'Dữ liệu không hợp lệ';
          details = obj.message;
        } else if (typeof obj.message === 'string') {
          message = obj.message;
        }
        if (typeof obj.code === 'string') explicitCode = obj.code;
        if (obj.details !== undefined) details = obj.details;
      }
      code = explicitCode ?? CODE_BY_STATUS[status] ?? 'ERROR';
      if (status >= 500) {
        this.logger.error(
          `Request failed ${request.method} ${request.path} status=${status}`,
          exception.stack,
        );
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        code = 'CONFLICT';
        message = 'Dữ liệu đã tồn tại';
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        code = 'NOT_FOUND';
        message = 'Không tìm thấy dữ liệu';
      } else if (exception.code === 'P2003') {
        status = HttpStatus.CONFLICT;
        code = 'CONFLICT';
        message = 'Dữ liệu đang được tham chiếu và không thể thay đổi';
      } else {
        this.logger.error(
          `Prisma error ${exception.code} on ${request.method} ${request.path}`,
          exception.stack,
        );
      }
    } else {
      const stack = exception instanceof Error ? exception.stack : String(exception);
      this.logger.error(`Unhandled error on ${request.method} ${request.path}`, stack);
    }

    const body: ApiErrorBody = {
      statusCode: status,
      code: code ?? 'ERROR',
      message,
      ...(details !== undefined ? { details } : {}),
    };

    if (status === HttpStatus.TOO_MANY_REQUESTS && !response.headersSent) {
      response.setHeader('Retry-After', '60');
    }

    response.status(status).json(body);
  }
}
