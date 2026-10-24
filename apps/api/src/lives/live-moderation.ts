import type { LiveViewerAccess } from '@instagram/contracts';
import type { Prisma } from '../generated/prisma/client.js';
import { AuthError } from '../auth/auth.error.js';

type Db = Pick<Prisma.TransactionClient, 'liveModerator' | 'liveRestriction'>;
export type ModerationAccess = LiveViewerAccess & { banned: boolean };

// A user's standing in all streams of a host. An expired mute has no
// effect, so no cleanup job is needed for correctness.
export async function moderationAccess(
  db: Db,
  hostId: string,
  userId: string,
  now = new Date(),
): Promise<ModerationAccess> {
  if (hostId === userId) return { role: 'host', muted: null, banned: false };
  // One after the other: db may be an interactive transaction.
  const moderator = await db.liveModerator.findUnique({
    where: { hostId_userId: { hostId, userId } },
  });
  const rows = await db.liveRestriction.findMany({ where: { hostId, userId } });
  const mute = rows.find(
    (row) => row.kind === 'MUTE' && (!row.until || row.until > now),
  );
  return {
    role: moderator ? 'moderator' : 'viewer',
    muted: mute ? { until: mute.until?.toISOString() ?? null } : null,
    banned: rows.some((row) => row.kind === 'BAN'),
  };
}

// The host and the host's moderators moderate; a moderator never acts on
// the host or on another moderator.
export async function assertCanModerate(
  db: Db,
  actorId: string,
  hostId: string,
  targetId?: string,
) {
  const actor = await moderationAccess(db, hostId, actorId);
  if (actor.role === 'viewer') throw new AuthError('LIVE_MODERATION_FORBIDDEN');
  if (targetId === undefined) return actor;
  const target = await moderationAccess(db, hostId, targetId);
  if (
    target.role === 'host' ||
    (target.role === 'moderator' && actor.role !== 'host')
  )
    throw new AuthError('LIVE_MODERATION_FORBIDDEN');
  return actor;
}

// Gifts and chat need a viewer who is neither banned nor muted.
export function assertCanSpeak(access: ModerationAccess) {
  if (access.banned) throw new AuthError('LIVE_BANNED');
  if (access.muted) throw new AuthError('LIVE_MUTED');
}
