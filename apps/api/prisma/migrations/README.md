# Migration history

The first migration, `20261022060000_auth_database`, creates Auth users, sessions
and one-time tokens. See [Auth persistence](../../../../docs/development/auth-database.md).

Review SQL before applying it. SQL CHECK constraints are part of migration history
and are not expressed by Prisma schema; preserve them in future migrations. Use
an explicitly isolated shadow database when authoring migrations; application
roles intentionally have no CREATEDB privilege.

Apply reviewed migrations with `pnpm --filter @instagram/api db:migrate:deploy`.
For the isolated test database use `pnpm --filter @instagram/api db:migrate:test`.
Never use `db push` or `migrate reset` as an automatic setup step.
