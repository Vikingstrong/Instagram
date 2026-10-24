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
    if (length < 8 || length > 128) {
      context.addIssue({
        code: "custom",
        message: "Password must contain 8 to 128 Unicode code points.",
      });
    }
  })
  .meta({
    minLength: 8,
    maxLength: 128,
    description:
      "8–128 Unicode code points; spaces allowed, no trimming or normalization. Lone surrogates are rejected.",
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
export const AuthEmailRequestSchema = z.strictObject({
  email: AuthEmailSchema,
});
export const AuthLinkTokenSchema = z
  .string()
  .length(43)
  .regex(/^[A-Za-z0-9_-]{43}$/);
export const AuthVerifyRequestSchema = z.strictObject({
  token: AuthLinkTokenSchema,
});
export const AuthResetPasswordRequestSchema = z.strictObject({
  token: AuthLinkTokenSchema,
  password: AuthPasswordSchema,
});
export const AuthEmailAcceptedResponseSchema = z.strictObject({
  status: z.literal("accepted"),
});
export const AuthVerifiedResponseSchema = z.strictObject({
  status: z.literal("verified"),
});
export const AuthPasswordResetResponseSchema = z.strictObject({
  status: z.literal("password_reset"),
});

export const authErrors = {
  COINS_INSUFFICIENT_BALANCE: { status: 409, message: "Not enough coins." },
  COINS_OPERATION_CONFLICT: {
    status: 409,
    message: "Coin operation key was already used for a different gift.",
  },
  COINS_BALANCE_LIMIT: { status: 409, message: "Coin balance limit reached." },
  STORY_NOT_FOUND: { status: 404, message: "Story is unavailable or expired." },
  INVALID_OR_EXPIRED_TOKEN: {
    status: 400,
    message: "Invalid or expired token.",
  },
  INVALID_REQUEST: { status: 400, message: "Invalid request." },
  INVALID_AUDIO: { status: 400, message: "Invalid or unsupported audio." },
  AUDIO_TOO_LONG: {
    status: 400,
    message: "Voice message exceeds three minutes.",
  },
  AUDIO_TOO_LARGE: { status: 413, message: "Voice message exceeds 10 MiB." },
  INVALID_IMAGE: {
    status: 400,
    message: "The image is damaged or its format is not supported.",
  },
  IMAGE_TOO_LARGE: {
    status: 413,
    message: "The image is larger than allowed.",
  },
  INVALID_VIDEO: {
    status: 400,
    message: "The video is damaged or its format is not supported.",
  },
  VIDEO_TOO_LARGE: {
    status: 413,
    message: "The video is larger than allowed.",
  },
  VIDEO_TOO_LONG: { status: 400, message: "The video is longer than allowed." },
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
  CANNOT_FOLLOW_SELF: { status: 400, message: "You cannot follow yourself." },
  PROFILE_PRIVATE: { status: 403, message: "This account is private." },
  USER_NOT_FOUND: { status: 404, message: "User not found." },
  POST_NOT_FOUND: { status: 404, message: "Post not found." },
  MEDIA_NOT_FOUND: { status: 404, message: "Image not found." },
  COMMENT_NOT_FOUND: { status: 404, message: "Comment not found." },
  CALL_NOT_FOUND: { status: 404, message: "Call not found." },
  CALL_BUSY: { status: 409, message: "A participant is already in a call." },
  CALL_STATE_CONFLICT: {
    status: 409,
    message: "Call state or device has changed.",
  },
  CALLS_UNAVAILABLE: { status: 503, message: "Calls are not configured." },
  LIVE_NOT_FOUND: { status: 404, message: "Live stream not found." },
  LIVE_BUSY: { status: 409, message: "You already have a live stream." },
  LIVE_FULL: { status: 409, message: "The live stream has reached its viewer limit." },
  LIVE_ENDED: { status: 409, message: "The live stream has ended." },
  LIVE_STATE_CONFLICT: { status: 409, message: "Live stream state or device has changed." },
  LIVES_UNAVAILABLE: { status: 503, message: "Live streams are not configured." },
  CONVERSATION_NOT_FOUND: { status: 404, message: "Conversation not found." },
  CANNOT_MESSAGE_SELF: {
    status: 400,
    message: "You cannot start a conversation with yourself.",
  },
  MESSAGE_ID_CONFLICT: {
    status: 409,
    message: "This message id was already used for another message.",
  },
  CANNOT_DELETE_COMMENT: {
    status: 403,
    message: "You cannot delete this comment.",
  },
  FOLLOW_REQUEST_NOT_FOUND: {
    status: 404,
    message: "Follow request not found.",
  },
  USERNAME_TAKEN: { status: 409, message: "Username is already taken." },
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
    errorVariant("COINS_INSUFFICIENT_BALANCE"),
    errorVariant("COINS_OPERATION_CONFLICT"),
    errorVariant("COINS_BALANCE_LIMIT"),
    errorVariant("INVALID_OR_EXPIRED_TOKEN"),
    errorVariant("INVALID_REQUEST"),
    errorVariant("INVALID_AUDIO"),
    errorVariant("AUDIO_TOO_LONG"),
    errorVariant("AUDIO_TOO_LARGE"),
    errorVariant("INVALID_IMAGE"),
    errorVariant("IMAGE_TOO_LARGE"),
    errorVariant("INVALID_VIDEO"),
    errorVariant("VIDEO_TOO_LARGE"),
    errorVariant("VIDEO_TOO_LONG"),
    errorVariant("INVALID_CREDENTIALS"),
    errorVariant("AUTHENTICATION_REQUIRED"),
    errorVariant("EMAIL_VERIFICATION_REQUIRED"),
    errorVariant("REQUEST_FORBIDDEN"),
    errorVariant("CANNOT_FOLLOW_SELF"),
    errorVariant("PROFILE_PRIVATE"),
    errorVariant("USER_NOT_FOUND"),
    errorVariant("FOLLOW_REQUEST_NOT_FOUND"),
    errorVariant("STORY_NOT_FOUND"),
    errorVariant("POST_NOT_FOUND"),
    errorVariant("MEDIA_NOT_FOUND"),
    errorVariant("COMMENT_NOT_FOUND"),
    errorVariant("CANNOT_DELETE_COMMENT"),
    errorVariant("CALL_NOT_FOUND"),
    errorVariant("CALL_BUSY"),
    errorVariant("CALL_STATE_CONFLICT"),
    errorVariant("CALLS_UNAVAILABLE"),
    errorVariant("LIVE_NOT_FOUND"),
    errorVariant("LIVE_BUSY"),
    errorVariant("LIVE_FULL"),
    errorVariant("LIVE_ENDED"),
    errorVariant("LIVE_STATE_CONFLICT"),
    errorVariant("LIVES_UNAVAILABLE"),
    errorVariant("CONVERSATION_NOT_FOUND"),
    errorVariant("CANNOT_MESSAGE_SELF"),
    errorVariant("MESSAGE_ID_CONFLICT"),
    errorVariant("USERNAME_TAKEN"),
    errorVariant("ACCOUNT_UNAVAILABLE"),
    errorVariant("TOO_MANY_REQUESTS"),
    errorVariant("SERVICE_UNAVAILABLE"),
    errorVariant("INTERNAL_ERROR"),
  ]),
});

export const authEndpoints = {
  requestVerification: {
    method: "POST",
    path: "/api/v1/auth/verification/request",
    successStatus: 202,
  },
  verify: {
    method: "POST",
    path: "/api/v1/auth/verification/confirm",
    successStatus: 200,
  },
  requestPasswordReset: {
    method: "POST",
    path: "/api/v1/auth/password/request",
    successStatus: 202,
  },
  resetPassword: {
    method: "POST",
    path: "/api/v1/auth/password/reset",
    successStatus: 200,
  },
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
