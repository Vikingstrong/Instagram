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
  CallIceConfigSchema,
  CreateLiveCommentRequestSchema,
  EmptyRequestSchema,
  JoinLiveResponseSchema,
  LiveAcceptedSchema,
  LiveCommentResponseSchema,
  LiveCommentsQuerySchema,
  LiveCommentsResponseSchema,
  LiveDeviceRequestSchema,
  LiveGiftsQuerySchema,
  LiveGiftsResponseSchema,
  LiveListResponseSchema,
  LiveResponseSchema,
  LiveSignalsQuerySchema,
  LiveSignalsResponseSchema,
  OptionalLiveResponseSchema,
  SendLiveGiftRequestSchema,
  SendLiveGiftResponseSchema,
  SendLiveSignalRequestSchema,
  StartLiveRequestSchema,
  UserSummarySchema,
} from '@instagram/contracts';
import { LivesService } from './lives.service.js';
import { AuthSecurity, cookieValue } from '../auth/auth-security.js';
import { sessionHash } from '../auth/auth.service.js';
import {
  VerifiedSessionGuard,
  type AuthenticatedRequest,
} from '../auth/auth-session.guard.js';
import { AuthRateLimiter } from '../auth/auth-rate-limiter.js';
import { AuthError } from '../auth/auth.error.js';
import { parse, schema, noStore, errorResponse } from '../auth/auth-http.js';

// Heartbeats and ICE of up to ten viewers are frequent: a budget of their
// own, apart from login/mail mutations (as for calls).
@Injectable()
export class LivesMutationGuard implements CanActivate {
  constructor(
    @Inject(AuthSecurity) private readonly security: AuthSecurity,
    @Inject(AuthRateLimiter) private readonly limiter: AuthRateLimiter,
  ) {}
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    this.security.assertMutation(request);
    if (!request.is('application/json')) throw new AuthError('INVALID_REQUEST');
    this.limiter.consume(
      'lives-mutation-ip',
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
    UseGuards(LivesMutationGuard),
    ApiSecurity('csrfToken'),
    ApiBody({ schema: schema(value) }),
  );
const uuid = UserSummarySchema.shape.id;

@ApiTags('Lives')
@ApiSecurity('session')
@Controller('lives')
@UseGuards(VerifiedSessionGuard)
@errorResponse(400)
@errorResponse(401)
@errorResponse(403)
@errorResponse(404)
@errorResponse(409)
@errorResponse(429)
@errorResponse(503)
export class LivesController {
  constructor(
    @Inject(LivesService) private readonly lives: LivesService,
    @Inject(AuthSecurity) private readonly security: AuthSecurity,
    @Inject(AuthRateLimiter) private readonly limiter: AuthRateLimiter,
  ) {}

  private actor(request: AuthenticatedRequest, mutation = false) {
    const id = request.authUser!.id;
    this.limiter.consume(
      mutation ? 'lives-write' : 'lives-read',
      id,
      mutation ? 400 : 600,
      60_000,
    );
    return {
      id,
      hash: sessionHash(cookieValue(request, this.security.sessionCookie)!),
    };
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  @ok(LiveListResponseSchema)
  @ApiOperation({ summary: 'Live streams of followed accounts and your own' })
  async list(@Req() request: AuthenticatedRequest) {
    return LiveListResponseSchema.parse({
      items: await this.lives.list(this.actor(request).id),
    });
  }

  @Get('current')
  @Header('Cache-Control', 'no-store')
  @ok(OptionalLiveResponseSchema)
  @ApiOperation({ summary: 'Your own stream that is on air' })
  async current(@Req() request: AuthenticatedRequest) {
    return OptionalLiveResponseSchema.parse({
      live: await this.lives.current(this.actor(request).id),
    });
  }

  @Get('config')
  @Header('Cache-Control', 'no-store')
  @ok(CallIceConfigSchema)
  @ApiOperation({
    summary: 'ICE configuration; short-lived TURN credentials for this user',
  })
  config(@Req() request: AuthenticatedRequest) {
    return CallIceConfigSchema.parse(
      this.lives.iceServers(this.actor(request).id),
    );
  }

  @Get('host/:id')
  @Header('Cache-Control', 'no-store')
  @ok(OptionalLiveResponseSchema)
  @ApiOperation({
    summary: "A user's stream on air, or null",
    description:
      'null also when the viewer may not see the author: a private account does not reveal that it is live.',
  })
  async byHost(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return OptionalLiveResponseSchema.parse({
      live: await this.lives.byHost(this.actor(request).id, parse(id, uuid)),
    });
  }

  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @bodySchema(StartLiveRequestSchema)
  @ok(LiveResponseSchema, 201)
  @ApiOperation({
    summary: 'Go live',
    description:
      'Idempotent by the client-generated id. One stream per host; followers get an SSE "live" notice.',
  })
  async start(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const actor = this.actor(request, true);
    this.limiter.consume('lives-start', actor.id, 10, 3_600_000);
    return LiveResponseSchema.parse({
      live: await this.lives.start(
        actor.id,
        actor.hash,
        parse(body, StartLiveRequestSchema),
      ),
    });
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ok(LiveResponseSchema)
  async get(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return LiveResponseSchema.parse({
      live: await this.lives.get(this.actor(request).id, parse(id, uuid)),
    });
  }

  @Post(':id/end')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @bodySchema(EmptyRequestSchema)
  @ok(LiveResponseSchema)
  @ApiOperation({ summary: 'End your stream for every viewer' })
  async end(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = this.actor(request, true);
    parse(body, EmptyRequestSchema);
    return LiveResponseSchema.parse({
      live: await this.lives.end(actor.id, parse(id, uuid)),
    });
  }

  @Post(':id/join')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @bodySchema(LiveDeviceRequestSchema)
  @ok(JoinLiveResponseSchema)
  @ApiOperation({
    summary: 'Connect as a viewer',
    description:
      'Returns the peer id for signaling. A new join of the same user replaces the previous connection.',
  })
  async join(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = this.actor(request, true);
    return JoinLiveResponseSchema.parse(
      await this.lives.join(
        actor.id,
        actor.hash,
        parse(id, uuid),
        parse(body, LiveDeviceRequestSchema).clientId,
      ),
    );
  }

  @Post(':id/leave')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @bodySchema(LiveDeviceRequestSchema)
  @ok(LiveAcceptedSchema)
  leave(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = this.actor(request, true);
    this.lives.leave(
      actor.id,
      actor.hash,
      parse(id, uuid),
      parse(body, LiveDeviceRequestSchema).clientId,
    );
    return { status: 'accepted' as const };
  }

  @Post(':id/heartbeat')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @bodySchema(LiveDeviceRequestSchema)
  @ok(LiveResponseSchema)
  async heartbeat(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = this.actor(request, true);
    return LiveResponseSchema.parse({
      live: await this.lives.heartbeat(
        actor.id,
        actor.hash,
        parse(id, uuid),
        parse(body, LiveDeviceRequestSchema).clientId,
      ),
    });
  }

  @Post(':id/signals')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @bodySchema(SendLiveSignalRequestSchema)
  @ok(LiveAcceptedSchema)
  async sendSignal(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = this.actor(request, true),
      input = parse(body, SendLiveSignalRequestSchema);
    await this.lives.sendSignal(
      actor.id,
      actor.hash,
      parse(id, uuid),
      input.clientId,
      input.peerId,
      input.signal,
    );
    return { status: 'accepted' as const };
  }

  @Get(':id/signals')
  @Header('Cache-Control', 'no-store')
  @ok(LiveSignalsResponseSchema)
  async signals(
    @Param('id') id: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = this.actor(request),
      input = parse(query, LiveSignalsQuerySchema);
    return LiveSignalsResponseSchema.parse(
      await this.lives.signals(
        actor.id,
        actor.hash,
        parse(id, uuid),
        input.clientId,
        input.after,
      ),
    );
  }

  @Get(':id/comments')
  @Header('Cache-Control', 'no-store')
  @ok(LiveCommentsResponseSchema)
  async comments(
    @Param('id') id: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return LiveCommentsResponseSchema.parse(
      await this.lives.comments(
        this.actor(request).id,
        parse(id, uuid),
        parse(query, LiveCommentsQuerySchema).after,
      ),
    );
  }

  @Post(':id/comments')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @bodySchema(CreateLiveCommentRequestSchema)
  @ok(LiveCommentResponseSchema, 201)
  async addComment(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = this.actor(request, true);
    this.limiter.consume('live-comment', actor.id, 30, 60_000);
    return LiveCommentResponseSchema.parse({
      comment: await this.lives.addComment(
        actor.id,
        parse(id, uuid),
        parse(body, CreateLiveCommentRequestSchema),
      ),
    });
  }

  @Get(':id/gifts')
  @Header('Cache-Control', 'no-store')
  @ok(LiveGiftsResponseSchema)
  @ApiOperation({
    summary: 'Gifts of a stream, latest first page or after a cursor',
  })
  async gifts(
    @Param('id') id: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return LiveGiftsResponseSchema.parse(
      await this.lives.gifts(
        this.actor(request).id,
        parse(id, uuid),
        parse(query, LiveGiftsQuerySchema).after,
      ),
    );
  }

  @Post(':id/gifts')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @bodySchema(SendLiveGiftRequestSchema)
  @ok(SendLiveGiftResponseSchema, 201)
  @ApiOperation({
    summary: 'Send a gift to the host',
    description:
      'The catalog price moves from your wallet to the host in one transaction with the stream check. Idempotent by id: a retry returns the same gift.',
  })
  async sendGift(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = this.actor(request, true);
    this.limiter.consume('live-gift', actor.id, 30, 60_000);
    return SendLiveGiftResponseSchema.parse(
      await this.lives.sendGift(
        actor.id,
        parse(id, uuid),
        parse(body, SendLiveGiftRequestSchema),
      ),
    );
  }
}
