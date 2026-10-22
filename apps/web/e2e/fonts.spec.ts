import { expect, test } from "@playwright/test";

test("fonts load from the application when Google Fonts is unavailable", async ({
  page,
}) => {
  const googleRequests: string[] = [];
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => {
    googleRequests.push(route.request().url());
    return route.abort();
  });
  const fontResponses: { url: string; status: number }[] = [];
  page.on("response", (response) => {
    if (/\.(ttf|woff2?)(?:[?#]|$)/.test(response.url())) {
      fontResponses.push({ url: response.url(), status: response.status() });
    }
  });

  await page.goto("/");
  const loaded = await page.evaluate(async () => {
    const style = getComputedStyle(document.documentElement);
    return Promise.all(
      ["--font-geist-sans", "--font-geist-mono", "--font-grand-hotel"].map(
        async (variable) => {
          // Only load the bundled face. The generated fallback may reference
          // Arial, which is not installed on Linux browser runners.
          const family = style.getPropertyValue(variable).split(",")[0].trim();
          if (!family) return false;
          const faces = await document.fonts.load(
            `16px ${family}`,
            "Instagram",
          );
          return (
            faces.length > 0 && faces.every((face) => face.status === "loaded")
          );
        },
      ),
    );
  });

  expect(loaded).toEqual([true, true, true]);
  expect(googleRequests).toEqual([]);
  expect(fontResponses.length).toBeGreaterThanOrEqual(3);
  for (const response of fontResponses) {
    expect(new URL(response.url).origin).toBe(new URL(page.url()).origin);
    expect(response.status).toBe(200);
  }
});
