import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  AuthApiErrorResponseSchema,
  CreatePostFieldsSchema,
  MediaUrlSchema,
  PostResponseSchema,
  UserSummarySchema,
  authErrors,
  imageUploadRules,
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
  image: {
    url: `/api/v1/media/${media}/full`,
    thumbnailUrl: `/api/v1/media/${media}/thumb`,
    width: 1080,
    height: 810,
  },
  createdAt: new Date().toISOString(),
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
  ]) {
    assert.equal(authErrors[code].status, status);
    const body = {
      error: { code, message: authErrors[code].message, requestId: randomUUID() },
    };
    assert.deepEqual(AuthApiErrorResponseSchema.parse(body), body);
  }
});
