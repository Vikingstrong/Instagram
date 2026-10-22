import { z } from "zod";

// Shared wire contract. Validation does not establish identity or uniqueness.
export const AuthUsernameSchema = z
  .string()
  .min(3)
  .max(30)
  .regex(/^[A-Za-z0-9_.]+(?![\s\S])/, {
    message:
      "Username may contain only Latin letters, digits, underscores and dots.",
  });

// Preserve input: canonical email/username identity keys belong to the agreed
// persistence contract. Never apply provider-specific email rewriting here.
export const AuthEmailSchema = z.email().max(254);

// JS string.length counts UTF-16 units. Count Unicode code points instead,
// without trimming or normalization, so non-BMP characters count once.
export const AuthPasswordSchema = z
  .string()
  .superRefine((value, context) => {
    let length = 0;
    for (const character of value) {
      const point = character.codePointAt(0)!;
      if (point >= 0xd800 && point <= 0xdfff) {
        context.addIssue({
          code: "custom",
          message: "Invalid Unicode password.",
        });
        return;
      }
      length += 1;
      if (length > 128) break;
    }
    if (length < 12 || length > 128) {
      context.addIssue({
        code: "custom",
        message: "Password must contain 12 to 128 Unicode code points.",
      });
    }
  })
  .meta({
    minLength: 12,
    maxLength: 128,
    description:
      "12–128 Unicode code points; spaces allowed, no trimming or normalization. Lone surrogates are rejected.",
  });

export const AuthRegisterRequestSchema = z.strictObject({
  email: AuthEmailSchema,
  username: AuthUsernameSchema,
  password: AuthPasswordSchema,
});

// Email + password login. Identity normalization is owned by the API.
export const AuthLoginRequestSchema = z.strictObject({
  email: AuthEmailSchema,
  password: AuthPasswordSchema,
});

export type AuthRegisterRequest = z.infer<typeof AuthRegisterRequestSchema>;
export type AuthLoginRequest = z.infer<typeof AuthLoginRequestSchema>;

export const AuthUserSchema = z.strictObject({
  id: z.uuid(),
  email: AuthEmailSchema,
  username: AuthUsernameSchema,
  emailVerified: z.boolean(),
});
export const AuthUserResponseSchema = z.strictObject({ user: AuthUserSchema });
export const AuthSessionResponseSchema = z.strictObject({
  user: AuthUserSchema.nullable(),
});
export const AuthCsrfResponseSchema = z.strictObject({
  csrfToken: z.string().regex(/^[A-Za-z0-9_-]{43}\.\d{10}\.[A-Za-z0-9_-]{43}$/),
});
export const AuthLogoutResponseSchema = z.strictObject({
  status: z.literal("signed_out"),
});
export const AuthLogoutRequestSchema = z.strictObject({});

export const authErrors = {
  INVALID_REQUEST: { status: 400, message: "Invalid request." },
  INVALID_CREDENTIALS: { status: 401, message: "Invalid email or password." },
  AUTHENTICATION_REQUIRED: {
    status: 401,
    message: "Authentication is required.",
  },
  EMAIL_VERIFICATION_REQUIRED: {
    status: 403,
    message: "Email verification is required.",
  },
  REQUEST_FORBIDDEN: { status: 403, message: "Request is forbidden." },
  ACCOUNT_UNAVAILABLE: {
    status: 409,
    message: "Account details are unavailable.",
  },
  TOO_MANY_REQUESTS: {
    status: 429,
    message: "Too many requests. Try again later.",
  },
  SERVICE_UNAVAILABLE: {
    status: 503,
    message: "Service is temporarily unavailable.",
  },
  INTERNAL_ERROR: { status: 500, message: "An unexpected error occurred." },
} as const;
export type AuthErrorCode = keyof typeof authErrors;
function errorVariant<C extends AuthErrorCode>(code: C) {
  return z.strictObject({
    code: z.literal(code),
    message: z.literal(authErrors[code].message),
    requestId: z.uuidv4(),
  });
}
export const AuthApiErrorResponseSchema = z.strictObject({
  error: z.discriminatedUnion("code", [
    errorVariant("INVALID_REQUEST"),
    errorVariant("INVALID_CREDENTIALS"),
    errorVariant("AUTHENTICATION_REQUIRED"),
    errorVariant("EMAIL_VERIFICATION_REQUIRED"),
    errorVariant("REQUEST_FORBIDDEN"),
    errorVariant("ACCOUNT_UNAVAILABLE"),
    errorVariant("TOO_MANY_REQUESTS"),
    errorVariant("SERVICE_UNAVAILABLE"),
    errorVariant("INTERNAL_ERROR"),
  ]),
});

export const authEndpoints = {
  csrf: { method: "GET", path: "/api/v1/auth/csrf", successStatus: 200 },
  register: {
    method: "POST",
    path: "/api/v1/auth/register",
    successStatus: 201,
  },
  login: { method: "POST", path: "/api/v1/auth/login", successStatus: 200 },
  session: { method: "GET", path: "/api/v1/auth/session", successStatus: 200 },
  logout: { method: "POST", path: "/api/v1/auth/logout", successStatus: 200 },
} as const;
export type AuthUser = z.infer<typeof AuthUserSchema>;
export type AuthApiErrorResponse = z.infer<typeof AuthApiErrorResponseSchema>;
