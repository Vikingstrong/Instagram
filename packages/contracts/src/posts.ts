import { z } from "zod";
import { UserSummarySchema, PageCursorSchema } from "./social.js";
import { MediaUrlSchema, profileText } from "./users.js";

// Upload rules shared by the form and the API (FR-04). The API checks the
// decoded content, not the file name or the browser's declared type.
export const imageUploadRules = {
  maxBytes: 10 * 1024 * 1024,
  formats: ["image/jpeg", "image/png", "image/webp"],
  maxPixels: 40_000_000,
  multipartField: "image",
} as const;

// Video posts (FR-10, P-12). The API probes the content, transcodes it to
// H.264/AAC MP4 and makes a poster; name and declared type are not trusted.
export const videoUploadRules = {
  maxBytes: 100 * 1024 * 1024,
  maxDurationMs: 90_000,
  maxDimension: 4096,
  formats: ["video/mp4", "video/quicktime", "video/webm"],
  multipartField: "video",
} as const;

// P-09 caption: up to 2200 code points, line breaks allowed, may be empty.
export const PostCaptionSchema = profileText(2200, true);

// Multipart text fields next to the image or video. Unknown fields are
// rejected.
export const CreatePostFieldsSchema = z.strictObject({
  caption: PostCaptionSchema.optional().transform((value) => value ?? ""),
});

// Prepared variants: "full" fits 1080×1350, "thumb" is a 480×480 square crop.
export const PostImageSchema = z.strictObject({
  url: MediaUrlSchema,
  thumbnailUrl: MediaUrlSchema,
  width: z.int().positive(),
  height: z.int().positive(),
});

// The transcoded MP4, served with Range support after an access check.
export const PostVideoSchema = z.strictObject({
  url: MediaUrlSchema,
  durationMs: z.int().positive(),
});

export const PostSchema = z.strictObject({
  id: z.uuid(),
  author: UserSummarySchema,
  caption: PostCaptionSchema,
  // A video post's image is its poster, so grids show every post the same.
  type: z.enum(["photo", "video"]),
  image: PostImageSchema,
  video: PostVideoSchema.nullable(),
  // Only the author ever sees a post that is not "ready": a video still
  // being processed, or one whose processing failed.
  status: z.enum(["ready", "processing", "failed"]),
  createdAt: z.iso.datetime(),
  // FR-06: counters and the viewer's own like, read with the post.
  likeCount: z.int().nonnegative(),
  commentCount: z.int().nonnegative(),
  liked: z.boolean(),
});
export const PostResponseSchema = z.strictObject({ post: PostSchema });
export const PostListResponseSchema = z.strictObject({
  items: z.array(PostSchema),
  nextCursor: PageCursorSchema.nullable(),
});
export const DeletePostResponseSchema = z.strictObject({
  status: z.literal("deleted"),
});
export const AvatarResponseSchema = z.strictObject({
  avatarUrl: MediaUrlSchema.nullable(),
});

// Like and unlike are idempotent and answer with the resulting state.
export const LikeResponseSchema = z.strictObject({
  liked: z.boolean(),
  likeCount: z.int().nonnegative(),
});

// P-09 comment: 1–2200 code points, line breaks allowed, not only spaces.
export const CommentTextSchema = profileText(2200, true).refine(
  (value) => value.trim().length > 0,
  { message: "Comment must not be empty." },
);
export const CreateCommentRequestSchema = z.strictObject({
  text: CommentTextSchema,
});
export const CommentSchema = z.strictObject({
  id: z.uuid(),
  postId: z.uuid(),
  author: UserSummarySchema,
  text: CommentTextSchema,
  createdAt: z.iso.datetime(),
  // Comment author or post author (FR-06).
  canDelete: z.boolean(),
});
export const CommentResponseSchema = z.strictObject({ comment: CommentSchema });
export const CommentListResponseSchema = z.strictObject({
  items: z.array(CommentSchema),
  nextCursor: PageCursorSchema.nullable(),
});
export const DeleteCommentResponseSchema = z.strictObject({
  status: z.literal("deleted"),
});

export type Post = z.infer<typeof PostSchema>;
export type PostVideo = z.infer<typeof PostVideoSchema>;
export type Comment = z.infer<typeof CommentSchema>;
export type LikeResponse = z.infer<typeof LikeResponseSchema>;
export type PostListResponse = z.infer<typeof PostListResponseSchema>;

export const postsEndpoints = {
  // multipart/form-data: image or video (file) + optional caption. A video
  // post answers with status "processing" until the server has prepared it.
  create: { method: "POST", path: "/api/v1/posts", successStatus: 201 },
  get: { method: "GET", path: "/api/v1/posts/{id}", successStatus: 200 },
  remove: { method: "DELETE", path: "/api/v1/posts/{id}", successStatus: 200 },
  byUser: { method: "GET", path: "/api/v1/users/{id}/posts", successStatus: 200 },
  // multipart/form-data: image (file).
  setAvatar: { method: "PUT", path: "/api/v1/me/avatar", successStatus: 200 },
  removeAvatar: { method: "DELETE", path: "/api/v1/me/avatar", successStatus: 200 },
  // FR-10: video posts the viewer may see, newest first, no ranking.
  reels: { method: "GET", path: "/api/v1/reels", successStatus: 200 },
  // FR-05: own posts and approved followings, newest first.
  feed: { method: "GET", path: "/api/v1/feed", successStatus: 200 },
  like: { method: "PUT", path: "/api/v1/posts/{id}/like", successStatus: 200 },
  unlike: { method: "DELETE", path: "/api/v1/posts/{id}/like", successStatus: 200 },
  // Oldest first, like a conversation under the post.
  comments: { method: "GET", path: "/api/v1/posts/{id}/comments", successStatus: 200 },
  addComment: { method: "POST", path: "/api/v1/posts/{id}/comments", successStatus: 201 },
  removeComment: { method: "DELETE", path: "/api/v1/comments/{id}", successStatus: 200 },
  // Binary image/webp; same access rules as the post or profile it belongs to.
  media: { method: "GET", path: "/api/v1/media/{id}/{variant}", successStatus: 200 },
} as const;
