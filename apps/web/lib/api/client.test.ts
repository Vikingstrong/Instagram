// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { createApiClient } from "./client";
import { readyFixture, unavailableFixture } from "./contracts.fixture";
import { createFixtureClient, readinessFixtureRoutes } from "./fixture-client";
import { describeFailure } from "./messages";
import { getReadiness } from "./readiness";
import {
  AuthUserResponseSchema,
  authEndpoints,
  authErrors,
} from "@instagram/contracts";

const readinessPath = "GET /api/v1/readiness";

it("forwards per-request CSRF and decodes/localizes the Auth error contract", async () => {
  const fetchImpl = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "INVALID_CREDENTIALS",
            message: authErrors.INVALID_CREDENTIALS.message,
            requestId: "8d159934-81b2-4adc-a0b2-a685945138c0",
          },
        }),
        { status: 401 },
      ),
  );
  const client = createApiClient({ fetchImpl });
  const result = await client.request(
    authEndpoints.login,
    AuthUserResponseSchema,
    {
      body: { email: "demo@example.test", password: "example password" },
      csrfToken: "synthetic-csrf",
    },
  );
  expect(fetchImpl).toHaveBeenCalledWith(
    authEndpoints.login.path,
    expect.objectContaining({
      headers: expect.objectContaining({ "X-CSRF-Token": "synthetic-csrf" }),
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
    }),
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.failure.kind).toBe("api");
    expect(describeFailure(result.failure)).toBe("Неверный email или пароль.");
  }
});

describe("api client", () => {
  it("returns parsed data for the contract success status", async () => {
    const result = await getReadiness(
      createFixtureClient(readinessFixtureRoutes.ready),
    );
    expect(result).toEqual({ ok: true, status: 200, data: readyFixture });
  });

  it("maps the agreed error envelope to an api failure", async () => {
    const result = await getReadiness(
      createFixtureClient(readinessFixtureRoutes.unavailable),
    );
    expect(result).toEqual({
      ok: false,
      failure: { kind: "api", status: 503, error: unavailableFixture.error },
    });
  });

  it("rejects a success body with extra internal fields", async () => {
    const client = createFixtureClient({
      [readinessPath]: {
        status: 200,
        body: { status: "ready", databaseUrl: "postgres://secret" },
      },
    });
    const result = await getReadiness(client);
    expect(result).toEqual({
      ok: false,
      failure: { kind: "invalid_response", status: 200 },
    });
  });

  it("treats non-contract errors and non-JSON bodies as invalid responses", async () => {
    const nestDefault = createFixtureClient({
      [readinessPath]: {
        status: 404,
        body: { statusCode: 404, message: "Cannot GET", error: "Not Found" },
      },
    });
    const proxyHtml = createApiClient({
      fetchImpl: async () =>
        new Response("<html>Bad Gateway</html>", { status: 502 }),
    });

    expect(await getReadiness(nestDefault)).toEqual({
      ok: false,
      failure: { kind: "invalid_response", status: 404 },
    });
    expect(await getReadiness(proxyHtml)).toEqual({
      ok: false,
      failure: { kind: "invalid_response", status: 502 },
    });
  });

  it("distinguishes a network error from a cancelled request", async () => {
    const offline = createApiClient({
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const controller = new AbortController();
    controller.abort();
    const cancelled = createApiClient({
      fetchImpl: async (_input, init) => {
        init.signal?.throwIfAborted();
        throw new Error("unreachable");
      },
    });

    expect(await getReadiness(offline)).toEqual({
      ok: false,
      failure: { kind: "network" },
    });
    expect(
      await getReadiness(cancelled, { signal: controller.signal }),
    ).toEqual({ ok: false, failure: { kind: "aborted" } });
  });

  it("sends same-origin, uncached JSON requests", async () => {
    const fetchImpl = vi.fn<
      (input: string, init: RequestInit) => Promise<Response>
    >(async () => new Response(JSON.stringify(readyFixture), { status: 200 }));
    const client = createApiClient({ baseUrl: "http://api.test", fetchImpl });

    await client.request(
      { method: "POST", path: "/api/v1/example", successStatus: 200 },
      { safeParse: (input) => ({ success: true, data: input }) },
      { body: { a: 1 } },
    );

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://api.test/api/v1/example");
    expect(init).toMatchObject({
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      body: '{"a":1}',
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
  });

  it("marks fixture clients so they are never mistaken for the live API", () => {
    expect(createFixtureClient({}).mode).toBe("fixture");
    expect(createApiClient().mode).toBe("live");
  });
});

describe("describeFailure", () => {
  it("localizes by kind and code, not by the API message", () => {
    expect(
      describeFailure({
        kind: "api",
        status: 503,
        error: unavailableFixture.error,
      }),
    ).toBe("Сервис временно недоступен. Попробуйте позже.");
    expect(describeFailure({ kind: "network" })).toBe(
      "Нет соединения с сервером. Проверьте интернет.",
    );
    expect(describeFailure({ kind: "invalid_response", status: 502 })).toBe(
      "Что-то пошло не так. Попробуйте ещё раз.",
    );
  });
});
