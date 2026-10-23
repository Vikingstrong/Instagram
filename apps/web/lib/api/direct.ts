import {
  authEndpoints,
  AuthCsrfResponseSchema,
  ConversationListResponseSchema,
  ConversationResponseSchema,
  directEndpoints,
  DirectMessageListResponseSchema,
  DirectMessageResponseSchema,
  type SendMessageRequest,
} from "@instagram/contracts";

import {
  createApiClient,
  type ApiClient,
  type ApiEndpoint,
  type ResponseSchema,
} from "./client";
import { withPath } from "./social";

// Direct over REST (stage 6). Sending is safe to repeat only with the same
// clientMessageId; callers keep it for the retry instead of making a new one.
export function createDirectClient(api: ApiClient = createApiClient()) {
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
    conversations: (cursor?: string, signal?: AbortSignal) =>
      api.request(
        withPath(directEndpoints.conversations, {}, { cursor }),
        ConversationListResponseSchema,
        { signal },
      ),
    open: (userId: string) =>
      mutate(directEndpoints.open, ConversationResponseSchema, { userId }),
    conversation: (id: string, signal?: AbortSignal) =>
      api.request(
        withPath(directEndpoints.conversation, { id }),
        ConversationResponseSchema,
        { signal },
      ),
    messages: (id: string, cursor?: string, signal?: AbortSignal) =>
      api.request(
        withPath(directEndpoints.messages, { id }, { cursor }),
        DirectMessageListResponseSchema,
        { signal },
      ),
    send: (id: string, body: SendMessageRequest) =>
      mutate(withPath(directEndpoints.send, { id }), DirectMessageResponseSchema, body),
  };
}

export type DirectClient = ReturnType<typeof createDirectClient>;
