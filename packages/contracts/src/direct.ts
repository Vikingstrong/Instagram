import { z } from "zod";
import { PageCursorSchema, UserSummarySchema } from "./social.js";
import { profileText } from "./users.js";

// FR-09 Direct over REST (stage 6): one-to-one text conversations. Any
// verified user may write to any other, regardless of follows or privacy.

// P-09 message: 1–1000 code points, line breaks allowed, not only spaces.
export const DirectMessageTextSchema = profileText(1000, true).refine(
  (value) => value.trim().length > 0,
  { message: "Message must not be empty." },
);

// Opens the conversation with a user, creating it on first use. Repeats and
// races return the same conversation (one per pair of users).
export const OpenConversationRequestSchema = z.strictObject({
  userId: z.uuid(),
});

// The client generates clientMessageId once per message and reuses it for
// every retry, so a lost response never creates a duplicate.
export const SendMessageRequestSchema = z.strictObject({
  clientMessageId: z.uuid(),
  text: DirectMessageTextSchema,
});

export const DirectMessageSchema = z.strictObject({
  id: z.uuid(),
  conversationId: z.uuid(),
  senderId: z.uuid(),
  clientMessageId: z.uuid(),
  text: DirectMessageTextSchema,
  createdAt: z.iso.datetime(),
});

export const ConversationSchema = z.strictObject({
  id: z.uuid(),
  peer: UserSummarySchema,
  lastMessage: DirectMessageSchema.nullable(),
  // Time of the last message, or of creation while there is none.
  lastActivityAt: z.iso.datetime(),
});

export const ConversationResponseSchema = z.strictObject({
  conversation: ConversationSchema,
});
export const ConversationListResponseSchema = z.strictObject({
  items: z.array(ConversationSchema),
  nextCursor: PageCursorSchema.nullable(),
});
export const DirectMessageResponseSchema = z.strictObject({
  message: DirectMessageSchema,
});
// History pages go from newest to oldest; nextCursor reads older messages.
export const DirectMessageListResponseSchema = z.strictObject({
  items: z.array(DirectMessageSchema),
  nextCursor: PageCursorSchema.nullable(),
});

export type DirectMessage = z.infer<typeof DirectMessageSchema>;
export type Conversation = z.infer<typeof ConversationSchema>;
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;

export const directEndpoints = {
  conversations: { method: "GET", path: "/api/v1/direct/conversations", successStatus: 200 },
  // Same answer whether the conversation was just created or existed.
  open: { method: "POST", path: "/api/v1/direct/conversations", successStatus: 200 },
  conversation: { method: "GET", path: "/api/v1/direct/conversations/{id}", successStatus: 200 },
  messages: { method: "GET", path: "/api/v1/direct/conversations/{id}/messages", successStatus: 200 },
  // A repeat with the same clientMessageId and text returns the stored
  // message again (also 201); another text with that id is 409.
  send: { method: "POST", path: "/api/v1/direct/conversations/{id}/messages", successStatus: 201 },
} as const;
