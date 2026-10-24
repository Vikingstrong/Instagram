import { z } from "zod";
import { CallPreviewSchema } from "./calls.js";
import { PageCursorSchema, UserSummarySchema } from "./social.js";
import { MediaUrlSchema, profileText } from "./users.js";

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

export const directImageRules = {
  maxBytes: 10 * 1024 * 1024,
  maxFrames: 100,
  maxTotalPixels: 40_000_000,
  formats: ["image/jpeg", "image/png", "image/webp", "image/gif"],
} as const;
export const voiceMessageRules = {
  maxBytes: 10 * 1024 * 1024,
  maxDurationMs: 180_000,
  formats: ["audio/webm", "audio/mp4", "audio/ogg", "audio/wav", "audio/mpeg"],
} as const;
export const SendMediaMessageFieldsSchema = z.strictObject({
  clientMessageId: z.uuid(),
  text: profileText(1000, true).optional().default(""),
});
export const DirectAttachmentSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("image"),
    url: MediaUrlSchema,
    thumbnailUrl: MediaUrlSchema,
    width: z.int().positive(),
    height: z.int().positive(),
  }),
  z.strictObject({
    type: z.literal("voice"),
    opusUrl: MediaUrlSchema.optional(),
    url: MediaUrlSchema,
    durationMs: z.int().positive().max(voiceMessageRules.maxDurationMs),
  }),
]);
export const ShareContentRequestSchema = z.strictObject({
  clientMessageId: z.uuid(),
  kind: z.enum(["post", "reel", "story"]),
  contentId: z.uuid(),
  text: profileText(1000, true).optional().default(""),
});
export const SharedContentSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("unavailable"),
    kind: z.enum(["post", "reel", "story"]),
  }),
  z.strictObject({
    status: z.literal("available"),
    kind: z.enum(["post", "reel", "story"]),
    id: z.uuid(),
    author: UserSummarySchema,
    caption: profileText(2200, true),
    thumbnailUrl: MediaUrlSchema,
    href: z.string().regex(/^\/(?:p|stories)\/[0-9a-f-]{36}$/),
    expiresAt: z.iso.datetime().nullable(),
  }),
]);
export type SharedContent = z.infer<typeof SharedContentSchema>;
export type ShareContentRequest = z.infer<typeof ShareContentRequestSchema>;
export const DirectMessageSchema = z
  .strictObject({
    id: z.uuid(),
    conversationId: z.uuid(),
    senderId: z.uuid(),
    clientMessageId: z.uuid(),
    text: profileText(1000, true),
    attachment: DirectAttachmentSchema.nullable().optional(),
    sharedContent: SharedContentSchema.nullable().optional(),
    createdAt: z.iso.datetime(),
  })
  .refine(
    (value) =>
      value.text.trim().length > 0 ||
      !!value.attachment ||
      !!value.sharedContent,
    {
      message: "Message must contain text or an attachment.",
    },
  );

export const ShareContentResponseSchema = z.strictObject({
  message: DirectMessageSchema,
  shareCount: z.int().nonnegative().nullable(),
});
export const ConversationSchema = z.strictObject({
  id: z.uuid(),
  peer: UserSummarySchema,
  lastMessage: DirectMessageSchema.nullable(),
  lastCall: CallPreviewSchema.nullable().optional(),
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
  share: {
    method: "POST",
    path: "/api/v1/direct/conversations/{id}/messages/share",
    successStatus: 201,
  },
  sendImage: {
    method: "POST",
    path: "/api/v1/direct/conversations/{id}/messages/image",
    successStatus: 201,
  },
  sendVoice: {
    method: "POST",
    path: "/api/v1/direct/conversations/{id}/messages/voice",
    successStatus: 201,
  },
  media: {
    method: "GET",
    path: "/api/v1/direct/conversations/{id}/messages/{messageId}/{variant}",
    successStatus: 200,
  },
  conversations: {
    method: "GET",
    path: "/api/v1/direct/conversations",
    successStatus: 200,
  },
  // Same answer whether the conversation was just created or existed.
  open: {
    method: "POST",
    path: "/api/v1/direct/conversations",
    successStatus: 200,
  },
  conversation: {
    method: "GET",
    path: "/api/v1/direct/conversations/{id}",
    successStatus: 200,
  },
  messages: {
    method: "GET",
    path: "/api/v1/direct/conversations/{id}/messages",
    successStatus: 200,
  },
  // A repeat with the same clientMessageId and text returns the stored
  // message again (also 201); another text with that id is 409.
  send: {
    method: "POST",
    path: "/api/v1/direct/conversations/{id}/messages",
    successStatus: 201,
  },
} as const;
