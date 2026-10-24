import { expect, test } from '@playwright/test';
import { expectLoaded, login, photo, verifiedAccount, type Fixture } from './helpers/app.mjs';

// FR-04: publish a photo, see it in the profile grid and on its page, set an
// avatar, then delete the post; its image stops being served right away.
test('publish, view, set an avatar and delete a post', async ({ page, playwright, baseURL }) => {
  test.setTimeout(180_000);
  const fixtures: Fixture[] = [];
  try {
    const owner = await verifiedAccount();
    fixtures.push(owner);
    const name = owner.account.username;
    await login(page, owner.account);

    await page.goto('/create');
    await page.getByLabel('Фото или видео для публикации').setInputFiles({
      name: 'sunset.png',
      mimeType: 'image/png',
      buffer: photo([232, 116, 59]),
    });
    await expect(page.getByRole('img', { name: 'Выбранное фото' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Подпись' }).fill('Закат на море');
    await page.getByRole('button', { name: 'Поделиться' }).click();
    await expect(page).toHaveURL(/\/p\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const full = page.getByRole('img', { name: 'Закат на море' });
    await expectLoaded(full);
    const fullUrl = await full.getAttribute('src');
    expect(fullUrl).toMatch(/^\/api\/v1\/media\/[0-9a-f-]{36}\/full$/);
    // Even the owner cannot send protected media through Next's shared cache.
    expect((await page.request.get('/_next/image', { params: { url: fullUrl!, w: '128', q: '75' } })).status()).toBe(400);

    // A request without the session cookie gets no image.
    const guest = await playwright.request.newContext({ baseURL });
    expect((await guest.get(fullUrl!)).status()).not.toBe(200);
    await guest.dispose();

    await page.getByLabel('Прикрепить фото или GIF').setInputFiles({ name: 'comment.png', mimeType: 'image/png', buffer: photo([80, 170, 110]) });
    await expect(page.getByAltText('Превью вложения')).toBeVisible();
    await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
    await expectLoaded(page.getByAltText('Вложение комментария'));
    const attachmentUrl = await page.getByAltText('Вложение комментария').getAttribute('src');
    await page.reload();
    await expectLoaded(page.getByAltText('Вложение комментария'));
    await page.getByLabel('Прикрепить фото или GIF').setInputFiles({ name: 'motion.gif', mimeType: 'image/gif', buffer: Buffer.from('R0lGODlhBAAEAIAAAExpcRQUFCH/C05FVFNDQVBFMi4wAwEAAAAh+QQFCgAAACwAAAAABAAEAAACBIyPGQUAIfkEBRQAAAAsAAAAAAQABACATGlx8PDwAgSMjxkFADs=', 'base64') });
    await page.getByRole('button', { name: 'Опубликовать', exact: true }).click();
    await expect(page.getByAltText('Вложение комментария')).toHaveCount(2);
    await expectLoaded(page.getByAltText('Вложение комментария').nth(1));


    await page.goto(`/${name}`);
    await expect(page.getByText('1 публикация', { exact: true })).toBeVisible();
    const tile = page.getByRole('link', { name: 'Закат на море' });
    await expectLoaded(tile.getByRole('img'));

    await page.goto('/accounts/edit');
    await page.getByLabel('Фото профиля').setInputFiles({
      name: 'me.png',
      mimeType: 'image/png',
      buffer: photo([59, 130, 232]),
    });
    await expect(page.getByRole('button', { name: 'Удалить фото' })).toBeVisible({ timeout: 30_000 });
    await expectLoaded(page.locator('img[src^="/api/v1/media/"]').first());

    await page.goto(`/${name}`);
    await tile.click();
    await expect(page).toHaveURL(/\/p\//);
    await page.getByRole('button', { name: 'Удалить публикацию' }).click();
    const confirm = page.getByRole('dialog', { name: 'Удалить публикацию?' });
    await confirm.getByRole('button', { name: 'Удалить', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${name}$`), { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Поделиться фото' })).toBeVisible();
    await expect(page.getByText('0 публикаций', { exact: true })).toBeVisible();
    expect((await page.request.get(fullUrl!)).status()).toBe(404);
    expect((await page.request.get(attachmentUrl!)).status()).toBe(404);
  } finally {
    for (const fixture of fixtures) await fixture.stop();
  }
});
