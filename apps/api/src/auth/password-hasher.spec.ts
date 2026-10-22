import { PasswordHasher } from './password-hasher.js';

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher();
  beforeAll(async () => hasher.onModuleInit());
  it('salts each password and verifies the complete Unicode value without trimming', async () => {
    const password = '  🔐 secret with spaces  ';
    const first = await hasher.hash(password);
    const second = await hasher.hash(password);
    expect(first).not.toBe(second);
    expect(first).not.toContain(password);
    expect(await hasher.verify(password, first)).toBe(true);
    expect(await hasher.verify(password.trim(), first)).toBe(false);
    expect(await hasher.verify(`${password}x`, first)).toBe(false);
  });
  it('does real password work but rejects absent, malformed and unsupported hashes', async () => {
    for (const hash of [
      undefined,
      'plaintext',
      'scrypt-v1$1048576$8$3$' + '0'.repeat(200),
    ]) {
      expect(await hasher.verify('example password', hash)).toBe(false);
    }
  });
  it('bounds expensive work and recovers after saturation', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => hasher.hash('example password')),
    );
    expect(
      results.filter((value) => value.status === 'fulfilled'),
    ).toHaveLength(4);
    const rejected = results.find((value) => value.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
    expect(
      await hasher.verify(
        'example password',
        await hasher.hash('example password'),
      ),
    ).toBe(true);
  });
});
