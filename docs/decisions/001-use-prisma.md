# ADR-001: Use Prisma ORM

Status: Accepted

## Context
We need an ORM for PostgreSQL in our
NestJS backend.

## Decision
Use Prisma.

## Reasons
- Type-safe database access
- Convenient relational queries
- Migration tooling
- Maintainable for a small team

## Alternatives
- Drizzle ORM

## Consequences
- Database migrations use Prisma.
- The team maintains Prisma schemas.
- Complex queries may require raw SQL.