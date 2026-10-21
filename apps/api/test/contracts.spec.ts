import {
  ApiErrorResponseSchema,
  ReadinessResponseSchema,
  type ApiErrorResponse,
  type ReadinessResponse,
} from '../src/contracts/foundation.js';
import {
  readinessReadyFixture,
  readinessUnavailableFixture,
} from '@instagram/contracts/fixtures';

describe('shared Foundation contracts in the API', () => {
  it('loads workspace ESM exports and inferred types with the API toolchain', () => {
    const ready: ReadinessResponse = ReadinessResponseSchema.parse(
      readinessReadyFixture,
    );
    const unavailable: ApiErrorResponse = ApiErrorResponseSchema.parse(
      readinessUnavailableFixture,
    );
    expect(ready.status).toBe('ready');
    expect(unavailable.error.code).toBe('SERVICE_UNAVAILABLE');
  });
});
