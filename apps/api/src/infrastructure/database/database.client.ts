import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';

// No singleton or Nest provider yet: FND-04 will own application lifecycle.
// Callers own this client and must always disconnect it in a finally block.
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
