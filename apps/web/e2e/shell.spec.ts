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
    // A browser's initial cursor can already hover the rail at the left edge.
    // Establish the collapsed state and wait for its CSS transition first.
    await page.mouse.move(720, 450);
    await expect
      .poll(async () => (await rail.boundingBox())?.width)
      .toBeLessThan(80);
    await rail.hover();
    await expect
      .poll(async () => (await rail.boundingBox())?.width)
      .toBeGreaterThan(200);
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
