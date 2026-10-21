import type { ApiClient, RequestOptions } from "./client";
import { ReadinessResponseSchema, readinessEndpoint } from "./contracts";

// GET /api/v1/readiness: 200 when API and DB are ready, 503 envelope otherwise.
export function getReadiness(client: ApiClient, options?: RequestOptions) {
  return client.request(readinessEndpoint, ReadinessResponseSchema, options);
}
