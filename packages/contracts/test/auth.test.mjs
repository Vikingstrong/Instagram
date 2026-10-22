import assert from "node:assert/strict";
import test from "node:test";
import {
  AuthEmailSchema,
  AuthLoginRequestSchema,
  AuthPasswordSchema,
  AuthRegisterRequestSchema,
  AuthUsernameSchema,
} from "@instagram/contracts";

// Public synthetic values; never use a real account or credential in fixtures.
const registration = {
  email: "auth-contract@example.test",
  username: "Test_User.1",
  password: "example password for tests",
};

test("auth requests preserve input and reject client-supplied privileges", () => {
  assert.deepEqual(AuthRegisterRequestSchema.parse(registration), registration);
  const login = { email: registration.email, password: registration.password };
  assert.deepEqual(AuthLoginRequestSchema.parse(login), login);
  for (const key of ["id", "emailVerified", "role", "passwordHash"]) {
    assert.equal(
      AuthRegisterRequestSchema.safeParse({ ...registration, [key]: true })
        .success,
      false,
    );
    assert.equal(
      AuthLoginRequestSchema.safeParse({ ...login, [key]: true }).success,
      false,
    );
  }
  for (const value of [null, {}, [], { ...registration, password: 123 }]) {
    assert.equal(AuthRegisterRequestSchema.safeParse(value).success, false);
  }
});

test("username accepts the agreed alphabet and enforces exact boundaries", () => {
  for (const value of ["abc", "A_1", "a.b", "a".repeat(30)]) {
    assert.equal(AuthUsernameSchema.parse(value), value);
  }
  for (const value of [
    "ab",
    "a".repeat(31),
    "имя",
    "user-name",
    " user ",
    "abc\n",
  ]) {
    assert.equal(AuthUsernameSchema.safeParse(value).success, false);
  }
});

test("email rejects malformed, padded and oversized input", () => {
  const atLimit = `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(61)}`;
  assert.equal(atLimit.length, 254);
  assert.equal(AuthEmailSchema.parse(atLimit), atLimit);
  for (const value of [
    "not-email",
    "a@",
    " user@example.test",
    "a@b.test\n",
    `${atLimit}a`,
  ]) {
    assert.equal(AuthEmailSchema.safeParse(value).success, false);
  }
});

test("password counts Unicode code points at both boundaries", () => {
  for (const value of [
    "x".repeat(12),
    "x".repeat(128),
    "🔐".repeat(12),
    "🔐".repeat(128),
  ]) {
    assert.equal(AuthPasswordSchema.parse(value), value);
  }
  for (const value of [
    "x".repeat(11),
    "x".repeat(129),
    "🔐".repeat(6),
    "🔐".repeat(129),
  ]) {
    assert.equal(AuthPasswordSchema.safeParse(value).success, false);
  }
});

test("password preserves spaces and Unicode representation and rejects lone surrogates", () => {
  for (const value of [
    "  word with spaces  ",
    " ".repeat(12),
    "é".repeat(12),
    "e\u0301".repeat(12),
  ]) {
    assert.equal(AuthPasswordSchema.parse(value), value);
  }
  for (const value of ["x".repeat(12) + "\ud800", "\udc00" + "x".repeat(12)]) {
    assert.equal(AuthPasswordSchema.safeParse(value).success, false);
  }
});
