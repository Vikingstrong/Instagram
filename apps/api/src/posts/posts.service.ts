import { Inject, Injectable } from '@nestjs/common';
import { rm } from 'node:fs/promises';
import {
  PostSchema,
  type PageQuery,
  type Post,
  type PostListResponse,
} from '@instagram/contracts';
import type { Prisma, MediaType } from '../generated/prisma/client.js';
import { DatabaseService } from '../infrastructure/database/database.service.js';
import { AuthError } from '../auth/auth.error.js';
import { MediaService, mediaUrl } from '../media/media.service.js';
import type { MediaVariant } from '../media/media-storage.js';
import {
  avatarUrl,
  decodeCursor,
  encodeCursor,
  summarySelect,
  userSummary,
} from '../users/user-summary.js';
import { visibleStory } from '../stories/story-policy.js';
import { visibleAuthor, visiblePost } from './post-policy.js';

// Counters and the viewer's own like are read with the post in one query.
const postSelect = (viewerId: string) =>
  ({
    id: true,
    caption: true,
    createdAt: true,
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
    author: { select: summarySelect },
    _count: { select: { likes: true, comments: true, shares: true } },
    likes: { where: { userId: viewerId }, select: { userId: true }, take: 1 },
  }) as const;

type PostRow = {
  id: string;
  caption: string;
  createdAt: Date;
  media: {
    id: string;
    type: MediaType;
    state: 'PENDING' | 'READY' | 'DELETED';
    width: number | null;
    height: number | null;
    durationMs: number | null;
    failedAt: Date | null;
  };
  author: Parameters<typeof userSummary>[0];
  _count: { likes: number; comments: number; shares: number };
  likes: { userId: string }[];
};

// A video post's image is its poster. Until processing ends only the
// author can read the post, and its video is not served yet.
function toPost(row: PostRow): Post {
  const { media } = row;
  const ready = media.state === 'READY';
  return PostSchema.parse({
    id: row.id,
    author: userSummary(row.author),
    caption: row.caption,
    type: media.type === 'VIDEO' ? 'video' : 'photo',
    video:
      media.type === 'VIDEO' && ready
        ? { url: mediaUrl(media.id, 'video'), durationMs: media.durationMs }
        : null,
    status: ready ? 'ready' : media.failedAt ? 'failed' : 'processing',
    image: {
      url: mediaUrl(row.media.id, 'full'),
      thumbnailUrl: mediaUrl(row.media.id, 'thumb'),
      width: row.media.width,
      height: row.media.height,
    },
    createdAt: row.createdAt.toISOString(),
    likeCount: row._count.likes,
    commentCount: row._count.comments,
    shareCount: row._count.shares,
    liked: row.likes.length > 0,
  });
}

// Keyset page, newest first: createdAt DESC, id DESC.
async function postPage(
  find: (args: {
    where: Prisma.PostWhereInput;
    take: number;
  }) => Promise<PostRow[]>,
  where: Prisma.PostWhereInput,
  page: PageQuery,
): Promise<PostListResponse> {
  const after = decodeCursor(page.cursor, 'date');
  const rows = await find({
    where: {
      AND: [
        where,
        after
          ? {
              OR: [
                { createdAt: { lt: after.date } },
                { createdAt: after.date, id: { lt: after.id } },
              ],
            }
          : {},
      ],
    },
    take: page.limit + 1,
  });
  const items = rows.slice(0, page.limit);
  const last = items.at(-1);
  return {
    items: items.map(toPost),
    nextCursor:
      rows.length > page.limit && last
        ? encodeCursor(last.createdAt.toISOString(), last.id)
        : null,
  };
}

@Injectable()
export class PostsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MediaService) private readonly media: MediaService,
  ) {}

  // Image first (PENDING media with files), then one transaction makes the
  // media READY and creates the post. Any failure leaves no visible post.
  async create(
    authorId: string,
    image: Buffer,
    caption: string,
  ): Promise<Post> {
    const stored = await this.media.store(authorId, 'POST', image);
    try {
      const row = await this.database.prisma.$transaction(async (tx) => {
        await this.media.activate(tx, stored);
        return tx.post.create({
          data: { authorId, mediaId: stored.id, caption },
          select: postSelect(authorId),
        });
      });
      return toPost(row);
    } catch (error) {
      await this.media.discard(stored.id);
      throw error;
    }
  }

  // FR-10: the original is checked before anything is recorded; then the
  // post and its PENDING media are created together and the transcoding
  // runs in the background. Others see the post only once it is READY.
  async createVideo(
    authorId: string,
    original: string,
    caption: string,
  ): Promise<Post> {
    try {
      const info = await this.media.inspectVideo(original);
      const row = await this.database.prisma.$transaction(async (tx) => {
        const media = await this.media.createVideo(tx, authorId, info);
        return tx.post.create({
          data: { authorId, mediaId: media.id, caption },
          select: postSelect(authorId),
        });
      });
      void this.media.processVideo(row.media.id, original);
      return toPost(row);
    } catch (error) {
      await rm(original, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  // Visible posts, plus the viewer's own video that is still processing or
  // failed, so its author can follow it.
  async get(viewerId: string, id: string): Promise<Post> {
    const row = await this.database.prisma.post.findFirst({
      where: {
        id,
        OR: [
          visiblePost(viewerId),
          {
            authorId: viewerId,
            media: { type: 'VIDEO', state: 'PENDING' },
          },
        ],
      },
      select: postSelect(viewerId),
    });
    if (!row) throw new AuthError('POST_NOT_FOUND');
    return toPost(row);
  }

  // Profile grid, newest first. Private authors: 403 like follower lists.
  async byUser(
    viewerId: string,
    userId: string,
    page: PageQuery,
  ): Promise<PostListResponse> {
    const author = await this.database.prisma.user.findFirst({
      where: { id: userId, emailVerifiedAt: { not: null } },
      select: { id: true },
    });
    if (!author) throw new AuthError('USER_NOT_FOUND');
    const visible = await this.database.prisma.user.count({
      where: { id: userId, ...visibleAuthor(viewerId) },
    });
    if (!visible) throw new AuthError('PROFILE_PRIVATE');
    return this.page(viewerId, { authorId: userId }, page);
  }

  // FR-05: own posts and approved followings, newest first. Access is part
  // of the WHERE clause, so a revoked follow drops posts before paging.
  async feed(viewerId: string, page: PageQuery): Promise<PostListResponse> {
    return this.page(
      viewerId,
      {
        OR: [
          { authorId: viewerId },
          {
            author: {
              followers: {
                some: { followerId: viewerId, status: 'ACCEPTED' },
              },
            },
          },
        ],
      },
      page,
    );
  }

  // FR-10 Reels: every video post the viewer may see (own, approved
  // followings and public accounts), newest first, no ranking.
  async reels(viewerId: string, page: PageQuery): Promise<PostListResponse> {
    return this.page(viewerId, { media: { type: 'VIDEO' } }, page);
  }

  private page(
    viewerId: string,
    where: Prisma.PostWhereInput,
    page: PageQuery,
  ): Promise<PostListResponse> {
    return postPage(
      (args) =>
        this.database.prisma.post.findMany({
          ...args,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: postSelect(viewerId),
        }),
      { AND: [where, visiblePost(viewerId)] },
      page,
    );
  }

  // Only the author; others get 404 so a hidden post is not confirmed.
  // Serving stops with the commit; files are removed afterwards.
  async remove(viewerId: string, id: string): Promise<void> {
    const mediaId = await this.database.prisma.$transaction(async (tx) => {
      const post = await tx.post.findFirst({
        where: { id, authorId: viewerId },
        select: { mediaId: true },
      });
      if (!post) throw new AuthError('POST_NOT_FOUND');
      await tx.post.delete({ where: { id } });
      await this.media.markDeleted(tx, post.mediaId);
      return post.mediaId;
    });
    await this.media.discard(mediaId);
  }

  // Replaces the avatar; the previous one stops being served at once.
  async setAvatar(userId: string, image: Buffer): Promise<string> {
    const stored = await this.media.store(userId, 'AVATAR', image);
    let previous: string | null;
    try {
      previous = await this.database.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ avatarMediaId: string | null }[]>`
          SELECT "avatarMediaId" FROM auth_users WHERE id = ${userId}::uuid FOR UPDATE`;
        const old = rows[0]?.avatarMediaId ?? null;
        await this.media.activate(tx, stored);
        await tx.user.update({
          where: { id: userId },
          data: { avatarMediaId: stored.id },
        });
        if (old) await this.media.markDeleted(tx, old);
        return old;
      });
    } catch (error) {
      await this.media.discard(stored.id);
      throw error;
    }
    if (previous) await this.media.discard(previous);
    return avatarUrl(stored.id)!;
  }

  async removeAvatar(userId: string): Promise<void> {
    const previous = await this.database.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ avatarMediaId: string | null }[]>`
        SELECT "avatarMediaId" FROM auth_users WHERE id = ${userId}::uuid FOR UPDATE`;
      const id = rows[0]?.avatarMediaId ?? null;
      if (!id) return null;
      await tx.user.update({
        where: { id: userId },
        data: { avatarMediaId: null },
      });
      await this.media.markDeleted(tx, id);
      return id;
    });
    if (previous) await this.media.discard(previous);
  }

  // Image bytes after the same checks as the owning post or profile: post
  // images follow post visibility; avatars follow the profile summary, which
  // every verified user may read (FR-02). Anything else is 404.
  async readImage(
    viewerId: string,
    id: string,
    variant: MediaVariant,
  ): Promise<Buffer> {
    const allowed = await this.database.prisma.media.findFirst({
      where: {
        id,
        state: 'READY',
        OR: [
          { kind: 'COMMENT', comment: { post: visiblePost(viewerId) } },
          { kind: 'POST', post: visiblePost(viewerId) },
          { kind: 'STORY', story: visibleStory(viewerId) },
          {
            kind: 'AVATAR',
            avatarOf: { emailVerifiedAt: { not: null } },
          },
        ],
      },
      select: { id: true },
    });
    if (!allowed) throw new AuthError('MEDIA_NOT_FOUND');
    const data = await this.media.read(id, variant);
    if (!data) throw new AuthError('MEDIA_NOT_FOUND');
    return data;
  }

  // The video file of a READY post the viewer may see, checked again for
  // every (Range) request, so a revoked follow stops playback at once.
  async openVideo(viewerId: string, id: string) {
    const allowed = await this.database.prisma.media.findFirst({
      where: {
        id,
        type: 'VIDEO',
        state: 'READY',
        OR: [
          { kind: 'COMMENT', comment: { post: visiblePost(viewerId) } },
          { kind: 'POST', post: visiblePost(viewerId) },
          { kind: 'STORY', story: visibleStory(viewerId) },
        ],
      },
      select: { id: true },
    });
    if (!allowed) throw new AuthError('MEDIA_NOT_FOUND');
    const file = await this.media.open(id, 'video');
    if (!file) throw new AuthError('MEDIA_NOT_FOUND');
    return file;
  }
}
