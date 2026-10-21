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
| Database integration | `pnpm --filter @instagram/api test:integration` | Explicit real PostgreSQL 18.6 checks; requires distinct dev/test URLs and roles |
| Validate / generate Prisma | `pnpm --filter @instagram/api db:validate` / `pnpm --filter @instagram/api db:generate` | Prisma 7.10.1; generation also runs before API dev/build/typecheck/lint |
| Check database connection | `pnpm --filter @instagram/api db:check` (append `--test` for test DB) | Builds API, imports compiled ESM client, connects and executes SQL |
| Apply migration history | `pnpm --filter @instagram/api db:migrate:deploy` / `pnpm --filter @instagram/api db:migrate:test` | Dev/test respectively; currently no application migrations |
| Build | `pnpm build` | Contracts first, then both apps through Turbo |

For a single app use `pnpm --filter @instagram/web <script>` or
`pnpm --filter @instagram/api <script>` with a script present in its manifest.
Build `@instagram/contracts` first when calling app scripts directly; root Turbo
commands and root `dev:web` / `dev:api` already handle that dependency.
Web Playwright runs the locally installed Google Chrome (`PLAYWRIGHT_CHANNEL`
overrides, e.g. `msedge`); CI uses bundled Chromium from `playwright install chromium`.
The readiness browser smoke is `test.fixme` until FND-04 and the FND-01 origin
scheme exist; a green web run does not prove web → API → DB connectivity.

The apps remain scaffolds. PostgreSQL 18.6 / Prisma 7.10.1 configuration,
Compose/native setup, compiled-client checks and isolated database integration
tests exist; see `docs/development/database.md`. NestJS does not use the database
yet. There are no application models or SQL migrations. `packages/contracts`
contains the FND-02 readiness/error Zod schemas and fixtures; API and web import
it. See `docs/development/foundation-contracts.md` for the proposed wire format
and pending Developer 2 review. Frontend/browser tests, CI and local test mail
are not implemented yet. Root `test` / `test:e2e` do not run database integration tests.
The repository-root `.env` is loaded by Prisma CLI configuration, API start
scripts and database checks; it stays out of Git. Process environment values
take precedence. The API currently consumes `PORT` but no database URL.
`/api/v1` is the planned API prefix; the current starter endpoint is `GET /`.
Do not install dependencies or change infrastructure outside the assigned scope.

## API contracts and coordination

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
