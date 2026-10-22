// Shared by Server and Client Components, so no "use client" here: it would
// turn these schemas into client references that cannot be called on the server.
// Browser-safe entry for FND-05. No HTTP request or UI behavior is added here.
export {
  ApiTransportErrorResponseSchema as ApiErrorResponseSchema,
  ReadinessResponseSchema,
  readinessEndpoint,
  type ApiTransportErrorResponse as ApiErrorResponse,
  type ReadinessResponse,
} from "@instagram/contracts";
