import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { login, verifiedAccount, type Fixture } from './helpers/app.mjs';

const thread = (page: Page) => page.getByRole('list', { name: 'Сообщения' });

// FR-09 over REST (stage 6): A writes to B without following, B was offline
// and reads the stored message later, replies, and A sees the reply after a
// manual refresh. A third user cannot open the conversation.
test('direct messages between two users over REST', async ({ page, browser, baseURL }, info) => {
  test.setTimeout(240_000);
  const fixtures: Fixture[] = [];
  const contexts: BrowserContext[] = [];
  const newPage = async () => {
    const context = await browser.newContext({ baseURL, viewport: info.project.use.viewport });
    contexts.push(context);
    return context.newPage();
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
    await expect(page.getByText('Напишите первое сообщение.')).toBeVisible();
    const field = page.getByRole('textbox', { name: 'Сообщение' });
    await field.fill('Привет, Боб!');
    await field.press('Enter');
    await expect(thread(page).getByText('Привет, Боб!')).toBeVisible();
    await expect(page.getByText('Отправка…')).toHaveCount(0);

    // Stored while Bob was not connected; still there after a reload.
    await page.reload();
    await expect(thread(page).getByText('Привет, Боб!')).toBeVisible();

    const bobPage = await newPage();
    await login(bobPage, bob.account);
    await bobPage.goto('/direct');
    const inbox = bobPage.getByRole('navigation', { name: 'Диалоги' });
    await inbox.getByRole('link', { name: new RegExp(alice.account.username) }).click();
    await expect(bobPage).toHaveURL(new RegExp(`${conversationUrl}$`));
    await expect(thread(bobPage).getByText('Привет, Боб!')).toBeVisible();
    await bobPage.getByRole('textbox', { name: 'Сообщение' }).fill('Привет, Алиса!');
    await bobPage.getByRole('button', { name: 'Отправить' }).click();
    await expect(thread(bobPage).getByText('Привет, Алиса!')).toBeVisible();
    // The text shows at once as pending; wait until the server stored it.
    await expect(bobPage.getByText('Отправка…')).toHaveCount(0);

    await page.getByRole('button', { name: 'Обновить' }).click();
    await expect(thread(page).getByText('Привет, Алиса!')).toBeVisible();
    await expect(thread(page).getByRole('listitem')).toHaveCount(2);

    const evePage = await newPage();
    await login(evePage, eve.account);
    await evePage.goto(conversationUrl);
    await expect(evePage.getByRole('heading', { name: 'Диалог не найден' })).toBeVisible();
    await expect(evePage.getByText('Привет, Боб!')).toHaveCount(0);
  } finally {
    for (const context of contexts) await context.close();
    for (const fixture of fixtures) await fixture.stop();
  }
});
