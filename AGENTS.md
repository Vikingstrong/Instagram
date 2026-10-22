# Instagram Clone — Shared Agent Instructions

## Scope and sources of truth

These repository-wide instructions apply to both OpenAI Codex and Claude Code.
Keep shared engineering rules here; root `CLAUDE.md` imports this file.
Before starting a task, read the relevant sections of:

- [Product requirements](docs/product/PRD.md): behavior and acceptance criteria.
- [Architecture overview](docs/architecture/overview.md): technical boundaries and security.
- [Roadmap](docs/roadmap.md): sequencing, ownership, dependencies and open decisions.
- [Accepted decisions](docs/decisions/): rationale for recorded technical choices.

Do not duplicate these documents here or silently change their decisions. PRD is
still Draft; approved technical foundations do not resolve open product rules.
If a task depends on an unresolved rule or documents conflict, identify the issue
and request the team's decision before implementing the dependent behavior.
Continue independent work within scope.

## Architecture boundaries

- Keep the approved modular monolith: Next.js web, one NestJS API process,
  PostgreSQL + Prisma, REST and SSE. New infrastructure requires team approval.
- `apps/web` performs application operations through the API, including Server
  Components. No direct database access, Prisma imports, server-module imports,
  or independent Next.js authentication system. Forward session context for SSR.
- `apps/api` owns authentication, authorization, privacy, business rules and data
  access. Controllers delegate scenarios to services; module-owned data changes
  go through that module. Prisma schema and migrations belong to the API.
- Never treat hidden UI or contract validation as authorization. Enforce current
  access rights server-side for resources, files, pagination and SSE connections.
- Keep personalized data out of shared caches; clear client state on logout or
  user changes. Protected media must not pass through a shared image cache.

## Current repository and commands

Use pnpm from the repository root. Node is pinned in `.nvmrc` (24.19.0), its
allowed range is in root `package.json`, and pnpm is pinned by `packageManager`
(12.14.0). Manifests, `pnpm-workspace.yaml` and `turbo.json` define actual commands;
recheck them when changing scripts and update this section in the same task.

| Purpose | Command | Current coverage / behavior |
| --- | --- | --- |
| Start web and API | `pnpm dev` | Turbo runs both app `dev` scripts |
| Start web | `pnpm dev:web` | Next.js dev server, default port 3000 |
| Start API | `pnpm dev:api` | Nest watch; `PORT` or default 4000 |
| Typecheck | `pnpm check-types` | Both apps; web runs Next type generation first |
| Lint | `pnpm lint` | Web ESLint; API type-aware Oxlint |
| Unit / contract tests | `pnpm test` | API Vitest, contracts node:test, web Vitest + Testing Library (jsdom) |
| E2E tests | `pnpm test:e2e` | API Vitest + Supertest; web Playwright browser smoke (desktop + mobile), starts `next dev` itself |
| Database integration | `pnpm --filter @instagram/api test:integration` | Real PostgreSQL 18.6 and Mailpit SMTP checks; requires distinct dev/test URLs and roles |
| Validate / generate Prisma | `pnpm --filter @instagram/api db:validate` / `pnpm --filter @instagram/api db:generate` | Prisma 7.10.1; generation also runs before API dev/build/typecheck/lint |
| Check database connection | `pnpm --filter @instagram/api db:check` (append `--test` for test DB) | Builds API, imports compiled ESM client, connects and executes SQL |
| Apply migration history | `pnpm --filter @instagram/api db:migrate:deploy` / `pnpm --filter @instagram/api db:migrate:test` | Dev/test respectively; first Auth migration is versioned SQL |
| Build | `pnpm build` | Contracts first, then both apps through Turbo |

For a single app use `pnpm --filter @instagram/web <script>` or
`pnpm --filter @instagram/api <script>` with a script present in its manifest.
Build `@instagram/contracts` first when calling app scripts directly; root Turbo
commands and root `dev:web` / `dev:api` already handle that dependency.
Web Playwright runs the locally installed Google Chrome (`PLAYWRIGHT_CHANNEL`
overrides, e.g. `msedge`); CI uses bundled Chromium from `playwright install chromium`.
The readiness browser smoke calls the real API through the web rewrite; it
requires PostgreSQL and API to be running. CI starts both before E2E. See
`docs/development/web-api.md` for routing, server/client usage and validation;
`docs/development/frontend-testing.md` describes FND-06, error component tests
and the distinction between fixtures and live browser checks.
The internal API origin is configured by server-only `API_INTERNAL_ORIGIN`
(default `http://127.0.0.1:4000`), exported in the process or set in
`apps/web/.env.local`. Root `.env` is not automatically loaded by Next.
Use `createServerApiClient` per request for Server Components; it forwards cookie
and origin context without shared caching. Browser calls stay same-origin.

The web feed remains a design scaffold. PostgreSQL 18.6 / Prisma 7.10.1 configuration,
Compose/native setup, compiled-client checks and isolated database integration
tests exist; see `docs/development/database.md`. NestJS uses Prisma for
`GET /api/v1/readiness`; Swagger UI is at `/api/docs/` and OpenAPI JSON at
`/api/docs/openapi.json`. See `docs/development/api-readiness.md`. The first Auth persistence models and migration are in `apps/api/prisma`; see
`docs/development/auth-database.md`. Auth registration, cookie sessions, CSRF,
email verification, recovery and durable SMTP delivery are implemented; see
`docs/development/auth-api.md` and `docs/development/auth-email.md`. The additive
mail outbox migration must be applied to both dev and test databases. `packages/contracts`
contains the FND-02 readiness/error Zod schemas and fixtures; API and web import
it. Shared Auth input/output/error schemas are used by the API and web transport.
Register/login/session/logout web pages use the existing Auth contract; see
`docs/development/auth-web.md`. Verification/recovery forms use the same API;
see `docs/development/auth-email.md`. Their browser test requires Mailpit and
an API started against the isolated TEST database with
`node --env-file=.env scripts/ci/start-test-api.mjs`; CI uses this launcher too.
The owner authorized stage 2
implementation before FND-08 on 2026-10-22. Real-machine checks and joint
acceptance in `docs/development/foundation-acceptance.md` remain required before
final stage 2 acceptance; cloud CI is not a substitute.
See `docs/development/foundation-contracts.md` for the proposed wire format
and `docs/development/fnd-02-review.md` for Developer 2 acceptance.
Frontend/browser harnesses include real readiness through the web origin;
product scenarios and joint Foundation acceptance remain pending.
All future protected product routes must enforce verified sessions server-side
(e.g. `VerifiedSessionGuard` exported by AuthModule); auth mutations additionally
require Origin/CSRF validation. Cookie/session fields never enter public DTOs.
Local Mailpit configuration and startup instructions are in
`docs/development/local-environment.md`; API mail delivery uses MailModule and
Nodemailer. Configure a persistent server-only MAIL_OUTBOX_KEY, SMTP_HOST,
SMTP_PORT and SMTP_FROM; SMTP_USER/SMTP_PASSWORD are optional and paired.
Missing development key causes mail-producing transactions to fail safely with
503; production requires it at startup and enforces SMTP TLS. Preserve this key
across restarts; never print it or use NEXT_PUBLIC. See auth-email.md.
Foundation CI is defined in `.github/workflows/ci.yml`; see
`docs/development/ci.md` for checks and service lifecycle.
Root `test` / `test:e2e` do not run database integration tests; CI runs them explicitly.
The repository-root `.env` is loaded by Prisma CLI configuration, API start
scripts and database checks; it stays out of Git. Process environment values
take precedence. The API consumes `PORT` and validates `DATABASE_URL` at startup.
`/api/v1` is the API prefix; the legacy `GET /` remains outside it and does not
check the database. Readiness keeps its exact 503 envelope; Auth routes use the shared Auth error
contract with safe 400/401/403/409/413/429/500/503 responses. Other legacy routes
keep their existing behavior. Production Auth requires AUTH_PUBLIC_ORIGIN
(HTTPS) and AUTH_CSRF_SECRET with NODE_ENV=production; do not log their values.
Do not install dependencies or change infrastructure outside the assigned scope.

## API contracts and coordination

Temporary owner instruction, 2026-10-22: while Developer 2 is unavailable,
the owner acts as team lead and is the sole approver of contracts, migrations
and implementation. Developer 2 approval is not a prerequisite during this
period. Present concrete proposals to the team lead; their authorization takes
precedence over the two-developer review wording below. Technical/security
checks and the separate FND-08 real-machine acceptance remain required.

- Developer 1 (Codex) primarily owns backend, infrastructure and architecture;
  Developer 2 (Claude Code) primarily owns frontend and frontend tests. These are
  coordination responsibilities, not agent-specific engineering rules.
- Developer 1 coordinates `packages/contracts`; both developers agree the
  affected schemas, errors, permissions, limits and examples before dependent
  API/UI implementation. Do not design the entire future API in advance.
- When introduced, contracts contain browser-safe Zod request, response and SSE
  schemas with inferred TypeScript types. No secrets, Prisma models, NestJS
  services or internal user fields. API validates input at runtime.
- Change schemas, producers, consumers, fixtures and relevant tests together in
  the same slice. Do not independently copy API types into web. Identify breaking
  changes and affected consumers in the PR and handoff to the other developer.
- UI may use fixtures validated by the agreed schemas during parallel work.
  Completion requires integration with the real API and applicable dependencies.

## Git and PR workflow

- Inspect the current branch and working tree first. Preserve existing user
  changes. Work on a task-specific branch, keeping edits within the task.
- One task/PR has one owner. Coordinate shared contracts, root scripts, lockfile
  and migrations before editing overlapping areas. Update dependent branches
  after the contract merges.
- Keep PRs focused. Include the problem, resulting behavior, requirement links,
  contract/migration effects, validation results and remaining blockers.
- Human review is required; auth, access policies and migrations need both
  developers' attention. Do not merge or push to `main` automatically. Commit,
  push and PR publication must stay within the user's explicit authorization.
- Do not add infrastructure, dependencies or project conventions incidentally;
  explain any proposed addition and obtain required approval first.

## Verification and security

- For code changes, run relevant typechecks, lint and tests before completion;
  run build when changes affect compilation, configuration or integration.
  For shared contracts, verify both apps and contract tests once available.
- Add or update meaningful tests for changed behavior and regressions. Select
  unit, integration, API and browser checks according to the affected guarantees
  in Architecture Overview §13 and the task's roadmap acceptance criteria.
- For auth/privacy changes include negative access tests, direct API/file
  requests, and applicable session/cache transitions. Verify migrations and data
  invariants against isolated test PostgreSQL, not SQLite or a mocked database.
- Never report missing scripts, skipped tasks, fixtures or starter tests as proof
  that a feature works. Report unavailable checks and what is needed to run them.
  For instruction-only edits, verify paths, script names, imports and consistency;
  application checks may be skipped with that reason stated in the report.
- Keep secrets out of Git, contracts, browser bundles, logs and reports. Use
  server environment configuration; examples contain placeholders only. Never
  log passwords, session/recovery tokens or private message contents.
- Follow Architecture Overview §§8–11, 15 for cookie/session protection, CSRF
  and Origin checks, validation, safe responses, rate limits and private media.
  Do not weaken checks to make a test pass or invent unresolved product limits.
- Use isolated dev/test data. Do not reset shared or production databases or run
  destructive migrations without explicit authorization.

## Completion report

Report concisely in the user's language:

- Files created or changed and the behavior/rules implemented.
- Checks actually run, their results, and checks skipped or blocked with reasons.
- Remaining limitations, unresolved decisions and coordination needed.

Distinguish verified behavior from assumptions. Do not claim runtime loading of
an agent's instructions when only filenames or documented syntax were checked.
