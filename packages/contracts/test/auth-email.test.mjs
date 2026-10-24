import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AuthEmailRequestSchema,  AuthResetPasswordRequestSchema,
  AuthEmailAcceptedResponseSchema,  AuthPasswordResetResponseSchema,
  AuthApiErrorResponseSchema, authEndpoints,
} from '@instagram/contracts';

test('email actions are strict, token-bound and preserve Unicode passwords', () => {
  const token = 'a'.repeat(43);
  assert.deepEqual(AuthEmailRequestSchema.parse({ email: 'person@example.test' }), { email: 'person@example.test' });
  for (const bad of ['', 'a'.repeat(42), 'a'.repeat(44), 'a'.repeat(42) + '\n', 'a'.repeat(43) + '\n', 'https://example.test/?token=secret'])
    assert.equal(AuthResetPasswordRequestSchema.safeParse({ token: bad, password: 'valid password' }).success, false);
  const body = { token, password: ` ${'🔐'.repeat(126)} ` };
  assert.deepEqual(AuthResetPasswordRequestSchema.parse(body), body);
  assert.equal(AuthResetPasswordRequestSchema.safeParse({ token, password: 'short' }).success, false);
});
test('email acceptance never contains identity, delivery state or tokens', () => {
  assert.deepEqual(AuthEmailAcceptedResponseSchema.parse({ status: 'accepted' }), { status: 'accepted' });
  for (const extra of [{ exists: true }, { token: 'secret' }, { delivered: true }, { user: null }])
    assert.equal(AuthEmailAcceptedResponseSchema.safeParse({ status: 'accepted', ...extra }).success, false);
  assert.deepEqual(AuthPasswordResetResponseSchema.parse({ status: 'password_reset' }), { status: 'password_reset' });
  assert.equal(authEndpoints.requestPasswordReset.successStatus, 202);
  assert.equal(AuthApiErrorResponseSchema.safeParse({ error: { code: 'INVALID_OR_EXPIRED_TOKEN', message: 'Invalid or expired token.', requestId: '4f70d2ab-d6d6-4243-b0d3-f7b767434789' } }).success, true);
});
