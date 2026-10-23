import { readAuthConfiguration } from './auth.config.js';

describe('Auth configuration', () => {
  it('trusts only the explicit app and local Swagger origins during development', () => {
    const config = readAuthConfiguration({});
    expect([...config.allowedOrigins]).toEqual([
      'http://localhost:3000',
      'http://localhost:4000',
    ]);
    expect(config.secureCookies).toBe(false);
    expect(config.csrfSecret).toMatch(/^[0-9a-f]{64}$/);
  });
  it('requires HTTPS and a configured signing secret in production', () => {
    for (const env of [
      { NODE_ENV: 'production' },
      { NODE_ENV: 'production', AUTH_PUBLIC_ORIGIN: 'http://example.test' },
      { NODE_ENV: 'production', AUTH_PUBLIC_ORIGIN: 'https://example.test' },
    ])
      expect(() => readAuthConfiguration(env)).toThrow();
    const config = readAuthConfiguration({
      NODE_ENV: 'production',
      AUTH_PUBLIC_ORIGIN: 'https://example.test',
      AUTH_CSRF_SECRET: 'a'.repeat(64),
    });
    expect(config.secureCookies).toBe(true);
    expect([...config.allowedOrigins]).toEqual(['https://example.test']);
  });
  it('rejects credential-bearing URLs, paths and malformed secrets without echoing values', () => {
    for (const origin of [
      'https://secret:private@example.test',
      'https://example.test/path',
      'https://example.test?private=secret',
      'null',
    ]) {
      try {
        readAuthConfiguration({ AUTH_PUBLIC_ORIGIN: origin });
        throw new Error('accepted invalid origin');
      } catch (error) {
        expect(String(error)).toMatch(/AUTH_PUBLIC_ORIGIN/);
        expect(String(error)).not.toContain(origin);
      }
    }
    expect(() =>
      readAuthConfiguration({ AUTH_CSRF_SECRET: 'private-secret' }),
    ).toThrow('AUTH_CSRF_SECRET must contain');
  });
  it('keeps per-address limits unless explicitly raised', () => {
    expect(readAuthConfiguration({})).toMatchObject({
      mutationIpLimit: 60,
      readIpLimit: 300,
    });
    expect(
      readAuthConfiguration({
        AUTH_MUTATION_IP_LIMIT: '500',
        AUTH_READ_IP_LIMIT: '2000',
      }),
    ).toMatchObject({ mutationIpLimit: 500, readIpLimit: 2000 });
    for (const value of ['0', '-1', '1.5', 'many'])
      expect(() =>
        readAuthConfiguration({ AUTH_MUTATION_IP_LIMIT: value }),
      ).toThrow('AUTH_MUTATION_IP_LIMIT must be a positive integer.');
  });
});
