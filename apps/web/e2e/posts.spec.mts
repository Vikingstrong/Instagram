import { expect, test, type Locator, type Page } from '@playwright/test';
import { AuthCsrfResponseSchema } from '@instagram/contracts';
import { crc32, deflateSync } from 'node:zlib';
import { startAuthApi } from './helpers/auth-api.mjs';

type Fixture = Awaited<ReturnType<typeof startAuthApi>>;


async function verifiedAccount(): Promise<Fixture> {
  const fixture = await startAuthApi();
  const csrfResponse = await fetch(fixture.origin + '/api/v1/auth/csrf');
  const csrf = AuthCsrfResponseSchema.parse(await csrfResponse.json());
  const registration = await fetch(fixture.origin + '/api/v1/auth/register', {
    method: 'POST',
    headers: {
      Origin: fixture.origin,
      'Content-Type': 'application/json',
      Cookie: csrfResponse.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; '),
      'X-CSRF-Token': csrf.csrfToken,
    },
    body: JSON.stringify(fixture.account),
  });
  expect(registration.status).toBe(201);
  await fixture.verify();
  return fixture;
}

async function login(page: Page, account: Fixture['account']) {
  await page.goto('/auth/login');
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Пароль', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 30_000 });
}

// A solid-colour 640×480 PNG, built by hand so the test needs no image library.
function photo([r, g, b]: [number, number, number]) {
  const width = 640;
  const height = 480;
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const frame = Buffer.alloc(body.length + 8);
    frame.writeUInt32BE(data.length, 0);
    body.copy(frame, 4);
    frame.writeUInt32BE(crc32(body), body.length + 4);
    return frame;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function expectLoaded(image: Locator) {
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth)).toBeGreaterThan(0);
}

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
    await page.getByLabel('Фото для публикации').setInputFiles({
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

    // A request without the session cookie gets no image.
    const guest = await playwright.request.newContext({ baseURL });
    expect((await guest.get(fullUrl!)).status()).not.toBe(200);
    await guest.dispose();

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
  } finally {
    for (const fixture of fixtures) await fixture.stop();
  }
});
