import { expect, test } from "@playwright/test";
import {
  AuthCsrfResponseSchema,
  CoinClaimResponseSchema,
} from "@instagram/contracts";
import { login, verifiedAccount, type Fixture } from "./helpers/app.mjs";

test("More opens the real wallet, daily claim persists and a second account sees its own balance", async ({
  page,
  baseURL,
}, info) => {
  test.setTimeout(180_000);
  const fixtures: Fixture[] = [];
  try {
    const owner = await verifiedAccount();
    fixtures.push(owner);
    const other = await verifiedAccount();
    fixtures.push(other);
    await login(page, owner.account);
    const more = page
      .getByRole("button", { name: "Ещё", exact: true })
      .filter({ visible: true });
    await more.click();
    await page.getByRole("menuitem", { name: /Получить монеты/ }).click();
    await expect(page).toHaveURL(/\/coins$/);
    await expect(
      page.getByRole("heading", { name: "Монеты", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("0 монет", { exact: true })).toBeVisible();
    await expect
      .poll(() =>
        page
          .locator('img[src*="instagram-coins"]')
          .evaluate((node: HTMLImageElement) => node.naturalWidth),
      )
      .toBeGreaterThan(0);
    await page.screenshot({
      path: info.outputPath("wallet-available.png"),
      fullPage: true,
    });
    const response = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/coins/daily-claim") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Получить 100 монет" }).click();
    const claimed = await response;
    expect(claimed.status()).toBe(200);
    expect(CoinClaimResponseSchema.parse(await claimed.json()).credited).toBe(
      true,
    );
    await expect(page.getByLabel("100 монет", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Получено сегодня" }),
    ).toBeDisabled();
    await expect(
      page
        .getByRole("region", { name: "История операций" })
        .getByText("Ежедневный бонус"),
    ).toBeVisible();
    await expect(
      page.getByText(/Снова доступно.*00:00 по Душанбе/),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("100 монет", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Получено сегодня" }),
    ).toBeDisabled();
    await more.click();
    await expect(
      page
        .getByRole("menuitem", { name: /Получить монеты/ })
        .getByLabel("Баланс 100"),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.screenshot({
      path: info.outputPath("wallet-claimed.png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const csrf = AuthCsrfResponseSchema.parse(
      await (await page.request.get("/api/v1/auth/csrf")).json(),
    ).csrfToken;
    const headers = { Origin: baseURL!, "X-CSRF-Token": csrf };
    const repeated = await page.request.post("/api/v1/coins/daily-claim", {
      data: {},
      headers,
    });
    const replay = CoinClaimResponseSchema.parse(await repeated.json());
    expect(replay.credited).toBe(false);
    expect(replay.wallet.balance).toBe("100");
    expect(
      (
        await page.request.post("/api/v1/auth/logout", { data: {}, headers })
      ).status(),
    ).toBe(200);
    await login(page, other.account);
    await page.goto("/coins");
    await expect(page.getByLabel("0 монет", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Здесь будут ваши начисления и подарки."),
    ).toBeVisible();
    await expect(page.getByLabel("100 монет", { exact: true })).toHaveCount(0);
  } finally {
    await page.goto("/auth/login");
    for (const fixture of fixtures) await fixture.stop();
  }
});
