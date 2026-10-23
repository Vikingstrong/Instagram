import {
  authEndpoints,
  AuthCsrfResponseSchema,
  AvatarResponseSchema,
  CommentListResponseSchema,
  CommentResponseSchema,
  DeleteCommentResponseSchema,
  DeletePostResponseSchema,
  imageUploadRules,
  LikeResponseSchema,
  PostListResponseSchema,
  PostResponseSchema,
  postsEndpoints,
} from "@instagram/contracts";

import {
  createApiClient,
  type ApiClient,
  type ApiEndpoint,
  type ResponseSchema,
} from "./client";
import { withPath } from "./social";

// Posts, avatars and their images (stage 4); feed, likes and comments
// (stage 5). Uploads are multipart with the file in the agreed field;
// mutations fetch a fresh CSRF token each time and are never retried
// automatically.
export function createPostsClient(api: ApiClient = createApiClient()) {
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
  const upload = (image: Blob, caption?: string) => {
    const form = new FormData();
    form.append(imageUploadRules.multipartField, image);
    if (caption) form.append("caption", caption);
    return form;
  };

  return {
    create: (image: Blob, caption: string) =>
      mutate(postsEndpoints.create, PostResponseSchema, upload(image, caption)),
    get: (id: string, signal?: AbortSignal) =>
      api.request(withPath(postsEndpoints.get, { id }), PostResponseSchema, {
        signal,
      }),
    remove: (id: string) =>
      mutate(withPath(postsEndpoints.remove, { id }), DeletePostResponseSchema),
    byUser: (id: string, cursor?: string, signal?: AbortSignal) =>
      api.request(
        withPath(postsEndpoints.byUser, { id }, { cursor }),
        PostListResponseSchema,
        { signal },
      ),
    setAvatar: (image: Blob) =>
      mutate(postsEndpoints.setAvatar, AvatarResponseSchema, upload(image)),
    removeAvatar: () =>
      mutate(postsEndpoints.removeAvatar, AvatarResponseSchema),
    feed: (cursor?: string, signal?: AbortSignal) =>
      api.request(
        withPath(postsEndpoints.feed, {}, { cursor }),
        PostListResponseSchema,
        { signal },
      ),
    like: (id: string) =>
      mutate(withPath(postsEndpoints.like, { id }), LikeResponseSchema),
    unlike: (id: string) =>
      mutate(withPath(postsEndpoints.unlike, { id }), LikeResponseSchema),
    comments: (id: string, cursor?: string, signal?: AbortSignal) =>
      api.request(
        withPath(postsEndpoints.comments, { id }, { cursor }),
        CommentListResponseSchema,
        { signal },
      ),
    addComment: (id: string, text: string) =>
      mutate(withPath(postsEndpoints.addComment, { id }), CommentResponseSchema, {
        text,
      }),
    removeComment: (id: string) =>
      mutate(
        withPath(postsEndpoints.removeComment, { id }),
        DeleteCommentResponseSchema,
      ),
  };
}

export type PostsClient = ReturnType<typeof createPostsClient>;

// Quick checks before uploading; the API validates the decoded file again.
export function checkImageFile(file: File): string | undefined {
  if (!(imageUploadRules.formats as readonly string[]).includes(file.type))
    return "Выберите фото в формате JPEG, PNG или WebP.";
  if (file.size > imageUploadRules.maxBytes)
    return "Фото больше 10 МБ. Выберите файл поменьше.";
  return undefined;
}
