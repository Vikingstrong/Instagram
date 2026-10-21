import { createDatabaseClient } from './database.client.js';
import {
  DatabaseConfigurationError,
  readDatabaseUrl,
} from './database.config.js';

const target = process.argv.includes('--test') ? 'test' : 'development';

try {
  const client = createDatabaseClient(readDatabaseUrl(process.env, target));
  try {
    await client.$connect();
    const result = await client.$queryRaw<
      { value: number }[]
    >`SELECT 1::int AS value`;
    if (result.length !== 1 || result[0]?.value !== 1) {
      throw new Error('Unexpected connection check result');
    }
    console.info(`PostgreSQL ${target} connection and query: OK`);
  } finally {
    await client.$disconnect();
  }
} catch (error) {
  // Configuration errors contain only variable names; driver errors may
  // include connection details, so keep those behind a generic message.
  console.error(
    error instanceof DatabaseConfigurationError
      ? error.message
      : `PostgreSQL ${target} check failed. Verify database availability.`,
  );
  process.exitCode = 1;
}
