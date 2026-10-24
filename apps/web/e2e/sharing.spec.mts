import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  expectLoaded,
  login,
  photo,
  verifiedAccount,
  type Fixture,
} from "./helpers/app.mjs";

async function clip() {
  const api = createRequire(new URL("../../api/package.json", import.meta.url));
  const dir = await mkdtemp(join(tmpdir(), "sharing-video-"));
  const path = join(dir, "clip.mp4");
  try {
    await promisify(execFile)(api("ffmpeg-static") as string, [
      "-hide_banner",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=120x160:r=10:d=1",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-an",
      path,
    ]);
    return await readFile(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
async function choose(page: Page, username: string, search = false) {
  const dialog = page.getByRole("dialog", { name: "Поделиться" });
  if (search)
    await dialog
      .getByRole("textbox", { name: "Найти получателя" })
      .fill(username);
  await dialog.getByRole("button", { name: username, exact: true }).click();
  await dialog.getByRole("button", { name: "Отправить", exact: true }).click();
}

test("share post, story and reel in Direct with unique counters, retry and private original links", async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(240_000);
  const fixtures: Fixture[] = [];
  const contexts: BrowserContext[] = [];
  try {
    const alice = await verifiedAccount();
    fixtures.push(alice);
    const bob = await verifiedAccount();
    fixtures.push(bob);
    await login(page, alice.account);
    await page.goto("/create");
    await page
      .getByLabel("Фото или видео для публикации")
      .setInputFiles({
        name: "share.png",
        mimeType: "image/png",
        buffer: photo([100, 160, 200]),
      });
    await page
      .getByRole("textbox", { name: "Подпись" })
      .fill("Публикация для пересылки");
    await page.getByRole("button", { name: "Поделиться", exact: true }).click();
    await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const sourceUrl = new URL(page.url()).pathname;
    let lose = true;
    await page.route(
      "**/api/v1/direct/conversations/*/messages/share",
      async (route) => {
        if (lose) {
          lose = false;
          await route.fetch();
          await route.abort();
        } else await route.continue();
      },
    );
    await page.getByRole("button", { name: "Поделиться", exact: true }).click();
    await choose(page, bob.account.username, true);
    const modal = page.getByRole("dialog", { name: "Поделиться" });
    await expect(modal.getByRole("alert")).toBeVisible();
    await expect(page.getByLabel("Поделились: 0")).toBeVisible();
    await modal
      .getByRole("button", { name: "Повторить отправку", exact: true })
      .click();
    await expect(modal).toHaveCount(0);
    await expect(page.getByLabel("Поделились: 1")).toBeVisible();
    const context = await browser.newContext({
      baseURL,
      viewport: info.project.use.viewport,
    });
    contexts.push(context);
    const receiver = await context.newPage();
    await login(receiver, bob.account);
    await receiver.goto("/direct");
    await receiver
      .getByRole("navigation", { name: "Диалоги" })
      .getByRole("link", { name: new RegExp(alice.account.username) })
      .click();
    const card = receiver.getByRole("link", {
      name: `Открыть публикацию ${alice.account.username}`,
      exact: true,
    });
    await expect(card).toHaveCount(1);
    await expect(card).toHaveAttribute("href", sourceUrl);
    await expectLoaded(card.getByRole("img"));
    await page.getByRole("button", { name: "Поделиться", exact: true }).click();
    await choose(page, bob.account.username);
    await expect(page.getByLabel("Поделились: 1")).toBeVisible();
    await expect(card).toHaveCount(2);

    await page.goto("/stories/create");
    await page
      .getByLabel("Фото или видео для истории")
      .setInputFiles({
        name: "story.png",
        mimeType: "image/png",
        buffer: photo([200, 160, 100]),
      });
    await page
      .getByRole("button", { name: "Опубликовать историю", exact: true })
      .click();
    await expect(page).toHaveURL(/\/stories\/[0-9a-f-]{36}$/, {
      timeout: 30_000,
    });
    const storyUrl = new URL(page.url()).pathname;
    await page.getByRole("button", { name: "Поделиться", exact: true }).click();
    await page.waitForTimeout(5500);
    await expect(page).toHaveURL(new RegExp(`${storyUrl}$`));
    await choose(page, bob.account.username);
    const storyCard = receiver.getByRole("link", {
      name: `Открыть историю ${alice.account.username}`,
      exact: true,
    });
    await expect(storyCard).toHaveAttribute("href", storyUrl);
    await expectLoaded(storyCard.getByRole("img"));

    await page.goto("/create");
    await page
      .getByLabel("Фото или видео для публикации")
      .setInputFiles({
        name: "reel.mp4",
        mimeType: "video/mp4",
        buffer: await clip(),
      });
    await page
      .getByRole("textbox", { name: "Подпись" })
      .fill("Reels для пересылки");
    await page.getByRole("button", { name: "Поделиться", exact: true }).click();
    await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const reelUrl = new URL(page.url()).pathname;
    await expect(
      page.getByRole("button", { name: "Поделиться", exact: true }),
    ).toBeVisible({ timeout: 30_000 });
    await page.goto("/reels");
    const reel = page.getByRole("article", {
      name: `Reels ${alice.account.username}`,
      exact: true,
    });
    await expect(reel).toBeVisible();
    await expect(
      reel.getByRole("button", { name: "Поделиться", exact: true }),
    ).toBeInViewport();
    await reel.getByRole("button", { name: "Поделиться", exact: true }).click();
    await choose(page, bob.account.username);
    const reelCard = receiver.getByRole("link", {
      name: `Открыть Reels ${alice.account.username}`,
      exact: true,
    });
    await expect(reelCard).toHaveAttribute("href", reelUrl);
    await expectLoaded(reelCard.getByRole("img"));
    await receiver.reload();
    await expect(reelCard).toHaveCount(1);
    await expect(storyCard).toHaveCount(1);
    await expect(card).toHaveCount(2);
    await page.goto(sourceUrl);
    await expect(page.getByLabel("Поделились: 1")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    for (const context of contexts) await context.close();
    for (const fixture of fixtures) await fixture.stop();
  }
});
