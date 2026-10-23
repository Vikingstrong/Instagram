import {
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
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import {
  CommentListResponseSchema,
  CommentResponseSchema,
  CreateCommentRequestSchema,
  DeleteCommentResponseSchema,
  EmptyRequestSchema,
  LikeResponseSchema,
  PageQuerySchema,
  PostListResponseSchema,
  UserSummarySchema,
} from '@instagram/contracts';
import { PostsService } from './posts.service.js';
import { InteractionsService } from './interactions.service.js';
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

// FR-05 feed and FR-06 likes/comments. Access follows post-policy.ts.
@ApiTags('Feed and interactions')
@ApiSecurity('session')
@Controller()
@UseGuards(VerifiedSessionGuard)
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
