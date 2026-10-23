import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  StorySchema,
  StoryViewersResponseSchema,
  StoryFeedResponseSchema,
  AuthApiErrorResponseSchema,
  authErrors,
  storyRules,
} from "@instagram/contracts";
const id = randomUUID();
const story = {
  id,
  author: {
    id: randomUUID(),
    username: "story_author",
    displayName: "",
    avatarUrl: null,
    isPrivate: true,
  },
  type: "photo",
  status: "ready",
  image: {
    url: `/api/v1/media/${id}/full`,
    thumbnailUrl: `/api/v1/media/${id}/thumb`,
    width: 800,
    height: 1200,
  },
  video: null,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + storyRules.lifetimeMs).toISOString(),
  viewed: false,
};
test("Stories public DTOs reject internal fields and external media paths", () => {
  assert.deepEqual(StorySchema.parse(story), story);
  assert.equal(StorySchema.safeParse({ ...story, mediaId: id }).success, false);
  assert.equal(
    StorySchema.safeParse({
      ...story,
      image: { ...story.image, url: "https://storage.example/raw" },
    }).success,
    false,
  );
  assert.equal(
    StorySchema.safeParse({ ...story, expiresAt: "tomorrow" }).success,
    false,
  );
  assert.equal(storyRules.lifetimeMs, 86400000);
});
test("Story feed and viewers expose only public user fields and valid pagination", () => {
  assert.equal(
    StoryFeedResponseSchema.safeParse({
      items: [
        { author: story.author, latestAt: story.createdAt, hasUnseen: true },
      ],
      nextCursor: null,
    }).success,
    true,
  );
  assert.equal(
    StoryViewersResponseSchema.safeParse({
      items: [
        {
          user: { ...story.author, email: "private@example.test" },
          viewedAt: story.createdAt,
        },
      ],
      total: 1,
      nextCursor: null,
    }).success,
    false,
  );
  assert.equal(
    StoryViewersResponseSchema.safeParse({
      items: [],
      total: -1,
      nextCursor: null,
    }).success,
    false,
  );
});
test("expired and inaccessible stories share one safe 404 contract", () => {
  assert.equal(authErrors.STORY_NOT_FOUND.status, 404);
  assert.equal(
    AuthApiErrorResponseSchema.safeParse({
      error: {
        code: "STORY_NOT_FOUND",
        message: authErrors.STORY_NOT_FOUND.message,
        requestId: randomUUID(),
      },
    }).success,
    true,
  );
});
