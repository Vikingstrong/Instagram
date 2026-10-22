# @instagram/contracts

Browser-safe Zod schemas and inferred types shared by NestJS and Next.js.

Runtime scope: Foundation readiness plus Auth registration/cookie-session contracts.
See [the contract and frontend handoff](../../docs/development/foundation-contracts.md).
Auth request/response/error schemas and endpoint constants are used by the API
and web transport. See [Auth API](../../docs/development/auth-api.md) for cookie/CSRF
semantics, Unicode password length and remaining email/frontend work. The exact
Foundation error schema stays stable; ApiTransportErrorResponseSchema accepts
both implemented slices.

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
