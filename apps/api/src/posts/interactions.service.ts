import { Inject, Injectable } from '@nestjs/common';
import {
  CommentSchema,
  type Comment,
  type LikeResponse,
  type SaveResponse,
  type PageQuery,
  NotificationListResponseSchema,
  type Notification,
} from '@instagram/contracts';
import { DatabaseService } from '../infrastructure/database/database.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { AuthError } from '../auth/auth.error.js';
import {
  decodeCursor,
  encodeCursor,
  summarySelect,
  userSummary,
} from '../users/user-summary.js';
import { MediaService, mediaUrl } from '../media/media.service.js';
import { visiblePost } from './post-policy.js';
import { DirectEvents } from '../direct/direct-events.js';

const commentSelect = (viewerId: string) =>
  ({
    id: true,
    postId: true,
    parentId: true,
    replyTo: { select: summarySelect },
    _count: { select: { likes: true, replies: true } },
    likes: { where: { userId: viewerId }, select: { userId: true } },
    media: { select: { id: true, width: true, height: true } },
    text: true,
    createdAt: true,
    author: { select: summarySelect },
    post: { select: { authorId: true } },
  }) as const;

type CommentRow = Prisma.CommentGetPayload<{
  select: ReturnType<typeof commentSelect>;
}>;

// FR-06: the comment author and the post author may delete a comment.
function toComment(viewerId: string, row: CommentRow): Comment {
  return CommentSchema.parse({
    id: row.id,
    parentId: row.parentId,
    replyTo: row.replyTo ? userSummary(row.replyTo) : null,
    replyCount: row._count.replies,
    likeCount: row._count.likes,
    liked: row.likes.length > 0,
    postId: row.postId,
    author: userSummary(row.author),
    attachment: row.media
      ? {
          url: mediaUrl(row.media.id, 'full'),
          thumbnailUrl: mediaUrl(row.media.id, 'thumb'),
          width: row.media.width!,
          height: row.media.height!,
        }
      : null,
    text: row.text,
    createdAt: row.createdAt.toISOString(),
    canDelete: row.author.id === viewerId || row.post.authorId === viewerId,
  });
}

// A post deleted between the access check and the write.
const missingPost = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2003';

// Likes and comments. Every action needs a post the viewer may see now
// (post-policy.ts); the only exception is deleting one's own comment (P-10).
@Injectable()
export class InteractionsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MediaService) private readonly media: MediaService,
    @Inject(DirectEvents) private readonly events: DirectEvents,
  ) {}

  private async requireVisible(viewerId: string, postId: string) {
    const post = await this.database.prisma.post.findFirst({
      where: { id: postId, ...visiblePost(viewerId) },
      select: { id: true, authorId: true },
    });
    if (!post) throw new AuthError('POST_NOT_FOUND');
    return post;
  }

  private async likeState(
    viewerId: string,
    postId: string,
  ): Promise<LikeResponse> {
    const [likeCount, own] = await Promise.all([
      this.database.prisma.postLike.count({ where: { postId } }),
      this.database.prisma.postLike.count({
        where: { postId, userId: viewerId },
      }),
    ]);
    return { liked: own > 0, likeCount };
  }

  // Idempotent: the primary key keeps one like per user, repeats are no-ops.
  async like(viewerId: string, postId: string): Promise<LikeResponse> {
    const post = await this.requireVisible(viewerId, postId);
    try {
      const created = await this.database.prisma.$transaction(async (tx) => {
        const result = await tx.postLike.createMany({
          data: { postId, userId: viewerId },
          skipDuplicates: true,
        });
        if (result.count && post.authorId !== viewerId)
          await tx.notification.create({
            data: {
              key: `post-like:${postId}:${viewerId}`,
              kind: 'POST_LIKE',
              recipientId: post.authorId,
              actorId: viewerId,
              postId,
            },
          });
        return result.count > 0;
      });
      if (created && post.authorId !== viewerId)
        this.events.notifyNotification(post.authorId);
    } catch (error) {
      if (missingPost(error)) throw new AuthError('POST_NOT_FOUND');
      throw error;
    }
    return this.likeState(viewerId, postId);
  }

  async unlike(viewerId: string, postId: string): Promise<LikeResponse> {
    const post = await this.requireVisible(viewerId, postId);
    const removed = await this.database.prisma.$transaction(async (tx) => {
      await tx.postLike.deleteMany({ where: { postId, userId: viewerId } });
      return tx.notification.deleteMany({
        where: { key: `post-like:${postId}:${viewerId}` },
      });
    });
    if (removed.count && post.authorId !== viewerId)
      this.events.notifyNotification(post.authorId);
    return this.likeState(viewerId, postId);
  }

  // Idempotent like likes; saves are private, so no counter is returned.
  async save(viewerId: string, postId: string): Promise<SaveResponse> {
    await this.requireVisible(viewerId, postId);
    try {
      await this.database.prisma.postSave.createMany({
        data: { postId, userId: viewerId },
        skipDuplicates: true,
      });
    } catch (error) {
      if (missingPost(error)) throw new AuthError('POST_NOT_FOUND');
      throw error;
    }
    return { saved: true };
  }

  async unsave(viewerId: string, postId: string): Promise<SaveResponse> {
    await this.requireVisible(viewerId, postId);
    await this.database.prisma.postSave.deleteMany({
      where: { postId, userId: viewerId },
    });
    return { saved: false };
  }

  // Oldest first (createdAt ASC, id ASC), like a conversation.
  async list(
    viewerId: string,
    postId: string,
    page: PageQuery,
    parentId: string | null = null,
  ): Promise<{ items: Comment[]; nextCursor: string | null }> {
    await this.requireVisible(viewerId, postId);
    const after = decodeCursor(page.cursor, 'date');
    const rows = await this.database.prisma.comment.findMany({
      where: {
        postId,
        parentId,
        ...(after && {
          OR: [
            { createdAt: { gt: after.date } },
            { createdAt: after.date, id: { gt: after.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: page.limit + 1,
      select: commentSelect(viewerId),
    });
    const items = rows.slice(0, page.limit);
    const last = items.at(-1);
    return {
      items: items.map((row) => toComment(viewerId, row)),
      nextCursor:
        rows.length > page.limit && last
          ? encodeCursor(last.createdAt.toISOString(), last.id)
          : null,
    };
  }

  async add(
    viewerId: string,
    postId: string,
    text: string,
    replyToCommentId?: string,
    image?: Buffer,
  ): Promise<Comment> {
    await this.requireVisible(viewerId, postId);
    const target = replyToCommentId
      ? await this.database.prisma.comment.findFirst({
          where: { id: replyToCommentId, postId },
          select: { id: true, parentId: true, authorId: true },
        })
      : null;
    if (replyToCommentId && !target) throw new AuthError('COMMENT_NOT_FOUND');
    const stored = image
      ? await this.media.store(viewerId, 'COMMENT', image)
      : undefined;
    try {
      const result = await this.database.prisma.$transaction(async (tx) => {
        if (stored) await this.media.activate(tx, stored);
        const row = await tx.comment.create({
          data: {
            postId,
            mediaId: stored?.id,
            authorId: viewerId,
            text,
            parentId: target ? (target.parentId ?? target.id) : null,
            replyToUserId: target?.authorId ?? null,
          },
          select: commentSelect(viewerId),
        });
        const recipientId = target?.authorId ?? row.post.authorId;
        if (recipientId !== viewerId)
          await tx.notification.create({
            data: {
              key: `comment:${row.id}`,
              kind: target ? 'REPLY' : 'COMMENT',
              recipientId,
              actorId: viewerId,
              postId,
              commentId: row.id,
            },
          });
        return { row, recipientId };
      });
      if (result.recipientId !== viewerId)
        this.events.notifyNotification(result.recipientId);
      return toComment(viewerId, result.row);
    } catch (error) {
      if (stored) await this.media.discard(stored.id);
      if (missingPost(error))
        throw new AuthError(
          replyToCommentId ? 'COMMENT_NOT_FOUND' : 'POST_NOT_FOUND',
        );
      throw error;
    }
  }

  private async visibleComment(viewerId: string, id: string) {
    const comment = await this.database.prisma.comment.findFirst({
      where: { id, post: visiblePost(viewerId) },
      select: { id: true, postId: true, parentId: true, authorId: true },
    });
    if (!comment) throw new AuthError('COMMENT_NOT_FOUND');
    return comment;
  }

  async replies(viewerId: string, id: string, page: PageQuery) {
    const root = await this.visibleComment(viewerId, id);
    if (root.parentId) throw new AuthError('COMMENT_NOT_FOUND');
    return this.list(viewerId, root.postId, { ...page, limit: 3 }, root.id);
  }

  async commentLike(
    viewerId: string,
    id: string,
    liked: boolean,
  ): Promise<LikeResponse> {
    const comment = await this.visibleComment(viewerId, id);
    try {
      const changed = await this.database.prisma.$transaction(async (tx) => {
        if (liked) {
          const result = await tx.commentLike.createMany({
            data: { commentId: id, userId: viewerId },
            skipDuplicates: true,
          });
          if (result.count && comment.authorId !== viewerId)
            await tx.notification.create({
              data: {
                key: `comment-like:${id}:${viewerId}`,
                kind: 'COMMENT_LIKE',
                recipientId: comment.authorId,
                actorId: viewerId,
                postId: comment.postId,
                commentId: id,
              },
            });
          return result.count > 0;
        }
        await tx.commentLike.deleteMany({
          where: { commentId: id, userId: viewerId },
        });
        const removed = await tx.notification.deleteMany({
          where: { key: `comment-like:${id}:${viewerId}` },
        });
        return removed.count > 0;
      });
      if (changed && comment.authorId !== viewerId)
        this.events.notifyNotification(comment.authorId);
    } catch (error) {
      if (missingPost(error)) throw new AuthError('COMMENT_NOT_FOUND');
      throw error;
    }
    const [likeCount, own] = await Promise.all([
      this.database.prisma.commentLike.count({ where: { commentId: id } }),
      this.database.prisma.commentLike.count({
        where: { commentId: id, userId: viewerId },
      }),
    ]);
    return { liked: own > 0, likeCount };
  }

  async notifications(
    viewerId: string,
    page: PageQuery,
  ): Promise<{
    items: Notification[];
    nextCursor: string | null;
  }> {
    const after = decodeCursor(page.cursor, 'date');
    const rows = await this.database.prisma.notification.findMany({
      where: {
        recipientId: viewerId,
        post: visiblePost(viewerId),
        ...(after && {
          OR: [
            { createdAt: { lt: after.date } },
            { createdAt: after.date, id: { lt: after.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: page.limit + 1,
      include: { actor: { select: summarySelect } },
    });
    const items = rows.slice(0, page.limit);
    const last = items.at(-1);
    return NotificationListResponseSchema.parse({
      items: items.map((row) => ({
        id: row.id,
        kind: row.kind,
        actor: userSummary(row.actor),
        postId: row.postId,
        commentId: row.commentId,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor:
        rows.length > page.limit && last
          ? encodeCursor(last.createdAt.toISOString(), last.id)
          : null,
    });
  }

  // P-10: one's own comment can be deleted even after losing access to the
  // post. The post author deletes any comment under it. Anyone else gets
  // 403 when they can see the post and 404 when they cannot.
  async remove(viewerId: string, id: string): Promise<void> {
    const comment = await this.database.prisma.comment.findUnique({
      where: { id },
      select: {
        authorId: true,
        postId: true,
        post: { select: { authorId: true } },
      },
    });
    if (!comment) throw new AuthError('COMMENT_NOT_FOUND');
    if (comment.authorId !== viewerId && comment.post.authorId !== viewerId) {
      const visible = await this.database.prisma.post.count({
        where: { id: comment.postId, ...visiblePost(viewerId) },
      });
      throw new AuthError(
        visible ? 'CANNOT_DELETE_COMMENT' : 'COMMENT_NOT_FOUND',
      );
    }
    await this.database.prisma.comment.deleteMany({ where: { id } });
  }
}
