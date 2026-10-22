import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { createDatabaseClient } from './database.client.js';

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly client: ReturnType<typeof createDatabaseClient>;

  constructor(connectionUrl: string) {
    this.client = createDatabaseClient(connectionUrl);
  }

  // Internal API services only. Controllers expose explicit public projections.
  get prisma(): ReturnType<typeof createDatabaseClient> {
    return this.client;
  }

  // Connect lazily: an unavailable database must produce readiness 503 rather
  // than prevent the HTTP server (and its diagnostics) from starting.
  async checkConnection(): Promise<void> {
    const result = await this.client.$queryRaw<{ value: number }[]>`
      SELECT 1::int AS value
    `;
    if (result.length !== 1 || result[0]?.value !== 1) {
      throw new Error('Database check failed');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.$disconnect();
  }
}
