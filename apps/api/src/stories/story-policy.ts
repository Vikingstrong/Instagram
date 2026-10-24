import type { Prisma } from '../generated/prisma/client.js';
import { visibleAuthor } from '../posts/post-policy.js';

// Applied to the story AND each direct image/video request, before paging.
export function visibleStory(
  viewerId: string,
  now = new Date(),
): Prisma.StoryWhereInput {
  return {
    expiresAt: { gt: now },
    author: visibleAuthor(viewerId),
    media: { state: 'READY' },
  };
}
