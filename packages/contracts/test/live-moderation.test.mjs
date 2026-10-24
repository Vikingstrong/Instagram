import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CreateLiveRestrictionRequestSchema, LiveSchema } from '@instagram/contracts';
test('live moderation: mute for 5, 60, 1440 minutes or for good; a ban has no term', () => {
  const userId = randomUUID();
  for (const minutes of [5, 60, 1440, null])
    assert.equal(CreateLiveRestrictionRequestSchema.safeParse({ kind: 'mute', userId, minutes }).success, true);
  for (const body of [{ kind: 'mute', userId, minutes: 7 }, { kind: 'mute', userId }, { kind: 'ban', userId, minutes: 5 }, { kind: 'kick', userId }])
    assert.equal(CreateLiveRestrictionRequestSchema.safeParse(body).success, false);
  assert.equal(CreateLiveRestrictionRequestSchema.safeParse({ kind: 'ban', userId }).success, true);
  const live = { id: randomUUID(), host: { id: randomUUID(), username: 'host', displayName: '', avatarUrl: null, isPrivate: false }, status: 'LIVE', startedAt: new Date().toISOString(), endedAt: null, viewerCount: 0 };
  assert.equal(LiveSchema.safeParse(live).success, true);
  assert.equal(LiveSchema.safeParse({ ...live, viewer: { role: 'moderator', muted: null } }).success, true);
  assert.equal(LiveSchema.safeParse({ ...live, viewer: { role: 'admin', muted: null } }).success, false);
});
