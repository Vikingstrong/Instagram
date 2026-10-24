import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { StartLiveRequestSchema, SendLiveSignalRequestSchema, CreateLiveCommentRequestSchema, LiveSignalsResponseSchema } from '@instagram/contracts';
test('lives reject forged hosts, oversized signaling and multi-line or empty chat', () => {
  const input = { id: randomUUID(), clientId: randomUUID() };
  assert.equal(StartLiveRequestSchema.safeParse(input).success, true);
  assert.equal(StartLiveRequestSchema.safeParse({ ...input, hostId: randomUUID() }).success, false);
  assert.equal(SendLiveSignalRequestSchema.safeParse({ clientId: input.clientId, peerId: randomUUID(), signal: { type: 'offer', sdp: 's'.repeat(48001) } }).success, false);
  assert.equal(SendLiveSignalRequestSchema.safeParse({ clientId: input.clientId, signal: { type: 'offer', sdp: 'v=0' } }).success, false);
  assert.equal(CreateLiveCommentRequestSchema.safeParse({ id: randomUUID(), text: 'Привет 👋' }).success, true);
  for (const text of ['', '   ', 'a\nb', 'x'.repeat(301)])
    assert.equal(CreateLiveCommentRequestSchema.safeParse({ id: randomUUID(), text }).success, false);
  assert.equal(CreateLiveCommentRequestSchema.safeParse({ id: randomUUID(), text: '👋'.repeat(300) }).success, true);
  assert.equal(LiveSignalsResponseSchema.safeParse({ items: [], peers: [], next: 0, hash: 'x' }).success, false);
});
