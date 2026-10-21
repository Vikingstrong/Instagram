// Shared wire schemas; no Nest controllers or database services in this entry.
export {
  ApiErrorResponseSchema,
  ReadinessResponseSchema,
  readinessEndpoint,
  type ApiErrorResponse,
  type ReadinessResponse,
} from '@instagram/contracts';
