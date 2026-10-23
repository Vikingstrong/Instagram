import type { ApiEndpoint, ApiResult, ResponseSchema } from "./client";
import { ApiErrorResponseSchema } from "./contracts";

export type UploadProgress = (fraction: number) => void;

export type UploadRequest<T> = {
  endpoint: ApiEndpoint;
  schema: ResponseSchema<T>;
  form: FormData;
  csrfToken: string;
  onProgress?: UploadProgress;
  signal?: AbortSignal;
};

// Multipart upload with progress. fetch() cannot report upload progress, so
// large files (video) go through XMLHttpRequest with the same result shape
// and the same rules as the API client: same-origin cookies, CSRF header,
// contract-checked responses, never retried automatically.
export function uploadWithProgress<T>({
  endpoint,
  schema,
  form,
  csrfToken,
  onProgress,
  signal,
}: UploadRequest<T>): Promise<ApiResult<T>> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open(endpoint.method, endpoint.path);
    xhr.setRequestHeader("Accept", "application/json");
    xhr.setRequestHeader("X-CSRF-Token", csrfToken);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onerror = () => resolve({ ok: false, failure: { kind: "network" } });
    xhr.onabort = () => resolve({ ok: false, failure: { kind: "aborted" } });
    xhr.onload = () => {
      let payload: unknown;
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        payload = undefined;
      }
      const status = xhr.status;
      if (status === endpoint.successStatus) {
        const parsed = schema.safeParse(payload);
        resolve(
          parsed.success
            ? { ok: true, status, data: parsed.data }
            : { ok: false, failure: { kind: "invalid_response", status } },
        );
        return;
      }
      const error = ApiErrorResponseSchema.safeParse(payload);
      resolve({
        ok: false,
        failure: error.success
          ? { kind: "api", status, error: error.data.error }
          : { kind: "invalid_response", status },
      });
    };
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}
