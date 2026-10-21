// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import nextConfig from "../next.config";
import { getApiOrigin } from "./api-origin";

afterEach(() => vi.unstubAllEnvs());

describe("API origin configuration", () => {
  it("defaults to the local Nest API and normalizes an explicit origin", () => {
    vi.stubEnv("API_INTERNAL_ORIGIN", undefined);
    expect(getApiOrigin()).toBe("http://127.0.0.1:4000");
    expect(getApiOrigin("https://api.example.test/")).toBe(
      "https://api.example.test",
    );
  });

  it.each([
    "",
    "/api",
    "ftp://api.example.test",
    "https://user:private@api.example.test",
    "https://api.example.test/api/v1",
    "https://api.example.test/?key=private",
    "https://api.example.test/#private",
  ])("rejects an unsafe origin without exposing it: %s", (value) => {
    expect(() => getApiOrigin(value)).toThrow(
      new Error(
        "API_INTERNAL_ORIGIN must be an HTTP(S) origin without credentials, path, query or fragment.",
      ),
    );
  });

  it("routes the REST prefix to the configured origin without publishing it", async () => {
    vi.stubEnv("API_INTERNAL_ORIGIN", "http://api.example.test:4100/");
    expect(await nextConfig.rewrites?.()).toEqual([
      {
        source: "/api/v1/:path*",
        destination: "http://api.example.test:4100/api/v1/:path*",
      },
    ]);
    expect(nextConfig.env).toBeUndefined();
  });
});
