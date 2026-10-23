import {
  authEndpoints,
  AuthCsrfResponseSchema,
  CallResponseSchema,
  CurrentCallResponseSchema,
  CallHistoryResponseSchema,
  CallIceConfigSchema,
  CallSignalsResponseSchema,
  CallSignalAcceptedSchema,
  callsEndpoints,
  type StartCallRequest,
  type CallActionRequest,
  type CallSignal,
} from "@instagram/contracts";
import {
  createApiClient,
  type ApiClient,
  type ApiEndpoint,
  type ResponseSchema,
} from "./client";
import { withPath } from "./social";
export function createCallsClient(api: ApiClient = createApiClient()) {
  async function mutate<T>(
    endpoint: ApiEndpoint,
    schema: ResponseSchema<T>,
    body: unknown,
  ) {
    const csrf = await api.request(authEndpoints.csrf, AuthCsrfResponseSchema);
    if (!csrf.ok) return csrf;
    return api.request(endpoint, schema, {
      body,
      csrfToken: csrf.data.csrfToken,
    });
  }
  return {
    config: () => api.request(callsEndpoints.config, CallIceConfigSchema),
    current: () =>
      api.request(callsEndpoints.current, CurrentCallResponseSchema),
    get: (id: string) =>
      api.request(withPath(callsEndpoints.get, { id }), CallResponseSchema),
    start: (input: StartCallRequest) =>
      mutate(callsEndpoints.start, CallResponseSchema, input),
    action: (id: string, input: CallActionRequest) =>
      mutate(
        withPath(callsEndpoints.action, { id }),
        CallResponseSchema,
        input,
      ),
    heartbeat: (id: string, clientId: string) =>
      mutate(withPath(callsEndpoints.heartbeat, { id }), CallResponseSchema, {
        clientId,
      }),
    signals: (id: string, clientId: string, after: number) =>
      api.request(
        withPath(callsEndpoints.signals, { id }, { clientId, after }),
        CallSignalsResponseSchema,
      ),
    sendSignal: (id: string, clientId: string, signal: CallSignal) =>
      mutate(
        withPath(callsEndpoints.sendSignal, { id }),
        CallSignalAcceptedSchema,
        { clientId, signal },
      ),
    history: (id: string, cursor?: string, signal?: AbortSignal) =>
      api.request(
        withPath(callsEndpoints.history, { id }, { cursor }),
        CallHistoryResponseSchema,
        { signal },
      ),
  };
}
