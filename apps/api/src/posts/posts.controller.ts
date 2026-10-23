import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  applyDecorators,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import {
  AvatarResponseSchema,
  CreatePostFieldsSchema,
  DeletePostResponseSchema,
  EmptyRequestSchema,
  PageQuerySchema,
  PostListResponseSchema,
  PostResponseSchema,
  UserSummarySchema,
  imageUploadRules,
} from '@instagram/contracts';
import { PostsService } from './posts.service.js';
import {
  VerifiedSessionGuard,
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

// Multer memory storage fills buffer; nothing is written to disk here.
type UploadedImage = { buffer: Buffer };

const viewer = (request: AuthenticatedRequest): string => request.authUser!.id;
const uuid = (value: string): string =>
  parse(value, UserSummarySchema.shape.id);
function ok(value: Parameters<typeof schema>[0], status = 200) {
  return ApiResponse({ status, headers: noStore, schema: schema(value) });
}

// Multer keeps the single file in memory under the contract limit; guards
// (session, Origin/CSRF, multipart) run before any byte is parsed.
function imageUpload(withCaption: boolean) {
  return applyDecorators(
    UseGuards(UploadMutationGuard),
    UseInterceptors(
      FileInterceptor(imageUploadRules.multipartField, {
        limits: {
          fileSize: imageUploadRules.maxBytes,
          files: 1,
          fields: withCaption ? 1 : 0,
          fieldSize: 16_384,
          parts: withCaption ? 2 : 1,
        },
      }),
    ),
    ApiSecurity('csrfToken'),
    ApiConsumes('multipart/form-data'),
    ApiBody({
      schema: {
        type: 'object',
        required: [imageUploadRules.multipartField],
        properties: {
          [imageUploadRules.multipartField]: {
            type: 'string',
            format: 'binary',
            description: 'JPEG, PNG or WebP, up to 10 MB and 40 MP.',
          },
          ...(withCaption && {
            caption: {
              type: 'string',
              maxLength: 2200,
              description: 'Optional, up to 2200 characters.',
            },
          }),
        },
      },
    }),
    errorResponse(400),
    errorResponse(403),
    errorResponse(413),
  );
}
function image(file: UploadedImage | undefined): Buffer {
  if (!file?.buffer?.length) throw new AuthError('INVALID_IMAGE');
  return file.buffer;
}

@ApiTags('Posts')
@ApiSecurity('session')
@Controller()
@UseGuards(VerifiedSessionGuard)
@errorResponse(401)
@errorResponse(403)
@errorResponse(429)
@errorResponse(500)
@errorResponse(503)
export class PostsController {
  constructor(
    @Inject(PostsService) private readonly posts: PostsService,
    @Inject(AuthRateLimiter) private readonly limiter: AuthRateLimiter,
  ) {}

  @Post('posts')
  @Header('Cache-Control', 'no-store')
  @imageUpload(true)
  @ApiOperation({
    operationId: 'createPost',
    summary: 'Publish a post with one image',
    description:
      'multipart/form-data with an image and an optional caption. The server checks the decoded image, strips metadata and stores prepared WebP variants privately. A failed upload never creates a post.',
  })
  @ok(PostResponseSchema, 201)
  async create(
    @UploadedFile() file: UploadedImage | undefined,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    this.limiter.consume('upload', viewer(request), 30, 3600_000);
    const fields = parse(body ?? {}, CreatePostFieldsSchema);
    return PostResponseSchema.parse({
      post: await this.posts.create(
        viewer(request),
        image(file),
        fields.caption,
      ),
    });
  }

  @Get('posts/:id')
  @Header('Cache-Control', 'no-store')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    operationId: 'getPost',
    summary: 'Read one post',
    description:
      'Author, public profile or approved follower only. Hidden, deleted and unknown posts are 404 POST_NOT_FOUND.',
  })
  @ok(PostResponseSchema)
  @errorResponse(400)
  @errorResponse(404)
  async get(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return PostResponseSchema.parse({
      post: await this.posts.get(viewer(request), uuid(id)),
    });
  }

  @Delete('posts/:id')
  @Header('Cache-Control', 'no-store')
  @mutationBody(EmptyRequestSchema, {})
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    operationId: 'deletePost',
    summary: 'Delete an own post',
    description:
      'Author only; others get 404. The image stops being served immediately.',
  })
  @ok(DeletePostResponseSchema)
  @errorResponse(404)
  async remove(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    parse(body, EmptyRequestSchema);
    await this.posts.remove(viewer(request), uuid(id));
    return DeletePostResponseSchema.parse({ status: 'deleted' });
  }

  @Get('users/:id/posts')
  @Header('Cache-Control', 'no-store')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOperation({
    operationId: 'listUserPosts',
    summary: 'Profile posts, newest first',
    description:
      'Private profile: owner and approved followers only, otherwise 403 PROFILE_PRIVATE. Limit 1–50, default 20.',
  })
  @ok(PostListResponseSchema)
  @errorResponse(400)
  @errorResponse(404)
  async byUser(
    @Param('id') id: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return PostListResponseSchema.parse(
      await this.posts.byUser(
        viewer(request),
        uuid(id),
        parse(query, PageQuerySchema),
      ),
    );
  }

  @Put('me/avatar')
  @Header('Cache-Control', 'no-store')
  @imageUpload(false)
  @ApiOperation({
    operationId: 'setAvatar',
    summary: 'Upload a new profile photo',
    description:
      'multipart/form-data with one image. Avatars are visible wherever the profile summary is (FR-02), served only through the API.',
  })
  @ok(AvatarResponseSchema)
  async setAvatar(
    @UploadedFile() file: UploadedImage | undefined,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    this.limiter.consume('upload', viewer(request), 30, 3600_000);
    parse(body ?? {}, EmptyRequestSchema);
    return AvatarResponseSchema.parse({
      avatarUrl: await this.posts.setAvatar(viewer(request), image(file)),
    });
  }

  @Delete('me/avatar')
  @Header('Cache-Control', 'no-store')
  @mutationBody(EmptyRequestSchema, {})
  @ApiOperation({
    operationId: 'removeAvatar',
    summary: 'Remove the profile photo',
  })
  @ok(AvatarResponseSchema)
  async removeAvatar(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    parse(body, EmptyRequestSchema);
    await this.posts.removeAvatar(viewer(request));
    return AvatarResponseSchema.parse({ avatarUrl: null });
  }

  @Get('media/:id/:variant')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'variant', enum: ['full', 'thumb'] })
  @ApiProduces('image/webp')
  @ApiOperation({
    operationId: 'getMedia',
    summary: 'Image bytes after an access check',
    description:
      'Checked on every request: post images follow post visibility, avatars follow the profile summary. No public or signed URLs; not cacheable by shared caches.',
  })
  @ApiResponse({ status: 200, description: 'image/webp' })
  @errorResponse(400)
  @errorResponse(404)
  async media(
    @Param('id') id: string,
    @Param('variant') variant: string,
    @Req() request: AuthenticatedRequest,
  ) {
    if (variant !== 'full' && variant !== 'thumb')
      throw new AuthError('MEDIA_NOT_FOUND');
    this.limiter.consume('media-read', viewer(request), 1200, 300_000);
    const data = await this.posts.readImage(viewer(request), uuid(id), variant);
    return new StreamableFile(data, {
      type: 'image/webp',
      length: data.length,
    });
  }
}
