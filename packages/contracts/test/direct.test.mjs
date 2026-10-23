import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  AuthApiErrorResponseSchema,
  ConversationListResponseSchema,
  DirectMessageListResponseSchema,
  OpenConversationRequestSchema,
  SendMessageRequestSchema,
  authErrors,
  directEndpoints,
} from "@instagram/contracts";

const peer = {
  id: randomUUID(),
  username: "peer_user",
  displayName: "",
  avatarUrl: null,
  isPrivate: true,
};
const message = {
  id: randomUUID(),
  conversationId: randomUUID(),
  senderId: peer.id,
  clientMessageId: randomUUID(),
  text: "Привет\nкак дела?",
  createdAt: new Date().toISOString(),
};

test("messages need a client id and 1–1000 non-blank characters", () => {
  const body = { clientMessageId: randomUUID(), text: "🙂".repeat(1000) };
  assert.deepEqual(SendMessageRequestSchema.parse(body), body);
  for (const invalid of [
    { clientMessageId: randomUUID(), text: "" },
    { clientMessageId: randomUUID(), text: " \n " },
    { clientMessageId: randomUUID(), text: "x".repeat(1001) },
    { clientMessageId: "1", text: "hi" },
    { text: "hi" },
    { clientMessageId: randomUUID(), text: "hi", senderId: randomUUID() },
  ])
    assert.equal(SendMessageRequestSchema.safeParse(invalid).success, false);
  assert.equal(OpenConversationRequestSchema.safeParse({ userId: "me" }).success, false);
});

test("conversations carry the peer card and the last message", () => {
  const page = {
    items: [
      { id: message.conversationId, peer, lastMessage: message, lastActivityAt: message.createdAt },
      { id: randomUUID(), peer, lastMessage: null, lastActivityAt: message.createdAt },
    ],
    nextCursor: null,
  };
  assert.deepEqual(ConversationListResponseSchema.parse(page), page);
  assert.deepEqual(
    DirectMessageListResponseSchema.parse({ items: [message], nextCursor: "b2xkZXI" }),
    { items: [message], nextCursor: "b2xkZXI" },
  );
  assert.equal(directEndpoints.send.successStatus, 201);
});

test("Direct errors match the agreed statuses", () => {
  for (const [code, status] of [
    ["CONVERSATION_NOT_FOUND", 404],
    ["CANNOT_MESSAGE_SELF", 400],
    ["MESSAGE_ID_CONFLICT", 409],
  ]) {
    assert.equal(authErrors[code].status, status);
    const body = { error: { code, message: authErrors[code].message, requestId: randomUUID() } };
    assert.deepEqual(AuthApiErrorResponseSchema.parse(body), body);
  }
});
