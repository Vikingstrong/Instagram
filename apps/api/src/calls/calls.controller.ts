import {
  Body,
  Controller,
  Get,
  Post,
  Header,
  HttpCode,
  Inject,
  Param,
  Query,
  Req,
  UseGuards,
  Injectable,
  type CanActivate,
  type ExecutionContext,
  applyDecorators,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import {
  CallResponseSchema,
  CurrentCallResponseSchema,
  CallHistoryResponseSchema,
  StartCallRequestSchema,
  CallOwnerRequestSchema,
  CallActionRequestSchema,
  SendCallSignalRequestSchema,
  CallSignalsQuerySchema,
  CallSignalsResponseSchema,
  CallSignalAcceptedSchema,
  CallIceConfigSchema,
  PageQuerySchema,
  UserSummarySchema,
} from '@instagram/contracts';
import { CallsService } from './calls.service.js';
import {
  CALLS_CONFIG,
  iceConfiguration,
  type CallsConfig,
} from './calls.config.js';
import { AuthSecurity, cookieValue } from '../auth/auth-security.js';
import { sessionHash } from '../auth/auth.service.js';
import {
  VerifiedSessionGuard,
  type AuthenticatedRequest,
} from '../auth/auth-session.guard.js';
import { AuthRateLimiter } from '../auth/auth-rate-limiter.js';
import { AuthError } from '../auth/auth.error.js';
import { parse, schema, noStore, errorResponse } from '../auth/auth-http.js';
// Calls need frequent heartbeats and ICE. Keep their budget separate from login/mail mutations.
@Injectable()
export class CallsMutationGuard implements CanActivate {
  constructor(
    @Inject(AuthSecurity) private readonly security: AuthSecurity,
    @Inject(AuthRateLimiter) private readonly limiter: AuthRateLimiter,
  ) {}
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    this.security.assertMutation(request);
    if (!request.is('application/json')) throw new AuthError('INVALID_REQUEST');
    this.limiter.consume(
      'calls-mutation-ip',
      request.socket.remoteAddress ?? 'unknown',
      5000,
      300_000,
    );
    return true;
  }
}
const ok = (value: Parameters<typeof schema>[0], status = 200) =>
  ApiResponse({ status, headers: noStore, schema: schema(value) });
const bodySchema = (value: Parameters<typeof schema>[0]) =>
  applyDecorators(
    UseGuards(CallsMutationGuard),
    ApiSecurity('csrfToken'),
    ApiBody({ schema: schema(value) }),
  );
@ApiTags('Calls')
@ApiSecurity('session')
@Controller('calls')
@UseGuards(VerifiedSessionGuard)
@errorResponse(400)
@errorResponse(401)
@errorResponse(403)
@errorResponse(404)
@errorResponse(409)
@errorResponse(429)
@errorResponse(503)
export class CallsController {
  constructor(
    @Inject(CallsService) private readonly calls: CallsService,
    @Inject(AuthSecurity) private readonly security: AuthSecurity,
    @Inject(AuthRateLimiter) private readonly limiter: AuthRateLimiter,
    @Inject(CALLS_CONFIG) private readonly config: CallsConfig,
  ) {}
  private actor(request: AuthenticatedRequest, mutation = false) {
    const id = request.authUser!.id;
    this.limiter.consume(
      mutation ? 'calls-write' : 'calls-read',
      id,
      mutation ? 400 : 300,
      60_000,
    );
    return {
      id,
      hash: sessionHash(cookieValue(request, this.security.sessionCookie)!),
    };
  }
  @Get('config')
  @Header('Cache-Control', 'no-store')
  @ok(CallIceConfigSchema)
  @ApiOperation({
    summary: 'ICE configuration; short-lived TURN credentials for this user',
  })
  configIce(@Req() request: AuthenticatedRequest) {
    return CallIceConfigSchema.parse(
      iceConfiguration(this.config, this.actor(request).id),
    );
  }
  @Get('current')
  @Header('Cache-Control', 'no-store')
  @ok(CurrentCallResponseSchema)
  async current(@Req() request: AuthenticatedRequest) {
    return CurrentCallResponseSchema.parse({
      call: await this.calls.current(this.actor(request).id),
    });
  }
  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @bodySchema(StartCallRequestSchema)
  @ok(CallResponseSchema, 201)
  async start(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const actor = this.actor(request, true);
    this.limiter.consume('calls-start', actor.id, 10, 60_000);
    return CallResponseSchema.parse({
      call: await this.calls.start(
        actor.id,
        actor.hash,
        parse(body, StartCallRequestSchema),
      ),
    });
  }
  @Post(':id/action')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @bodySchema(CallActionRequestSchema)
  @ok(CallResponseSchema)
  async action(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = this.actor(request, true);
    return CallResponseSchema.parse({
      call: await this.calls.action(
        actor.id,
        actor.hash,
        parse(id, UserSummarySchema.shape.id),
        parse(body, CallActionRequestSchema),
      ),
    });
  }
  @Post(':id/heartbeat')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @bodySchema(CallOwnerRequestSchema)
  @ok(CallResponseSchema)
  async heartbeat(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = this.actor(request, true);
    return CallResponseSchema.parse({
      call: await this.calls.heartbeat(
        actor.id,
        actor.hash,
        parse(id, UserSummarySchema.shape.id),
        parse(body, CallOwnerRequestSchema).clientId,
      ),
    });
  }
  @Post(':id/signals')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @bodySchema(SendCallSignalRequestSchema)
  @ok(CallSignalAcceptedSchema)
  async sendSignal(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = this.actor(request, true),
      input = parse(body, SendCallSignalRequestSchema);
    await this.calls.sendSignal(
      actor.id,
      actor.hash,
      parse(id, UserSummarySchema.shape.id),
      input.clientId,
      input.signal,
    );
    return { status: 'accepted' as const };
  }
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ok(CallResponseSchema)
  async get(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return CallResponseSchema.parse({
      call: await this.calls.get(
        this.actor(request).id,
        parse(id, UserSummarySchema.shape.id),
      ),
    });
  }
  @Get(':id/signals')
  @Header('Cache-Control', 'no-store')
  @ok(CallSignalsResponseSchema)
  async signals(
    @Param('id') id: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = this.actor(request),
      input = parse(query, CallSignalsQuerySchema);
    return CallSignalsResponseSchema.parse(
      await this.calls.signals(
        actor.id,
        actor.hash,
        parse(id, UserSummarySchema.shape.id),
        input.clientId,
        input.after,
      ),
    );
  }
  @Get('history/:id')
  @Header('Cache-Control', 'no-store')
  @ok(CallHistoryResponseSchema)
  async history(
    @Param('id') id: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return CallHistoryResponseSchema.parse(
      await this.calls.history(
        this.actor(request).id,
        parse(id, UserSummarySchema.shape.id),
        parse(query, PageQuerySchema),
      ),
    );
  }
}
