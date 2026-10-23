import { z } from "zod";
import { UserSummarySchema, PageCursorSchema } from "./social.js";
import { profileText } from "./users.js";
import { CallSignalSchema } from "./calls.js";

// FR-12 live streams (stage 10, P-15 proposal): the host's browser sends
// WebRTC media to each viewer; the API only authorizes, relays signals and
// keeps the chat. Who may watch and chat follows the author's posts.
export const liveRules = {
  maxViewers: 10,
  maxDurationMinutes: 60,
  commentMaxLength: 300,
} as const;

export const LiveStatusSchema = z.enum(["LIVE", "ENDED"]);
export const LiveSchema = z.strictObject({
  id: z.uuid(),
  host: UserSummarySchema,
  status: LiveStatusSchema,
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  viewerCount: z.int().nonnegative(),
});
export const LiveResponseSchema = z.strictObject({ live: LiveSchema });
export const OptionalLiveResponseSchema = z.strictObject({ live: LiveSchema.nullable() });
export const LiveListResponseSchema = z.strictObject({ items: z.array(LiveSchema) });
export const StartLiveRequestSchema = z.strictObject({ id: z.uuid(), clientId: z.uuid() });
// The tab's random device id. It binds a host or viewer connection to one
// tab of one session; it is never an authorization by itself.
export const LiveDeviceRequestSchema = z.strictObject({ clientId: z.uuid() });
export const JoinLiveResponseSchema = z.strictObject({ live: LiveSchema, peerId: z.uuid() });

// Signals reuse the call SDP/ICE shapes and limits. A viewer sends offer and
// ICE to the host; the host answers each viewer peer.
export const SendLiveSignalRequestSchema = z.strictObject({
  clientId: z.uuid(),
  peerId: z.uuid(),
  signal: CallSignalSchema,
});
export const LiveSignalsQuerySchema = z.strictObject({
  clientId: z.uuid(),
  after: z.coerce.number().int().nonnegative().default(0),
});
export const LivePeerSchema = z.strictObject({ peerId: z.uuid(), user: UserSummarySchema });
// peers: the connected viewers, only for the host.
export const LiveSignalsResponseSchema = z.strictObject({
  items: z.array(
    z.strictObject({ sequence: z.int().positive(), peerId: z.uuid(), signal: CallSignalSchema }),
  ),
  peers: z.array(LivePeerSchema),
  next: z.int().nonnegative(),
});
export const LiveAcceptedSchema = z.strictObject({ status: z.literal("accepted") });

// Chat line: 1–300 code points on one line, not only spaces.
export const LiveCommentTextSchema = profileText(liveRules.commentMaxLength, false).refine(
  (value) => value.trim().length > 0,
  { message: "Comment must not be empty." },
);
export const CreateLiveCommentRequestSchema = z.strictObject({
  id: z.uuid(),
  text: LiveCommentTextSchema,
});
export const LiveCommentSchema = z.strictObject({
  id: z.uuid(),
  author: UserSummarySchema,
  text: z.string(),
  createdAt: z.iso.datetime(),
});
export const LiveCommentResponseSchema = z.strictObject({ comment: LiveCommentSchema });
// Without after: the latest messages; with it: the ones that came later.
export const LiveCommentsQuerySchema = z.strictObject({ after: PageCursorSchema.optional() });
export const LiveCommentsResponseSchema = z.strictObject({
  items: z.array(LiveCommentSchema),
  next: PageCursorSchema.nullable(),
});
// SSE "live" event: ids only, the state is read over REST.
export const LiveNoticeSchema = z.strictObject({ liveId: z.uuid() });

export type Live = z.infer<typeof LiveSchema>;
export type LivePeer = z.infer<typeof LivePeerSchema>;
export type LiveComment = z.infer<typeof LiveCommentSchema>;
export type StartLiveRequest = z.infer<typeof StartLiveRequestSchema>;
export type CreateLiveCommentRequest = z.infer<typeof CreateLiveCommentRequestSchema>;

export const livesEndpoints = {
  list: { method: "GET", path: "/api/v1/lives", successStatus: 200 },
  current: { method: "GET", path: "/api/v1/lives/current", successStatus: 200 },
  config: { method: "GET", path: "/api/v1/lives/config", successStatus: 200 },
  byHost: { method: "GET", path: "/api/v1/lives/host/{id}", successStatus: 200 },
  start: { method: "POST", path: "/api/v1/lives", successStatus: 201 },
  get: { method: "GET", path: "/api/v1/lives/{id}", successStatus: 200 },
  end: { method: "POST", path: "/api/v1/lives/{id}/end", successStatus: 200 },
  join: { method: "POST", path: "/api/v1/lives/{id}/join", successStatus: 200 },
  leave: { method: "POST", path: "/api/v1/lives/{id}/leave", successStatus: 200 },
  heartbeat: { method: "POST", path: "/api/v1/lives/{id}/heartbeat", successStatus: 200 },
  signals: { method: "GET", path: "/api/v1/lives/{id}/signals", successStatus: 200 },
  sendSignal: { method: "POST", path: "/api/v1/lives/{id}/signals", successStatus: 200 },
  comments: { method: "GET", path: "/api/v1/lives/{id}/comments", successStatus: 200 },
  comment: { method: "POST", path: "/api/v1/lives/{id}/comments", successStatus: 201 },
} as const;
