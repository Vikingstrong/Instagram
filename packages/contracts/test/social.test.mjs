import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  AuthApiErrorResponseSchema,
  FollowRequestListResponseSchema,
  FollowResponseSchema,
  PageQuerySchema,
  SuggestionsQuerySchema,
  UserListResponseSchema,
  UserSearchQuerySchema,
  authErrors,
} from "@instagram/contracts";

const card = {
  id: randomUUID(),
  username: "demo_user",
  displayName: "Demo",
  avatarUrl: null,
  isPrivate: false,
};

test("page query parses text limits with defaults and bounds", () => {
  assert.deepEqual(PageQuerySchema.parse({}), { limit: 20 });
  assert.deepEqual(PageQuerySchema.parse({ limit: "50", cursor: "abc_-1" }), {
    limit: 50,
    cursor: "abc_-1",
  });
  for (const query of [
    { limit: "0" },
    { limit: "51" },
    { limit: "1.5" },
    { limit: ["1", "2"] },
    { cursor: "a+b" },
    { cursor: "" },
    { other: "1" },
  ]) {
    assert.equal(PageQuerySchema.safeParse(query).success, false);
  }
  assert.deepEqual(SuggestionsQuerySchema.parse({}), { limit: 5 });
  assert.equal(SuggestionsQuerySchema.safeParse({ limit: "21" }).success, false);
});

test("search query trims, requires text and allows 160 characters", () => {
  assert.equal(UserSearchQuerySchema.parse({ q: "  Demo " }).q, "Demo");
  assert.equal(UserSearchQuerySchema.parse({ q: "x".repeat(160) }).q.length, 160);
  for (const q of ["", "   ", "x".repeat(161), undefined]) {
    assert.equal(UserSearchQuerySchema.safeParse({ q }).success, false);
  }
});

test("lists, requests and follow responses expose only user cards", () => {
  const list = { items: [card], nextCursor: null };
  assert.deepEqual(UserListResponseSchema.parse(list), list);
  assert.equal(
    UserListResponseSchema.safeParse({
      items: [{ ...card, email: "a@example.test" }],
      nextCursor: null,
    }).success,
    false,
  );
  const requests = {
    items: [{ user: card, requestedAt: new Date().toISOString() }],
    nextCursor: "c3RhcnQ",
  };
  assert.deepEqual(FollowRequestListResponseSchema.parse(requests), requests);
  for (const relationship of ["none", "requested", "following"]) {
    assert.equal(FollowResponseSchema.parse({ relationship }).relationship, relationship);
  }
  assert.equal(FollowResponseSchema.safeParse({ relationship: "self" }).success, false);
});

test("social errors use the shared error envelope", () => {
  for (const [code, status] of [
    ["CANNOT_FOLLOW_SELF", 400],
    ["PROFILE_PRIVATE", 403],
    ["FOLLOW_REQUEST_NOT_FOUND", 404],
  ]) {
    assert.equal(authErrors[code].status, status);
    const body = {
      error: { code, message: authErrors[code].message, requestId: randomUUID() },
    };
    assert.deepEqual(AuthApiErrorResponseSchema.parse(body), body);
  }
});
