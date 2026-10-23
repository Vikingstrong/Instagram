import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import {
  ConversationListResponseSchema,
  ConversationResponseSchema,
  DirectMessageListResponseSchema,
  DirectMessageResponseSchema,
  OpenConversationRequestSchema,
  PageQuerySchema,
  SendMessageRequestSchema,
  UserSummarySchema,
} from '@instagram/contracts';
import { DirectService } from './direct.service.js';
import {
  VerifiedSessionGuard,
  type AuthenticatedRequest,
} from '../auth/auth-session.guard.js';
import { AuthRateLimiter } from '../auth/auth-rate-limiter.js';
import {
  errorResponse,
  mutationBody,
  noStore,
  parse,
  schema,
} from '../auth/auth-http.js';

const viewer = (request: AuthenticatedRequest): string => request.authUser!.id;
const uuid = (value: string): string =>
  parse(value, UserSummarySchema.shape.id);
function ok(value: Parameters<typeof schema>[0], status = 200) {
  return ApiResponse({ status, headers: noStore, schema: schema(value) });
}
const paged = () =>
  applyDecorators(
    ApiQuery({ name: 'cursor', required: false, type: String }),
    ApiQuery({ name: 'limit', required: false, type: Number, example: 20 }),
  );

// FR-09 Direct over REST (stage 6). Realtime delivery arrives in stage 7;
// until then clients reload the history.
@ApiTags('Direct')
@ApiSecurity('session')
@Controller('direct/conversations')
@UseGuards(VerifiedSessionGuard)
@errorResponse(401)
@errorResponse(403)
@errorResponse(429)
@errorResponse(500)
@errorResponse(503)
export class DirectController {
  constructor(
    @Inject(DirectService) private readonly direct: DirectService,
    @Inject(AuthRateLimiter) private readonly limiter: AuthRateLimiter,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @paged()
  @ApiOperation({
    operationId: 'listConversations',
    summary: 'Own conversations, most recent activity first',
    description:
      'Each item has the other participant and the last message. An empty conversation is listed only for the user who opened it. Limit 1–50, default 20.',
  })
  @ok(ConversationListResponseSchema)
  @errorResponse(400)
  async list(@Query() query: unknown, @Req() request: AuthenticatedRequest) {
    return ConversationListResponseSchema.parse(
      await this.direct.list(viewer(request), parse(query, PageQuerySchema)),
    );
  }

  @Post()
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @mutationBody(OpenConversationRequestSchema, {
    userId: '00000000-0000-4000-8000-000000000002',
  })
  @ApiOperation({
    operationId: 'openConversation',
    summary: 'Open (or create) the conversation with a user',
    description:
      'Any verified user may write to any other, regardless of follows or privacy (FR-09). Repeats return the same conversation. Yourself: 400 CANNOT_MESSAGE_SELF; unknown user: 404.',
  })
  @ok(ConversationResponseSchema)
  @errorResponse(404)
  async open(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    const input = parse(body, OpenConversationRequestSchema);
    this.limiter.consume('direct-open', viewer(request), 30, 3600_000);
    return ConversationResponseSchema.parse({
      conversation: await this.direct.open(viewer(request), input.userId),
    });
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    operationId: 'getConversation',
    summary: 'Read one conversation',
    description: 'Participants only; others get 404 CONVERSATION_NOT_FOUND.',
  })
  @ok(ConversationResponseSchema)
  @errorResponse(400)
  @errorResponse(404)
  async get(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return ConversationResponseSchema.parse({
      conversation: await this.direct.get(viewer(request), uuid(id)),
    });
  }

  @Get(':id/messages')
  @Header('Cache-Control', 'no-store')
  @paged()
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    operationId: 'listMessages',
    summary: 'Message history, newest first',
    description:
      'Participants only. nextCursor reads older messages. Limit 1–50, default 20.',
  })
  @ok(DirectMessageListResponseSchema)
  @errorResponse(400)
  @errorResponse(404)
  async messages(
    @Param('id') id: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return DirectMessageListResponseSchema.parse(
      await this.direct.messages(
        viewer(request),
        uuid(id),
        parse(query, PageQuerySchema),
      ),
    );
  }

  @Post(':id/messages')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @mutationBody(SendMessageRequestSchema, {
    clientMessageId: '6f1c2a4e-8b3d-4c5e-9f60-718293a4b5c6',
    text: 'Привет!',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    operationId: 'sendMessage',
    summary: 'Send a text message',
    description:
      '1–1000 characters. Success means stored, not read. Retrying with the same clientMessageId and text returns the stored message; another text with that id is 409 MESSAGE_ID_CONFLICT.',
  })
  @ok(DirectMessageResponseSchema, 201)
  @errorResponse(404)
  @errorResponse(409)
  async send(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const input = parse(body, SendMessageRequestSchema);
    this.limiter.consume('direct-send', viewer(request), 60, 60_000);
    return DirectMessageResponseSchema.parse({
      message: await this.direct.send(viewer(request), uuid(id), input),
    });
  }
}
