import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { rm } from 'node:fs/promises';
import {
  StorySchema,
  storyRules,
  type PageQuery,
  type Story,
} from '@instagram/contracts';
import type { Prisma } from '../generated/prisma/client.js';
import { DatabaseService } from '../infrastructure/database/database.service.js';
import { AuthError } from '../auth/auth.error.js';
import {
  MEDIA_CLEANUP,
  MediaService,
  mediaUrl,
} from '../media/media.service.js';
import {
  summarySelect,
  userSummary,
  encodeCursor,
  decodeCursor,
} from '../users/user-summary.js';
import { visibleStory } from './story-policy.js';

const selection = (viewerId: string) =>
  ({
    id: true,
    createdAt: true,
    expiresAt: true,
    author: { select: summarySelect },
    media: {
      select: {
        id: true,
        type: true,
        state: true,
        width: true,
        height: true,
        durationMs: true,
        failedAt: true,
      },
    },
    views: { where: { userId: viewerId }, select: { userId: true }, take: 1 },
  }) as const;
type Row = Prisma.StoryGetPayload<{ select: ReturnType<typeof selection> }>;
function dto(row: Row): Story {
  const m = row.media;
  return StorySchema.parse({
    id: row.id,
    author: userSummary(row.author),
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    type: m.type === 'VIDEO' ? 'video' : 'photo',
    status:
      m.state === 'READY' ? 'ready' : m.failedAt ? 'failed' : 'processing',
    image: {
      url: mediaUrl(m.id, 'full'),
      thumbnailUrl: mediaUrl(m.id, 'thumb'),
      width: m.width,
      height: m.height,
    },
    video:
      m.type === 'VIDEO' && m.state === 'READY'
        ? { url: mediaUrl(m.id, 'video'), durationMs: m.durationMs }
        : null,
    viewed: row.views.length > 0,
  });
}
function lifetime() {
  const createdAt = new Date();
  return {
    createdAt,
    expiresAt: new Date(createdAt.getTime() + storyRules.lifetimeMs),
  };
}
@Injectable()
export class StoriesService implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running?: Promise<number>;
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(MEDIA_CLEANUP) private readonly cleanupEnabled: boolean,
  ) {}

  async create(userId: string, image: Buffer): Promise<Story> {
    const stored = await this.media.store(userId, 'STORY', image);
    try {
      return dto(
        await this.db.prisma.$transaction(async (tx) => {
          await this.media.activate(tx, stored);
          return tx.story.create({
            data: { authorId: userId, mediaId: stored.id, ...lifetime() },
            select: selection(userId),
          });
        }),
      );
    } catch (error) {
      await this.media.discard(stored.id);
      throw error;
    }
  }
  async createVideo(userId: string, original: string): Promise<Story> {
    try {
      const info = await this.media.inspectVideo(original);
      const row = await this.db.prisma.$transaction(async (tx) => {
        const media = await this.media.createVideo(tx, userId, info, 'STORY');
        return tx.story.create({
          data: { authorId: userId, mediaId: media.id, ...lifetime() },
          select: selection(userId),
        });
      });
      void this.media.processVideo(row.media.id, original);
      return dto(row);
    } catch (error) {
      await rm(original, { force: true }).catch(() => undefined);
      throw error;
    }
  }
  private readable(userId: string): Prisma.StoryWhereInput {
    return {
      OR: [
        visibleStory(userId),
        {
          authorId: userId,
          expiresAt: { gt: new Date() },
          media: { state: 'PENDING' },
        },
      ],
    };
  }
  async get(userId: string, id: string): Promise<Story> {
    const row = await this.db.prisma.story.findFirst({
      where: { id, ...this.readable(userId) },
      select: selection(userId),
    });
    if (!row) throw new AuthError('STORY_NOT_FOUND');
    return dto(row);
  }
  async byUser(viewerId: string, authorId: string, page: PageQuery) {
    const after = decodeCursor(page.cursor, 'date');
    const rows = await this.db.prisma.story.findMany({
      where: {
        AND: [
          { authorId },
          this.readable(viewerId),
          after
            ? {
                OR: [
                  { createdAt: { gt: after.date } },
                  { createdAt: after.date, id: { gt: after.id } },
                ],
              }
            : {},
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: page.limit + 1,
      select: selection(viewerId),
    });
    const items = rows.slice(0, page.limit),
      last = items.at(-1);
    return {
      items: items.map(dto),
      nextCursor:
        rows.length > page.limit && last
          ? encodeCursor(last.createdAt.toISOString(), last.id)
          : null,
    };
  }
  // One group per author with active READY stories, own account and approved
  // followings only. Stable username order; newest story is metadata, not cursor.
  async feed(viewerId: string, page: PageQuery) {
    const after = decodeCursor(page.cursor, 'username');
    const active = visibleStory(viewerId);
    const rows = await this.db.prisma.user.findMany({
      where: {
        AND: [
          {
            stories: { some: active },
            OR: [
              { id: viewerId },
              {
                followers: {
                  some: { followerId: viewerId, status: 'ACCEPTED' },
                },
              },
            ],
          },
          after
            ? {
                OR: [
                  { usernameKey: { gt: after.username } },
                  { usernameKey: after.username, id: { gt: after.id } },
                ],
              }
            : {},
        ],
      },
      orderBy: [{ usernameKey: 'asc' }, { id: 'asc' }],
      take: page.limit + 1,
      select: {
        ...summarySelect,
        usernameKey: true,
        stories: {
          where: active,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { createdAt: true },
        },
        _count: {
          select: {
            stories: {
              where: {
                AND: [active, { views: { none: { userId: viewerId } } }],
              },
            },
          },
        },
      },
    });
    const items = rows.slice(0, page.limit),
      last = items.at(-1);
    return {
      items: items.map((row) => ({
        author: userSummary({
          id: row.id,
          username: row.username,
          displayName: row.displayName,
          isPrivate: row.isPrivate,
          avatarMediaId: row.avatarMediaId,
        }),
        latestAt: row.stories[0]!.createdAt.toISOString(),
        hasUnseen: row._count.stories > 0,
      })),
      nextCursor:
        rows.length > page.limit && last
          ? encodeCursor(last.usernameKey, last.id)
          : null,
    };
  }
  async view(viewerId: string, id: string): Promise<void> {
    await this.db.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM stories WHERE id = ${id}::uuid FOR UPDATE`;
      const row = await tx.story.findFirst({
        where: { id, ...visibleStory(viewerId) },
        select: { authorId: true },
      });
      if (!row) throw new AuthError('STORY_NOT_FOUND');
      // Keep the author's own seen state for the avatar ring, but exclude
      // them from the audience projection below.
      await tx.storyView.upsert({
        where: { storyId_userId: { storyId: id, userId: viewerId } },
        create: { storyId: id, userId: viewerId },
        update: {},
      });
    });
  }
  async viewers(viewerId: string, id: string, page: PageQuery) {
    const story = await this.db.prisma.story.findFirst({
      where: { id, authorId: viewerId, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (!story) throw new AuthError('STORY_NOT_FOUND');
    const after = decodeCursor(page.cursor, 'date');
    const rows = await this.db.prisma.storyView.findMany({
      where: {
        storyId: id,
        userId: { not: viewerId },
        ...(after
          ? {
              OR: [
                { viewedAt: { lt: after.date } },
                { viewedAt: after.date, userId: { lt: after.id } },
              ],
            }
          : {}),
      },
      select: { user: { select: summarySelect }, viewedAt: true, userId: true },
      orderBy: [{ viewedAt: 'desc' }, { userId: 'desc' }],
      take: page.limit + 1,
    });
    const items = rows.slice(0, page.limit),
      last = items.at(-1);
    return {
      items: items.map((row) => ({
        user: userSummary(row.user),
        viewedAt: row.viewedAt.toISOString(),
      })),
      total: await this.db.prisma.storyView.count({
        where: { storyId: id, userId: { not: viewerId } },
      }),
      nextCursor:
        rows.length > page.limit && last
          ? encodeCursor(last.viewedAt.toISOString(), last.userId)
          : null,
    };
  }
  async remove(viewerId: string, id: string): Promise<void> {
    const mediaId = await this.db.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM stories WHERE id = ${id}::uuid FOR UPDATE`;
      const row = await tx.story.findFirst({
        where: { id, authorId: viewerId },
        select: { mediaId: true },
      });
      if (!row) throw new AuthError('STORY_NOT_FOUND');
      await tx.story.delete({ where: { id } });
      await this.media.markDeleted(tx, row.mediaId);
      return row.mediaId;
    });
    await this.media.discard(mediaId);
  }

  // Stories owns its rows; MediaService owns state transitions and file cleanup.
  // Expiry has already stopped reads, so a filesystem failure is retryable.
  async cleanup(now = new Date()): Promise<number> {
    const failedBefore = new Date(now.getTime() - 3600_000);
    const stale: Prisma.StoryWhereInput = {
      OR: [
        { expiresAt: { lte: now } },
        { media: { type: 'VIDEO', failedAt: { lt: failedBefore } } },
      ],
    };
    const rows = await this.db.prisma.story.findMany({
      where: stale,
      select: { id: true, mediaId: true },
      take: 100,
    });
    let removed = 0;
    for (const row of rows) {
      const deleted = await this.db.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM stories WHERE id = ${row.id}::uuid FOR UPDATE`;
        const { count } = await tx.story.deleteMany({
          where: { id: row.id, ...stale },
        });
        if (count) await this.media.markDeleted(tx, row.mediaId);
        return count;
      });
      if (deleted) {
        await this.media.discard(row.mediaId);
        removed += deleted;
      }
    }
    return removed;
  }
  async onApplicationBootstrap(): Promise<void> {
    if (!this.cleanupEnabled) return;
    await this.cleanup().catch(() => 0);
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.cleanup()
        .catch(() => 0)
        .finally(() => {
          this.running = undefined;
        });
    }, 600_000);
    this.timer.unref();
  }
  async onModuleDestroy(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }
}
