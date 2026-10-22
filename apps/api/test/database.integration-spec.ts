import { createDatabaseClient } from '../src/infrastructure/database/database.client.js';
import { readDatabaseUrl } from '../src/infrastructure/database/database.config.js';

// Missing or overlapping configuration fails the suite; never silently skip it.
const testUrl = readDatabaseUrl(process.env, 'test');
const development = new URL(readDatabaseUrl(process.env, 'development'));
const test = new URL(testUrl);
const client = createDatabaseClient(testUrl);

describe('Database Foundation (real PostgreSQL)', () => {
  beforeAll(async () => {
    await client.$connect();
  });

  afterAll(async () => {
    await client.$disconnect();
  });

  it('executes parameterized SQL against the pinned PostgreSQL test database', async () => {
    const value = 42;
    const rows = await client.$queryRaw<
      {
        value: number;
        database: string;
        role: string;
        version: string;
      }[]
    >`
      SELECT ${value}::int AS value, current_database() AS database,
             current_user AS role, current_setting('server_version_num') AS version
    `;
    expect(rows).toEqual([
      {
        value,
        database: decodeURIComponent(test.pathname.slice(1)),
        role: decodeURIComponent(test.username),
        version: '180006',
      },
    ]);
  });

  it('uses an unprivileged test role without access to the development database', async () => {
    const developmentDatabase = decodeURIComponent(
      development.pathname.slice(1),
    );
    const rows = await client.$queryRaw<
      {
        superuser: boolean;
        create_database: boolean;
        create_role: boolean;
        can_connect_development: boolean;
      }[]
    >`
      SELECT rolsuper AS superuser, rolcreatedb AS create_database,
             rolcreaterole AS create_role,
             has_database_privilege(current_user, ${developmentDatabase}, 'CONNECT')
               AS can_connect_development
      FROM pg_roles WHERE rolname = current_user
    `;
    expect(rows).toEqual([
      {
        superuser: false,
        create_database: false,
        create_role: false,
        can_connect_development: false,
      },
    ]);
  });

  it('rejects a direct connection from the test role to the development database', async () => {
    const forbiddenUrl = new URL(testUrl);
    forbiddenUrl.pathname = development.pathname;
    const forbidden = createDatabaseClient(forbiddenUrl.toString());
    try {
      await expect(forbidden.$queryRaw`SELECT 1`).rejects.toThrow();
    } finally {
      await forbidden.$disconnect();
    }
  });

  it('has the versioned Auth tables after migration deploy', async () => {
    const rows = await client.$queryRaw<{ name: string }[]>`
      SELECT tablename AS name FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
      ORDER BY tablename
    `;
    expect(rows).toEqual([
      { name: 'auth_sessions' },
      { name: 'auth_tokens' },
      { name: 'auth_users' },
      { name: 'mail_deliveries' },
    ]);
  });
});
