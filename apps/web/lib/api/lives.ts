import {
  authEndpoints,
  AuthCsrfResponseSchema,
  CallIceConfigSchema,
  JoinLiveResponseSchema,
  LiveAcceptedSchema,
  LiveCommentResponseSchema,
  LiveCommentsResponseSchema,
  LiveListResponseSchema,
  LiveResponseSchema,
  LiveSignalsResponseSchema,
  OptionalLiveResponseSchema,
  livesEndpoints,
  type CallSignal,
  type CreateLiveCommentRequest,
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
  };
}
export type LivesClient = ReturnType<typeof createLivesClient>;
