import { readDatabaseUrl } from './database.config.js';

const environment = {
  DATABASE_URL: 'postgresql://dev:dev-password@localhost:5432/development',
  TEST_DATABASE_URL: 'postgresql://test:test-password@localhost:5432/testing',
};

describe('database configuration safety', () => {
  it('requires explicit test configuration instead of falling back to development', () => {
    expect(() =>
      readDatabaseUrl({ DATABASE_URL: environment.DATABASE_URL }, 'test'),
    ).toThrow('TEST_DATABASE_URL');
  });

  it('rejects the development database even through another host or encoded name', () => {
    expect(() =>
      readDatabaseUrl(
        {
          ...environment,
          TEST_DATABASE_URL:
            'postgresql://test:password@127.0.0.1/%64evelopment',
        },
        'test',
      ),
    ).toThrow('different database names and roles');
  });

  it('rejects reusing the development role for tests', () => {
    expect(() =>
      readDatabaseUrl(
        {
          ...environment,
          TEST_DATABASE_URL: 'postgresql://dev:password@localhost/testing',
        },
        'test',
      ),
    ).toThrow('different database names and roles');
  });

  it('rejects query parameters that could override the checked database role', () => {
    expect(() =>
      readDatabaseUrl(
        {
          ...environment,
          TEST_DATABASE_URL: `${environment.TEST_DATABASE_URL}?user=admin`,
        },
        'test',
      ),
    ).toThrow('TEST_DATABASE_URL must not override connection identity');
  });

  it('does not expose credentials in configuration errors', () => {
    const secret = 'sensitive-password';
    try {
      readDatabaseUrl(
        { DATABASE_URL: `https://dev:${secret}@localhost/dev` },
        'development',
      );
      expect.fail('Invalid configuration must fail');
    } catch (error) {
      expect(String(error)).toContain('DATABASE_URL');
      expect(String(error)).not.toContain(secret);
    }
  });

  it('accepts separate development and test connection URLs', () => {
    expect(readDatabaseUrl(environment, 'development')).toBe(
      environment.DATABASE_URL,
    );
    expect(readDatabaseUrl(environment, 'test')).toBe(
      environment.TEST_DATABASE_URL,
    );
  });
});
