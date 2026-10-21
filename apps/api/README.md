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
from the unit/API e2e tests. NestJS queries PostgreSQL through Prisma for
`GET /api/v1/readiness`; it returns the agreed 200/503 contract without caching.
Set `DATABASE_URL` before starting the API. The scaffold `GET /` is preserved
but is not readiness.

Swagger UI: `http://localhost:4000/api/docs/`.
OpenAPI JSON: `http://localhost:4000/api/docs/openapi.json`.
Implementation, checks and remaining integration work:
[FND-04](../../docs/development/api-readiness.md).
Auth and application models are not implemented yet.
