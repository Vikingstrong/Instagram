import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';

// CI runs in a fresh checkout. Refuse to overwrite an existing developer .env.
const [admin, development, test] = Array.from({ length: 3 }, () =>
  randomBytes(24).toString('hex'),
);
const contents = [
  `POSTGRES_ADMIN_PASSWORD=${admin}`,
  `POSTGRES_DEV_PASSWORD=${development}`,
  `POSTGRES_TEST_PASSWORD=${test}`,
  'POSTGRES_PORT=5432',
  `DATABASE_URL=postgresql://instagram_dev:${development}@127.0.0.1:5432/instagram_dev`,
  `TEST_DATABASE_URL=postgresql://instagram_test:${test}@127.0.0.1:5432/instagram_test`,
  `MAIL_OUTBOX_KEY=${randomBytes(32).toString('hex')}`,
  'SMTP_HOST=127.0.0.1',
  'SMTP_PORT=1025',
  'SMTP_FROM=noreply@example.test',
  '',
].join('\n');

writeFileSync('.env', contents, { flag: 'wx', mode: 0o600 });
console.log('Created ephemeral CI configuration with separate dev/test roles.');
