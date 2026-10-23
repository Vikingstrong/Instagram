import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  AuthApiErrorResponseSchema,
  CommentListResponseSchema,
  CreateCommentRequestSchema,
  CreatePostFieldsSchema,
  LikeResponseSchema,
  MediaUrlSchema,
  PostResponseSchema,
  PostSchema,
  UserSummarySchema,
  authErrors,
  imageUploadRules,
  videoUploadRules,
} from "@instagram/contracts";

const media = randomUUID();
const post = {
  id: randomUUID(),
  author: {
    id: randomUUID(),
    username: "demo_user",
    displayName: "",
    avatarUrl: `/api/v1/media/${randomUUID()}/thumb`,
    isPrivate: false,
  },
  caption: "Закат\nна море",
  type: "photo",
  video: null,
  status: "ready",
  image: {
    url: `/api/v1/media/${media}/full`,
    thumbnailUrl: `/api/v1/media/${media}/thumb`,
    width: 1080,
    height: 810,
  },
  createdAt: new Date().toISOString(),
  likeCount: 3,
  commentCount: 1,
  liked: true,
};

test("posts expose only API image paths, never storage locations", () => {
  assert.deepEqual(PostResponseSchema.parse({ post }), { post });
  for (const url of [
    "https://bucket.example/photo.webp",
    `/api/v1/media/${media}/raw`,
    `/api/v1/media/${media}/full?x=1`,
    `/media/${media}/full`,
    "/api/v1/media/../full",
  ]) {
    assert.equal(MediaUrlSchema.safeParse(url).success, false);
  }
  assert.equal(
    PostResponseSchema.safeParse({ post: { ...post, mediaId: media } }).success,
    false,
  );
  assert.equal(
    UserSummarySchema.safeParse({ ...post.author, avatarUrl: null }).success,
    true,
  );
});

test("caption fields are optional, strict and limited to 2200 code points", () => {
  assert.deepEqual(CreatePostFieldsSchema.parse({}), { caption: "" });
  assert.equal(
    CreatePostFieldsSchema.parse({ caption: "🙂".repeat(2200) }).caption.length,
    4400,
  );
  for (const fields of [
    { caption: "x".repeat(2201) },
    { caption: "tab\t" },
    { authorId: randomUUID() },
  ]) {
    assert.equal(CreatePostFieldsSchema.safeParse(fields).success, false);
  }
});

test("upload rules and media errors match the agreed limits", () => {
  assert.equal(imageUploadRules.maxBytes, 10 * 1024 * 1024);
  assert.deepEqual(imageUploadRules.formats, ["image/jpeg", "image/png", "image/webp"]);
  for (const [code, status] of [
    ["INVALID_IMAGE", 400],
    ["IMAGE_TOO_LARGE", 413],
    ["POST_NOT_FOUND", 404],
    ["MEDIA_NOT_FOUND", 404],
    ["INVALID_VIDEO", 400],
    ["VIDEO_TOO_LARGE", 413],
    ["VIDEO_TOO_LONG", 400],
    ["COMMENT_NOT_FOUND", 404],
    ["CANNOT_DELETE_COMMENT", 403],
  ]) {
    assert.equal(authErrors[code].status, status);
    const body = {
      error: { code, message: authErrors[code].message, requestId: randomUUID() },
    };
    assert.deepEqual(AuthApiErrorResponseSchema.parse(body), body);
  }
});

test("comments are 1–2200 code points and never blank", () => {
  assert.deepEqual(CreateCommentRequestSchema.parse({ text: "Класс\nфото" }), {
    text: "Класс\nфото",
  });
  assert.equal(CreateCommentRequestSchema.safeParse({ text: "🙂".repeat(2200) }).success, true);
  for (const body of [
    { text: "" },
    { text: "  \n " },
    { text: "x".repeat(2201) },
    { text: "tab\t" },
    { text: "ok", authorId: randomUUID() },
  ])
    assert.equal(CreateCommentRequestSchema.safeParse(body).success, false);
});

test("comment lists carry delete rights; likes report the resulting state", () => {
  const comment = {
    id: randomUUID(),
    postId: post.id,
    author: post.author,
    text: "Красиво",
    createdAt: new Date().toISOString(),
    canDelete: false,
  };
  const page = { items: [comment], nextCursor: null };
  assert.deepEqual(CommentListResponseSchema.parse(page), page);
  assert.equal(
    CommentListResponseSchema.safeParse({ items: [{ ...comment, canDelete: undefined }], nextCursor: null }).success,
    false,
  );
  assert.deepEqual(LikeResponseSchema.parse({ liked: true, likeCount: 1 }), { liked: true, likeCount: 1 });
  assert.equal(LikeResponseSchema.safeParse({ liked: true, likeCount: -1 }).success, false);
});

test("video posts carry a poster, a served video and a processing status", () => {
  const clip = randomUUID();
  const video = {
    ...post,
    type: "video",
    image: {
      ...post.image,
      url: `/api/v1/media/${clip}/full`,
      thumbnailUrl: `/api/v1/media/${clip}/thumb`,
    },
    video: { url: `/api/v1/media/${clip}/video`, durationMs: 12_500 },
  };
  assert.deepEqual(PostSchema.parse(video), video);
  assert.equal(
    PostSchema.parse({ ...video, video: null, status: "processing" }).status,
    "processing",
  );
  for (const invalid of [
    { ...video, status: "uploading" },
    { ...video, type: "reel" },
    { ...video, video: { url: `/api/v1/media/${clip}/raw`, durationMs: 1 } },
    { ...video, video: { url: `/api/v1/media/${clip}/video`, durationMs: 0 } },
  ])
    assert.equal(PostSchema.safeParse(invalid).success, false);
  assert.equal(videoUploadRules.maxBytes, 100 * 1024 * 1024);
  assert.equal(videoUploadRules.maxDurationMs, 90_000);
  assert.deepEqual(videoUploadRules.formats, [
    "video/mp4",
    "video/quicktime",
    "video/webm",
  ]);
});
