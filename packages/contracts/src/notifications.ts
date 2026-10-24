import { z } from "zod";
import { PageCursorSchema, UserSummarySchema } from "./social.js";

export const NotificationSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(["POST_LIKE", "COMMENT", "REPLY", "COMMENT_LIKE"]),
  actor: UserSummarySchema,
  postId: z.uuid(),
  commentId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});
export const NotificationListResponseSchema = z.strictObject({
  items: z.array(NotificationSchema),
  nextCursor: PageCursorSchema.nullable(),
});
export type Notification = z.infer<typeof NotificationSchema>;

export const notificationsEndpoints = {
  list: { method: "GET", path: "/api/v1/me/notifications", successStatus: 200 },
} as const;
