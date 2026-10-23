import { Inject, Injectable } from '@nestjs/common';
import {
  CommentSchema,
  type Comment,
  type LikeResponse,
  type PageQuery,
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
import { visiblePost } from './post-policy.js';

const commentSelect = {
  id: true,
  postId: true,
  text: true,
  createdAt: true,
  author: { select: summarySelect },
  post: { select: { authorId: true } },
} as const;

type CommentRow = {
  id: string;
  postId: string;
  text: string;
  createdAt: Date;
  author: Parameters<typeof userSummary>[0];
  post: { authorId: string };
};

// FR-06: the comment author and the post author may delete a comment.
function toComment(viewerId: string, row: CommentRow): Comment {
  return CommentSchema.parse({
    id: row.id,
    postId: row.postId,
    author: userSummary(row.author),
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
  ) {}

  private async requireVisible(viewerId: string, postId: string) {
    const post = await this.database.prisma.post.findFirst({
      where: { id: postId, ...visiblePost(viewerId) },
      select: { id: true },
    });
    if (!post) throw new AuthError('POST_NOT_FOUND');
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
    await this.requireVisible(viewerId, postId);
    try {
      await this.database.prisma.postLike.createMany({
        data: { postId, userId: viewerId },
        skipDuplicates: true,
      });
    } catch (error) {
      if (missingPost(error)) throw new AuthError('POST_NOT_FOUND');
      throw error;
    }
    return this.likeState(viewerId, postId);
  }

  async unlike(viewerId: string, postId: string): Promise<LikeResponse> {
    await this.requireVisible(viewerId, postId);
    await this.database.prisma.postLike.deleteMany({
      where: { postId, userId: viewerId },
    });
    return this.likeState(viewerId, postId);
  }

  // Oldest first (createdAt ASC, id ASC), like a conversation.
  async list(
    viewerId: string,
    postId: string,
    page: PageQuery,
  ): Promise<{ items: Comment[]; nextCursor: string | null }> {
    await this.requireVisible(viewerId, postId);
    const after = decodeCursor(page.cursor, 'date');
    const rows = await this.database.prisma.comment.findMany({
      where: {
        postId,
        ...(after && {
          OR: [
            { createdAt: { gt: after.date } },
            { createdAt: after.date, id: { gt: after.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: page.limit + 1,
      select: commentSelect,
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

  async add(viewerId: string, postId: string, text: string): Promise<Comment> {
    await this.requireVisible(viewerId, postId);
    try {
      const row = await this.database.prisma.comment.create({
        data: { postId, authorId: viewerId, text },
        select: commentSelect,
      });
      return toComment(viewerId, row);
    } catch (error) {
      if (missingPost(error)) throw new AuthError('POST_NOT_FOUND');
      throw error;
    }
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
