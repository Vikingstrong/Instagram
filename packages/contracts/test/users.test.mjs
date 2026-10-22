import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  AuthApiErrorResponseSchema,
  OwnProfileResponseSchema,
  UpdateOwnProfileRequestSchema,
  UserProfileResponseSchema,
  authErrors,
  usersEndpoints,
} from "@instagram/contracts";

const profile = {
  id: randomUUID(),
  username: "demo_user",
  displayName: "Demo",
  bio: "Line one\nline two",
  avatarUrl: null,
  isPrivate: true,
  counts: { posts: 0, followers: 2, following: 1 },
  relationship: "requested",
};

test("profile summary accepts only the agreed safe fields", () => {
  assert.deepEqual(UserProfileResponseSchema.parse({ profile }), { profile });
  for (const key of ["email", "passwordHash", "posts", "emailVerified"]) {
    assert.equal(
      UserProfileResponseSchema.safeParse({ profile: { ...profile, [key]: 1 } })
        .success,
      false,
    );
  }
  for (const relationship of ["blocked", "pending", ""]) {
    assert.equal(
      UserProfileResponseSchema.safeParse({
        profile: { ...profile, relationship },
      }).success,
      false,
    );
  }
  assert.equal(
    UserProfileResponseSchema.safeParse({
      profile: { ...profile, counts: { ...profile.counts, followers: -1 } },
    }).success,
    false,
  );
});

test("own profile excludes counters and relationship", () => {
  const own = {
    id: profile.id,
    username: profile.username,
    displayName: "",
    bio: "",
    isPrivate: false,
  };
  assert.deepEqual(OwnProfileResponseSchema.parse({ profile: own }), {
    profile: own,
  });
  assert.equal(
    OwnProfileResponseSchema.safeParse({
      profile: { ...own, relationship: "self" },
    }).success,
    false,
  );
});

test("profile update is partial, strict and counts code points", () => {
  for (const body of [
    { bio: "" },
    { isPrivate: true },
    { username: "New.Name_1" },
    { displayName: "🙂".repeat(30) },
    { bio: `${"б".repeat(149)}\n` },
  ]) {
    assert.deepEqual(UpdateOwnProfileRequestSchema.parse(body), body);
  }
  for (const body of [
    {},
    { displayName: "🙂".repeat(31) },
    { bio: "b".repeat(151) },
    { displayName: "two\nlines" },
    { bio: "tab\there" },
    { bio: "\ud800" },
    { username: "ab" },
    { isPrivate: "true" },
    { id: profile.id },
    null,
  ]) {
    assert.equal(UpdateOwnProfileRequestSchema.safeParse(body).success, false);
  }
});

test("profile errors use the shared error envelope", () => {
  for (const code of ["USER_NOT_FOUND", "USERNAME_TAKEN"]) {
    const body = {
      error: { code, message: authErrors[code].message, requestId: randomUUID() },
    };
    assert.deepEqual(AuthApiErrorResponseSchema.parse(body), body);
  }
  assert.equal(authErrors.USER_NOT_FOUND.status, 404);
  assert.equal(authErrors.USERNAME_TAKEN.status, 409);
  assert.equal(usersEndpoints.updateOwnProfile.method, "PATCH");
});
