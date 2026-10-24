import { expect, test, type BrowserContext } from '@playwright/test';
import { expectLoaded, login, photo, verifiedAccount, type Fixture } from './helpers/app.mjs';

test.use({
  permissions: ['microphone'],
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] },
});

test('private photos, GIF and recorded voice in Direct survive reload and a lost upload response', async ({ page, browser, baseURL }, info) => {
  test.setTimeout(240_000);
  const fixtures: Fixture[] = [];
  const contexts: BrowserContext[] = [];
  try {
    const alice = await verifiedAccount(); fixtures.push(alice);
    const bob = await verifiedAccount(); fixtures.push(bob);
    const eve = await verifiedAccount(); fixtures.push(eve);
    await login(page, alice.account);
    await page.goto(`/${bob.account.username}`);
    await page.getByRole('button', { name: 'Написать' }).click();
    await expect(page).toHaveURL(/\/direct\/t\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const conversationUrl = new URL(page.url()).pathname;
    const bobContext = await browser.newContext({ baseURL, viewport: info.project.use.viewport }); contexts.push(bobContext);
    const bobPage = await bobContext.newPage();
    await login(bobPage, bob.account); await bobPage.goto(conversationUrl);
    await expect(bobPage.getByText('В сети', { exact: true })).toBeVisible({ timeout: 15_000 });

    // The server commits, but the sender loses the response. Retry must return
    // the exact stored message; the receiver already saw the single SSE notice.
    let lose = true;
    await page.route('**/api/v1/direct/conversations/*/messages/image', async route => {
      if (lose) { lose = false; await route.fetch(); await route.abort(); }
      else await route.continue();
    });
    await page.getByLabel('Фото или GIF в сообщение').setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: photo([80,140,190]) });
    await expect(page.getByAltText('Превью сообщения')).toBeVisible();
    await page.getByRole('button', { name: 'Отправить', exact: true }).click();
    await expect(page.getByText(/Не отправлено/)).toBeVisible();
    await expectLoaded(bobPage.getByAltText('Фото или GIF в сообщении'));
    await page.getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect(page.getByText('Отправка…', { exact: true })).toHaveCount(0);
    await expectLoaded(page.getByAltText('Фото или GIF в сообщении'));
    await expect(bobPage.getByAltText('Фото или GIF в сообщении')).toHaveCount(1);

    await page.getByLabel('Фото или GIF в сообщение').setInputFiles({ name: 'motion.gif', mimeType: 'image/gif', buffer: Buffer.from('R0lGODlhBAAEAIAAAExpcRQUFCH/C05FVFNDQVBFMi4wAwEAAAAh+QQFCgAAACwAAAAABAAEAAACBIyPGQUAIfkEBRQAAAAsAAAAAAQABACATGlx8PDwAgSMjxkFADs=', 'base64') });
    await page.getByRole('button', { name: 'Отправить', exact: true }).click();
    await expect(bobPage.getByAltText('Фото или GIF в сообщении')).toHaveCount(2);
    await expectLoaded(bobPage.getByAltText('Фото или GIF в сообщении').nth(1));

    await page.getByRole('button', { name: 'Записать голосовое', exact: true }).click();
    await expect(page.getByText(/Запись ·/)).toBeVisible();
    await page.waitForTimeout(1300);
    await page.getByRole('button', { name: 'Остановить', exact: true }).click();
    await expect(page.getByLabel('Прослушать запись')).toBeVisible();
    await page.getByRole('button', { name: 'Отправить', exact: true }).click();
    const voice = bobPage.locator('audio[aria-label="Голосовое сообщение"]');
    await expect(voice).toHaveCount(1);
    await expect.poll(() => voice.evaluate((element: HTMLAudioElement) => element.readyState), { timeout: 20_000 }).toBeGreaterThan(0);
    await voice.evaluate((element: HTMLAudioElement) => element.play());
    await expect.poll(() => voice.evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThan(0);
    await voice.evaluate((element: HTMLAudioElement) => element.pause());
    const audioUrl = await voice.locator('source').first().getAttribute('src');
    expect((await bobPage.request.get(audioUrl!, { headers: { Range: 'bytes=0-31' } })).status()).toBe(206);
    await bobPage.reload();
    await expect(bobPage.getByAltText('Фото или GIF в сообщении')).toHaveCount(2);
    await expect(bobPage.locator('audio[aria-label="Голосовое сообщение"]')).toHaveCount(1);
    expect(await bobPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const recordButton = bobPage.getByRole('button', { name: 'Записать голосовое', exact: true });
    await expect(recordButton).toBeInViewport({ ratio: 1 });
    if (info.project.name === 'mobile') {
      expect(await recordButton.evaluate(element => {
        const rect = element.getBoundingClientRect(); const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return target === element || (target !== null && element.contains(target));
      })).toBe(true);
      expect(await bobPage.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1)).toBe(true);
      const original = bobPage.viewportSize()!;
      await bobPage.setViewportSize({ width: original.width, height: 500 });
      await expect(recordButton).toBeInViewport({ ratio: 1 });
      await bobPage.setViewportSize(original);
    }

    await bobPage.screenshot({ path: info.outputPath('direct-media.png'), fullPage: true });

    const eveContext = await browser.newContext({ baseURL }); contexts.push(eveContext);
    expect((await eveContext.request.get(audioUrl!)).status()).toBe(401);
    const evePage = await eveContext.newPage(); await login(evePage, eve.account);
    expect((await evePage.request.get(audioUrl!)).status()).toBe(404);
    await evePage.goto(conversationUrl);
    await expect(evePage.getByRole('heading', { name: 'Диалог не найден' })).toBeVisible();
  } finally {
    for (const context of contexts) await context.close();
    for (const fixture of fixtures) await fixture.stop();
  }
});
