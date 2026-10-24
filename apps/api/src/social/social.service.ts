import { Inject, Injectable } from '@nestjs/common';
import type {
  FollowRequest,
  FollowResponse,
  PageQuery,
  UserListResponse,
  UserSummary,
} from '@instagram/contracts';
import { DatabaseService } from '../infrastructure/database/database.service.js';
import { AuthError } from '../auth/auth.error.js';
import {
  decodeCursor,
  encodeCursor,
  summarySelect,
  userSummary,
} from '../users/user-summary.js';

type Page<T> = { items: T[]; nextCursor: string | null };

@Injectable()
export class SocialService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  // Public profiles are followed at once, private ones get a pending request.
  // The target row is read FOR SHARE: a concurrent privacy switch holds
  // FOR UPDATE, so a request can never stay pending on a public profile.
  async follow(viewerId: string, targetId: string): Promise<FollowResponse> {
    if (viewerId === targetId) throw new AuthError('CANNOT_FOLLOW_SELF');
    return this.database.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ isPrivate: boolean }[]>`
        SELECT "isPrivate" FROM auth_users
        WHERE id = ${targetId}::uuid
        FOR SHARE`;
      if (!rows[0]) throw new AuthError('USER_NOT_FOUND');
      const accepted = !rows[0].isPrivate;
      // Idempotent: a repeated or concurrent follow keeps the existing row.
      await tx.follow.createMany({
        data: {
          followerId: viewerId,
          followeeId: targetId,
          status: accepted ? 'ACCEPTED' : 'PENDING',
          acceptedAt: accepted ? new Date() : null,
        },
        skipDuplicates: true,
      });
      const row = await tx.follow.findUniqueOrThrow({
        where: {
          followerId_followeeId: { followerId: viewerId, followeeId: targetId },
        },
        select: { status: true },
      });
      return {
        relationship: row.status === 'ACCEPTED' ? 'following' : 'requested',
      };
    });
  }

  // Unfollow or cancel a pending request. Idempotent for existing users.
  async unfollow(viewerId: string, targetId: string): Promise<FollowResponse> {
    await this.requireUser(targetId);
    await this.database.prisma.follow.deleteMany({
      where: { followerId: viewerId, followeeId: targetId },
    });
    return { relationship: 'none' };
  }

  // P-05: lists of a private profile are visible to its owner and approved
  // followers only. Newest relationships first.
  async list(
    viewerId: string,
    targetId: string,
    direction: 'followers' | 'following',
    page: PageQuery,
  ): Promise<UserListResponse> {
    const target = await this.requireUser(targetId);
    if (target.isPrivate && viewerId !== targetId) {
      const access = await this.database.prisma.follow.findUnique({
        where: {
          followerId_followeeId: { followerId: viewerId, followeeId: targetId },
        },
        select: { status: true },
      });
      if (access?.status !== 'ACCEPTED') throw new AuthError('PROFILE_PRIVATE');
    }
    const after = decodeCursor(page.cursor, 'date');
    const rows =
      direction === 'followers'
        ? (
            await this.database.prisma.follow.findMany({
              where: {
                followeeId: targetId,
                status: 'ACCEPTED',
                ...(after && {
                  OR: [
                    { acceptedAt: { lt: after.date } },
                    { acceptedAt: after.date, followerId: { lt: after.id } },
                  ],
                }),
              },
              orderBy: [{ acceptedAt: 'desc' }, { followerId: 'desc' }],
              take: page.limit + 1,
              select: { acceptedAt: true, follower: { select: summarySelect } },
            })
          ).map((row) => ({ acceptedAt: row.acceptedAt, user: row.follower }))
        : (
            await this.database.prisma.follow.findMany({
              where: {
                followerId: targetId,
                status: 'ACCEPTED',
                ...(after && {
                  OR: [
                    { acceptedAt: { lt: after.date } },
                    { acceptedAt: after.date, followeeId: { lt: after.id } },
                  ],
                }),
              },
              orderBy: [{ acceptedAt: 'desc' }, { followeeId: 'desc' }],
              take: page.limit + 1,
              select: { acceptedAt: true, followee: { select: summarySelect } },
            })
          ).map((row) => ({ acceptedAt: row.acceptedAt, user: row.followee }));
    return this.page(rows, page.limit, (row) => ({
      item: userSummary(row.user),
      cursor: encodeCursor(row.acceptedAt!.toISOString(), row.user.id),
    }));
  }

  async requests(
    viewerId: string,
    page: PageQuery,
  ): Promise<Page<FollowRequest>> {
    const after = decodeCursor(page.cursor, 'date');
    const rows = await this.database.prisma.follow.findMany({
      where: {
        followeeId: viewerId,
        status: 'PENDING',
        ...(after && {
          OR: [
            { createdAt: { lt: after.date } },
            { createdAt: after.date, followerId: { lt: after.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { followerId: 'desc' }],
      take: page.limit + 1,
      select: { createdAt: true, follower: { select: summarySelect } },
    });
    return this.page(rows, page.limit, (row) => ({
      item: {
        user: userSummary(row.follower),
        requestedAt: row.createdAt.toISOString(),
      },
      cursor: encodeCursor(row.createdAt.toISOString(), row.follower.id),
    }));
  }

  // Conditional transitions from PENDING: concurrent accept/decline/cancel
  // resolve to exactly one outcome; the loser gets 404.
  async accept(viewerId: string, requesterId: string): Promise<void> {
    const { count } = await this.database.prisma.follow.updateMany({
      where: {
        followerId: requesterId,
        followeeId: viewerId,
        status: 'PENDING',
      },
      data: { status: 'ACCEPTED', acceptedAt: new Date() },
    });
    if (count === 0) throw new AuthError('FOLLOW_REQUEST_NOT_FOUND');
  }

  async decline(viewerId: string, requesterId: string): Promise<void> {
    const { count } = await this.database.prisma.follow.deleteMany({
      where: {
        followerId: requesterId,
        followeeId: viewerId,
        status: 'PENDING',
      },
    });
    if (count === 0) throw new AuthError('FOLLOW_REQUEST_NOT_FOUND');
  }

  // Idempotent; access to private content ends with the row.
  async removeFollower(viewerId: string, followerId: string): Promise<void> {
    await this.database.prisma.follow.deleteMany({
      where: { followerId, followeeId: viewerId, status: 'ACCEPTED' },
    });
  }

  async suggestions(viewerId: string, limit: number): Promise<UserSummary[]> {
    const rows = await this.database.prisma.$queryRaw<
      {
        id: string;
        username: string;
        displayName: string;
        isPrivate: boolean;
        avatarMediaId: string | null;
      }[]
    >`
      SELECT u.id, u.username, u."displayName", u."isPrivate", u."avatarMediaId"
      FROM auth_users u
      WHERE u.id <> ${viewerId}::uuid
        AND NOT EXISTS (
          SELECT 1 FROM follows f
          WHERE f."followerId" = ${viewerId}::uuid AND f."followeeId" = u.id
        )
      ORDER BY random()
      LIMIT ${limit}`;
    return rows.map(userSummary);
  }

  private async requireUser(id: string) {
    const user = await this.database.prisma.user.findFirst({
      where: { id },
      select: { isPrivate: true },
    });
    if (!user) throw new AuthError('USER_NOT_FOUND');
    return user;
  }

  private page<R, T>(
    rows: R[],
    limit: number,
    map: (row: R) => { item: T; cursor: string },
  ): Page<T> {
    const mapped = rows.slice(0, limit).map(map);
    return {
      items: mapped.map((entry) => entry.item),
      nextCursor: rows.length > limit ? (mapped.at(-1)?.cursor ?? null) : null,
    };
  }
}
