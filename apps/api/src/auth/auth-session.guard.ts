import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { AuthUser } from '@instagram/contracts';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import { AuthSecurity, cookieValue } from './auth-security.js';
import { AuthError } from './auth.error.js';

export type AuthenticatedRequest = Request & { authUser?: AuthUser };
@Injectable()
export class VerifiedSessionGuard implements CanActivate {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AuthSecurity) private readonly security: AuthSecurity,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await this.auth.session(
      cookieValue(request, this.security.sessionCookie),
    );
    if (!user) throw new AuthError('AUTHENTICATION_REQUIRED');
    if (!user.emailVerified) throw new AuthError('EMAIL_VERIFICATION_REQUIRED');
    request.authUser = user;
    return true;
  }
}
