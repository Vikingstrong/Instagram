# Instagram Web

Next.js frontend in the pnpm workspace. Run commands from the repository root.
API routing, server/client usage, environment configuration and validation:
[FND-05 — Web and API](../../docs/development/web-api.md).

Prepare PostgreSQL and root API configuration using
[FND-03](../../docs/development/local-environment.md), then run:

```bash
pnpm dev
pnpm --filter @instagram/web check-types
pnpm --filter @instagram/web lint
pnpm --filter @instagram/web test
```

Web uses `http://localhost:3000`; `/api/v1/*` is proxied to NestJS on port 4000.
Use `API_INTERNAL_ORIGIN` in the process environment or `apps/web/.env.local`
to configure the internal API origin; its default is `http://127.0.0.1:4000`.
Do not put it in `NEXT_PUBLIC_*`. Server Components use the request-scoped
`createServerApiClient`; browser code uses `createApiClient` with relative URLs.

`pnpm test:e2e` includes real browser readiness and requires running PostgreSQL
and API. Playwright starts web automatically or reuses it outside CI.
The home feed still uses design mock-data; auth and product APIs are later work.

Fonts are bundled with the app and loaded through `next/font/local`; build/dev
do not fetch Google Fonts. Sources, checksums and SIL OFL licenses are in
[`app/fonts`](app/fonts/README.md). The browser font check blocks Google Fonts
and verifies all three faces load from the application origin.
