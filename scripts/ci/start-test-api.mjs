// Run with node --env-file=.env. Keep the web/fixture dev/test configuration
// distinct; override the URL only inside this isolated compiled API process.
import { readDatabaseUrl } from '../../apps/api/dist/infrastructure/database/database.config.js';

process.env.DATABASE_URL = readDatabaseUrl(process.env, 'test');
// Every browser test reaches the API through the one Next proxy socket, so
// the per-address limits would throttle the suite itself. Per-account and
// per-email limits stay as in production.
process.env.AUTH_MUTATION_IP_LIMIT ??= '10000';
process.env.AUTH_READ_IP_LIMIT ??= '50000';
await import('../../apps/api/dist/main.js');
