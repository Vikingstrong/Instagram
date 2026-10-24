import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
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
  AuthUsernameSchema,
  OwnProfileResponseSchema,
  UpdateOwnProfileRequestSchema,
  UserListResponseSchema,
  UserProfileResponseSchema,
  UserSearchQuerySchema,
} from '@instagram/contracts';
import { UsersService } from './users.service.js';
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

// Every route requires a authenticated session (P-04: no guest profile access).
function viewer(request: AuthenticatedRequest): string {
  return request.authUser!.id;
}

@ApiTags('Users')
@ApiSecurity('session')
@Controller('users')
@UseGuards(SessionGuard)
@errorResponse(401)
@errorResponse(403)
@errorResponse(429)
@errorResponse(500)
@errorResponse(503)
export class UsersController {
  constructor(
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(AuthRateLimiter) private readonly limiter: AuthRateLimiter,
  ) {}

  @Get(':username')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    operationId: 'getUserProfile',
    summary: 'Read a profile summary by username',
    description:
      'Case-insensitive username. Private profiles return the same summary fields and counters (FR-02); posts are never included here. relationship is self, none, requested or following for the signed-in viewer. Unknown accounts are 404.',
  })
  @ApiParam({ name: 'username', example: 'demo_user' })
  @ApiResponse({
    status: 200,
    headers: noStore,
    schema: schema(UserProfileResponseSchema),
  })
  @errorResponse(400)
  @errorResponse(404)
  async profile(
    @Param('username') username: string,
    @Req() request: AuthenticatedRequest,
  ) {
    this.limiter.consume('profile-read', viewer(request), 300, 300_000);
    const name = parse(username, AuthUsernameSchema);
    return UserProfileResponseSchema.parse({
      profile: await this.users.profile(viewer(request), name),
    });
  }
}

@ApiTags('Users')
@ApiSecurity('session')
@Controller('me')
@UseGuards(SessionGuard)
@errorResponse(401)
@errorResponse(403)
@errorResponse(429)
@errorResponse(500)
@errorResponse(503)
export class MeController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Get('profile')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    operationId: 'getOwnProfile',
    summary: 'Read the editable profile of the signed-in account',
  })
  @ApiResponse({
    status: 200,
    headers: noStore,
    schema: schema(OwnProfileResponseSchema),
  })
  async ownProfile(@Req() request: AuthenticatedRequest) {
    return OwnProfileResponseSchema.parse({
      profile: await this.users.ownProfile(viewer(request)),
    });
  }

  @Patch('profile')
  @Header('Cache-Control', 'no-store')
  @mutationBody(UpdateOwnProfileRequestSchema, {
    displayName: 'Demo User',
    bio: 'Hello from the demo profile.',
    isPrivate: true,
  })
  @ApiOperation({
    operationId: 'updateOwnProfile',
    summary: 'Change text profile fields, username or privacy',
    description:
      'Partial update; send at least one field. Requires allowed Origin and CSRF. Username is unique case-insensitively (409 USERNAME_TAKEN). Switching to public approves all pending follow requests; switching to private keeps existing followers.',
  })
  @ApiResponse({
    status: 200,
    headers: noStore,
    schema: schema(OwnProfileResponseSchema),
  })
  @errorResponse(409)
  async updateOwnProfile(
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const input = parse(body, UpdateOwnProfileRequestSchema);
    return OwnProfileResponseSchema.parse({
      profile: await this.users.updateOwnProfile(viewer(request), input),
    });
  }
}

// A separate prefix: /users/{username} would capture "search" as a username.
@ApiTags('Users')
@ApiSecurity('session')
@Controller('search')
@UseGuards(SessionGuard)
@errorResponse(400)
@errorResponse(401)
@errorResponse(403)
@errorResponse(429)
@errorResponse(500)
@errorResponse(503)
export class SearchController {
  constructor(
    @Inject(UsersService) private readonly users: UsersService,
    @Inject(AuthRateLimiter) private readonly limiter: AuthRateLimiter,
  ) {}

  @Get('users')
  @Header('Cache-Control', 'no-store')
  @ApiQuery({ name: 'q', required: true, type: String, example: 'demo' })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 20 })
  @ApiOperation({
    operationId: 'searchUsers',
    summary: 'Search users by username or display name',
    description:
      'Case-insensitive substring match; q is 1–160 characters after trimming. Ordered by username; limit 1–50, default 20. Returns profile cards only, never posts.',
  })
  @ApiResponse({
    status: 200,
    headers: noStore,
    schema: schema(UserListResponseSchema),
  })
  async search(@Query() query: unknown, @Req() request: AuthenticatedRequest) {
    this.limiter.consume('search', viewer(request), 120, 60_000);
    return UserListResponseSchema.parse(
      await this.users.search(parse(query, UserSearchQuerySchema)),
    );
  }
}
