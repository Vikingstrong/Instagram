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
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
  DeleteStoryResponseSchema,
  EmptyRequestSchema,
  PageQuerySchema,
  StoryFeedResponseSchema,
  StoryListResponseSchema,
  StoryResponseSchema,
  StoryViewedResponseSchema,
  StoryViewersResponseSchema,
  UserSummarySchema,
  imageUploadRules,
  videoUploadRules,
} from '@instagram/contracts';
import { rm } from 'node:fs/promises';
import {
  SessionGuard,
  type AuthenticatedRequest,
} from '../auth/auth-session.guard.js';
import { UploadMutationGuard } from '../auth/auth-security.js';
import { AuthRateLimiter } from '../auth/auth-rate-limiter.js';
import { AuthError } from '../auth/auth.error.js';
import {
  errorResponse,
  mutationBody,
  noStore,
  parse,
  schema,
} from '../auth/auth-http.js';
import { VideoUploadInterceptor } from '../posts/video-upload.interceptor.js';
import { StoriesService } from './stories.service.js';
const uuid = (id: string) => parse(id, UserSummarySchema.shape.id);
const ok = (value: Parameters<typeof schema>[0], status = 200) =>
  ApiResponse({ status, headers: noStore, schema: schema(value) });
const uploadBody = (field: string, description: string) =>
  ApiBody({
    schema: {
      type: 'object',
      required: [field],
      additionalProperties: false,
      properties: {
        [field]: { type: 'string', format: 'binary', description },
      },
    },
  });

@ApiTags('Stories')
@ApiSecurity('session')
@Controller()
@UseGuards(SessionGuard)
@errorResponse(400)
@errorResponse(401)
@errorResponse(403)
@errorResponse(404)
@errorResponse(429)
@errorResponse(500)
@errorResponse(503)
export class StoriesController {
  constructor(
    @Inject(StoriesService) private readonly stories: StoriesService,
    @Inject(AuthRateLimiter) private readonly limiter: AuthRateLimiter,
  ) {}
  private viewer(req: AuthenticatedRequest) {
    this.limiter.consume('stories-read', req.authUser!.id, 600, 300_000);
    return req.authUser!.id;
  }
  @Post('stories')
  @Header('Cache-Control', 'no-store')
  @UseGuards(UploadMutationGuard)
  @UseInterceptors(
    FileInterceptor('image', {
      limits: {
        fileSize: imageUploadRules.maxBytes,
        files: 1,
        fields: 0,
        parts: 1,
      },
    }),
  )
  @ApiSecurity('csrfToken')
  @ApiConsumes('multipart/form-data')
  @uploadBody(
    'image',
    'JPEG, PNG or WebP; up to 10 MB, 40 MP. Visible for 24 hours from creation.',
  )
  @ApiOperation({
    operationId: 'createStory',
    summary: 'Publish one photo story for 24 hours',
  })
  @ok(StoryResponseSchema, 201)
  @errorResponse(413)
  async create(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @Body() body: unknown,
  ) {
    this.limiter.consume('upload', req.authUser!.id, 30, 3600_000);
    parse(body ?? {}, EmptyRequestSchema);
    if (!file?.buffer?.length) throw new AuthError('INVALID_IMAGE');
    return StoryResponseSchema.parse({
      story: await this.stories.create(req.authUser!.id, file.buffer),
    });
  }
  @Post('stories/video')
  @Header('Cache-Control', 'no-store')
  @UseGuards(UploadMutationGuard)
  @UseInterceptors(VideoUploadInterceptor)
  @ApiSecurity('csrfToken')
  @ApiConsumes('multipart/form-data')
  @uploadBody(
    videoUploadRules.multipartField,
    'MP4, MOV or WebM; up to 100 MB and 90 seconds. Processing in background; 24 hours from creation.',
  )
  @ApiOperation({
    operationId: 'createVideoStory',
    summary: 'Publish one video story; poll getStory until ready',
  })
  @ok(StoryResponseSchema, 201)
  @errorResponse(413)
  async video(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file: { path: string } | undefined,
    @Body() body: unknown,
  ) {
    if (!file?.path) throw new AuthError('INVALID_VIDEO');
    try {
      parse(body ?? {}, EmptyRequestSchema);
    } catch (error) {
      await rm(file.path, { force: true });
      throw error;
    }
    return StoryResponseSchema.parse({
      story: await this.stories.createVideo(req.authUser!.id, file.path),
    });
  }
  @Get('stories/feed')
  @Header('Cache-Control', 'no-store')
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOperation({
    operationId: 'listStoryFeed',
    summary:
      'Active story authors: own and approved followings, username order',
  })
  @ok(StoryFeedResponseSchema)
  async feed(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    return StoryFeedResponseSchema.parse(
      await this.stories.feed(this.viewer(req), parse(query, PageQuerySchema)),
    );
  }
  @Get('users/:id/stories')
  @Header('Cache-Control', 'no-store')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOperation({
    operationId: 'listUserStories',
    summary:
      'Active accessible stories of an author, oldest first; empty for inaccessible authors',
  })
  @ok(StoryListResponseSchema)
  async byUser(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return StoryListResponseSchema.parse(
      await this.stories.byUser(
        this.viewer(req),
        uuid(id),
        parse(query, PageQuerySchema),
      ),
    );
  }
  @Get('stories/:id')
  @Header('Cache-Control', 'no-store')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    operationId: 'getStory',
    summary:
      'Read an accessible, unexpired story; only author sees processing/failed video',
  })
  @ok(StoryResponseSchema)
  async get(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return StoryResponseSchema.parse({
      story: await this.stories.get(this.viewer(req), uuid(id)),
    });
  }
  @Post('stories/:id/views')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @mutationBody(EmptyRequestSchema, {})
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    operationId: 'viewStory',
    summary:
      'Record first successful display; idempotent, author is not counted',
  })
  @ok(StoryViewedResponseSchema)
  async view(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    parse(body, EmptyRequestSchema);
    await this.stories.view(this.viewer(req), uuid(id));
    return StoryViewedResponseSchema.parse({ status: 'viewed' });
  }
  @Get('stories/:id/viewers')
  @Header('Cache-Control', 'no-store')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiOperation({
    operationId: 'listStoryViewers',
    summary: 'Author only: unique viewers, newest first, during story lifetime',
  })
  @ok(StoryViewersResponseSchema)
  async viewers(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return StoryViewersResponseSchema.parse(
      await this.stories.viewers(
        this.viewer(req),
        uuid(id),
        parse(query, PageQuerySchema),
      ),
    );
  }
  @Delete('stories/:id')
  @Header('Cache-Control', 'no-store')
  @mutationBody(EmptyRequestSchema, {})
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    operationId: 'deleteStory',
    summary: 'Author only: revoke story and direct media access immediately',
  })
  @ok(DeleteStoryResponseSchema)
  async remove(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    parse(body, EmptyRequestSchema);
    await this.stories.remove(this.viewer(req), uuid(id));
    return DeleteStoryResponseSchema.parse({ status: 'deleted' });
  }
}
