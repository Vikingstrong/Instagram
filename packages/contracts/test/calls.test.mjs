import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { StartCallRequestSchema, SendCallSignalRequestSchema, CallActionRequestSchema } from '@instagram/contracts';
test('calls reject forged participants, unknown actions and oversized signaling', () => {
  const input = { id: randomUUID(), conversationId: randomUUID(), clientId: randomUUID(), kind: 'VIDEO' };
  assert.equal(StartCallRequestSchema.safeParse(input).success, true);
  assert.equal(StartCallRequestSchema.safeParse({ ...input, callerId: randomUUID() }).success, false);
  assert.equal(CallActionRequestSchema.safeParse({ clientId: input.clientId, action: 'accept' }).success, true);
  assert.equal(CallActionRequestSchema.safeParse({ clientId: input.clientId, action: 'listen' }).success, false);
  assert.equal(SendCallSignalRequestSchema.safeParse({ clientId: input.clientId, signal: { type: 'offer', sdp: 's'.repeat(48001) } }).success, false);
  assert.equal(SendCallSignalRequestSchema.safeParse({ clientId: input.clientId, signal: { type: 'ice', candidate: { candidate: 'synthetic', sdpMid: '0', sdpMLineIndex: 0 } } }).success, true);
});
