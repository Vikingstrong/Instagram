import { ApiErrorResponseSchema, ReadinessResponseSchema } from "./index.js";

// Explicit fixtures for parallel UI work, never an API readiness implementation.
export const readinessReadyFixture = ReadinessResponseSchema.parse({
  status: "ready",
});

export const readinessUnavailableFixture = ApiErrorResponseSchema.parse({
  error: {
    code: "SERVICE_UNAVAILABLE",
    message: "Service is temporarily unavailable.",
    requestId: "123e4567-e89b-42d3-a456-426614174000",
  },
});
