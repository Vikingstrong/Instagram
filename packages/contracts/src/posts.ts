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

// P-09 caption: up to 2200 code points, line breaks allowed, may be empty.
export const PostCaptionSchema = profileText(2200, true);

// Multipart text fields next to the image. Unknown fields are rejected.
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

export const PostSchema = z.strictObject({
  id: z.uuid(),
  author: UserSummarySchema,
  caption: PostCaptionSchema,
  image: PostImageSchema,
  createdAt: z.iso.datetime(),
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

export type Post = z.infer<typeof PostSchema>;
export type PostListResponse = z.infer<typeof PostListResponseSchema>;

export const postsEndpoints = {
  // multipart/form-data: image (file) + optional caption.
  create: { method: "POST", path: "/api/v1/posts", successStatus: 201 },
  get: { method: "GET", path: "/api/v1/posts/{id}", successStatus: 200 },
  remove: { method: "DELETE", path: "/api/v1/posts/{id}", successStatus: 200 },
  byUser: { method: "GET", path: "/api/v1/users/{id}/posts", successStatus: 200 },
  // multipart/form-data: image (file).
  setAvatar: { method: "PUT", path: "/api/v1/me/avatar", successStatus: 200 },
  removeAvatar: { method: "DELETE", path: "/api/v1/me/avatar", successStatus: 200 },
  // Binary image/webp; same access rules as the post or profile it belongs to.
  media: { method: "GET", path: "/api/v1/media/{id}/{variant}", successStatus: 200 },
} as const;
