import { Inject, Injectable } from '@nestjs/common';
import {
  OwnProfileSchema,
  UserProfileSchema,
  type OwnProfile,
  type ProfileRelationship,
  type UpdateOwnProfileRequest,
  type UserListResponse,
  type UserProfile,
  type UserSearchQuery,
} from '@instagram/contracts';
import { DatabaseService } from '../infrastructure/database/database.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { AuthError } from '../auth/auth.error.js';
import {
  avatarUrl,
  decodeCursor,
  encodeCursor,
  summarySelect,
  userSummary,
} from './user-summary.js';

const ownSelect = {
  id: true,
  username: true,
  displayName: true,
  bio: true,
  isPrivate: true,
  avatarMediaId: true,
} as const;

type OwnRow = { avatarMediaId: string | null } & Omit<OwnProfile, 'avatarUrl'>;
const toOwnProfile = ({ avatarMediaId, ...user }: OwnRow): OwnProfile =>
  OwnProfileSchema.parse({ ...user, avatarUrl: avatarUrl(avatarMediaId) });

@Injectable()
export class UsersService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  // Unverified accounts cannot use the product yet, so they are not found.
  async profile(viewerId: string, username: string): Promise<UserProfile> {
    const user = await this.database.prisma.user.findFirst({
      where: {
        usernameKey: username.toLowerCase(),
        emailVerifiedAt: { not: null },
      },
      select: {
        ...ownSelect,
        _count: {
          select: {
            posts: true,
            followers: { where: { status: 'ACCEPTED' } },
            following: { where: { status: 'ACCEPTED' } },
          },
        },
      },
    });
    if (!user) throw new AuthError('USER_NOT_FOUND');
    let relationship: ProfileRelationship = 'self';
    if (user.id !== viewerId) {
      const follow = await this.database.prisma.follow.findUnique({
        where: {
          followerId_followeeId: { followerId: viewerId, followeeId: user.id },
        },
        select: { status: true },
      });
      relationship = !follow
        ? 'none'
        : follow.status === 'ACCEPTED'
          ? 'following'
          : 'requested';
    }
    return UserProfileSchema.parse({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      bio: user.bio,
      avatarUrl: avatarUrl(user.avatarMediaId),
      isPrivate: user.isPrivate,
      // Counters are public (FR-02), including posts of private profiles.
      counts: {
        posts: user._count.posts,
        followers: user._count.followers,
        following: user._count.following,
      },
      relationship,
    });
  }

  async ownProfile(userId: string): Promise<OwnProfile> {
    const user = await this.database.prisma.user.findUnique({
      where: { id: userId },
      select: ownSelect,
    });
    if (!user) throw new AuthError('AUTHENTICATION_REQUIRED');
    return toOwnProfile(user);
  }

  async updateOwnProfile(
    userId: string,
    input: UpdateOwnProfileRequest,
  ): Promise<OwnProfile> {
    try {
      return await this.database.prisma.$transaction(async (tx) => {
        // Lock the row: follow requests must read isPrivate under the same
        // lock, so none can stay pending after the profile turns public.
        const rows = await tx.$queryRaw<
          { isPrivate: boolean }[]
        >`SELECT "isPrivate" FROM auth_users WHERE id = ${userId}::uuid FOR UPDATE`;
        if (!rows[0]) throw new AuthError('AUTHENTICATION_REQUIRED');
        const updated = await tx.user.update({
          where: { id: userId },
          data: {
            displayName: input.displayName,
            displayNameKey: input.displayName?.toLowerCase(),
            bio: input.bio,
            isPrivate: input.isPrivate,
            ...(input.username !== undefined && {
              username: input.username,
              usernameKey: input.username.toLowerCase(),
            }),
          },
          select: ownSelect,
        });
        // P-06: going public approves all pending requests; going private
        // keeps existing followers.
        if (rows[0].isPrivate && !updated.isPrivate)
          await tx.follow.updateMany({
            where: { followeeId: userId, status: 'PENDING' },
            data: { status: 'ACCEPTED', acceptedAt: new Date() },
          });
        return toOwnProfile(updated);
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new AuthError('USERNAME_TAKEN');
      throw error;
    }
  }

  // Case-insensitive (Unicode) substring match on username or display name
  // keys written by the API, ordered by
  // username key so the keyset cursor is stable. Prisma passes contains into
  // LIKE unescaped, so %, _ and the escape character are escaped here.
  async search(query: UserSearchQuery): Promise<UserListResponse> {
    const after = decodeCursor(query.cursor, 'username');
    const text = query.q.replace(/[\\%_]/g, '\\$&');
    const rows = await this.database.prisma.user.findMany({
      where: {
        emailVerifiedAt: { not: null },
        OR: [
          { usernameKey: { contains: text.toLowerCase() } },
          { displayNameKey: { contains: text.toLowerCase() } },
        ],
        ...(after && { usernameKey: { gt: after.username } }),
      },
      orderBy: { usernameKey: 'asc' },
      take: query.limit + 1,
      select: { ...summarySelect, usernameKey: true },
    });
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    return {
      items: items.map(({ usernameKey: _key, ...user }) => userSummary(user)),
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor(last.usernameKey, last.id)
          : null,
    };
  }
}
