import { test, expect, type Page } from "@playwright/test";
import { login, verifiedAccount, type Fixture } from "./helpers/app.mjs";

// Live moderation: the host appoints a moderator, the moderator mutes a
// viewer, the host bans them — the viewer is sent home with the message
// and the host's streams are gone for them.
test.use({
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});

test("host appoints a moderator who mutes; a banned viewer is sent home", async ({
  page: hostPage,
  context: hostContext,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(300_000);
  const fixtures: Fixture[] = [];
  const contexts = await Promise.all(
    [0, 1].map(() => browser.newContext({ baseURL, viewport: info.project.use.viewport })),
  );
  try {
    const host = await verifiedAccount();
    fixtures.push(host);
    const helper = await verifiedAccount();
    fixtures.push(helper);
    const troll = await verifiedAccount();
    fixtures.push(troll);
    const name = host.account.username;
    await hostContext.grantPermissions(["microphone", "camera"]);
    const [modPage, trollPage] = await Promise.all(contexts.map((context) => context.newPage()));

    await login(hostPage, host.account);
    await hostPage.goto("/live");
    const start = hostPage.getByRole("button", { name: "Начать эфир", exact: true });
    await expect(start).toBeEnabled({ timeout: 30_000 });
    await start.click();
    await expect(hostPage.getByRole("button", { name: "Завершить", exact: true })).toBeVisible({
      timeout: 20_000,
    });

    async function watch(page: Page, account: Fixture["account"]) {
      await login(page, account);
      await page.goto(`/${name}`);
      await page.getByRole("link", { name: `Смотреть эфир ${name}` }).first().click();
      await expect(page).toHaveURL(/\/live\/[\da-f-]+$/, { timeout: 60_000 });
    }
    async function say(page: Page, text: string) {
      await page.getByLabel("Комментарий к эфиру").fill(text);
      await page.getByRole("button", { name: "Отправить комментарий" }).click();
    }
    async function act(page: Page, user: string, action: string) {
      await page.getByRole("button", { name: `Модерация ${user}` }).first().click();
      await page.getByRole("dialog", { name: `Действия с ${user}` }).getByRole("menuitem", { name: action }).click();
    }
    await watch(modPage, helper.account);
    await watch(trollPage, troll.account);
    await say(modPage, "Я помогу");
    await say(trollPage, "спам спам");
    const hostChat = hostPage.getByRole("complementary", { name: "Чат эфира" });
    await expect(hostChat.getByText("спам спам")).toBeVisible({ timeout: 15_000 });

    // The host appoints the helper; the helper gets the moderation tools.
    await act(hostPage, helper.account.username, "Назначить модератором");
    await expect(modPage.getByRole("button", { name: "Модерация", exact: true })).toBeVisible({
      timeout: 15_000,
    });

    // The moderator mutes the troll for 5 minutes.
    await act(modPage, troll.account.username, "Мут на 5 минут");
    await expect(trollPage.getByText(/Вам запрещено писать в этом эфире до \d\d:\d\d\./)).toBeVisible({
      timeout: 15_000,
    });
    await expect(trollPage.getByLabel("Комментарий к эфиру")).toHaveCount(0);
    await expect(trollPage.getByRole("button", { name: "Подарки", exact: true })).toHaveCount(0);

    // The host bans the troll: sent home with the message, lines removed.
    await act(hostPage, troll.account.username, "Заблокировать");
    await expect(trollPage).toHaveURL(/\/$/, { timeout: 20_000 });
    await expect(trollPage.getByRole("alert").filter({ hasText: "Вас забанили на трансляции" })).toBeVisible();
    await expect(hostChat.getByText("спам спам")).toHaveCount(0, { timeout: 15_000 });
    await trollPage.screenshot({ path: info.outputPath("banned-home.png") });

    // The host's stream is gone for the troll: no live ring, no way back.
    await trollPage.goto(`/${name}`);
    await expect(trollPage.getByRole("heading", { name })).toBeVisible({ timeout: 30_000 });
    await expect(trollPage.getByRole("link", { name: `Смотреть эфир ${name}` })).toHaveCount(0);

    // The host sees and lifts the ban in the moderation dialog.
    await hostPage.getByRole("button", { name: "Модерация", exact: true }).click();
    const panel = hostPage.getByRole("dialog", { name: "Модерация" });
    await expect(panel.getByText(helper.account.username)).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByText("заблокирован(а)", { exact: false })).toBeVisible();
    await hostPage.screenshot({ path: info.outputPath("moderation-host.png") });
    await panel.getByRole("button", { name: "Разблокировать" }).click();
    // The 5-minute mute stays; only the ban is lifted.
    await expect(panel.getByText("заблокирован(а)", { exact: false })).toHaveCount(0, { timeout: 15_000 });
    await expect(panel.getByText(/мут до/)).toBeVisible();
    await trollPage.reload();
    await expect(trollPage.getByRole("link", { name: `Смотреть эфир ${name}` }).first()).toBeVisible({
      timeout: 30_000,
    });
  } finally {
    for (const context of contexts) await context.close();
    for (const fixture of fixtures) await fixture.stop();
  }
});
