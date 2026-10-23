import { expect, test } from "@playwright/test";

test("anonymous home opens login; explicit guest browse asks for auth on interaction", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/auth\/login$/);
  await expect(page.getByRole("heading", { name: "Войти в Instagram" })).toBeVisible();
  await page.getByRole("link", { name: /Продолжить как гость/ }).click();
  await expect(page).toHaveURL(/\?guest=1$/);
  await expect(page.getByRole("button", { name: "Нравится", exact: true }).first()).toBeVisible();
  // Suggestions are personal API data: guests never see or request them.
  await expect(page.getByRole("heading", { name: "Рекомендации для вас" })).toHaveCount(0);
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Нравится", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Войти", exact: true })).toHaveAttribute("href", "/auth/login");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Добавьте комментарий" }).first().click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Продолжить просмотр" }).click();
  await expect(dialog).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.goto("/auth/register");
  await expect(page.getByRole("heading", { name: "Создайте аккаунт" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
