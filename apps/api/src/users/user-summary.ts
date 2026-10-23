import { UserSummarySchema, type UserSummary } from '@instagram/contracts';
import { AuthError } from '../auth/auth.error.js';
import { mediaUrl } from '../media/media.service.js';

export const summarySelect = {
  id: true,
  username: true,
  displayName: true,
  isPrivate: true,
  avatarMediaId: true,
} as const;

export const avatarUrl = (id: string | null) =>
  id ? mediaUrl(id, 'thumb') : null;

export function userSummary(user: {
  id: string;
  username: string;
  displayName: string;
  isPrivate: boolean;
  avatarMediaId: string | null;
}): UserSummary {
  const { avatarMediaId, ...rest } = user;
  return UserSummarySchema.parse({
    ...rest,
    avatarUrl: avatarUrl(avatarMediaId),
  });
}

// Keyset cursor: "<sort key>~<uuid>" in base64url. The sort key is an ISO
// timestamp or a username key; the id breaks ties. Malformed cursors are 400.
export function encodeCursor(key: string, id: string): string {
  return Buffer.from(`${key}~${id}`).toString('base64url');
}
export function decodeCursor(
  cursor: string | undefined,
  key: 'date' | 'username',
): { date: Date; username: string; id: string } | undefined {
  if (cursor === undefined) return undefined;
  const match =
    /^([^~]+)~([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(
      Buffer.from(cursor, 'base64url').toString(),
    );
  const date = new Date(match?.[1] ?? '');
  if (
    !match ||
    (key === 'date'
      ? Number.isNaN(date.getTime()) || date.toISOString() !== match[1]
      : !/^[a-z0-9_.]{3,30}$/.test(match[1]!))
  )
    throw new AuthError('INVALID_REQUEST');
  return { date, username: match[1]!, id: match[2]! };
}
