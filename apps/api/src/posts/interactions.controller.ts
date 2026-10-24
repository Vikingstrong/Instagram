import {
  UploadedFile,
  UseInterceptors,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import {
  CreateMediaCommentFieldsSchema,
  commentAttachmentRules,
  CommentListResponseSchema,
  CommentResponseSchema,
  CreateCommentRequestSchema,
  DeleteCommentResponseSchema,
  EmptyRequestSchema,
  LikeResponseSchema,
  SaveResponseSchema,
  PageQuerySchema,
  PostListResponseSchema,
  NotificationListResponseSchema,
  UserSummarySchema,
} from '@instagram/contracts';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadMutationGuard } from '../auth/auth-security.js';
import { AuthError } from '../auth/auth.error.js';
import { PostsService } from './posts.service.js';
import { InteractionsService } from './interactions.service.js';
import {
  SessionGuard,
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

// FR-05 feed and FR-06 likes/comments. Access follows post-policy.ts.
@ApiTags('Feed and interactions')
@ApiSecurity('session')
@Controller()
@UseGuards(SessionGuard)
@errorResponse(401)
@errorResponse(403)
@errorResponse(429)
@errorResponse(500)
@errorResponse(503)
export class InteractionsController {
  constructor(
    @Inject(PostsService) private readonly posts: PostsService,
    @Inject(InteractionsService)
    private readonly interactions: InteractionsService,
    @Inject(AuthRateLimiter) private readonly limiter: AuthRateLimiter,
  ) {}

  @Get('me/notifications')
  @Header('Cache-Control', 'no-store')
  @paged()
  @ApiOperation({
    operationId: 'listNotifications',
    summary: 'Interaction notifications for the signed-in user, newest first',
    description:
      'Post likes, comments, replies and comment likes. Current post visibility is enforced before paging.',
  })
  @ok(NotificationListResponseSchema)
  @errorResponse(400)
  async notifications(
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.interactions.notifications(
      viewer(request),
      parse(query, PageQuerySchema),
    );
  }

  @Get('feed')
  @Header('Cache-Control', 'no-store')
  @paged()
  @ApiOperation({
    operationId: 'getFeed',
    summary: 'Own posts and approved followings, newest first',
    description:
      'Chronological, no recommendations. Access is checked before paging, so posts of a revoked follow disappear at once. Limit 1–50, default 20.',
  })
  @ok(PostListResponseSchema)
  @errorResponse(400)
  async feed(@Query() query: unknown, @Req() request: AuthenticatedRequest) {
    return PostListResponseSchema.parse(
      await this.posts.feed(viewer(request), parse(query, PageQuerySchema)),
    );
  }

  @Put('posts/:id/like')
  @Header('Cache-Control', 'no-store')
  @mutationBody(EmptyRequestSchema, {})
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    operationId: 'likePost',
    summary: 'Like a post',
    description:
      'Idempotent: at most one like per user and post. Hidden posts are 404.',
  })
  @ok(LikeResponseSchema)
  @errorResponse(404)
  async like(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    parse(body, EmptyRequestSchema);
    this.limiter.consume('like', viewer(request), 300, 300_000);
    return LikeResponseSchema.parse(
      await this.interactions.like(viewer(request), uuid(id)),
    );
  }

  @Delete('posts/:id/like')
  @Header('Cache-Control', 'no-store')
  @mutationBody(EmptyRequestSchema, {})
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    operationId: 'unlikePost',
    summary: 'Remove a like',
    description: 'Idempotent. Hidden posts are 404.',
  })
  @ok(LikeResponseSchema)
  @errorResponse(404)
  async unlike(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    parse(body, EmptyRequestSchema);
    this.limiter.consume('like', viewer(request), 300, 300_000);
    return LikeResponseSchema.parse(
      await this.interactions.unlike(viewer(request), uuid(id)),
    );
  }

  @Put('posts/:id/save')
  @Header('Cache-Control', 'no-store')
  @mutationBody(EmptyRequestSchema, {})
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    operationId: 'savePost',
    summary: 'Save a post to "Сохранённое"',
    description: 'Idempotent, private to the viewer. Hidden posts are 404.',
  })
  @ok(SaveResponseSchema)
  @errorResponse(404)
  async save(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    parse(body, EmptyRequestSchema);
    this.limiter.consume('like', viewer(request), 300, 300_000);
    return SaveResponseSchema.parse(
      await this.interactions.save(viewer(request), uuid(id)),
    );
  }

  @Delete('posts/:id/save')
  @Header('Cache-Control', 'no-store')
  @mutationBody(EmptyRequestSchema, {})
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    operationId: 'unsavePost',
    summary: 'Remove a post from "Сохранённое"',
    description: 'Idempotent. Hidden posts are 404.',
  })
  @ok(SaveResponseSchema)
  @errorResponse(404)
  async unsave(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    parse(body, EmptyRequestSchema);
    this.limiter.consume('like', viewer(request), 300, 300_000);
    return SaveResponseSchema.parse(
      await this.interactions.unsave(viewer(request), uuid(id)),
    );
  }

  @Get('posts/:id/comments')
  @Header('Cache-Control', 'no-store')
  @paged()
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    operationId: 'listComments',
    summary: 'Comments of a post, oldest first',
    description:
      'Same access as the post; hidden posts are 404. canDelete marks comments the viewer may delete.',
  })
  @ok(CommentListResponseSchema)
  @errorResponse(400)
  @errorResponse(404)
  async comments(
    @Param('id') id: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return CommentListResponseSchema.parse(
      await this.interactions.list(
        viewer(request),
        uuid(id),
        parse(query, PageQuerySchema),
      ),
    );
  }

  @Post('posts/:id/comments')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @mutationBody(CreateCommentRequestSchema, { text: 'Красивое фото!' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    operationId: 'addComment',
    summary: 'Comment on a post',
    description:
      '1–2200 characters, not only spaces. Only on posts the viewer may see.',
  })
  @ok(CommentResponseSchema, 201)
  @errorResponse(404)
  async addComment(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const input = parse(body, CreateCommentRequestSchema);
    this.limiter.consume('comment', viewer(request), 60, 600_000);
    return CommentResponseSchema.parse({
      comment: await this.interactions.add(
        viewer(request),
        uuid(id),
        input.text,
        input.replyToCommentId,
      ),
    });
  }

  @Post('posts/:id/comments/image')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @UseGuards(UploadMutationGuard)
  @UseInterceptors(
    FileInterceptor('image', {
      limits: {
        fileSize: commentAttachmentRules.maxBytes,
        files: 1,
        fields: 2,
        parts: 3,
        fieldSize: 16384,
      },
    }),
  )
  @ApiSecurity('csrfToken')
  @ApiConsumes('multipart/form-data')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['image'],
      properties: {
        image: {
          type: 'string',
          format: 'binary',
          description:
            'JPEG, PNG, WebP or GIF, max 10 MiB, 100 frames and 40M total decoded pixels. GIF becomes animated WebP.',
        },
        text: { type: 'string', maxLength: 2200 },
        replyToCommentId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @ApiOperation({
    operationId: 'addMediaComment',
    summary:
      'Comment or reply with one photo or animated GIF and optional text',
  })
  @ok(CommentResponseSchema, 201)
  @errorResponse(400)
  @errorResponse(404)
  @errorResponse(413)
  async addMediaComment(
    @Param('id') id: string,
    @Body() body: unknown,
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const input = parse(body, CreateMediaCommentFieldsSchema);
    this.limiter.consume('comment', viewer(request), 60, 600_000);
    if (!file?.buffer.length) throw new AuthError('INVALID_IMAGE');
    return CommentResponseSchema.parse({
      comment: await this.interactions.add(
        viewer(request),
        uuid(id),
        input.text,
        input.replyToCommentId,
        file.buffer,
      ),
    });
  }

  @Get('comments/:id/replies')
  @Header('Cache-Control', 'no-store')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiOperation({
    operationId: 'listCommentReplies',
    summary: 'Replies to a root comment, oldest first, three per page',
  })
  @ok(CommentListResponseSchema)
  @errorResponse(404)
  async replies(
    @Param('id') id: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return CommentListResponseSchema.parse(
      await this.interactions.replies(
        viewer(request),
        uuid(id),
        parse(query, PageQuerySchema),
      ),
    );
  }

  @Put('comments/:id/like')
  @Header('Cache-Control', 'no-store')
  @mutationBody(EmptyRequestSchema, {})
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    operationId: 'likeComment',
    summary: 'Like a comment or reply, idempotently',
  })
  @ok(LikeResponseSchema)
  @errorResponse(404)
  async likeComment(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    parse(body, EmptyRequestSchema);
    this.limiter.consume('like', viewer(request), 300, 300_000);
    return LikeResponseSchema.parse(
      await this.interactions.commentLike(viewer(request), uuid(id), true),
    );
  }

  @Delete('comments/:id/like')
  @Header('Cache-Control', 'no-store')
  @mutationBody(EmptyRequestSchema, {})
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    operationId: 'unlikeComment',
    summary: 'Remove a comment like, idempotently',
  })
  @ok(LikeResponseSchema)
  @errorResponse(404)
  async unlikeComment(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    parse(body, EmptyRequestSchema);
    this.limiter.consume('like', viewer(request), 300, 300_000);
    return LikeResponseSchema.parse(
      await this.interactions.commentLike(viewer(request), uuid(id), false),
    );
  }

  @Delete('comments/:id')
  @Header('Cache-Control', 'no-store')
  @mutationBody(EmptyRequestSchema, {})
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    operationId: 'deleteComment',
    summary: 'Delete a comment',
    description:
      'The comment author (even after losing access to the post, P-10) or the post author. Others: 403 CANNOT_DELETE_COMMENT, or 404 when the post is hidden from them.',
  })
  @ok(DeleteCommentResponseSchema)
  @errorResponse(404)
  async removeComment(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    parse(body, EmptyRequestSchema);
    await this.interactions.remove(viewer(request), uuid(id));
    return DeleteCommentResponseSchema.parse({ status: 'deleted' });
  }
}
