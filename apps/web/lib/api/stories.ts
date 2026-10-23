import {
  authEndpoints,
  AuthCsrfResponseSchema,
  DeleteStoryResponseSchema,
  StoryFeedResponseSchema,
  StoryListResponseSchema,
  StoryResponseSchema,
  StoryViewedResponseSchema,
  StoryViewersResponseSchema,
  storiesEndpoints,
} from "@instagram/contracts";
import {
  createApiClient,
  type ApiClient,
  type ApiEndpoint,
  type ResponseSchema,
} from "./client";
import { withPath } from "./social";
export function createStoriesClient(api: ApiClient = createApiClient()) {
  async function mutate<T>(
    endpoint: ApiEndpoint,
    schema: ResponseSchema<T>,
    body: unknown = {},
    signal?: AbortSignal,
  ) {
    const csrf = await api.request(authEndpoints.csrf, AuthCsrfResponseSchema, {
      signal,
    });
    if (!csrf.ok) return csrf;
    return api.request(endpoint, schema, {
      body,
      csrfToken: csrf.data.csrfToken,
      signal,
    });
  }
  return {
    create: (file: File, signal?: AbortSignal) => {
      const video = file.type.startsWith("video/");
      const form = new FormData();
      form.append(video ? "video" : "image", file);
      return mutate(
        video ? storiesEndpoints.createVideo : storiesEndpoints.create,
        StoryResponseSchema,
        form,
        signal,
      );
    },
    get: (id: string, signal?: AbortSignal) =>
      api.request(withPath(storiesEndpoints.get, { id }), StoryResponseSchema, {
        signal,
      }),
    feed: (cursor?: string, signal?: AbortSignal) =>
      api.request(
        withPath(storiesEndpoints.feed, {}, { cursor }),
        StoryFeedResponseSchema,
        { signal },
      ),
    byUser: (id: string, cursor?: string, signal?: AbortSignal) =>
      api.request(
        withPath(storiesEndpoints.byUser, { id }, { cursor }),
        StoryListResponseSchema,
        { signal },
      ),
    view: (id: string) =>
      mutate(
        withPath(storiesEndpoints.view, { id }),
        StoryViewedResponseSchema,
      ),
    viewers: (id: string, cursor?: string, signal?: AbortSignal) =>
      api.request(
        withPath(storiesEndpoints.viewers, { id }, { cursor }),
        StoryViewersResponseSchema,
        { signal },
      ),
    remove: (id: string) =>
      mutate(
        withPath(storiesEndpoints.remove, { id }),
        DeleteStoryResponseSchema,
      ),
  };
}
