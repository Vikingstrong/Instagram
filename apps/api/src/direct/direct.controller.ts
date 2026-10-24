import {
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
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
  ApiBody,
  ApiConsumes,
  ApiProduces,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import {
  SendMediaMessageFieldsSchema,
  directImageRules,
  voiceMessageRules,
  ConversationListResponseSchema,
  ConversationResponseSchema,
  DirectMessageListResponseSchema,
  DirectMessageResponseSchema,
  OpenConversationRequestSchema,
  PageQuerySchema,
  SendMessageRequestSchema,
  ShareContentRequestSchema,
  ShareContentResponseSchema,
  UserSummarySchema,
} from '@instagram/contracts';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadMutationGuard } from '../auth/auth-security.js';
import { AuthError } from '../auth/auth.error.js';
import { parseRange } from '../media/byte-range.js';
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

function attachmentUpload(type: 'image' | 'voice') {
  return applyDecorators(
    UseGuards(UploadMutationGuard),
    UseInterceptors(
      FileInterceptor('file', {
        limits: {
          fileSize:
            type === 'voice'
              ? voiceMessageRules.maxBytes
              : directImageRules.maxBytes,
          files: 1,
          fields: 2,
          parts: 3,
          fieldSize: 16384,
        },
      }),
    ),
    ApiSecurity('csrfToken'),
    ApiConsumes('multipart/form-data'),
    ApiBody({
      schema: {
        type: 'object',
        required: ['file', 'clientMessageId'],
        properties: {
          file: {
            type: 'string',
            format: 'binary',
            description:
              type === 'voice'
                ? 'Audio recording up to 10 MiB / 180 seconds. Transcoded to AAC/M4A.'
                : 'JPEG/PNG/WebP/GIF up to 10 MiB, 100 frames, 40M decoded pixels.',
          },
          clientMessageId: { type: 'string', format: 'uuid' },
          text: { type: 'string', maxLength: 1000 },
        },
      },
    }),
    ApiParam({ name: 'id', format: 'uuid' }),
    ok(DirectMessageResponseSchema, 201),
    errorResponse(400),
    errorResponse(404),
    errorResponse(409),
    errorResponse(413),
  );
}

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
  private async sendAttachment(
    id: string,
    body: unknown,
    file: { buffer: Buffer } | undefined,
    request: AuthenticatedRequest,
    type: 'image' | 'voice',
  ) {
    const input = parse(body, SendMediaMessageFieldsSchema);
    this.limiter.consume('direct-send', viewer(request), 60, 60_000);
    if (!file?.buffer.length)
      throw new AuthError(type === 'voice' ? 'INVALID_AUDIO' : 'INVALID_IMAGE');
    return DirectMessageResponseSchema.parse({
      message: await this.direct.sendMedia(
        viewer(request),
        uuid(id),
        input,
        file.buffer,
        type,
      ),
    });
  }

  @Post(':id/messages/share')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @mutationBody(ShareContentRequestSchema, {
    clientMessageId: '6f1c2a4e-8b3d-4c5e-9f60-718293a4b5c6',
    kind: 'post',
    contentId: '00000000-0000-4000-8000-000000000002',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    operationId: 'shareContent',
    summary:
      'Share a post, reel or active story in Direct; counts unique sharers after commit',
    description:
      'Sender needs current access. Recipient receives an unavailable card without preview if not allowed. Idempotent clientMessageId; one unique account count per source across conversations.',
  })
  @ok(ShareContentResponseSchema, 201)
  @errorResponse(404)
  @errorResponse(409)
  async share(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const input = parse(body, ShareContentRequestSchema);
    this.limiter.consume('direct-send', viewer(request), 60, 60_000);
    return ShareContentResponseSchema.parse(
      await this.direct.share(viewer(request), uuid(id), input),
    );
  }

  @Post(':id/messages/image')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @attachmentUpload('image')
  @ApiOperation({
    operationId: 'sendDirectImage',
    summary:
      'Send one private photo or animated GIF with optional text; retries compare exact file bytes, text and conversation',
  })
  sendImage(
    @Param('id') id: string,
    @Body() body: unknown,
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.sendAttachment(id, body, file, request, 'image');
  }

  @Post(':id/messages/voice')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @attachmentUpload('voice')
  @ApiOperation({
    operationId: 'sendDirectVoice',
    summary:
      'Send a private voice message, up to three minutes, with optional text',
  })
  sendVoice(
    @Param('id') id: string,
    @Body() body: unknown,
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.sendAttachment(id, body, file, request, 'voice');
  }

  @Get(':id/messages/:messageId/:variant')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'messageId', format: 'uuid' })
  @ApiParam({ name: 'variant', enum: ['full', 'thumb', 'audio', 'opus'] })
  @ApiProduces('image/webp', 'audio/mp4', 'audio/webm')
  @ApiOperation({
    operationId: 'getDirectAttachment',
    summary:
      'Private message attachment; participants only on every request, including Range',
  })
  @ApiResponse({
    status: 200,
    description: 'WebP image or AAC/M4A voice message',
  })
  @ApiResponse({ status: 206, description: 'Byte range' })
  @ApiResponse({ status: 416, description: 'Range outside file' })
  @errorResponse(400)
  @errorResponse(404)
  async attachment(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Param('variant') variant: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (
      variant !== 'full' &&
      variant !== 'thumb' &&
      variant !== 'audio' &&
      variant !== 'opus'
    )
      throw new AuthError('MEDIA_NOT_FOUND');
    this.limiter.consume('direct-media-read', viewer(request), 1200, 300_000);
    const file = await this.direct.attachment(
      viewer(request),
      uuid(id),
      uuid(messageId),
      variant,
    );
    response.setHeader('Accept-Ranges', 'bytes');
    const range = parseRange(request.headers.range, file.size);
    if (range.kind === 'unsatisfiable') {
      response.status(416).setHeader('Content-Range', `bytes */${file.size}`);
      return;
    }
    const [start, end] =
      range.kind === 'partial' ? [range.start, range.end] : [0, file.size - 1];
    if (range.kind === 'partial') {
      response.status(206);
      response.setHeader('Content-Range', `bytes ${start}-${end}/${file.size}`);
    }
    return new StreamableFile(file.stream(start, end), {
      type:
        variant === 'audio'
          ? 'audio/mp4'
          : variant === 'opus'
            ? 'audio/webm'
            : 'image/webp',
      length: end - start + 1,
    });
  }
}
