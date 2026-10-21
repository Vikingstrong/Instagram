import { defineConfig } from 'prisma/config';
import config from './prisma.config.js';
import { readDatabaseUrl } from './src/infrastructure/database/database.config.js';

export default defineConfig({
  ...config,
  datasource: { url: readDatabaseUrl(process.env, 'test') },
});
