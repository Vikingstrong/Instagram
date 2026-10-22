# @instagram/contracts

Browser-safe Zod schemas and inferred types shared by NestJS and Next.js.

Runtime scope: Foundation readiness response and its safe error envelope.
See [the contract and frontend handoff](../../docs/development/foundation-contracts.md).
Draft Auth input schemas are also exported for review; they are not used by API
routes or web forms yet. See [Auth preparation](../../docs/development/auth-preparation.md)
for field rules, Unicode password length, pending decisions and integration gates.

```ts
import {
  ReadinessResponseSchema,
  type ReadinessResponse,
} from '@instagram/contracts';
import { readinessReadyFixture } from '@instagram/contracts/fixtures';

const ready: ReadinessResponse = ReadinessResponseSchema.parse(readinessReadyFixture);
```

From the repository root: `pnpm build`, `pnpm check-types`, `pnpm lint`, `pnpm test`.
For package-only checks, build first: `pnpm --filter @instagram/contracts build`,
then `pnpm --filter @instagram/contracts test`. Public runtime exports contain
neither Node builtins nor server modules. Tests may use Node builtins and are not
exported or included in `dist`.
