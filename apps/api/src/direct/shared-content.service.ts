import { Inject, Injectable } from '@nestjs/common';
import type { ShareContentRequest, SharedContent } from '@instagram/contracts';
import { DatabaseService } from '../infrastructure/database/database.service.js';
import type { Prisma, SharedContentKind } from '../generated/prisma/client.js';
import { visiblePost } from '../posts/post-policy.js';
import { visibleStory } from '../stories/story-policy.js';
import { mediaUrl } from '../media/media.service.js';
import { summarySelect, userSummary } from '../users/user-summary.js';
import { AuthError } from '../auth/auth.error.js';

export const sharedKind = {
  post: 'POST',
  reel: 'REEL',
  story: 'STORY',
} as const;
export const wireKind = { POST: 'post', REEL: 'reel', STORY: 'story' } as const;
type Reference = {
  id: string;
  sharedKind: SharedContentKind | null;
  sharedPostId: string | null;
  sharedStoryId: string | null;
};
const selection = {
  id: true,
  author: { select: summarySelect },
  media: { select: { id: true, type: true } },
} as const;

@Injectable()
export class SharedContentService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  // No stored preview/snapshot: each history or inbox read rechecks originals
  // for this viewer. The unavailable DTO carries no author, text, URL or id.
  async resolve(
    viewerId: string,
    rows: Reference[],
  ): Promise<Map<string, SharedContent>> {
    const references = rows.filter((row) => row.sharedKind);
    const result = new Map<string, SharedContent>();
    if (!references.length) return result;
    const [posts, stories] = await Promise.all([
      this.db.prisma.post.findMany({
        where: {
          id: {
            in: references.flatMap((row) =>
              row.sharedPostId ? [row.sharedPostId] : [],
            ),
          },
          ...visiblePost(viewerId),
        },
        select: { ...selection, caption: true },
      }),
      this.db.prisma.story.findMany({
        where: {
          id: {
            in: references.flatMap((row) =>
              row.sharedStoryId ? [row.sharedStoryId] : [],
            ),
          },
          ...visibleStory(viewerId),
        },
        select: { ...selection, expiresAt: true },
      }),
    ]);
    const postById = new Map(posts.map((post) => [post.id, post]));
    const storyById = new Map(stories.map((story) => [story.id, story]));
    for (const row of references) {
      const kind = wireKind[row.sharedKind!];
      const post = row.sharedPostId
        ? postById.get(row.sharedPostId)
        : undefined;
      const story = row.sharedStoryId
        ? storyById.get(row.sharedStoryId)
        : undefined;
      const source = kind === 'story' ? story : post;
      if (!source || (kind === 'reel' && source.media.type !== 'VIDEO')) {
        result.set(row.id, { kind, status: 'unavailable' });
        continue;
      }
      result.set(row.id, {
        kind,
        status: 'available',
        id: source.id,
        author: userSummary(source.author),
        caption: kind === 'story' ? '' : post!.caption,
        thumbnailUrl: mediaUrl(source.media.id, 'thumb'),
        href: `/${kind === 'story' ? 'stories' : 'p'}/${source.id}`,
        expiresAt: story?.expiresAt.toISOString() ?? null,
      });
    }
    return result;
  }

  async requireVisible(
    tx: Prisma.TransactionClient,
    viewerId: string,
    input: ShareContentRequest,
  ): Promise<void> {
    if (input.kind === 'story') {
      if (
        !(await tx.story.findFirst({
          where: { id: input.contentId, ...visibleStory(viewerId) },
          select: { id: true },
        }))
      )
        throw new AuthError('STORY_NOT_FOUND');
    } else {
      const post = await tx.post.findFirst({
        where: { id: input.contentId, ...visiblePost(viewerId) },
        select: { media: { select: { type: true } } },
      });
      if (!post || (input.kind === 'reel' && post.media.type !== 'VIDEO'))
        throw new AuthError('POST_NOT_FOUND');
    }
  }

  // Unique account, not message count: Direct owns this transactional journal.
  async record(
    tx: Prisma.TransactionClient,
    userId: string,
    input: ShareContentRequest,
  ) {
    if (input.kind === 'story') {
      await tx.storyShare.createMany({
        data: { storyId: input.contentId, userId },
        skipDuplicates: true,
      });
      return tx.storyShare.count({ where: { storyId: input.contentId } });
    }
    await tx.postShare.createMany({
      data: { postId: input.contentId, userId },
      skipDuplicates: true,
    });
    return tx.postShare.count({ where: { postId: input.contentId } });
  }
  count(input: ShareContentRequest) {
    return input.kind === 'story'
      ? this.db.prisma.storyShare.count({ where: { storyId: input.contentId } })
      : this.db.prisma.postShare.count({ where: { postId: input.contentId } });
  }
}
