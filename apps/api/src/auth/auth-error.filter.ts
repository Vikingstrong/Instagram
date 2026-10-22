import {
  Catch,
  HttpException,
  Inject,
  type ArgumentsHost,
} from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import {
  AuthApiErrorResponseSchema,
  authErrors,
  type AuthErrorCode,
} from '@instagram/contracts';
import type { Request, Response } from 'express';
import { AuthError } from './auth.error.js';
import { Prisma } from '../generated/prisma/client.js';

// Route groups that answer with the Auth error contract, including Nest's own
// 404/400 for unknown or malformed requests under them.
const contractPath = /^\/api\/v1\/(?:auth|users|me)(?:\/|$)/;

@Catch()
export class AuthErrorFilter {
  constructor(
    @Inject(HttpAdapterHost) private readonly adapter: HttpAdapterHost,
  ) {}
  catch(exception: unknown, host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<Request>();
    if (!contractPath.test(request.path) && !(exception instanceof AuthError))
      return new BaseExceptionFilter(this.adapter.httpAdapter).catch(
        exception,
        host,
      );
    const response = host.switchToHttp().getResponse<Response>();
    let status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    // Nest maps malformed JSON but can pass body-parser's size error through.
    // Read only the known discriminator; never serialize its body/message.
    if (
      exception &&
      typeof exception === 'object' &&
      'type' in exception &&
      exception.type === 'entity.too.large'
    )
      status = 413;
    if (
      exception instanceof Prisma.PrismaClientInitializationError ||
      (exception instanceof Prisma.PrismaClientKnownRequestError &&
        [
          'P1000',
          'P1001',
          'P1002',
          'P1003',
          'P1008',
          'P1010',
          'P1017',
          'P2024',
        ].includes(exception.code))
    )
      status = 503;
    let code: AuthErrorCode =
      exception instanceof AuthError ? exception.code : 'INTERNAL_ERROR';
    if (!(exception instanceof AuthError)) {
      if ([400, 404, 405, 413, 415].includes(status)) code = 'INVALID_REQUEST';
      else if (status === 503) code = 'SERVICE_UNAVAILABLE';
    }
    // Never log/serialize the exception, Zod input, credentials or driver error.
    response.setHeader('Cache-Control', 'no-store');
    if (exception instanceof AuthError && exception.retryAfter)
      response.setHeader('Retry-After', exception.retryAfter);
    response.status(status).json(
      AuthApiErrorResponseSchema.parse({
        error: {
          code,
          message: authErrors[code].message,
          requestId: randomUUID(),
        },
      }),
    );
  }
}
