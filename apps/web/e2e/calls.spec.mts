import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { login, registeredAccount, type Fixture } from "./helpers/app.mjs";

// Headless CI has no physical camera or microphone. Scope synthetic devices
// to call tests; real-network/TURN acceptance remains a separate check.
test.use({
  launchOptions: {
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  },
});

type Instrumented = Window & { __callPeers?: RTCPeerConnection[] };
async function instrument(context: BrowserContext) {
  await context.grantPermissions(["microphone", "camera"]);
  await context.addInitScript(() => {
    const Native = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Native {
      constructor(configuration?: RTCConfiguration) {
        super(configuration);
        const target = window as Instrumented;
        (target.__callPeers ??= []).push(this);
      }
    };
  });
}
async function received(page: Page, kind: string) {
  return page.evaluate(async (mediaKind) => {
    const peers = (window as Instrumented).__callPeers ?? [];
    for (const pc of peers) {
      if (pc.connectionState !== "connected") continue;
      const stats = await pc.getStats();
      for (const report of stats.values())
        if (
          report.type === "inbound-rtp" &&
          report.kind === mediaKind &&
          report.bytesReceived > 0
        )
          return true;
    }
    return false;
  }, kind);
}
for (const kind of ["AUDIO", "VIDEO"] as const) {
  test(`${kind}: real 1:1 media, controls, hangup and history`, async ({
    page,
    context,
    browser,
    baseURL,
  }, info) => {
    test.setTimeout(120000);
    const fixtures: Fixture[] = [];
    let secondContext: BrowserContext | undefined;
    try {
      const first = await registeredAccount(),
        second = await registeredAccount();
      fixtures.push(first, second);
      await instrument(context);
      secondContext = await browser.newContext({
        baseURL,
        viewport: info.project.use.viewport,
      });
      await instrument(secondContext);
      const peer = await secondContext.newPage();
      await login(page, first.account);
      await login(peer, second.account);
      await page.goto(`/${second.account.username}`);
      await page.getByRole("button", { name: "Написать", exact: true }).click();
      await expect(page).toHaveURL(/\/direct\/t\/[\da-f-]+$/);
      const conversationUrl = new URL(page.url()).pathname;
      await page
        .getByRole("button", {
          name: kind === "VIDEO" ? "Видеозвонок" : "Аудиозвонок",
          exact: true,
        })
        .click();
      const incoming = peer.getByRole("dialog");
      await expect(
        incoming.getByText(
          kind === "VIDEO" ? "Входящий видеозвонок" : "Входящий аудиозвонок",
          { exact: true },
        ),
      ).toBeVisible({ timeout: 15000 });
      // Incoming calls do not activate capture until the recipient accepts.
      expect(
        await peer.evaluate(
          () => ((window as Instrumented).__callPeers ?? []).length,
        ),
      ).toBe(0);
      await incoming
        .getByRole("button", { name: "Принять", exact: true })
        .click();
      await expect
        .poll(() => received(page, "audio"), { timeout: 25000 })
        .toBe(true);
      await expect
        .poll(() => received(peer, "audio"), { timeout: 25000 })
        .toBe(true);
      if (kind === "VIDEO") {
        await expect
          .poll(() => received(page, "video"), { timeout: 25000 })
          .toBe(true);
        await expect
          .poll(() => received(peer, "video"), { timeout: 25000 })
          .toBe(true);
      }
      await page.screenshot({ path: info.outputPath("call-connected.png") });
      const outgoing = page.getByRole("dialog");
      await outgoing
        .getByRole("button", { name: "Выключить микрофон", exact: true })
        .click();
      expect(
        await page.evaluate(
          () =>
            (window as Instrumented)
              .__callPeers![0].getSenders()
              .find((sender) => sender.track?.kind === "audio")!.track!.enabled,
        ),
      ).toBe(false);
      await outgoing
        .getByRole("button", { name: "Включить микрофон", exact: true })
        .click();
      await outgoing
        .getByRole("button", {
          name: "Выключить звук собеседника",
          exact: true,
        })
        .click();
      await expect(outgoing.getByLabel("Видео собеседника")).toHaveJSProperty(
        "muted",
        true,
      );
      // Muting output locally never disables the other participant's microphone.
      expect(
        await peer.evaluate(
          () =>
            (window as Instrumented)
              .__callPeers![0].getSenders()
              .find((sender) => sender.track?.kind === "audio")!.track!.enabled,
        ),
      ).toBe(true);
      await outgoing
        .getByRole("button", { name: "Включить звук собеседника", exact: true })
        .click();
      if (kind === "VIDEO") {
        await outgoing
          .getByRole("button", { name: "Выключить камеру", exact: true })
          .click();
        expect(
          await page.evaluate(
            () =>
              (window as Instrumented)
                .__callPeers![0].getSenders()
                .find((sender) => sender.track?.kind === "video")!.track!
                .enabled,
          ),
        ).toBe(false);
        await outgoing
          .getByRole("button", { name: "Включить камеру", exact: true })
          .click();
      }
      await outgoing.getByRole("button", { name: "Свернуть звонок" }).click();
      await expect(page.getByRole("dialog")).not.toBeVisible();
      await page
        .getByRole("button", { name: new RegExp(second.account.username) })
        .click();
      await outgoing
        .getByRole("button", { name: "Завершить звонок", exact: true })
        .click();
      await expect(
        incoming.getByText("Звонок завершён", { exact: true }),
      ).toBeVisible({ timeout: 12000 });
      expect(
        await page.evaluate(
          () => (window as Instrumented).__callPeers![0].connectionState,
        ),
      ).toBe("closed");
      expect(
        await peer.evaluate(
          () => (window as Instrumented).__callPeers![0].connectionState,
        ),
      ).toBe("closed");
      await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 6000 });
      await page
        .getByRole("button", { name: "История звонков", exact: true })
        .click();
      await expect(
        page
          .getByRole("region", { name: "Звонки в диалоге" })
          .getByText(/Завершён/),
      ).toBeVisible();
      await peer.goto(conversationUrl);
      await peer
        .getByRole("button", { name: "История звонков", exact: true })
        .click();
      await expect(
        peer
          .getByRole("region", { name: "Звонки в диалоге" })
          .getByText(/Завершён/),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (kind === "AUDIO" && info.project.name === "desktop") {
        await page
          .getByRole("button", { name: "Аудиозвонок", exact: true })
          .click();
        await peer
          .getByRole("dialog")
          .getByRole("button", { name: "Принять", exact: true })
          .click();
        await expect
          .poll(() => received(page, "audio"), { timeout: 25000 })
          .toBe(true);
        // A fetch that never settles must not leave microphone capture running.
        await page.route(
          "**/api/v1/calls/current",
          () => new Promise<void>(() => {}),
        );
        await expect
          .poll(
            () =>
              page.evaluate(
                () =>
                  (window as Instrumented).__callPeers!.at(-1)!.connectionState,
              ),
            { timeout: 25000 },
          )
          .toBe("closed");
        await expect
          .poll(
            () =>
              peer.evaluate(
                () =>
                  (window as Instrumented).__callPeers!.at(-1)!.connectionState,
              ),
            { timeout: 15000 },
          )
          .toBe("closed");
        await page.unrouteAll({ behavior: "ignoreErrors" });
      }
    } finally {
      await secondContext?.close();
      for (const fixture of fixtures) await fixture.stop();
    }
  });
}
