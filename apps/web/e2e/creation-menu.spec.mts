import { expect, test } from "@playwright/test";
import { login, registeredAccount, type Fixture } from "./helpers/app.mjs";

test("creation chooser supports keyboard dismissal and opens each format", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  let fixture: Fixture | undefined;
  try {
    fixture = await registeredAccount();
    await login(page, fixture.account);
    const create = page
      .getByRole("button", { name: "Создать", exact: true })
      .filter({ visible: true });
    await create.click();
    const dialog = page.getByRole("dialog", { name: "Что создадим?" });
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: info.outputPath("creation-menu.png") });
    // Native modal contains focus and blocks the page behind the rail/header.
    await expect
      .poll(() =>
        dialog.evaluate((node) => node.contains(document.activeElement)),
      )
      .toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(create).toBeFocused();

    for (const [format, path, heading, field] of [
      ["Reels", "/create/reel", "Новый Reels", "Видео для Reels"],
      [
        "Публикация",
        "/create",
        "Создание публикации",
        "Фото или видео для публикации",
      ],
      [
        "История",
        "/stories/create",
        "Новая история",
        "Фото или видео для истории",
      ],
    ]) {
      await create.click();
      await dialog.getByRole("link", { name: format, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(
        page.getByRole("heading", { name: heading, exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel(field)).toHaveAttribute("type", "file");
      if (format === "Reels")
        await expect(page.getByLabel(field)).not.toHaveAttribute(
          "accept",
          /image/,
        );
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        )
        .toBe(true);
      await page.screenshot({
        path: info.outputPath(
          `${format === "История" ? "story" : format === "Reels" ? "reel" : "post"}-creation.png`,
        ),
        fullPage: true,
      });
    }
  } finally {
    await page.goto("/auth/login");
    await fixture?.stop();
  }
});
