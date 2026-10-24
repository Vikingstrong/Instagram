import { test, expect } from "@playwright/test";
import { login, verifiedAccount, type Fixture } from "./helpers/app.mjs";

// FR-14 gifts in a live stream: a viewer spends the daily coins on gifts,
// the host receives them; a gift above 10 coins plays full screen for both.
test.use({
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

test("viewer sends gifts with coins; big ones play full screen for everyone", async ({
  page: hostPage,
  context: hostContext,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(300_000);
  const fixtures: Fixture[] = [];
  const viewerContext = await browser.newContext({
    baseURL,
    viewport: info.project.use.viewport,
  });
  try {
    const host = await verifiedAccount();
    fixtures.push(host);
    const viewer = await verifiedAccount();
    fixtures.push(viewer);
    const name = host.account.username;
    const fan = viewer.account.username;
    await hostContext.grantPermissions(["microphone", "camera"]);
    const viewerPage = await viewerContext.newPage();

    // The viewer takes the daily 100 coins.
    await login(viewerPage, viewer.account);
    await viewerPage.goto("/coins");
    await viewerPage.getByRole("button", { name: "Получить 100 монет" }).click();
    await expect(viewerPage.getByLabel("100 монет", { exact: true })).toBeVisible({
      timeout: 30_000,
    });

    await login(hostPage, host.account);
    await hostPage.goto("/live");
    const start = hostPage.getByRole("button", { name: "Начать эфир", exact: true });
    await expect(start).toBeEnabled({ timeout: 30_000 });
    await start.click();
    await expect(hostPage.getByRole("button", { name: "Завершить", exact: true })).toBeVisible({
      timeout: 20_000,
    });

    // The public host's avatar is a live ring that leads into the stream.
    await viewerPage.goto(`/${name}`);
    await viewerPage.getByRole("link", { name: `Смотреть эфир ${name}` }).first().click();
    await expect(viewerPage).toHaveURL(/\/live\/[\da-f-]+$/, { timeout: 60_000 });
    await expect(hostPage.getByLabel("Зрителей: 1")).toBeVisible({ timeout: 30_000 });

    const panel = viewerPage.getByRole("dialog", { name: "Подарки" });
    await viewerPage.getByRole("button", { name: "Подарки", exact: true }).click();
    await expect(panel.getByText("Баланс: 100 монет")).toBeVisible({ timeout: 15_000 });

    // A small gift: only a line that it was sent.
    await panel.getByRole("button", { name: "Подарить «Роза» за 1 монету" }).click();
    await expect(panel.getByText("Отправлено: «Роза»")).toBeVisible();
    await expect(panel.getByText("Баланс: 99 монет")).toBeVisible();
    const hostGifts = hostPage.getByRole("list", { name: "Подарки в эфире" });
    await expect(hostGifts.getByText("отправил(а) «Роза»")).toBeVisible({ timeout: 15_000 });
    await expect(hostPage.getByRole("status", { name: /дарит/ })).toHaveCount(0);

    // Above 10 coins: full screen for the viewer and the host.
    await panel
      .getByRole("button", { name: "Подарить «Хэллоуинская тыква» за 50 монет" })
      .click();
    const show = `${fan} дарит «Хэллоуинская тыква» за 50 монет`;
    await expect(viewerPage.getByRole("status", { name: show })).toBeVisible();
    await viewerPage.screenshot({ path: info.outputPath("gift-viewer.png") });
    await expect(panel).toBeHidden();
    await expect(hostPage.getByRole("status", { name: show })).toBeVisible({ timeout: 15_000 });
    await hostPage.screenshot({ path: info.outputPath("gift-host.png") });

    // 49 coins left: the cat costs 100.
    await expect(viewerPage.getByRole("status", { name: show })).toBeHidden({ timeout: 15_000 });
    await viewerPage.getByRole("button", { name: "Подарки", exact: true }).click();
    await expect(panel.getByText("Баланс: 49 монет")).toBeVisible({ timeout: 15_000 });
    await panel.getByRole("button", { name: "Подарить «Кошка» за 100 монет" }).click();
    await expect(panel.getByRole("alert")).toContainText("Недостаточно монет");
    await expect(panel.getByRole("link", { name: "Получить монеты" })).toBeVisible();

    // The host received the full prices.
    await hostPage.getByRole("button", { name: "Завершить", exact: true }).click();
    await expect(hostPage.getByRole("heading", { name: "Эфир завершён" })).toBeVisible();
    await hostPage.goto("/coins");
    await expect(hostPage.getByLabel("51 монет", { exact: true })).toBeVisible({
      timeout: 30_000,
    });
  } finally {
    await viewerContext.close();
    for (const fixture of fixtures) await fixture.stop();
  }
});
