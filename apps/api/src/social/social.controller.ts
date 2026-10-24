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
  EmptyRequestSchema,
  FollowRequestDecisionResponseSchema,
  FollowRequestListResponseSchema,
  FollowResponseSchema,
  PageQuerySchema,
  RemoveFollowerResponseSchema,
  SuggestionsQuerySchema,
  SuggestionsResponseSchema,
  UserListResponseSchema,
  UserSummarySchema,
} from '@instagram/contracts';
import { SocialService } from './social.service.js';
import {
  SessionGuard,
  type AuthenticatedRequest,
} from '../auth/auth-session.guard.js';
import {
  errorResponse,
  mutationBody,
  noStore,
  parse,
  schema,
} from '../auth/auth-http.js';

const viewer = (request: AuthenticatedRequest): string => request.authUser!.id;
const userId = (value: string): string =>
  parse(value, UserSummarySchema.shape.id);
const idParam = ApiParam({
  name: 'id',
  format: 'uuid',
  description: 'User id',
});
const pageQuery = applyDecorators(
  ApiQuery({ name: 'cursor', required: false, type: String }),
  ApiQuery({ name: 'limit', required: false, type: Number, example: 20 }),
);
function ok(value: Parameters<typeof schema>[0]) {
  return ApiResponse({ status: 200, headers: noStore, schema: schema(value) });
}

@ApiTags('Social')
@ApiSecurity('session')
@Controller('users')
@UseGuards(SessionGuard)
@errorResponse(401)
@errorResponse(403)
@errorResponse(404)
@errorResponse(429)
@errorResponse(500)
@errorResponse(503)
export class UsersSocialController {
  constructor(@Inject(SocialService) private readonly social: SocialService) {}

  @Post(':id/follow')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @mutationBody(EmptyRequestSchema, {})
  @idParam
  @ApiOperation({
    operationId: 'followUser',
    summary: 'Follow a user or request to follow a private profile',
    description:
      'Public profile: following at once. Private profile: a pending request (requested). Idempotent; never duplicates. Following yourself is 400 CANNOT_FOLLOW_SELF.',
  })
  @ok(FollowResponseSchema)
  async follow(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    parse(body, EmptyRequestSchema);
    return FollowResponseSchema.parse(
      await this.social.follow(viewer(request), userId(id)),
    );
  }

  @Delete(':id/follow')
  @Header('Cache-Control', 'no-store')
  @mutationBody(EmptyRequestSchema, {})
  @idParam
  @ApiOperation({
    operationId: 'unfollowUser',
    summary: 'Unfollow or cancel a pending request',
    description: 'Idempotent. Access to private content ends immediately.',
  })
  @ok(FollowResponseSchema)
  async unfollow(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    parse(body, EmptyRequestSchema);
    return FollowResponseSchema.parse(
      await this.social.unfollow(viewer(request), userId(id)),
    );
  }

  @Get(':id/followers')
  @Header('Cache-Control', 'no-store')
  @idParam
  @pageQuery
  @ApiOperation({
    operationId: 'listFollowers',
    summary: 'List approved followers, newest first',
    description:
      'Private profile: owner and approved followers only, otherwise 403 PROFILE_PRIVATE. Limit 1–50, default 20.',
  })
  @ok(UserListResponseSchema)
  @errorResponse(400)
  async followers(
    @Param('id') id: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return UserListResponseSchema.parse(
      await this.social.list(
        viewer(request),
        userId(id),
        'followers',
        parse(query, PageQuerySchema),
      ),
    );
  }

  @Get(':id/following')
  @Header('Cache-Control', 'no-store')
  @idParam
  @pageQuery
  @ApiOperation({
    operationId: 'listFollowing',
    summary: 'List approved followings, newest first',
    description: 'Same visibility rule as followers. Limit 1–50, default 20.',
  })
  @ok(UserListResponseSchema)
  @errorResponse(400)
  async following(
    @Param('id') id: string,
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return UserListResponseSchema.parse(
      await this.social.list(
        viewer(request),
        userId(id),
        'following',
        parse(query, PageQuerySchema),
      ),
    );
  }
}

@ApiTags('Social')
@ApiSecurity('session')
@Controller('me')
@UseGuards(SessionGuard)
@errorResponse(401)
@errorResponse(403)
@errorResponse(429)
@errorResponse(500)
@errorResponse(503)
export class MeSocialController {
  constructor(@Inject(SocialService) private readonly social: SocialService) {}

  @Get('follow-requests')
  @Header('Cache-Control', 'no-store')
  @pageQuery
  @ApiOperation({
    operationId: 'listFollowRequests',
    summary: 'Incoming pending follow requests, newest first',
  })
  @ok(FollowRequestListResponseSchema)
  @errorResponse(400)
  async requests(
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return FollowRequestListResponseSchema.parse(
      await this.social.requests(
        viewer(request),
        parse(query, PageQuerySchema),
      ),
    );
  }

  @Post('follow-requests/:id/accept')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @mutationBody(EmptyRequestSchema, {})
  @ApiParam({ name: 'id', format: 'uuid', description: 'Requester id' })
  @ApiOperation({
    operationId: 'acceptFollowRequest',
    summary: 'Approve a pending request',
    description:
      'Conditional transition from pending. Already handled or cancelled requests are 404 FOLLOW_REQUEST_NOT_FOUND.',
  })
  @ok(FollowRequestDecisionResponseSchema)
  @errorResponse(404)
  async accept(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    parse(body, EmptyRequestSchema);
    await this.social.accept(viewer(request), userId(id));
    return FollowRequestDecisionResponseSchema.parse({ status: 'accepted' });
  }

  @Post('follow-requests/:id/decline')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @mutationBody(EmptyRequestSchema, {})
  @ApiParam({ name: 'id', format: 'uuid', description: 'Requester id' })
  @ApiOperation({
    operationId: 'declineFollowRequest',
    summary: 'Decline a pending request',
    description:
      'Deletes the request; the requester may ask again. Already handled requests are 404.',
  })
  @ok(FollowRequestDecisionResponseSchema)
  @errorResponse(404)
  async decline(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    parse(body, EmptyRequestSchema);
    await this.social.decline(viewer(request), userId(id));
    return FollowRequestDecisionResponseSchema.parse({ status: 'declined' });
  }

  @Delete('followers/:id')
  @Header('Cache-Control', 'no-store')
  @mutationBody(EmptyRequestSchema, {})
  @ApiParam({ name: 'id', format: 'uuid', description: 'Follower id' })
  @ApiOperation({
    operationId: 'removeFollower',
    summary: 'Remove an approved follower',
    description: 'Idempotent. Their access to private content ends.',
  })
  @ok(RemoveFollowerResponseSchema)
  async removeFollower(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    parse(body, EmptyRequestSchema);
    await this.social.removeFollower(viewer(request), userId(id));
    return RemoveFollowerResponseSchema.parse({ status: 'removed' });
  }

  @Get('suggestions')
  @Header('Cache-Control', 'no-store')
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 5 })
  @ApiOperation({
    operationId: 'listSuggestions',
    summary: 'Random accounts to follow',
    description:
      'Random accounts the viewer neither follows nor requested, excluding the viewer. Limit 1–20, default 5. An empty list means there is nothing to suggest.',
  })
  @ok(SuggestionsResponseSchema)
  @errorResponse(400)
  async suggestions(
    @Query() query: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const { limit } = parse(query, SuggestionsQuerySchema);
    return SuggestionsResponseSchema.parse({
      items: await this.social.suggestions(viewer(request), limit),
    });
  }
}
