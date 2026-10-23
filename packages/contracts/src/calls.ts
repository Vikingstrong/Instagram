import { z } from "zod";
import { UserSummarySchema, PageCursorSchema } from "./social.js";
export const CallKindSchema = z.enum(["AUDIO", "VIDEO"]);
export const CallStatusSchema = z.enum(["RINGING", "ACTIVE", "ENDED", "DECLINED", "MISSED", "FAILED"]);
export const CallSchema = z.strictObject({
  id: z.uuid(), conversationId: z.uuid(), callerId: z.uuid(), peer: UserSummarySchema,
  kind: CallKindSchema, status: CallStatusSchema, createdAt: z.iso.datetime(),
  answeredAt: z.iso.datetime().nullable(), endedAt: z.iso.datetime().nullable(),
});
export const CallPreviewSchema = CallSchema.pick({ id: true, kind: true, status: true, callerId: true, createdAt: true, endedAt: true });
export const CallResponseSchema = z.strictObject({ call: CallSchema });
export const CurrentCallResponseSchema = z.strictObject({ call: CallSchema.nullable() });
export const CallHistoryResponseSchema = z.strictObject({ items: z.array(CallSchema), nextCursor: PageCursorSchema.nullable() });
export const StartCallRequestSchema = z.strictObject({ id: z.uuid(), conversationId: z.uuid(), kind: CallKindSchema, clientId: z.uuid() });
export const CallOwnerRequestSchema = z.strictObject({ clientId: z.uuid() });
export const CallActionRequestSchema = z.strictObject({ action: z.enum(["accept", "decline", "end", "fail"]), clientId: z.uuid() });
export const CallSignalSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("offer"), sdp: z.string().min(1).max(48000) }),
  z.strictObject({ type: z.literal("answer"), sdp: z.string().min(1).max(48000) }),
  z.strictObject({ type: z.literal("ice"), candidate: z.strictObject({ candidate: z.string().max(4096), sdpMid: z.string().max(256).nullable(), sdpMLineIndex: z.int().min(0).max(255).nullable(), usernameFragment: z.string().max(256).nullable().optional() }) }),
]);
export const SendCallSignalRequestSchema = z.strictObject({ clientId: z.uuid(), signal: CallSignalSchema });
export const CallSignalsQuerySchema = z.strictObject({ clientId: z.uuid(), after: z.coerce.number().int().nonnegative().default(0) });
export const CallSignalsResponseSchema = z.strictObject({ items: z.array(z.strictObject({ sequence: z.int().positive(), signal: CallSignalSchema })), next: z.int().nonnegative() });
export const CallNoticeSchema = z.strictObject({ callId: z.uuid() });
export const CallSignalAcceptedSchema = z.strictObject({ status: z.literal("accepted") });
export const CallIceConfigSchema = z.strictObject({ iceServers: z.array(z.strictObject({ urls: z.array(z.string()), username: z.string().optional(), credential: z.string().optional() })) });
export type Call = z.infer<typeof CallSchema>;
export type CallSignal = z.infer<typeof CallSignalSchema>;
export type StartCallRequest = z.infer<typeof StartCallRequestSchema>;
export type CallActionRequest = z.infer<typeof CallActionRequestSchema>;
export const callsEndpoints = {
  get: { method: "GET", path: "/api/v1/calls/{id}", successStatus: 200 },
  current: { method: "GET", path: "/api/v1/calls/current", successStatus: 200 },
  config: { method: "GET", path: "/api/v1/calls/config", successStatus: 200 },
  start: { method: "POST", path: "/api/v1/calls", successStatus: 201 },
  action: { method: "POST", path: "/api/v1/calls/{id}/action", successStatus: 200 },
  heartbeat: { method: "POST", path: "/api/v1/calls/{id}/heartbeat", successStatus: 200 },
  signals: { method: "GET", path: "/api/v1/calls/{id}/signals", successStatus: 200 },
  sendSignal: { method: "POST", path: "/api/v1/calls/{id}/signals", successStatus: 200 },
  history: { method: "GET", path: "/api/v1/calls/history/{id}", successStatus: 200 },
} as const;
