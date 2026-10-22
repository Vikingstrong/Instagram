import { HttpException } from '@nestjs/common';
import { authErrors, type AuthErrorCode } from '@instagram/contracts';

export class AuthError extends HttpException {
  constructor(
    readonly code: AuthErrorCode,
    readonly retryAfter?: number,
  ) {
    super(authErrors[code].message, authErrors[code].status);
  }
}
