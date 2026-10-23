import { expect, test } from "@playwright/test";
import { AuthCsrfResponseSchema } from "@instagram/contracts";
import {
  expectLoaded,
  login,
  photo,
  verifiedAccount,
  type Fixture,
} from "./helpers/app.mjs";

test.use({ actionTimeout: 15_000 });

// FR-13: two real accounts; no fixture story payloads or mocked media API.
test("create a story, view as another user, inspect viewers and delete", async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(180_000);
  const fixtures: Fixture[] = [];
  const context = await browser.newContext({
    baseURL,
    viewport: info.project.use.viewport,
  });
  const viewer = await context.newPage();
  let storyId: string | undefined;
  try {
    const owner = await verifiedAccount();
    fixtures.push(owner);
    const other = await verifiedAccount();
    fixtures.push(other);
    await login(page, owner.account);
    await page.getByRole("button", { name: "Создать", exact: true }).filter({ visible: true }).click();
    await page.getByRole("dialog", { name: "Что создадим?" }).getByRole("link", { name: "История", exact: true }).click();
    await page.getByLabel("Фото или видео для истории").setInputFiles({
      name: "story.png",
      mimeType: "image/png",
      buffer: photo([90, 150, 240]),
    });
    await expectLoaded(page.getByRole("img", { name: "Выбранное фото" }));
    const published = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/stories") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Опубликовать историю" }).click();
    const response = await published;
    expect(response.status()).toBe(201);
    const story = (await response.json()).story;
    storyId = story.id;
    await expect(page).toHaveURL(new RegExp(`/stories/${storyId}$`), {
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Приостановить историю" }).click();
    await expectLoaded(
      page.getByRole("img", { name: `История ${owner.account.username}` }),
    );

    await login(viewer, other.account);
    const csrf = AuthCsrfResponseSchema.parse(
      await (await viewer.request.get("/api/v1/auth/csrf")).json(),
    ).csrfToken;
    const follow = await viewer.request.post(
      `/api/v1/users/${story.author.id}/follow`,
      { data: {}, headers: { Origin: baseURL!, "X-CSRF-Token": csrf } },
    );
    expect(follow.status()).toBe(200);
    await viewer.goto("/");
    await viewer
      .getByRole("link", { name: `Истории ${owner.account.username}, новые` })
      .click();
    await expect(viewer).toHaveURL(new RegExp(`/stories/${storyId}$`), {
      timeout: 30_000,
    });
    await viewer.getByRole("button", { name: "Приостановить историю" }).click();
    await expectLoaded(
      viewer.getByRole("img", { name: `История ${owner.account.username}` }),
    );
    await expect
      .poll(async () => {
        const result = await page.request.get(
          `/api/v1/stories/${storyId}/viewers`,
        );
        return (await result.json()).total;
      })
      .toBe(1);
    await page.getByRole("button", { name: "Зрители", exact: true }).click();
    const audience = page.getByRole("dialog", { name: "Зрители истории" });
    await expect(
      audience.getByRole("link", { name: other.account.username }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Закрыть список зрителей" }).click();

    // Reloading does not add another viewer. The profile avatar also opens it.
    await viewer.goto(`/${owner.account.username}`);
    const ring = viewer.getByRole("link", {
      name: `Истории ${owner.account.username}`,
      exact: true,
    });
    await ring.filter({ visible: true }).first().click();
    await expect(viewer).toHaveURL(new RegExp(`/stories/${storyId}$`), {
      timeout: 30_000,
    });
    await viewer.getByRole("button", { name: "Приостановить историю" }).click();
    await expectLoaded(
      viewer.getByRole("img", { name: `История ${owner.account.username}` }),
    );
    expect(
      (
        await (
          await page.request.get(`/api/v1/stories/${storyId}/viewers`)
        ).json()
      ).total,
    ).toBe(1);

    await page.getByRole("button", { name: "Удалить", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Удалить историю?" })
      .getByRole("button", { name: "Удалить историю", exact: true })
      .click();
    await expect(page).toHaveURL(baseURL! + "/", { timeout: 30_000 });
    expect((await viewer.request.get(story.image.url)).status()).toBe(404);
    await viewer.reload();
    await expect(
      viewer.getByRole("alert").filter({ hasText: "История недоступна" }),
    ).toBeVisible();
    storyId = undefined;
  } finally {
    if (storyId) {
      const csrf = await page.request.get("/api/v1/auth/csrf");
      if (csrf.ok())
        await page.request.delete(`/api/v1/stories/${storyId}`, {
          data: {},
          headers: {
            Origin: baseURL!,
            "X-CSRF-Token": (await csrf.json()).csrfToken,
          },
        });
    }
    await context.close();
    for (const fixture of fixtures) await fixture.stop();
  }
});

// Real video upload/processing and protected Range delivery. The optional
// Chrome run also verifies native H.264 playback; bundled Chromium may lack it.
test("publish a video story, finish processing and delete it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { execFile } = await import("node:child_process");
  const { mkdtemp, readFile, rm } = await import("node:fs/promises");
  const { createRequire } = await import("node:module");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { promisify } = await import("node:util");
  const api = createRequire(new URL("../../api/package.json", import.meta.url));
  const dir = await mkdtemp(join(tmpdir(), "stories-browser-"));
  const original = join(dir, "clip.mp4");
  let fixture: Fixture | undefined;
  let id: string | undefined;
  try {
    await promisify(execFile)(api("ffmpeg-static") as string, [
      "-hide_banner",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=160x240:rate=10:duration=10",
      "-c:v",
      "libx264",
      original,
    ]);
    fixture = await verifiedAccount();
    await login(page, fixture.account);
    await page.goto("/stories/create");
    await page
      .getByLabel("Фото или видео для истории")
      .setInputFiles({
        name: "clip.mp4",
        mimeType: "video/mp4",
        buffer: await readFile(original),
      });
    const published = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/stories/video") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Опубликовать историю" }).click();
    const response = await published;
    expect(response.status()).toBe(201);
    id = (await response.json()).story.id;
    await expect(page).toHaveURL(new RegExp(`/stories/${id}$`), {
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Приостановить историю" }).click();
    const video = page.getByLabel("Видео истории");
    await expect(video).toBeVisible({ timeout: 30_000 });
    const src = (await video.getAttribute("src"))!;
    expect(
      (
        await page.request.get(src, { headers: { Range: "bytes=0-31" } })
      ).status(),
    ).toBe(206);
    if (process.env.STORIES_EXPECT_VIDEO_PLAYBACK === "true") {
      await expect
        .poll(() => video.evaluate((node: HTMLVideoElement) => node.readyState))
        .toBeGreaterThan(0);
      await page.getByRole("button", { name: "Продолжить историю" }).click();
      await expect
        .poll(() =>
          video.evaluate((node: HTMLVideoElement) => node.currentTime),
        )
        .toBeGreaterThan(0);
      await page.getByRole("button", { name: "Приостановить историю" }).click();
    }
    await page.getByRole("button", { name: "Удалить", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Удалить историю?" })
      .getByRole("button", { name: "Удалить историю", exact: true })
      .click();
    await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
    expect((await page.request.get(src)).status()).toBe(404);
    id = undefined;
  } finally {
    if (id) {
      const csrf = await page.request.get("/api/v1/auth/csrf");
      if (csrf.ok())
        await page.request.delete(`/api/v1/stories/${id}`, {
          data: {},
          headers: {
            Origin: "http://localhost:3000",
            "X-CSRF-Token": (await csrf.json()).csrfToken,
          },
        });
    }
    await fixture?.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
