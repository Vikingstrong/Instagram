import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { login, verifiedAccount, type Fixture } from './helpers/app.mjs';

// The API's pinned ffmpeg makes a short clip: no binary fixture in Git.
async function makeClip(): Promise<Buffer> {
  const api = createRequire(new URL('../../api/package.json', import.meta.url));
  const ffmpeg = api('ffmpeg-static') as string;
  const dir = await mkdtemp(join(tmpdir(), 'instagram-e2e-video-'));
  const file = join(dir, 'clip.mp4');
  try {
    await promisify(execFile)(ffmpeg, [
      '-hide_banner',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=480x854:rate=25:duration=2',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=2',
      '-c:v',
      'libx264',
      '-c:a',
      'aac',
      '-shortest',
      file,
    ]);
    return await readFile(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Status of a Range request made by the page itself (its session cookie).
const rangeStatus = (page: Page, url: string) =>
  page.evaluate(
    async (target) =>
      (await fetch(target, { headers: { Range: 'bytes=0-1023' } })).status,
    url,
  );

// FR-10: publish a video, watch the processing finish, see it in the post
// and in another user's Reels with a like; the file is served in ranges
// only to those who may see it, and disappears with the post.
test('publish a video, watch it in the post and in Reels', async ({ page, browser, baseURL }, info) => {
  test.setTimeout(240_000);
  const fixtures: Fixture[] = [];
  let viewerContext: BrowserContext | undefined;
  try {
    const owner = await verifiedAccount();
    fixtures.push(owner);
    const viewer = await verifiedAccount();
    fixtures.push(viewer);
    const caption = `Ролик ${randomUUID().slice(0, 8)}`;

    await login(page, owner.account);
    await page.goto('/create');
    await page.getByLabel('Фото или видео для публикации').setInputFiles({
      name: 'clip.mp4',
      mimeType: 'video/mp4',
      buffer: await makeClip(),
    });
    await expect(page.getByLabel('Выбранное видео')).toBeVisible();
    await page.getByRole('textbox', { name: 'Подпись' }).fill(caption);
    await page.getByRole('button', { name: 'Поделиться' }).click();
    await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}$/, { timeout: 90_000 });
    const postUrl = new URL(page.url()).pathname;

    const video = page.getByLabel(caption);
    await expect(video).toBeVisible();
    const src = (await video.getAttribute('src'))!;
    expect(src).toMatch(/^\/api\/v1\/media\/[0-9a-f-]{36}\/video$/);
    expect(await rangeStatus(page, src)).toBe(206);
    // Bundled Chromium has no H.264 decoder; Chrome proves playback.
    if (info.project.use.channel === 'chrome')
      await expect
        .poll(() => video.evaluate((node: HTMLVideoElement) => node.readyState))
        .toBeGreaterThan(0);

    viewerContext = await browser.newContext({ baseURL, viewport: info.project.use.viewport });
    const viewerPage = await viewerContext.newPage();
    await login(viewerPage, viewer.account);
    await viewerPage.goto('/reels');
    const reel = viewerPage.getByRole('article', { name: `Reels ${owner.account.username}` });
    await expect(reel).toBeVisible({ timeout: 15_000 });
    await expect(reel.getByLabel(caption)).toBeVisible();
    await reel.getByRole('button', { name: 'Нравится' }).click();
    await expect(reel.getByRole('button', { name: 'Не нравится' })).toBeVisible();
    await expect(reel.getByText('1', { exact: true })).toBeVisible();
    expect(await rangeStatus(viewerPage, src)).toBe(206);

    // The owner deletes the post: its video stops being served at once.
    await page.getByRole('button', { name: 'Удалить публикацию' }).click();
    await page
      .getByRole('dialog', { name: 'Удалить публикацию?' })
      .getByRole('button', { name: 'Удалить', exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/${owner.account.username}$`), { timeout: 30_000 });
    expect(await rangeStatus(viewerPage, src)).toBe(404);
    await viewerPage.goto(postUrl);
    await expect(viewerPage.getByRole('heading', { name: 'Публикация недоступна' })).toBeVisible();
  } finally {
    await viewerContext?.close();
    for (const fixture of fixtures) await fixture.stop();
  }
});
