import { expect, test, type Page, type BrowserContext } from '@playwright/test';
import { AuthCsrfResponseSchema, AuthUserResponseSchema } from '@instagram/contracts';
import { startAuthApi } from './helpers/auth-api.mjs';

async function mailLink(page: Page, email: string, path: string, previous?: string) {
  const port = process.env.MAILPIT_UI_PORT ?? '8025';
  let link: string | undefined;
  await expect.poll(async () => {
    const list = await page.request.get(`http://127.0.0.1:${port}/api/v1/messages`);
    if (!list.ok()) return false;
    const body = await list.json() as { messages: { ID: string; To: { Address: string }[] }[] };
    for (const message of body.messages.filter(m => m.To.some(to => to.Address === email))) {
      const response = await page.request.get(`http://127.0.0.1:${port}/api/v1/message/${message.ID}`);
      const detail = await response.json() as { Text: string };
      const candidate = detail.Text.split('\n').map(line => line.trim()).find(line => line.startsWith('http') && line.includes(`/auth/${path}#token=`));
      if (candidate && candidate !== previous) { link = candidate; return true; }
    }
    return false;
  }, { timeout: 20_000, message: 'Expected the synthetic auth message in local Mailpit' }).toBe(true);
  if (!link) throw new Error('Missing synthetic mail link.');
  return link;
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/auth/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
}

test('two users verify, resend and recover through real forms and SMTP mail', async ({ page, browser, baseURL }, info) => {
  test.setTimeout(180_000);
  // Helpers own unique accounts in the TEST database and remove only those rows.
  const first = await startAuthApi();
  let second: Awaited<ReturnType<typeof startAuthApi>> | undefined;
  let otherContext: BrowserContext | undefined;
  try {
    const csrfResponse = await fetch(first.origin + '/api/v1/auth/csrf');
    const csrf = AuthCsrfResponseSchema.parse(await csrfResponse.json());
    const registration = await fetch(first.origin + '/api/v1/auth/register', {
      method: 'POST', headers: {
        Origin: first.origin, 'Content-Type': 'application/json',
        Cookie: csrfResponse.headers.getSetCookie().map(cookie => cookie.split(';')[0]).join('; '),
        'X-CSRF-Token': csrf.csrfToken,
      }, body: JSON.stringify(first.account),
    });
    expect(registration.status).toBe(201);
    const user = AuthUserResponseSchema.parse(await registration.json()).user;
    // Before the browser creates an account, prove the real web rewrite reaches
    // the isolated TEST database by signing into this unique test-only fixture.
    await login(page, first.account.email, first.account.password);
    await expect(page, 'Start the browser API with scripts/ci/start-test-api.mjs; never use a shared dev API').toHaveURL(/\/auth\/session$/);
    await expect(page.getByText(first.account.email, { exact: true })).toBeVisible();
    expect((await (await page.request.get('/api/v1/auth/session')).json()).user.id).toBe(user.id);

    second = await startAuthApi();
    otherContext = await browser.newContext({ baseURL, viewport: info.project.use.viewport });
    const other = await otherContext.newPage();
    await other.goto('/auth/register');
    await other.getByLabel('Email', { exact: true }).fill(second.account.email);
    await other.getByLabel('Имя пользователя', { exact: true }).fill(second.account.username);
    await other.getByLabel('Пароль', { exact: true }).fill(second.account.password);
    await other.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
    await expect(other.getByRole('heading', { name: 'Аккаунт создан' })).toBeVisible();
    const registeredAt = Date.now();
    expect((await (await other.request.get('/api/v1/auth/session')).json()).user).toBeNull();
    await login(other, second.account.email, second.account.password);
    await expect(other).toHaveURL(/\/auth\/session$/);

    const firstLink = await mailLink(page, first.account.email, 'verify');
    const oldSecondLink = await mailLink(other, second.account.email, 'verify');
    await page.goto(firstLink);
    await expect(page.getByRole('button', { name: 'Подтвердить email', exact: true })).toBeEnabled();
    expect(page.url().includes('#')).toBe(false);
    expect((await (await page.request.get('/api/v1/auth/session')).json()).user.emailVerified).toBe(false);
    await page.getByRole('button', { name: 'Подтвердить email', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Email подтверждён');

    // Exercise the actual recipient cooldown; no fixture changes or fake timers.
    const remaining = Math.max(0, 62_000 - (Date.now() - registeredAt));
    if (remaining) await new Promise(resolve => setTimeout(resolve, remaining));
    await other.goto('/auth/request-verification');
    await other.getByLabel('Email', { exact: true }).fill(second.account.email);
    await other.getByRole('button', { name: 'Отправить письмо', exact: true }).click();
    await expect(other.getByRole('status')).toContainText('Если для этого адреса');
    const newSecondLink = await mailLink(other, second.account.email, 'verify', oldSecondLink);
    await other.goto(oldSecondLink);
    await other.getByRole('button', { name: 'Подтвердить email', exact: true }).click();
    await expect(other.getByRole('region', { name: 'Аккаунт', exact: true }).getByRole('alert')).toContainText('Ссылка недействительна');
    await other.goto(newSecondLink);
    await other.getByRole('button', { name: 'Подтвердить email', exact: true }).click();
    await expect(other.getByRole('status')).toContainText('Email подтверждён');

    await page.goto('/auth/forgot-password');
    await page.getByLabel('Email', { exact: true }).fill(first.account.email);
    await page.getByRole('button', { name: 'Отправить письмо', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Если для этого адреса');
    const resetLink = await mailLink(page, first.account.email, 'reset-password');
    const newPassword = 'new browser password with spaces 🔐';
    await page.goto(resetLink);
    await page.getByLabel('Новый пароль', { exact: true }).fill(newPassword);
    await page.getByRole('button', { name: 'Сохранить пароль', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Пароль изменён' })).toBeVisible();
    expect((await (await page.request.get('/api/v1/auth/session')).json()).user).toBeNull();
    expect((await (await other.request.get('/api/v1/auth/session')).json()).user.email).toBe(second.account.email);
    await page.goto(resetLink);
    await page.getByLabel('Новый пароль', { exact: true }).fill(newPassword);
    await page.getByRole('button', { name: 'Сохранить пароль', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Аккаунт', exact: true }).getByRole('alert')).toContainText('Ссылка недействительна');
    await login(page, first.account.email, first.account.password);
    await expect(page.getByRole('region', { name: 'Аккаунт', exact: true }).getByRole('alert')).toContainText('Неверный email или пароль');
    await page.getByLabel('Пароль', { exact: true }).fill(newPassword);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page).toHaveURL(/\/auth\/session$/);
    await expect(page.getByRole('status')).toHaveText('Email подтверждён.');
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    await expect(page).toHaveURL(/\/auth\/login$/);
    expect((await (await other.request.get('/api/v1/auth/session')).json()).user.email).toBe(second.account.email);
  } finally {
    await otherContext?.close();
    await second?.stop();
    await first.stop();
  }
});
