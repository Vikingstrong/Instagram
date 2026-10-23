import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';
import { AUTH_CONFIG, type AuthConfiguration } from './auth.config.js';
import { AuthError } from './auth.error.js';
import { AuthRateLimiter } from './auth-rate-limiter.js';

export function cookieValue(
  request: Request,
  name: string,
): string | undefined {
  const entries =
    request.headers.cookie
      ?.split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${name}=`)) ?? [];
  return entries.length === 1 ? entries[0]!.slice(name.length + 1) : undefined;
}

@Injectable()
export class AuthSecurity {
  readonly sessionCookie: string;
  private readonly csrfCookie: string;
  readonly cookieOptions: CookieOptions;
  readonly mutationIpLimit: number;
  readonly readIpLimit: number;
  constructor(@Inject(AUTH_CONFIG) private readonly config: AuthConfiguration) {
    this.mutationIpLimit = config.mutationIpLimit;
    this.readIpLimit = config.readIpLimit;
    this.sessionCookie = config.secureCookies
      ? '__Host-instagram-session'
      : 'instagram-session';
    this.csrfCookie = config.secureCookies
      ? '__Host-instagram-csrf'
      : 'instagram-csrf';
    this.cookieOptions = {
      httpOnly: true,
      secure: config.secureCookies,
      sameSite: 'lax',
      path: '/',
    };
  }
  private sign(value: string): string {
    return createHmac('sha256', Buffer.from(this.config.csrfSecret, 'hex'))
      .update(value)
      .digest('base64url');
  }
  private valid(token: string | undefined): token is string {
    if (!token || !/^[A-Za-z0-9_-]{43}\.\d{10}\.[A-Za-z0-9_-]{43}$/.test(token))
      return false;
    const [nonce, issued, signature] = token.split('.');
    const age = Math.floor(Date.now() / 1000) - Number(issued);
    return (
      age >= 0 &&
      age < 3600 &&
      timingSafeEqual(
        Buffer.from(signature!),
        Buffer.from(this.sign(`${nonce}.${issued}`)),
      )
    );
  }
  csrf(request: Request, response: Response): string {
    const existing = cookieValue(request, this.csrfCookie);
    if (this.valid(existing)) return existing;
    const value = `${randomBytes(32).toString('base64url')}.${Math.floor(Date.now() / 1000)}`;
    const token = `${value}.${this.sign(value)}`;
    response.cookie(this.csrfCookie, token, {
      ...this.cookieOptions,
      maxAge: 3600_000,
    });
    return token;
  }
  assertMutation(request: Request): void {
    const token = cookieValue(request, this.csrfCookie);
    if (
      !request.headers.origin ||
      !this.config.allowedOrigins.has(request.headers.origin) ||
      !this.valid(token) ||
      request.get('X-CSRF-Token') !== token
    )
      throw new AuthError('REQUEST_FORBIDDEN');
  }
}

@Injectable()
export class AuthMutationGuard implements CanActivate {
  constructor(
    @Inject(AuthSecurity) private readonly security: AuthSecurity,
    @Inject(AuthRateLimiter) private readonly limiter: AuthRateLimiter,
  ) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    // Never trust client-supplied X-Forwarded-For. Behind Next, the proxy shares
    // the socket bucket until trusted ingress is explicitly configured.
    this.limiter.consume(
      'mutation-ip',
      request.socket.remoteAddress ?? 'unknown',
      this.security.mutationIpLimit,
      300_000,
    );
    this.security.assertMutation(request);
    if (!request.is('application/json')) throw new AuthError('INVALID_REQUEST');
    return true;
  }
}

// File uploads: the same Origin/CSRF/rate checks as JSON mutations, but the
// body must be multipart. Guards run before Multer parses any file bytes.
@Injectable()
export class UploadMutationGuard implements CanActivate {
  constructor(
    @Inject(AuthSecurity) private readonly security: AuthSecurity,
    @Inject(AuthRateLimiter) private readonly limiter: AuthRateLimiter,
  ) {}
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    this.limiter.consume(
      'mutation-ip',
      request.socket.remoteAddress ?? 'unknown',
      this.security.mutationIpLimit,
      300_000,
    );
    this.security.assertMutation(request);
    if (!request.is('multipart/form-data'))
      throw new AuthError('INVALID_REQUEST');
    return true;
  }
}
