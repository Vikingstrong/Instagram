# Instagram API

NestJS backend scaffold. All commands run from the repository root using pnpm.

Database setup, pinned versions, dev/test isolation, Compose/native instructions,
connection checks and migration workflow: [Database Foundation](../../docs/development/database.md).
Shared schemas and frontend handoff: [FND-02](../../docs/development/foundation-contracts.md).

```bash
pnpm dev:api
pnpm --filter @instagram/contracts build
pnpm --filter @instagram/api check-types
pnpm --filter @instagram/api lint
pnpm --filter @instagram/api build
pnpm --filter @instagram/api test
pnpm --filter @instagram/api test:e2e
pnpm --filter @instagram/api test:integration
```

Database integration tests require configured dev/test databases and are separate
from the starter unit/API e2e tests. The current `GET /` returns `Hello World!`;
NestJS does not yet connect to PostgreSQL. Shared readiness/error contracts are
implemented for review; the readiness endpoint, Swagger and auth remain later tasks.
