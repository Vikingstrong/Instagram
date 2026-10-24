import { expect, test } from "@playwright/test";
import { startAuthApi } from "./helpers/auth-api.mjs";
import { startTestSmtp } from "../../api/test/helpers/test-smtp.js";

test("registers without verification, then recovers through optional real SMTP and revokes every old session", async ({
  page,
  browser,
  baseURL,
}, info) => {
  test.setTimeout(120_000);
  const smtp = await startTestSmtp();
  const fixture = await startAuthApi({ port: smtp.port });
  const other = await browser.newContext({
    baseURL,
    viewport: info.project.use.viewport,
  });
  async function proxy(context: import("@playwright/test").BrowserContext) {
    await context.route("**/api/v1/auth/**", async (route) => {
      const path = new URL(route.request().url());
      const response = await route.fetch({
        url: `${fixture.origin}${path.pathname}${path.search}`,
      });
      await route.fulfill({ response });
    });
  }
  try {
    await proxy(page.context());
    await proxy(other);
    await page.goto("/auth/register");
    await page.getByLabel("Email", { exact: true }).fill(fixture.account.email);
    await page
      .getByLabel("Имя пользователя", { exact: true })
      .fill(fixture.account.username);
    await page
      .getByLabel("Пароль", { exact: true })
      .fill(fixture.account.password);
    await page
      .getByRole("button", { name: "Создать аккаунт", exact: true })
      .click();
    await expect(page).toHaveURL(new URL("/", baseURL).href);
    const session = await (
      await page.request.get("/api/v1/auth/session")
    ).json();
    expect(session.user.emailVerified).toBe(false);
    expect(smtp.messages).toHaveLength(0);
    // Proxying is on browser routes, not APIRequestContext; login another real
    // browser against the same isolated compiled Auth module.
    const second = await other.newPage();
    await second.goto("/auth/login");
    await second
      .getByLabel("Email", { exact: true })
      .fill(fixture.account.email);
    await second
      .getByLabel("Пароль", { exact: true })
      .fill(fixture.account.password);
    await second.getByRole("button", { name: "Войти", exact: true }).click();
    await expect(second).toHaveURL(new URL("/", baseURL).href);
    await page.goto("/auth/forgot-password");
    await page.getByLabel("Email", { exact: true }).fill(fixture.account.email);
    await page
      .getByRole("button", { name: "Отправить письмо", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Если для этого адреса",
    );
    await fixture.flushRecovery();
    expect(smtp.messages).toHaveLength(1);
    const token = /reset-password#token=([A-Za-z0-9_-]{43})/.exec(
      smtp.messages[0]!.text,
    )?.[1];
    expect(token).toBeTruthy();
    const link = `/auth/reset-password#token=${token}`;
    await page.goto(link);
    await page
      .getByLabel("Новый пароль", { exact: true })
      .fill("replacement browser password");
    await page
      .getByRole("button", { name: "Сохранить пароль", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Пароль изменён" }),
    ).toBeVisible();
    expect(
      (await (await page.request.get("/api/v1/auth/session")).json()).user,
    ).toBeNull();
    expect(
      (await (await second.request.get("/api/v1/auth/session")).json()).user,
    ).toBeNull();
    await page.goto(link);
    await page
      .getByLabel("Новый пароль", { exact: true })
      .fill("another replacement");
    await page
      .getByRole("button", { name: "Сохранить пароль", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Аккаунт" }).getByRole("alert"),
    ).toContainText("Ссылка недействительна");
  } finally {
    await other.close();
    await fixture.stop();
    await smtp.close();
  }
});
