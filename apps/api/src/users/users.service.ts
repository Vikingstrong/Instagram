import { Inject, Injectable } from '@nestjs/common';
import {
  OwnProfileSchema,
  UserProfileSchema,
  type OwnProfile,
  type ProfileRelationship,
  type UpdateOwnProfileRequest,
  type UserProfile,
} from '@instagram/contracts';
import { DatabaseService } from '../infrastructure/database/database.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { AuthError } from '../auth/auth.error.js';

const ownSelect = {
  id: true,
  username: true,
  displayName: true,
  bio: true,
  isPrivate: true,
} as const;

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
      avatarUrl: null,
      isPrivate: user.isPrivate,
      // Posts arrive with stage 4; there is nothing to count yet.
      counts: {
        posts: 0,
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
    return OwnProfileSchema.parse(user);
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
        return OwnProfileSchema.parse(updated);
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
}
