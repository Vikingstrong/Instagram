import { z } from "zod";
import { AuthApiErrorResponseSchema } from "./auth.js";

export {
  AuthEmailSchema,
  AuthLoginRequestSchema,
  AuthPasswordSchema,
  AuthRegisterRequestSchema,
  AuthUsernameSchema,
  type AuthLoginRequest,
  type AuthRegisterRequest,
} from "./auth.js";
export {
  AuthEmailRequestSchema,
  AuthLinkTokenSchema,
  AuthVerifyRequestSchema,
  AuthResetPasswordRequestSchema,
  AuthEmailAcceptedResponseSchema,
  AuthVerifiedResponseSchema,
  AuthPasswordResetResponseSchema,
  AuthUserSchema,
  AuthUserResponseSchema,
  AuthSessionResponseSchema,
  AuthCsrfResponseSchema,
  AuthLogoutResponseSchema,
  AuthLogoutRequestSchema,
  AuthApiErrorResponseSchema,
  authEndpoints,
  authErrors,
  type AuthUser,
  type AuthErrorCode,
  type AuthApiErrorResponse,
} from "./auth.js";

// This describes the future FND-04 endpoint; FND-02 does not expose an HTTP route.
export const readinessEndpoint = {
  method: "GET",
  path: "/api/v1/readiness",
  successStatus: 200,
  unavailableStatus: 503,
} as const;

export const ReadinessResponseSchema = z.strictObject({
  status: z.literal("ready"),
});

// Only the technical slice's error code is defined. Extend this with each
// agreed feature; never pass a database/driver error message to the client.
export const ApiErrorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: z.literal("SERVICE_UNAVAILABLE"),
    message: z.literal("Service is temporarily unavailable."),
    requestId: z.uuidv4(),
  }),
});

export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>;
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

// Foundation's exact 503 schema stays stable; web transport understands both slices.
export const ApiTransportErrorResponseSchema = z.union([
  ApiErrorResponseSchema,
  AuthApiErrorResponseSchema,
]);
export type ApiTransportErrorResponse = z.infer<
  typeof ApiTransportErrorResponseSchema
>;
