# Migration history

Foundation has no application models and no SQL migrations. Do not add a dummy
table or empty migration to make a smoke check pass.

The first versioned migration belongs to the Auth slice after its contracts and
product decisions are agreed. Create and review its SQL before applying it. Use
an explicitly isolated shadow database when authoring migrations; application
roles intentionally have no CREATEDB privilege.

Apply reviewed migrations with `pnpm --filter @instagram/api db:migrate:deploy`.
For the isolated test database use `pnpm --filter @instagram/api db:migrate:test`.
Never use `db push` or `migrate reset` as an automatic setup step.
