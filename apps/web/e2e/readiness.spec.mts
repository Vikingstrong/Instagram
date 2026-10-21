import { expect, test } from "@playwright/test";
import { ReadinessResponseSchema, readinessEndpoint } from "@instagram/contracts";

// ESM test entry consumes the actual ESM-only workspace contract.
test("readiness is reachable through the shared origin", async ({ page }) => {
  await page.goto("/");

  // Executed in the real browser: no fixture or Playwright request interception.
  const result = await page.evaluate(async (path) => {
    const response = await fetch(path, {
      credentials: "same-origin",
      cache: "no-store",
    });
    return {
      status: response.status,
      cacheControl: response.headers.get("cache-control"),
      body: await response.json(),
    };
  }, readinessEndpoint.path);

  expect(result.status).toBe(readinessEndpoint.successStatus);
  expect(result.cacheControl).toBe("no-store");
  expect(ReadinessResponseSchema.parse(result.body)).toEqual({ status: "ready" });
});
