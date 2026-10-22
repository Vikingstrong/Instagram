import { z } from "zod";

// Draft input contract for review before API/UI integration. These schemas do
// not register routes, establish identity, or enforce database uniqueness.
export const AuthUsernameSchema = z
  .string()
  .min(3)
  .max(30)
  .refine((value) => !/[^A-Za-z0-9_.]/.test(value), {
    message:
      "Username may contain only Latin letters, digits, underscores and dots.",
  });

// Preserve input: canonical email/username identity keys belong to the agreed
// persistence contract. Never apply provider-specific email rewriting here.
export const AuthEmailSchema = z.email().max(254);

// JS string.length counts UTF-16 units. Count Unicode code points instead,
// without trimming or normalization, so non-BMP characters count once.
export const AuthPasswordSchema = z.string().superRefine((value, context) => {
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
});

export const AuthRegisterRequestSchema = z.strictObject({
  email: AuthEmailSchema,
  username: AuthUsernameSchema,
  password: AuthPasswordSchema,
});

// First slice proposes email + password login, pending contract review.
export const AuthLoginRequestSchema = z.strictObject({
  email: AuthEmailSchema,
  password: AuthPasswordSchema,
});

export type AuthRegisterRequest = z.infer<typeof AuthRegisterRequestSchema>;
export type AuthLoginRequest = z.infer<typeof AuthLoginRequestSchema>;
