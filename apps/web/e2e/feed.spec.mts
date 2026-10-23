import { expect, test, type BrowserContext } from '@playwright/test';
import { expectLoaded, login, photo, verifiedAccount, type Fixture } from './helpers/app.mjs';

// UF-04/05: B follows A, sees A's new photo in the feed, likes and comments
// on it; A sees the comment under the post and deletes it.
test('feed, like and comment between two users', async ({ page, browser, baseURL }, info) => {
  test.setTimeout(180_000);
  const fixtures: Fixture[] = [];
  let authorContext: BrowserContext | undefined;
  try {
    const author = await verifiedAccount();
    fixtures.push(author);
    const reader = await verifiedAccount();
    fixtures.push(reader);
    const name = author.account.username;

    authorContext = await browser.newContext({ baseURL, viewport: info.project.use.viewport });
    const authorPage = await authorContext.newPage();
    await login(authorPage, author.account);
    await expect(authorPage.getByRole('heading', { name: 'В ленте пока пусто' })).toBeVisible();
    await authorPage.goto('/create');
    await authorPage.getByLabel('Фото или видео для публикации').setInputFiles({
      name: 'lake.png',
      mimeType: 'image/png',
      buffer: photo([40, 150, 120]),
    });
    await authorPage.getByRole('textbox', { name: 'Подпись' }).fill('Озеро утром');
    await authorPage.getByRole('button', { name: 'Поделиться' }).click();
    await expect(authorPage).toHaveURL(/\/p\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const postUrl = new URL(authorPage.url()).pathname;

    await login(page, reader.account);
    await expect(page.getByRole('heading', { name: 'В ленте пока пусто' })).toBeVisible();
    await page.goto(`/${name}`);
    await page.getByRole('button', { name: 'Подписаться', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Подписки', exact: true })).toBeVisible();

    await page.goto('/');
    const feed = page.getByRole('region', { name: 'Лента' });
    const card = feed.getByRole('article', { name });
    await expectLoaded(card.getByRole('img', { name: 'Озеро утром' }));
    await card.getByRole('button', { name: 'Нравится' }).click();
    await expect(card.getByRole('button', { name: 'Не нравится' })).toHaveAttribute('aria-pressed', 'true');
    await expect(card.getByText('1 отметка «Нравится»')).toBeVisible();
    await card.getByRole('textbox', { name: 'Комментарий' }).fill('Красота!');
    await card.getByRole('textbox', { name: 'Комментарий' }).press('Enter');
    await expect(card.getByText('Красота!')).toBeVisible();
    await expect(card.getByRole('textbox', { name: 'Комментарий' })).toHaveValue('');

    // The server kept both after a reload.
    await page.goto(postUrl);
    await expect(page.getByRole('button', { name: 'Не нравится' })).toBeVisible();
    await expect(page.getByText('1 отметка «Нравится»')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Комментарии' }).getByText('Красота!')).toBeVisible();

    await authorPage.reload();
    const comments = authorPage.getByRole('region', { name: 'Комментарии' });
    await expect(comments.getByText('Красота!')).toBeVisible();
    // Replies stay one level deep; reload exercises the real three-item API pages.
    for (let index = 1; index <= 4; index += 1) {
      await comments.getByRole('button', { name: 'Ответить', exact: true }).first().click();
      await comments.getByRole('textbox', { name: 'Ответ', exact: true }).fill(`Ответ ${index}`);
      await comments.getByRole('textbox', { name: 'Ответ', exact: true }).press('Enter');
      await expect(comments.getByText(`Ответ ${index}`, { exact: true })).toBeVisible();
    }
    await page.reload();
    const readerComments = page.getByRole('region', { name: 'Комментарии' });
    await readerComments.getByRole('button', { name: 'Посмотреть ответы (4)' }).click();
    const replies = readerComments.getByRole('list', { name: `Ответы на комментарий ${reader.account.username}` });
    await expect(replies.getByRole('listitem')).toHaveCount(3);
    await readerComments.getByRole('button', { name: 'Показать ещё ответы' }).click();
    await expect(replies.getByRole('listitem')).toHaveCount(4);
    const firstReply = replies.getByRole('listitem').first();
    await firstReply.getByRole('button', { name: 'Нравится', exact: true }).click();
    await expect(firstReply.getByRole('button', { name: 'Не нравится', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await firstReply.getByRole('button', { name: 'Ответить', exact: true }).click();
    await expect(readerComments.getByText(`@${name}`, { exact: true })).toBeVisible();
    await readerComments.getByRole('textbox', { name: 'Ответ', exact: true }).fill('Ответ на ответ');
    await readerComments.getByRole('textbox', { name: 'Ответ', exact: true }).press('Enter');
    await expect(replies.getByText('Ответ на ответ', { exact: false })).toBeVisible();
    await page.reload();
    await readerComments.getByRole('button', { name: 'Посмотреть ответы (5)' }).click();
    await expect(readerComments.getByRole('button', { name: 'Не нравится', exact: true })).toBeVisible();
    await readerComments.getByRole('button', { name: 'Показать ещё ответы' }).click();
    await expect(replies.getByText('Ответ на ответ', { exact: false })).toBeVisible();
    await expect(replies.getByRole('listitem').last().getByRole('link', { name: `@${name}`, exact: true })).toBeVisible();

    await comments.getByRole('button', { name: `Удалить комментарий ${reader.account.username}` }).click();
    await authorPage
      .getByRole('dialog', { name: 'Удалить комментарий?' })
      .getByRole('button', { name: 'Удалить', exact: true })
      .click();
    await expect(comments.getByText('Красота!')).toHaveCount(0);
    await expect(comments.getByText('Комментариев пока нет.')).toBeVisible();

    await page.reload();
    await expect(page.getByRole('region', { name: 'Комментарии' }).getByText('Красота!')).toHaveCount(0);
  } finally {
    await authorContext?.close();
    for (const fixture of fixtures) await fixture.stop();
  }
});
