import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { ZodError } from 'zod';

type RequestLike = {
  originalUrl?: string;
  url?: string;
};

type ResponseLike = {
  status(code: number): ResponseLike;
  json(payload: unknown): void;
};

@Catch(ZodError)
export class ZodExceptionFilter implements ExceptionFilter {
  catch(exception: ZodError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<RequestLike>();
    const response = ctx.getResponse<ResponseLike>();
    const flattened = exception.flatten();

    const messages = [
      ...flattened.formErrors,
      ...Object.values(flattened.fieldErrors)
        .flat()
        .filter((value): value is string => Boolean(value))
    ];

    response.status(400).json({
      statusCode: 400,
      error: 'Bad Request',
      message: messages.length > 0 ? messages.join('; ') : 'Payload invalido.',
      issues: {
        formErrors: flattened.formErrors,
        fieldErrors: flattened.fieldErrors
      },
      path: request.originalUrl ?? request.url ?? ''
    });
  }
}
