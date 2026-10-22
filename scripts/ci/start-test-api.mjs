// Run with node --env-file=.env. Keep the web/fixture dev/test configuration
// distinct; override the URL only inside this isolated compiled API process.
import { readDatabaseUrl } from '../../apps/api/dist/infrastructure/database/database.config.js';

process.env.DATABASE_URL = readDatabaseUrl(process.env, 'test');
await import('../../apps/api/dist/main.js');
