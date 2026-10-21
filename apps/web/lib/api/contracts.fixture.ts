"use client";

import {
  readinessReadyFixture,
  readinessUnavailableFixture,
} from "@instagram/contracts/fixtures";
import {
  ApiErrorResponseSchema,
  ReadinessResponseSchema,
  type ApiErrorResponse,
  type ReadinessResponse,
} from "./contracts";

// Explicit fixture mode for Claude's parallel work; not connected to the live API.
export const readyFixture: ReadinessResponse = ReadinessResponseSchema.parse(
  readinessReadyFixture,
);
export const unavailableFixture: ApiErrorResponse =
  ApiErrorResponseSchema.parse(readinessUnavailableFixture);
