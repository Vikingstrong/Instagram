import { ApiErrorResponseSchema, type ApiErrorResponse } from "./contracts";

// Single path for every API call from web (Server and Client Components).
// Calls return a result instead of throwing, so each caller handles failures.

export type ApiFailure =
  // API answered with the agreed error envelope.
  | { kind: "api"; status: number; error: ApiErrorResponse["error"] }
  // No HTTP response: offline, DNS, refused connection, CORS.
  | { kind: "network" }
  // The caller cancelled the request (e.g. component unmounted).
  | { kind: "aborted" }
  // A response that matches no contract: proxy HTML, bad JSON, wrong shape.
  | { kind: "invalid_response"; status: number };

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; failure: ApiFailure };

// Structural subset of a Zod schema, so web needs no direct zod dependency.
export type ResponseSchema<T> = {
  safeParse(input: unknown): { success: true; data: T } | { success: false };
};

export type ApiEndpoint = {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: `/api/v1/${string}`;
  successStatus: number;
};

export type ApiMode = "live" | "fixture";

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type ApiClientOptions = {
  // "" = same origin (browser). Server Components use createServerApiClient()
  // from ./server, which supplies the configured origin and request context.
  baseUrl?: string;
  fetchImpl?: FetchLike;
  mode?: ApiMode;
};

export type RequestOptions = {
  body?: unknown;
  signal?: AbortSignal;
};

export type ApiClient = {
  mode: ApiMode;
  request<T>(
    endpoint: ApiEndpoint,
    schema: ResponseSchema<T>,
    options?: RequestOptions,
  ): Promise<ApiResult<T>>;
};

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function fail<T>(failure: ApiFailure): ApiResult<T> {
  return { ok: false, failure };
}

export function createApiClient({
  baseUrl = "",
  // Wrapped, not stored: calling an unbound window.fetch throws
  // "Illegal invocation" in browsers.
  fetchImpl = (input, init) => fetch(input, init),
  mode = "live",
}: ApiClientOptions = {}): ApiClient {
  return {
    mode,
    async request(endpoint, schema, { body, signal } = {}) {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
      }

      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}${endpoint.path}`, {
          method: endpoint.method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          // Personalized responses must never land in a shared cache.
          cache: "no-store",
          credentials: "same-origin",
          signal,
        });
      } catch {
        return fail({ kind: signal?.aborted ? "aborted" : "network" });
      }

      const { status } = response;
      const payload = await readJson(response);

      if (status === endpoint.successStatus) {
        const parsed = schema.safeParse(payload);
        return parsed.success
          ? { ok: true, status, data: parsed.data }
          : fail({ kind: "invalid_response", status });
      }

      const parsedError = ApiErrorResponseSchema.safeParse(payload);
      return fail(
        parsedError.success
          ? { kind: "api", status, error: parsedError.data.error }
          : { kind: "invalid_response", status },
      );
    },
  };
}
