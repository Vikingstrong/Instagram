import { z } from "zod";
import { AuthUsernameSchema } from "./auth.js";
import { ProfileDisplayNameSchema } from "./users.js";

// Compact user card for lists, search and suggestions. Same visibility as the
// profile summary: private accounts expose these fields too (FR-02).
export const UserSummarySchema = z.strictObject({
  id: z.uuid(),
  username: AuthUsernameSchema,
  displayName: ProfileDisplayNameSchema,
  avatarUrl: z.null(),
  isPrivate: z.boolean(),
});

// Opaque keyset cursor issued by the API; clients only pass it back.
export const PageCursorSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
// Query strings arrive as text; repeated parameters arrive as arrays and fail.
const limit = (max: number, fallback: number) =>
  z
    .string()
    .regex(/^[1-9]\d{0,2}$/)
    .transform(Number)
    .pipe(z.int().min(1).max(max))
    .optional()
    .transform((value) => value ?? fallback);
export const PageQuerySchema = z.strictObject({
  cursor: PageCursorSchema.optional(),
  limit: limit(50, 20),
});
export type PageQuery = z.infer<typeof PageQuerySchema>;

export const UserListResponseSchema = z.strictObject({
  items: z.array(UserSummarySchema),
  nextCursor: PageCursorSchema.nullable(),
});

// Case-insensitive match on username or display name, at most 160 characters.
// Surrounding whitespace is ignored; a blank query is rejected.
export const UserSearchQuerySchema = z.strictObject({
  q: z
    .string()
    .max(160)
    .transform((value) => value.trim())
    .pipe(z.string().min(1)),
  cursor: PageCursorSchema.optional(),
  limit: limit(50, 20),
});
export type UserSearchQuery = z.infer<typeof UserSearchQuerySchema>;

// Random verified accounts the viewer neither follows nor requested.
// An empty list means the UI hides the suggestions panel.
export const SuggestionsQuerySchema = z.strictObject({ limit: limit(20, 5) });
export const SuggestionsResponseSchema = z.strictObject({
  items: z.array(UserSummarySchema),
});

// Mutations carry an empty JSON object, like logout: CSRF checks need JSON.
export const EmptyRequestSchema = z.strictObject({});

// none after unfollow or cancelling a request.
export const FollowResponseSchema = z.strictObject({
  relationship: z.enum(["none", "requested", "following"]),
});

export const FollowRequestSchema = z.strictObject({
  user: UserSummarySchema,
  requestedAt: z.iso.datetime(),
});
export const FollowRequestListResponseSchema = z.strictObject({
  items: z.array(FollowRequestSchema),
  nextCursor: PageCursorSchema.nullable(),
});
export const FollowRequestDecisionResponseSchema = z.strictObject({
  status: z.enum(["accepted", "declined"]),
});
export const RemoveFollowerResponseSchema = z.strictObject({
  status: z.literal("removed"),
});

export type UserSummary = z.infer<typeof UserSummarySchema>;
export type UserListResponse = z.infer<typeof UserListResponseSchema>;
export type FollowRequest = z.infer<typeof FollowRequestSchema>;
export type FollowResponse = z.infer<typeof FollowResponseSchema>;

export const socialEndpoints = {
  follow: { method: "POST", path: "/api/v1/users/{id}/follow", successStatus: 200 },
  unfollow: { method: "DELETE", path: "/api/v1/users/{id}/follow", successStatus: 200 },
  followers: { method: "GET", path: "/api/v1/users/{id}/followers", successStatus: 200 },
  following: { method: "GET", path: "/api/v1/users/{id}/following", successStatus: 200 },
  followRequests: { method: "GET", path: "/api/v1/me/follow-requests", successStatus: 200 },
  acceptRequest: { method: "POST", path: "/api/v1/me/follow-requests/{id}/accept", successStatus: 200 },
  declineRequest: { method: "POST", path: "/api/v1/me/follow-requests/{id}/decline", successStatus: 200 },
  removeFollower: { method: "DELETE", path: "/api/v1/me/followers/{id}", successStatus: 200 },
  suggestions: { method: "GET", path: "/api/v1/me/suggestions", successStatus: 200 },
  search: { method: "GET", path: "/api/v1/search/users", successStatus: 200 },
} as const;
