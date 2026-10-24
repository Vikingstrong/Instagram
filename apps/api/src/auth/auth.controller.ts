import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  AuthCapabilitiesResponseSchema,
  AuthRegisterRequestSchema,
  AuthLoginRequestSchema,
  AuthLogoutRequestSchema,
  AuthUserResponseSchema,
  AuthSessionResponseSchema,
  AuthCsrfResponseSchema,
  AuthLogoutResponseSchema,
  AuthEmailRequestSchema,
  AuthResetPasswordRequestSchema,
  AuthEmailAcceptedResponseSchema,
  AuthPasswordResetResponseSchema,
} from '@instagram/contracts';
import type { Request, Response } from 'express';
import { MailService } from '../mail/mail.service.js';
import { AuthService, SESSION_TTL_MS } from './auth.service.js';
import { AuthSecurity, cookieValue } from './auth-security.js';
import { AuthRateLimiter } from './auth-rate-limiter.js';
import {
  errorResponse,
  mutationBody,
  noStore,
  parse,
  schema,
} from './auth-http.js';

@ApiTags('Auth')
@Controller('auth')
@errorResponse(429)
@errorResponse(500)
@errorResponse(503)
export class AuthController {
  constructor(
    @Inject(MailService) private readonly mail: MailService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AuthSecurity) private readonly security: AuthSecurity,
    @Inject(AuthRateLimiter) private readonly limiter: AuthRateLimiter,
  ) {}
  private readLimit(request: Request): void {
    this.limiter.consume(
      'read-ip',
      request.socket.remoteAddress ?? 'unknown',
      this.security.readIpLimit,
      300_000,
    );
  }

  private emailLimit(email: string): void {
    // Charge all addresses, including nonexistent/accounts, equally.
    this.limiter.consume('mail-minute', email.toLowerCase(), 1, 60_000);
    this.limiter.consume('mail-hour', email.toLowerCase(), 3, 3600_000);
  }

  @Get('capabilities')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    operationId: 'getAuthCapabilities',
    summary:
      'Read optional password recovery availability; registration is always independent of mail',
  })
  @ApiResponse({
    status: 200,
    headers: noStore,
    schema: schema(AuthCapabilitiesResponseSchema),
  })
  capabilities(@Req() request: Request) {
    this.readLimit(request);
    return AuthCapabilitiesResponseSchema.parse({
      passwordRecoveryEnabled: this.mail.recoveryAvailable(),
    });
  }

  @Post('password/request')
  @Header('Cache-Control', 'no-store')
  @HttpCode(202)
  @mutationBody(AuthEmailRequestSchema, { email: 'person@example.test' })
  @ApiOperation({
    operationId: 'requestPasswordReset',
    summary: 'Request a password recovery link',
    description:
      'Same accepted response for existing and nonexistent accounts. Does not expose account existence or SMTP delivery status.',
  })
  @ApiResponse({
    status: 202,
    headers: noStore,
    schema: schema(AuthEmailAcceptedResponseSchema),
  })
  async requestPasswordReset(@Body() body: unknown) {
    const input = parse(body, AuthEmailRequestSchema);
    this.emailLimit(input.email);
    await this.auth.requestEmail(input.email, 'PASSWORD_RESET');
    return AuthEmailAcceptedResponseSchema.parse({ status: 'accepted' });
  }

  @Post('password/reset')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  @mutationBody(AuthResetPasswordRequestSchema, {
    token: 'a'.repeat(43),
    password: 'new synthetic password 🔐',
  })
  @ApiOperation({
    operationId: 'resetAuthPassword',
    summary: 'Consume a password recovery token',
    description:
      '30-minute single-use token. Atomically changes the password and revokes all existing sessions and outstanding tokens. Requires a fresh login; does not sign in.',
  })
  @ApiResponse({
    status: 200,
    headers: noStore,
    schema: schema(AuthPasswordResetResponseSchema),
  })
  async resetPassword(@Body() body: unknown) {
    const input = parse(body, AuthResetPasswordRequestSchema);
    await this.auth.resetPassword(input.token, input.password);
    // The current browser may belong to another account; do not clear its cookie.
    // Reset-account sessions are rejected by the API's credential-version check.
    return AuthPasswordResetResponseSchema.parse({ status: 'password_reset' });
  }

  @Get('csrf')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    operationId: 'getAuthCsrf',
    summary: 'Get a signed CSRF token',
    description:
      'Sets an HttpOnly CSRF cookie. Send the returned token as X-CSRF-Token on JSON mutations. Swagger fills this header automatically for same-origin Auth requests.',
  })
  @ApiResponse({
    status: 200,
    headers: noStore,
    schema: schema(AuthCsrfResponseSchema),
  })
  csrf(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.readLimit(request);
    return AuthCsrfResponseSchema.parse({
      csrfToken: this.security.csrf(request, response),
    });
  }

  @Post('register')
  @Header('Cache-Control', 'no-store')
  @mutationBody(AuthRegisterRequestSchema, {
    email: 'demo@example.test',
    username: 'demo_user',
    password: 'example password for demo',
  })
  @ApiOperation({
    operationId: 'registerAuth',
    summary: 'Register and sign in immediately; no email verification',
    description:
      'Open registration. Requires an allowed browser Origin and CSRF cookie/header. Atomically creates the account and an HttpOnly session cookie. No verification token or mail is created; SMTP is optional.',
  })
  @ApiResponse({
    status: 201,
    headers: {
      ...noStore,
      'Set-Cookie': {
        schema: { type: 'string' },
        description:
          'HttpOnly session; SameSite=Lax; Path=/; Secure and __Host- prefix in production.',
      },
    },
    schema: schema(AuthUserResponseSchema),
  })
  @errorResponse(409)
  async register(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const input = parse(body, AuthRegisterRequestSchema);
    this.limiter.consume(
      'register-email',
      input.email.toLowerCase(),
      3,
      900_000,
    );
    const result = await this.auth.register(input);
    response.cookie(this.security.sessionCookie, result.token, {
      ...this.security.cookieOptions,
      maxAge: SESSION_TTL_MS,
    });
    return AuthUserResponseSchema.parse({ user: result.user });
  }

  @Post('login')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  @mutationBody(AuthLoginRequestSchema, {
    email: 'demo@example.test',
    password: 'example password for demo',
  })
  @ApiOperation({
    operationId: 'loginAuth',
    summary: 'Create a persistent cookie session',
    description:
      'Requires allowed Origin and CSRF. Sets an HttpOnly host-only session cookie; bearer token is never returned in JSON. Email ownership is not a condition for authenticated features.',
  })
  @ApiResponse({
    status: 200,
    headers: {
      ...noStore,
      'Set-Cookie': {
        schema: { type: 'string' },
        description:
          'HttpOnly session; SameSite=Lax; Path=/; Secure and __Host- prefix in production.',
      },
    },
    schema: schema(AuthUserResponseSchema),
  })
  @errorResponse(401)
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const input = parse(body, AuthLoginRequestSchema);
    this.limiter.consume('login-email', input.email.toLowerCase(), 5, 900_000);
    const result = await this.auth.login(input);
    response.cookie(this.security.sessionCookie, result.token, {
      ...this.security.cookieOptions,
      maxAge: SESSION_TTL_MS,
    });
    return AuthUserResponseSchema.parse({ user: result.user });
  }

  @Get('session')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    operationId: 'getAuthSession',
    summary: 'Read the current session',
    description:
      'Uses the browser cookie jar. Returns user:null for absent, malformed, expired, revoked or outdated-credential sessions. Never returns password hashes, versions or tokens.',
  })
  @ApiResponse({
    status: 200,
    headers: noStore,
    schema: schema(AuthSessionResponseSchema),
  })
  async session(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.readLimit(request);
    const token = cookieValue(request, this.security.sessionCookie);
    const user = await this.auth.session(token);
    if (!user && token)
      response.clearCookie(
        this.security.sessionCookie,
        this.security.cookieOptions,
      );
    return AuthSessionResponseSchema.parse({ user });
  }

  @Post('logout')
  @Header('Cache-Control', 'no-store')
  @HttpCode(200)
  @mutationBody(AuthLogoutRequestSchema, {})
  @ApiOperation({
    operationId: 'logoutAuth',
    summary: 'Revoke the current session',
    description:
      'Idempotent. Requires allowed Origin and CSRF even when signed out. Send an empty JSON object. Revokes this session, clears its cookie, and leaves other device sessions active.',
  })
  @ApiResponse({
    status: 200,
    headers: noStore,
    schema: schema(AuthLogoutResponseSchema),
  })
  async logout(
    @Body() body: unknown,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    parse(body, AuthLogoutRequestSchema);
    await this.auth.logout(cookieValue(request, this.security.sessionCookie));
    response.clearCookie(
      this.security.sessionCookie,
      this.security.cookieOptions,
    );
    return AuthLogoutResponseSchema.parse({ status: 'signed_out' });
  }
}
