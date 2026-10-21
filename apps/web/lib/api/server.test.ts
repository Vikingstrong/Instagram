// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: vi.fn() }));

import { headers } from "next/headers";
import { readyFixture, unavailableFixture } from "./contracts.fixture";
import { getReadiness } from "./readiness";
import { createServerApiClient } from "./server";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("server API client", () => {
  it("uses the configured origin and forwards only cookie and origin context", async () => {
    vi.stubEnv("API_INTERNAL_ORIGIN", "https://internal.example.test");
    vi.mocked(headers).mockResolvedValue(
      new Headers({
        cookie: "session=first",
        origin: "https://web.example.test",
        host: "untrusted.example.test",
        authorization: "unrelated",
      }) as Awaited<ReturnType<typeof headers>>,
    );
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(readyFixture), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchImpl);

    const client = await createServerApiClient();
    expect(client.mode).toBe("live");
    expect(await getReadiness(client)).toEqual({
      ok: true,
      status: 200,
      data: readyFixture,
    });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://internal.example.test/api/v1/readiness");
    expect(init).toMatchObject({ cache: "no-store", redirect: "error" });
    const sent = new Headers(init?.headers);
    expect(sent.get("cookie")).toBe("session=first");
    expect(sent.get("origin")).toBe("https://web.example.test");
    expect(sent.get("host")).toBeNull();
    expect(sent.get("authorization")).toBeNull();
  });

  it("keeps request cookies isolated even when clients are used out of order", async () => {
    vi.mocked(headers)
      .mockResolvedValueOnce(
        new Headers({ cookie: "session=first" }) as Awaited<ReturnType<typeof headers>>,
      )
      .mockResolvedValueOnce(
        new Headers() as Awaited<ReturnType<typeof headers>>,
      );
    const sent: Headers[] = [];
    vi.stubGlobal("fetch", async (_input: string, init: RequestInit) => {
      sent.push(new Headers(init.headers));
      return new Response(JSON.stringify(readyFixture), { status: 200 });
    });
    const first = await createServerApiClient();
    const anonymous = await createServerApiClient();
    await getReadiness(anonymous);
    await getReadiness(first);
    expect(sent[0].get("cookie")).toBeNull();
    expect(sent[1].get("cookie")).toBe("session=first");
  });

  it("preserves API failures and request cancellation", async () => {
    vi.mocked(headers).mockResolvedValue(
      new Headers() as Awaited<ReturnType<typeof headers>>,
    );
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(unavailableFixture), { status: 503 }),
      )
      .mockImplementationOnce(async (_input, init) => {
        init?.signal?.throwIfAborted();
        throw new Error("Unreachable");
      });
    vi.stubGlobal("fetch", fetchImpl);
    const client = await createServerApiClient();
    expect(await getReadiness(client)).toMatchObject({
      ok: false,
      failure: { kind: "api", status: 503 },
    });
    const controller = new AbortController();
    controller.abort();
    expect(await getReadiness(client, { signal: controller.signal })).toEqual({
      ok: false,
      failure: { kind: "aborted" },
    });
  });
});
