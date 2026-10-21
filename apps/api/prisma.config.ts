import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

const envPath = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(envPath)) loadEnvFile(envPath);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Generation and validation must work without database credentials.
  // Prisma requires this URL only when a command actually accesses the DB.
  datasource: { url: process.env.DATABASE_URL },
});
