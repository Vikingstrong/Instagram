import type { Prisma } from '../generated/prisma/client.js';

// The single post visibility rule (architecture §9): a verified viewer sees a
// post when they are its author, the author is public, or their follow is
// approved. A pending request grants nothing. Applied in SQL before paging,
// to every post, profile grid and image read.
export function visibleAuthor(viewerId: string): Prisma.UserWhereInput {
  return {
    emailVerifiedAt: { not: null },
    OR: [
      { id: viewerId },
      { isPrivate: false },
      { followers: { some: { followerId: viewerId, status: 'ACCEPTED' } } },
    ],
  };
}

export function visiblePost(viewerId: string): Prisma.PostWhereInput {
  return { author: visibleAuthor(viewerId), media: { state: 'READY' } };
}
