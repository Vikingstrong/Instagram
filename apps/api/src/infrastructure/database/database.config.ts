export type DatabaseTarget = 'development' | 'test';

export class DatabaseConfigurationError extends Error {}

function parseDatabaseUrl(value: string | undefined, name: string): URL {
  // Do not include the value or the original parser error: both can leak secrets.
  if (!value || value.includes('REPLACE_WITH_')) {
    throw new DatabaseConfigurationError(
      `${name} must contain a configured PostgreSQL connection URL.`,
    );
  }

  try {
    const url = new URL(value);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !url.hostname ||
      !url.username ||
      url.pathname.length <= 1 ||
      url.hash
    ) {
      throw new Error('Invalid PostgreSQL URL');
    }
    // Decode here so malformed escapes also produce the safe error below.
    decodeURIComponent(url.pathname);
    decodeURIComponent(url.username);
    // node-postgres reads these query parameters before URL components.
    // Never let a query string change the reviewed database identity or role.
    if (
      ['host', 'port', 'user', 'password', 'database', 'db'].some((key) =>
        url.searchParams.has(key),
      )
    ) {
      throw new DatabaseConfigurationError(
        `${name} must not override connection identity in URL query parameters.`,
      );
    }
    return url;
  } catch (error) {
    if (error instanceof DatabaseConfigurationError) throw error;
    throw new DatabaseConfigurationError(
      `${name} must contain a valid PostgreSQL connection URL.`,
    );
  }
}

export function readDatabaseUrl(
  environment: NodeJS.ProcessEnv,
  target: DatabaseTarget,
): string {
  const development = parseDatabaseUrl(
    environment.DATABASE_URL,
    'DATABASE_URL',
  );
  if (target === 'development') return environment.DATABASE_URL!;

  const test = parseDatabaseUrl(
    environment.TEST_DATABASE_URL,
    'TEST_DATABASE_URL',
  );
  if (
    decodeURIComponent(test.pathname) ===
      decodeURIComponent(development.pathname) ||
    decodeURIComponent(test.username) ===
      decodeURIComponent(development.username)
  ) {
    throw new DatabaseConfigurationError(
      'Test and development must use different database names and roles.',
    );
  }

  return environment.TEST_DATABASE_URL!;
}
