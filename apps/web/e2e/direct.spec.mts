import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { login, verifiedAccount, type Fixture } from './helpers/app.mjs';

const thread = (page: Page) => page.getByRole('list', { name: 'Сообщения' });
async function say(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Сообщение' }).fill(text);
  await page.getByRole('textbox', { name: 'Сообщение' }).press('Enter');
  // Shown at once as pending; wait until the server stored it.
  await expect(thread(page).getByText(text)).toBeVisible();
  await expect(page.getByText('Отправка…')).toHaveCount(0);
}

// FR-09: A writes to B without following; B, offline at first, finds the
// stored message. With both connected, messages appear without a reload;
// after a network outage the missed ones are synced. A third user cannot
// open the conversation.
test('direct messages in real time with recovery after an outage', async ({ page, browser, baseURL }, info) => {
  test.setTimeout(240_000);
  const fixtures: Fixture[] = [];
  const contexts: BrowserContext[] = [];
  const newContext = async () => {
    const context = await browser.newContext({ baseURL, viewport: info.project.use.viewport });
    contexts.push(context);
    return context;
  };
  try {
    const alice = await verifiedAccount();
    fixtures.push(alice);
    const bob = await verifiedAccount();
    fixtures.push(bob);
    const eve = await verifiedAccount();
    fixtures.push(eve);

    await login(page, alice.account);
    await page.goto(`/${bob.account.username}`);
    await page.getByRole('button', { name: 'Написать' }).click();
    await expect(page).toHaveURL(/\/direct\/t\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const conversationUrl = new URL(page.url()).pathname;
    await expect(page.getByText('В сети')).toBeVisible({ timeout: 15_000 });
    await say(page, 'Привет, Боб!');

    const bobContext = await newContext();
    const bobPage = await bobContext.newPage();
    await login(bobPage, bob.account);
    await bobPage.goto('/direct');
    await bobPage
      .getByRole('navigation', { name: 'Диалоги' })
      .getByRole('link', { name: new RegExp(alice.account.username) })
      .click();
    await expect(bobPage).toHaveURL(new RegExp(`${conversationUrl}$`));
    await expect(thread(bobPage).getByText('Привет, Боб!')).toBeVisible();
    await expect(bobPage.getByText('В сети')).toBeVisible({ timeout: 15_000 });

    // Realtime both ways, no reload.
    await say(bobPage, 'Привет, Алиса!');
    await expect(thread(page).getByText('Привет, Алиса!')).toBeVisible({ timeout: 10_000 });
    await say(page, 'Как дела?');
    await expect(thread(bobPage).getByText('Как дела?')).toBeVisible({ timeout: 10_000 });

    // Outage: Bob's stream is cut (a newer set of streams evicts it, as
    // with a dropped connection) and reconnecting is blocked, so notices for
    // messages sent meanwhile are lost. The stored messages are not.
    let blocked = true;
    await bobPage.route('**/api/v1/direct/events', (route) =>
      blocked ? route.abort() : route.continue(),
    );
    const evictor = await bobContext.newPage();
    await evictor.goto('/accounts/edit');
    await evictor.evaluate(() => {
      for (let index = 0; index < 5; index++) new EventSource('/api/v1/direct/events');
    });
    await expect(bobPage.getByText('Нет соединения. Переподключаемся…')).toBeVisible({ timeout: 15_000 });
    await say(page, 'Ты тут?');
    await say(page, 'Напиши, как появишься');
    await bobPage.waitForTimeout(1_000);
    await expect(thread(bobPage).getByText('Ты тут?')).toHaveCount(0);

    await evictor.close();
    blocked = false;
    await expect(bobPage.getByText('В сети')).toBeVisible({ timeout: 40_000 });
    await expect(thread(bobPage).getByText('Ты тут?')).toBeVisible({ timeout: 15_000 });
    await expect(thread(bobPage).getByText('Напиши, как появишься')).toBeVisible();
    await expect(thread(bobPage).getByRole('listitem')).toHaveCount(5);

    const evePage = await (await newContext()).newPage();
    await login(evePage, eve.account);
    await evePage.goto(conversationUrl);
    await expect(evePage.getByRole('heading', { name: 'Диалог не найден' })).toBeVisible();
    await expect(evePage.getByText('Привет, Боб!')).toHaveCount(0);
  } finally {
    for (const context of contexts) await context.close();
    for (const fixture of fixtures) await fixture.stop();
  }
});
