import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';

// The Nest provider owns the application client. Standalone CLI/test callers
// own their clients and must disconnect them in a finally block.
export function createDatabaseClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    statement_timeout: 5_000,
  });
  return new PrismaClient({ adapter, log: [] });
}
