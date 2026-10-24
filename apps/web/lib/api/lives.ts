import {
  authEndpoints,
  AuthCsrfResponseSchema,
  CallIceConfigSchema,
  JoinLiveResponseSchema,
  LiveAcceptedSchema,
  LiveCommentResponseSchema,
  LiveCommentsResponseSchema,
  LiveGiftsResponseSchema,
  LiveListResponseSchema,
  LiveModeratorListResponseSchema,
  LiveRestrictionListResponseSchema,
  LiveRestrictionResponseSchema,
  LiveResponseSchema,
  LiveSignalsResponseSchema,
  OptionalLiveResponseSchema,
  SendLiveGiftResponseSchema,
  livesEndpoints,
  type CallSignal,
  type CreateLiveCommentRequest,
  type CreateLiveRestrictionRequest,
  type SendLiveGiftRequest,
  type StartLiveRequest,
} from "@instagram/contracts";
import {
  createApiClient,
  type ApiClient,
  type ApiEndpoint,
  type ResponseSchema,
} from "./client";
import { withPath } from "./social";

// FR-12 live streams (stage 10). Mutations fetch a fresh CSRF token each time.
export function createLivesClient(api: ApiClient = createApiClient()) {
  async function mutate<T>(
    endpoint: ApiEndpoint,
    schema: ResponseSchema<T>,
    body: unknown = {},
  ) {
    const csrf = await api.request(authEndpoints.csrf, AuthCsrfResponseSchema);
    if (!csrf.ok) return csrf;
    return api.request(endpoint, schema, {
      body,
      csrfToken: csrf.data.csrfToken,
    });
  }
  const at = (endpoint: ApiEndpoint, id: string) => withPath(endpoint, { id });
  return {
    list: (signal?: AbortSignal) =>
      api.request(livesEndpoints.list, LiveListResponseSchema, { signal }),
    current: () => api.request(livesEndpoints.current, OptionalLiveResponseSchema),
    config: () => api.request(livesEndpoints.config, CallIceConfigSchema),
    byHost: (userId: string, signal?: AbortSignal) =>
      api.request(at(livesEndpoints.byHost, userId), OptionalLiveResponseSchema, {
        signal,
      }),
    get: (id: string) => api.request(at(livesEndpoints.get, id), LiveResponseSchema),
    start: (input: StartLiveRequest) =>
      mutate(livesEndpoints.start, LiveResponseSchema, input),
    end: (id: string) => mutate(at(livesEndpoints.end, id), LiveResponseSchema),
    join: (id: string, clientId: string) =>
      mutate(at(livesEndpoints.join, id), JoinLiveResponseSchema, { clientId }),
    leave: (id: string, clientId: string) =>
      mutate(at(livesEndpoints.leave, id), LiveAcceptedSchema, { clientId }),
    heartbeat: (id: string, clientId: string) =>
      mutate(at(livesEndpoints.heartbeat, id), LiveResponseSchema, { clientId }),
    signals: (id: string, clientId: string, after: number) =>
      api.request(
        withPath(livesEndpoints.signals, { id }, { clientId, after }),
        LiveSignalsResponseSchema,
      ),
    sendSignal: (id: string, clientId: string, peerId: string, signal: CallSignal) =>
      mutate(at(livesEndpoints.sendSignal, id), LiveAcceptedSchema, {
        clientId,
        peerId,
        signal,
      }),
    comments: (id: string, after?: string) =>
      api.request(
        withPath(livesEndpoints.comments, { id }, { after }),
        LiveCommentsResponseSchema,
      ),
    comment: (id: string, input: CreateLiveCommentRequest) =>
      mutate(at(livesEndpoints.comment, id), LiveCommentResponseSchema, input),
    gifts: (id: string, after?: string) =>
      api.request(
        withPath(livesEndpoints.gifts, { id }, { after }),
        LiveGiftsResponseSchema,
      ),
    sendGift: (id: string, input: SendLiveGiftRequest) =>
      mutate(at(livesEndpoints.sendGift, id), SendLiveGiftResponseSchema, input),
    // Moderation of all streams of a host.
    moderators: (hostId: string) =>
      api.request(at(livesEndpoints.moderators, hostId), LiveModeratorListResponseSchema),
    addModerator: (hostId: string, userId: string) =>
      mutate(at(livesEndpoints.addModerator, hostId), LiveModeratorListResponseSchema, {
        userId,
      }),
    removeModerator: (hostId: string, userId: string) =>
      mutate(
        withPath(livesEndpoints.removeModerator, { id: hostId, userId }),
        LiveModeratorListResponseSchema,
      ),
    restrictions: (hostId: string) =>
      api.request(at(livesEndpoints.restrictions, hostId), LiveRestrictionListResponseSchema),
    restrict: (hostId: string, input: CreateLiveRestrictionRequest) =>
      mutate(at(livesEndpoints.restrict, hostId), LiveRestrictionResponseSchema, input),
    unrestrict: (hostId: string, userId: string, kind: "mute" | "ban") =>
      mutate(
        withPath(livesEndpoints.unrestrict, { id: hostId, userId, kind }),
        LiveAcceptedSchema,
      ),
  };
}
export type LivesClient = ReturnType<typeof createLivesClient>;
