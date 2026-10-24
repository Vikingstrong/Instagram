import { z } from "zod";
import { UserSummarySchema, PageCursorSchema } from "./social.js";
import { PostImageSchema, PostVideoSchema } from "./posts.js";

// P-16: existing photo/video limits; 24h from creation, no archive/highlights.
export const storyRules = {
  lifetimeMs: 24 * 60 * 60 * 1000,
  photoDurationMs: 5000,
} as const;
export const StorySchema = z.strictObject({
  id: z.uuid(),
  author: UserSummarySchema,
  type: z.enum(["photo", "video"]),
  status: z.enum(["ready", "processing", "failed"]),
  image: PostImageSchema,
  video: PostVideoSchema.nullable(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  viewed: z.boolean(),
  shareCount: z.int().nonnegative().optional(),
});
export const StoryResponseSchema = z.strictObject({ story: StorySchema });
export const StoryListResponseSchema = z.strictObject({
  items: z.array(StorySchema),
  nextCursor: PageCursorSchema.nullable(),
});
export const StoryGroupSchema = z.strictObject({
  author: UserSummarySchema,
  latestAt: z.iso.datetime(),
  hasUnseen: z.boolean(),
});
export const StoryFeedResponseSchema = z.strictObject({
  items: z.array(StoryGroupSchema),
  nextCursor: PageCursorSchema.nullable(),
});
export const StoryViewersResponseSchema = z.strictObject({
  items: z.array(
    z.strictObject({ user: UserSummarySchema, viewedAt: z.iso.datetime() }),
  ),
  total: z.int().nonnegative(),
  nextCursor: PageCursorSchema.nullable(),
});
export const StoryViewedResponseSchema = z.strictObject({
  status: z.literal("viewed"),
});
export const DeleteStoryResponseSchema = z.strictObject({
  status: z.literal("deleted"),
});
export type Story = z.infer<typeof StorySchema>;
export type StoryGroup = z.infer<typeof StoryGroupSchema>;
export type StoryViewers = z.infer<typeof StoryViewersResponseSchema>;
export const storiesEndpoints = {
  create: { method: "POST", path: "/api/v1/stories", successStatus: 201 },
  createVideo: {
    method: "POST",
    path: "/api/v1/stories/video",
    successStatus: 201,
  },
  feed: { method: "GET", path: "/api/v1/stories/feed", successStatus: 200 },
  get: { method: "GET", path: "/api/v1/stories/{id}", successStatus: 200 },
  byUser: {
    method: "GET",
    path: "/api/v1/users/{id}/stories",
    successStatus: 200,
  },
  view: {
    method: "POST",
    path: "/api/v1/stories/{id}/views",
    successStatus: 200,
  },
  viewers: {
    method: "GET",
    path: "/api/v1/stories/{id}/viewers",
    successStatus: 200,
  },
  remove: {
    method: "DELETE",
    path: "/api/v1/stories/{id}",
    successStatus: 200,
  },
} as const;
