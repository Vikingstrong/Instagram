import { z } from "zod";
import { AuthUsernameSchema } from "./auth.js";

// Limits count Unicode code points, matching the PostgreSQL VARCHAR columns.
// Input is kept as sent: no trimming or normalization. Lone surrogates and
// control characters are rejected; the bio alone may contain line breaks.
export function profileText(max: number, multiline: boolean) {
  return z
    .string()
    .superRefine((value, context) => {
      let length = 0;
      for (const character of value) {
        const point = character.codePointAt(0)!;
        const control =
          point < 0x20 || (point >= 0x7f && point < 0xa0);
        if (
          (point >= 0xd800 && point <= 0xdfff) ||
          (control && !(multiline && point === 0x0a))
        ) {
          context.addIssue({ code: "custom", message: "Invalid character." });
          return;
        }
        length += 1;
      }
      if (length > max)
        context.addIssue({
          code: "custom",
          message: `At most ${max} characters.`,
        });
    })
    .meta({ maxLength: max });
}
export const ProfileDisplayNameSchema = profileText(30, false);
export const ProfileBioSchema = profileText(150, true);

// self: own profile; requested: a pending request to a private profile.
export const ProfileRelationshipSchema = z.enum([
  "self",
  "none",
  "requested",
  "following",
]);

// Same-origin API path of an access-checked image variant; never a public
// object URL. The browser sends its session cookie when loading it.
export const MediaUrlSchema = z
  .string()
  .regex(
    /^\/api\/v1\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(?:full|thumb)$/,
  );

// Allowed FR-02 summary. Private profiles return the same fields; their posts
// are served by separate, access-checked endpoints.
export const UserProfileSchema = z.strictObject({
  id: z.uuid(),
  username: AuthUsernameSchema,
  displayName: ProfileDisplayNameSchema,
  bio: ProfileBioSchema,
  avatarUrl: MediaUrlSchema.nullable(),
  isPrivate: z.boolean(),
  counts: z.strictObject({
    posts: z.int().nonnegative(),
    followers: z.int().nonnegative(),
    following: z.int().nonnegative(),
  }),
  relationship: ProfileRelationshipSchema,
});
export const UserProfileResponseSchema = z.strictObject({
  profile: UserProfileSchema,
});

// Editable fields of the signed-in account.
export const OwnProfileSchema = z.strictObject({
  id: z.uuid(),
  username: AuthUsernameSchema,
  displayName: ProfileDisplayNameSchema,
  bio: ProfileBioSchema,
  isPrivate: z.boolean(),
});
export const OwnProfileResponseSchema = z.strictObject({
  profile: OwnProfileSchema,
});

// Partial update; at least one field. Uniqueness is checked by the API.
export const UpdateOwnProfileRequestSchema = z
  .strictObject({
    username: AuthUsernameSchema.optional(),
    displayName: ProfileDisplayNameSchema.optional(),
    bio: ProfileBioSchema.optional(),
    isPrivate: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field.",
  });

export type ProfileRelationship = z.infer<typeof ProfileRelationshipSchema>;
export type UserProfile = z.infer<typeof UserProfileSchema>;
export type OwnProfile = z.infer<typeof OwnProfileSchema>;
export type UpdateOwnProfileRequest = z.infer<
  typeof UpdateOwnProfileRequestSchema
>;

export const usersEndpoints = {
  // {username} is matched case-insensitively.
  profile: { method: "GET", path: "/api/v1/users/{username}", successStatus: 200 },
  ownProfile: { method: "GET", path: "/api/v1/me/profile", successStatus: 200 },
  updateOwnProfile: { method: "PATCH", path: "/api/v1/me/profile", successStatus: 200 },
} as const;
