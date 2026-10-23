import { Inject, Injectable } from '@nestjs/common';
import {
  PostSchema,
  type PageQuery,
  type Post,
  type PostListResponse,
} from '@instagram/contracts';
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
import { visibleAuthor, visiblePost } from './post-policy.js';

const postSelect = {
  id: true,
  caption: true,
  createdAt: true,
  media: { select: { id: true, width: true, height: true } },
  author: { select: summarySelect },
} as const;

type PostRow = {
  id: string;
  caption: string;
  createdAt: Date;
  media: { id: string; width: number | null; height: number | null };
  author: Parameters<typeof userSummary>[0];
};

function toPost(row: PostRow): Post {
  return PostSchema.parse({
    id: row.id,
    author: userSummary(row.author),
    caption: row.caption,
    image: {
      url: mediaUrl(row.media.id, 'full'),
      thumbnailUrl: mediaUrl(row.media.id, 'thumb'),
      width: row.media.width,
      height: row.media.height,
    },
    createdAt: row.createdAt.toISOString(),
  });
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
          select: postSelect,
        });
      });
      return toPost(row);
    } catch (error) {
      await this.media.discard(stored.id);
      throw error;
    }
  }

  async get(viewerId: string, id: string): Promise<Post> {
    const row = await this.database.prisma.post.findFirst({
      where: { id, ...visiblePost(viewerId) },
      select: postSelect,
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
    const after = decodeCursor(page.cursor, 'date');
    const rows = await this.database.prisma.post.findMany({
      where: {
        authorId: userId,
        ...visiblePost(viewerId),
        ...(after && {
          OR: [
            { createdAt: { lt: after.date } },
            { createdAt: after.date, id: { lt: after.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: page.limit + 1,
      select: postSelect,
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
          { kind: 'POST', post: visiblePost(viewerId) },
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
}
