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
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
  type SchemaObject,
} from '@nestjs/swagger';
import {
  AuthRegisterRequestSchema,
  AuthLoginRequestSchema,
  AuthLogoutRequestSchema,
  AuthUserResponseSchema,
  AuthSessionResponseSchema,
  AuthCsrfResponseSchema,
  AuthLogoutResponseSchema,
  AuthApiErrorResponseSchema,
} from '@instagram/contracts';
import type { Request, Response } from 'express';
import { AuthService, SESSION_TTL_MS } from './auth.service.js';
import {
  AuthSecurity,
  AuthMutationGuard,
  cookieValue,
} from './auth-security.js';
import { AuthRateLimiter } from './auth-rate-limiter.js';
import { AuthError } from './auth.error.js';

const schema = (value: {
  toJSONSchema(options: { target: 'openapi-3.0' }): unknown;
}): SchemaObject =>
  value.toJSONSchema({ target: 'openapi-3.0' }) as SchemaObject;
const noStore = {
  'Cache-Control': { schema: { type: 'string' as const, enum: ['no-store'] } },
};
function errorResponse(status: number) {
  return ApiResponse({
    status,
    headers: noStore,
    schema: schema(AuthApiErrorResponseSchema),
  });
}
function mutationBody(
  value: Parameters<typeof schema>[0],
  example: Record<string, string>,
) {
  return applyDecorators(
    UseGuards(AuthMutationGuard),
    ApiSecurity('csrfToken'),
    ApiBody({ schema: schema(value), examples: { demo: { value: example } } }),
    errorResponse(400),
    errorResponse(403),
    errorResponse(413),
  );
}
function parse<T>(
  value: unknown,
  validator: {
    safeParse(value: unknown): { success: true; data: T } | { success: false };
  },
): T {
  const parsed = validator.safeParse(value);
  if (!parsed.success) throw new AuthError('INVALID_REQUEST');
  return parsed.data;
}

@ApiTags('Auth')
@Controller('auth')
@errorResponse(429)
@errorResponse(500)
@errorResponse(503)
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(AuthSecurity) private readonly security: AuthSecurity,
    @Inject(AuthRateLimiter) private readonly limiter: AuthRateLimiter,
  ) {}
  private readLimit(request: Request): void {
    this.limiter.consume(
      'read-ip',
      request.socket.remoteAddress ?? 'unknown',
      300,
      300_000,
    );
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
    summary: 'Create an unverified account',
    description:
      'Open registration. Requires an allowed browser Origin and CSRF cookie/header. Does not create a session. Email verification/delivery is the next slice and is not implemented yet; protected features remain unavailable until verified.',
  })
  @ApiResponse({
    status: 201,
    headers: noStore,
    schema: schema(AuthUserResponseSchema),
  })
  @errorResponse(409)
  async register(@Body() body: unknown) {
    const input = parse(body, AuthRegisterRequestSchema);
    this.limiter.consume(
      'register-email',
      input.email.toLowerCase(),
      3,
      900_000,
    );
    return AuthUserResponseSchema.parse({
      user: await this.auth.register(input),
    });
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
      'Requires allowed Origin and CSRF. Sets an HttpOnly host-only session cookie; bearer token is never returned in JSON. Unverified accounts can sign in only for auth/verification/recovery pages.',
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
