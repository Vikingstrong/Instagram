import { expect, test } from "@playwright/test";

test.describe("app shell", () => {
  test("home renders inside the shell", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveTitle("Instagram");
    await expect(
      page.getByRole("heading", { name: "Рекомендации для вас" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Главная", exact: true }).filter({ visible: true }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("desktop rail expands on hover", async ({ page, isMobile }) => {
    test.skip(isMobile, "The rail exists only on desktop widths");
    await page.goto("/");

    const rail = page.locator("aside").first();
    const collapsed = await rail.boundingBox();
    await rail.hover();
    await expect
      .poll(async () => (await rail.boundingBox())?.width)
      .toBeGreaterThan(200);
    expect(collapsed?.width).toBeLessThan(80);
  });

  test("mobile shows the bottom tab bar instead of the rail", async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, "Bottom navigation exists only on mobile widths");
    await page.goto("/");

    await expect(page.locator("aside").first()).toBeHidden();
    await expect(
      page.getByRole("link", { name: "Сообщения", exact: true }).filter({ visible: true }),
    ).toHaveCount(1);
  });
});

// Roadmap FND-06: the browser must reach GET /api/v1/readiness through the
// shared origin. Blocked until FND-04 ships the endpoint and FND-01 agrees
// the origin scheme; kept visible as a pending test, never as a pass.
test.fixme("readiness is reachable through the shared origin", async () => {});
