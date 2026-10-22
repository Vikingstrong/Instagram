import {
  authEndpoints,
  AuthCsrfResponseSchema,
  FollowRequestDecisionResponseSchema,
  FollowRequestListResponseSchema,
  FollowResponseSchema,
  OwnProfileResponseSchema,
  RemoveFollowerResponseSchema,
  socialEndpoints,
  SuggestionsResponseSchema,
  UserListResponseSchema,
  UserProfileResponseSchema,
  usersEndpoints,
  type UpdateOwnProfileRequest,
} from "@instagram/contracts";

import {
  createApiClient,
  type ApiClient,
  type ApiEndpoint,
  type ResponseSchema,
} from "./client";

type Query = Record<string, string | number | undefined>;

// Fills {name} placeholders of a contract path and appends a query string.
export function withPath(
  endpoint: ApiEndpoint,
  params: Record<string, string> = {},
  query: Query = {},
): ApiEndpoint {
  let path = endpoint.path.replace(/\{(\w+)\}/g, (_, name: string) =>
    encodeURIComponent(params[name] ?? ""),
  );
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== undefined) search.set(key, String(value));
  if (search.size) path += `?${search}`;
  return { ...endpoint, path: path as ApiEndpoint["path"] };
}

// Profiles, follows, lists, suggestions and search (stage 3). Mutations fetch
// a fresh CSRF token each time and are never retried automatically.
export function createSocialClient(api: ApiClient = createApiClient()) {
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
  const byId = (endpoint: ApiEndpoint, id: string) =>
    withPath(endpoint, { id });

  return {
    profile: (username: string, signal?: AbortSignal) =>
      api.request(
        withPath(usersEndpoints.profile, { username }),
        UserProfileResponseSchema,
        { signal },
      ),
    ownProfile: (signal?: AbortSignal) =>
      api.request(usersEndpoints.ownProfile, OwnProfileResponseSchema, {
        signal,
      }),
    updateProfile: (body: UpdateOwnProfileRequest) =>
      mutate(usersEndpoints.updateOwnProfile, OwnProfileResponseSchema, body),
    follow: (id: string) =>
      mutate(byId(socialEndpoints.follow, id), FollowResponseSchema),
    unfollow: (id: string) =>
      mutate(byId(socialEndpoints.unfollow, id), FollowResponseSchema),
    followers: (id: string, cursor?: string, signal?: AbortSignal) =>
      api.request(
        withPath(socialEndpoints.followers, { id }, { cursor }),
        UserListResponseSchema,
        { signal },
      ),
    following: (id: string, cursor?: string, signal?: AbortSignal) =>
      api.request(
        withPath(socialEndpoints.following, { id }, { cursor }),
        UserListResponseSchema,
        { signal },
      ),
    requests: (cursor?: string, signal?: AbortSignal) =>
      api.request(
        withPath(socialEndpoints.followRequests, {}, { cursor }),
        FollowRequestListResponseSchema,
        { signal },
      ),
    accept: (id: string) =>
      mutate(
        byId(socialEndpoints.acceptRequest, id),
        FollowRequestDecisionResponseSchema,
      ),
    decline: (id: string) =>
      mutate(
        byId(socialEndpoints.declineRequest, id),
        FollowRequestDecisionResponseSchema,
      ),
    removeFollower: (id: string) =>
      mutate(
        byId(socialEndpoints.removeFollower, id),
        RemoveFollowerResponseSchema,
      ),
    suggestions: (limit: number, signal?: AbortSignal) =>
      api.request(
        withPath(socialEndpoints.suggestions, {}, { limit }),
        SuggestionsResponseSchema,
        { signal },
      ),
    search: (q: string, cursor?: string, signal?: AbortSignal) =>
      api.request(
        withPath(socialEndpoints.search, {}, { q, cursor }),
        UserListResponseSchema,
        { signal },
      ),
  };
}

export type SocialClient = ReturnType<typeof createSocialClient>;
