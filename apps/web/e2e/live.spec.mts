import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { login, verifiedAccount, type Fixture } from "./helpers/app.mjs";

// FR-12 / stage 10: a private host goes live; an approved follower is told,
// watches real WebRTC media and chats; a stranger gets nothing; the end of
// the stream reaches the viewer.
type Instrumented = Window & { __livePeers?: RTCPeerConnection[] };
// Synthetic camera and microphone, also on a developer PC with real ones.
test.use({
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  },
});
async function instrument(context: BrowserContext) {
  await context.grantPermissions(["microphone", "camera"]);
  await context.addInitScript(() => {
    const Native = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Native {
      constructor(configuration?: RTCConfiguration) {
        super(configuration);
        ((window as Instrumented).__livePeers ??= []).push(this);
      }
    };
  });
}
// Bytes of real RTP received by any connected peer of the page.
async function received(page: Page, kind: "audio" | "video") {
  return page.evaluate(async (mediaKind) => {
    let bytes = 0;
    for (const pc of (window as Instrumented).__livePeers ?? []) {
      if (pc.connectionState !== "connected") continue;
      for (const report of (await pc.getStats()).values())
        if (report.type === "inbound-rtp" && report.kind === mediaKind)
          bytes += report.bytesReceived ?? 0;
    }
    return bytes;
  }, kind);
}

test("private host goes live; follower watches and chats; stranger is refused", async ({
  page: hostPage,
  context: hostContext,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(300_000);
  const fixtures: Fixture[] = [];
  const contexts: BrowserContext[] = [];
  try {
    const host = await verifiedAccount();
    fixtures.push(host);
    const follower = await verifiedAccount();
    fixtures.push(follower);
    const stranger = await verifiedAccount();
    fixtures.push(stranger);
    const name = host.account.username;
    const open = async () => {
      const context = await browser.newContext({ baseURL, viewport: info.project.use.viewport });
      contexts.push(context);
      await instrument(context);
      return context.newPage();
    };
    await instrument(hostContext);
    const viewerPage = await open();
    const strangerPage = await open();

    // The host's account is private; the follower is approved.
    await login(hostPage, host.account);
    await hostPage.goto("/accounts/privacy");
    await hostPage.getByRole("switch", { name: "Закрытый аккаунт" }).click();
    await expect(hostPage.getByText("Аккаунт закрыт. Текущие подписчики сохранены.")).toBeVisible();
    await login(viewerPage, follower.account);
    await viewerPage.goto(`/${name}`);
    await viewerPage.getByRole("button", { name: "Подписаться", exact: true }).click();
    await expect(viewerPage.getByRole("button", { name: "Запрос отправлен", exact: true })).toBeVisible();
    await hostPage.goto("/notifications");
    await hostPage
      .getByRole("button", { name: `Подтвердить запрос ${follower.account.username}` })
      .click();
    await expect(hostPage.getByText("Новых запросов нет.")).toBeVisible();
    await viewerPage.goto("/");

    // Preview first, then go live.
    await hostPage.goto("/live");
    const start = hostPage.getByRole("button", { name: "Начать эфир", exact: true });
    await expect(start).toBeEnabled({ timeout: 20_000 });
    await expect(hostPage.getByRole("combobox", { name: "Камера" })).toBeVisible();
    await start.click();
    await expect(hostPage.getByRole("button", { name: "Завершить", exact: true })).toBeVisible({
      timeout: 20_000,
    });

    // The follower is told over SSE and joins from the notice.
    const notice = viewerPage.getByRole("status").filter({ hasText: "начал(а) прямой эфир" });
    await expect(notice).toBeVisible({ timeout: 20_000 });
    await notice.getByRole("link", { name: "Смотреть" }).click();
    // The first visit compiles the route in dev mode.
    await expect(viewerPage).toHaveURL(/\/live\/[\da-f-]+$/, { timeout: 60_000 });
    const liveUrl = new URL(viewerPage.url()).pathname;
    await expect.poll(() => received(viewerPage, "video"), { timeout: 30_000 }).toBeGreaterThan(0);
    await expect.poll(() => received(viewerPage, "audio"), { timeout: 30_000 }).toBeGreaterThan(0);
    await expect(hostPage.getByLabel("Зрителей: 1")).toBeVisible({ timeout: 15_000 });

    // Chat both ways.
    await viewerPage.getByLabel("Комментарий к эфиру").fill("Привет из зрительного зала");
    await viewerPage.getByRole("button", { name: "Отправить комментарий" }).click();
    const hostChat = hostPage.getByRole("complementary", { name: "Чат эфира" });
    await expect(hostChat.getByText("Привет из зрительного зала")).toBeVisible({ timeout: 15_000 });
    await hostPage.getByLabel("Комментарий к эфиру").fill("Спасибо, что смотрите");
    await hostPage.getByRole("button", { name: "Отправить комментарий" }).click();
    await expect(
      viewerPage.getByRole("complementary", { name: "Чат эфира" }).getByText("Спасибо, что смотрите"),
    ).toBeVisible({ timeout: 15_000 });

    // A short network break: the viewer keeps watching afterwards.
    await viewerPage.context().setOffline(true);
    await viewerPage.waitForTimeout(4000);
    await viewerPage.context().setOffline(false);
    const before = await received(viewerPage, "video");
    await expect.poll(() => received(viewerPage, "video"), { timeout: 30_000 }).toBeGreaterThan(before);
    // A reload is a new connection to the same stream.
    await viewerPage.reload();
    await expect.poll(() => received(viewerPage, "video"), { timeout: 30_000 }).toBeGreaterThan(0);
    await expect(hostPage.getByLabel("Зрителей: 1")).toBeVisible({ timeout: 15_000 });
    await hostPage.screenshot({ path: info.outputPath("live-host.png") });
    await viewerPage.screenshot({ path: info.outputPath("live-viewer.png") });

    // A stranger sees neither the stream nor the live ring.
    await login(strangerPage, stranger.account);
    await strangerPage.goto(liveUrl);
    await expect(strangerPage.getByRole("heading", { name: "Эфир недоступен" })).toBeVisible({
      timeout: 15_000,
    });
    await strangerPage.goto(`/${name}`);
    await expect(strangerPage.getByText("Это закрытый аккаунт")).toBeVisible();
    await expect(strangerPage.getByRole("link", { name: `Смотреть эфир ${name}` })).toHaveCount(0);
    expect(await strangerPage.evaluate(() => ((window as Instrumented).__livePeers ?? []).length)).toBe(0);

    // Ending closes the stream for the viewer too and releases the camera.
    await hostPage.getByRole("button", { name: "Завершить", exact: true }).click();
    await expect(hostPage.getByRole("heading", { name: "Эфир завершён" })).toBeVisible();
    await expect(viewerPage.getByText("Эфир завершён", { exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(viewerPage.getByText("Эфир завершён — чат закрыт.")).toBeVisible();
    expect(
      await hostPage.evaluate(() =>
        ((window as Instrumented).__livePeers ?? []).every((pc) => pc.connectionState === "closed"),
      ),
    ).toBe(true);
  } finally {
    for (const context of contexts) await context.close();
    for (const fixture of fixtures) await fixture.stop();
  }
});
