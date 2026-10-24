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
  videoUploadRules,
} from "@instagram/contracts";

import {
  createApiClient,
  type ApiClient,
  type ApiEndpoint,
  type ResponseSchema,
} from "./client";
import { withPath } from "./social";
import { uploadWithProgress, type UploadProgress } from "./upload";

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
    // FR-10: answers at once with status "processing"; poll get() after.
    createVideo: async (
      video: Blob,
      caption: string,
      onProgress?: UploadProgress,
      signal?: AbortSignal,
    ) => {
      const csrf = await api.request(
        authEndpoints.csrf,
        AuthCsrfResponseSchema,
      );
      if (!csrf.ok) return csrf;
      const form = new FormData();
      form.append(videoUploadRules.multipartField, video);
      if (caption) form.append("caption", caption);
      return uploadWithProgress({
        endpoint: postsEndpoints.createVideo,
        schema: PostResponseSchema,
        form,
        csrfToken: csrf.data.csrfToken,
        onProgress,
        signal,
      });
    },
    reels: (cursor?: string, signal?: AbortSignal) =>
      api.request(
        withPath(postsEndpoints.reels, {}, { cursor }),
        PostListResponseSchema,
        { signal },
      ),
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
    replies: (id: string, cursor?: string, signal?: AbortSignal) =>
      api.request(
        withPath(postsEndpoints.replies, { id }, { cursor }),
        CommentListResponseSchema,
        { signal },
      ),
    likeComment: (id: string) =>
      mutate(withPath(postsEndpoints.likeComment, { id }), LikeResponseSchema),
    unlikeComment: (id: string) =>
      mutate(
        withPath(postsEndpoints.unlikeComment, { id }),
        LikeResponseSchema,
      ),
    addComment: (id: string, text: string, replyToCommentId?: string) =>
      mutate(
        withPath(postsEndpoints.addComment, { id }),
        CommentResponseSchema,
        {
          text,
          ...(replyToCommentId && { replyToCommentId }),
        },
      ),
    addMediaComment: (
      id: string,
      image: File,
      text: string,
      replyToCommentId?: string,
    ) => {
      const form = new FormData();
      form.append("image", image);
      form.append("text", text);
      if (replyToCommentId) form.append("replyToCommentId", replyToCommentId);
      return mutate(
        withPath(postsEndpoints.addMediaComment, { id }),
        CommentResponseSchema,
        form,
      );
    },
    removeComment: (id: string) =>
      mutate(
        withPath(postsEndpoints.removeComment, { id }),
        DeleteCommentResponseSchema,
      ),
  };
}

export type PostsClient = ReturnType<typeof createPostsClient>;

export const isVideoFile = (file: File) =>
  (videoUploadRules.formats as readonly string[]).includes(file.type);

// Quick checks before uploading; the API validates the decoded file again.
export function checkVideoFile(file: File): string | undefined {
  if (!isVideoFile(file)) return "Выберите видео в формате MP4, MOV или WebM.";
  if (file.size > videoUploadRules.maxBytes)
    return "Видео больше 100 МБ. Выберите файл поменьше.";
  return undefined;
}

// Quick checks before uploading; the API validates the decoded file again.
export function checkImageFile(file: File): string | undefined {
  if (!(imageUploadRules.formats as readonly string[]).includes(file.type))
    return "Выберите фото в формате JPEG, PNG или WebP.";
  if (file.size > imageUploadRules.maxBytes)
    return "Фото больше 10 МБ. Выберите файл поменьше.";
  return undefined;
}
