import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { AuthCsrfResponseSchema } from '@instagram/contracts';
import { startAuthApi } from './helpers/auth-api.mjs';

type Fixture = Awaited<ReturnType<typeof startAuthApi>>;

// Creates and verifies a unique TEST-database account through its helper API.
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

// UF-03: A finds private B, requests to follow, B approves, A gains access;
// then A unfollows and loses it again.
test('two users: search, private follow request, approval and unfollow', async ({ page, browser, baseURL }, info) => {
  test.setTimeout(180_000);
  const fixtures: Fixture[] = [];
  let ownerContext: BrowserContext | undefined;
  try {
    const requester = await verifiedAccount();
    fixtures.push(requester);
    const owner = await verifiedAccount();
    fixtures.push(owner);
    const name = owner.account.username;

    ownerContext = await browser.newContext({ baseURL, viewport: info.project.use.viewport });
    const ownerPage = await ownerContext.newPage();
    await login(ownerPage, owner.account);
    await ownerPage.goto('/accounts/edit');
    await ownerPage.getByRole('textbox', { name: /^Имя$/ }).fill('Закрытый Владелец');
    await ownerPage.getByRole('switch').check();
    await ownerPage.getByRole('button', { name: 'Отправить' }).click();
    await expect(ownerPage.getByText('Профиль сохранён.')).toBeVisible();

    await login(page, requester.account);
    await page.goto('/search');
    await page.getByRole('searchbox').fill('закрытый владелец');
    const results = page.getByRole('list', { name: 'Результаты поиска' });
    await results.getByRole('link', { name: new RegExp(name) }).click();
    await expect(page).toHaveURL(new RegExp(`/${name}$`));
    await expect(page.getByRole('heading', { name })).toBeVisible();
    await expect(page.getByText('Это закрытый аккаунт')).toBeVisible();
    await page.getByRole('button', { name: `Подписаться: ${name}` }).click();
    await expect(page.getByRole('button', { name: `Запрос отправлен: ${name}` })).toBeVisible();
    await expect(page.getByText('Это закрытый аккаунт')).toBeVisible();

    await ownerPage.goto('/notifications');
    await ownerPage.getByRole('button', { name: `Подтвердить запрос ${requester.account.username}` }).click();
    await expect(ownerPage.getByText('Новых запросов нет.')).toBeVisible();

    await page.reload();
    await expect(page.getByRole('button', { name: `Вы подписаны: ${name}` })).toBeVisible();
    await expect(page.getByText('1 подписчик', { exact: true })).toBeVisible();
    await expect(page.getByText('Публикаций пока нет')).toBeVisible();
    await expect(page.getByText('Это закрытый аккаунт')).toHaveCount(0);

    await page.getByRole('button', { name: `Вы подписаны: ${name}` }).click();
    await expect(page.getByRole('button', { name: `Подписаться: ${name}` })).toBeVisible();
    await expect(page.getByText('Это закрытый аккаунт')).toBeVisible();
    await expect(page.getByText('0 подписчиков', { exact: true })).toBeVisible();
  } finally {
    await ownerContext?.close();
    for (const fixture of fixtures) await fixture.stop();
  }
});
