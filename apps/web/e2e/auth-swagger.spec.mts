import { expect, test, type Page } from "@playwright/test";
import {
  AuthUserResponseSchema,
  AuthSessionResponseSchema,
  AuthLogoutResponseSchema,
  authEndpoints,
} from "@instagram/contracts";
import { startAuthApi } from "./helpers/auth-api.mjs";

async function execute(
  page: Page,
  operationId: string,
  method: string,
  url: string,
  body?: unknown,
) {
  const operation = page.locator(`#operations-Auth-${operationId}`);
  await operation.locator(".opblock-summary").click();
  await operation
    .getByRole("button", { name: "Try it out", exact: true })
    .click();
  if (body !== undefined)
    await operation
      .locator("textarea.body-param__text")
      .fill(JSON.stringify(body));
  const pending = page.waitForResponse(
    (response) =>
      response.url() === url && response.request().method() === method,
  );
  await operation.getByRole("button", { name: "Execute", exact: true }).click();
  const response = await pending;
  await expect(
    operation.locator(".live-responses-table tbody .response-col_status"),
  ).toHaveText(String(response.status()));
  expect(response.headers()["cache-control"]).toBe("no-store");
  return response;
}

test("Swagger executes registration, cookie login, session and logout against real PostgreSQL", async ({
  page,
}) => {
  const api = await startAuthApi();
  try {
    await page.goto(`${api.origin}/api/docs/`);
    const registration = await execute(
      page,
      "registerAuth",
      "POST",
      api.origin + authEndpoints.register.path,
      api.account,
    );
    expect(registration.status()).toBe(201);
    const user = AuthUserResponseSchema.parse(await registration.json()).user;
    expect(user.emailVerified).toBe(false);
    const login = await execute(
      page,
      "loginAuth",
      "POST",
      api.origin + authEndpoints.login.path,
      { email: api.account.email, password: api.account.password },
    );
    expect(login.status()).toBe(200);
    expect(AuthUserResponseSchema.parse(await login.json()).user).toEqual(user);
    const session = await execute(
      page,
      "getAuthSession",
      "GET",
      api.origin + authEndpoints.session.path,
    );
    expect(AuthSessionResponseSchema.parse(await session.json()).user).toEqual(
      user,
    );
    const cookies = await page.context().cookies(api.origin);
    const cookie = cookies.find((entry) => entry.name === "instagram-session");
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Lax");
    expect(
      await page.evaluate(() => document.cookie.includes("instagram-session=")),
    ).toBe(false);
    const logout = await execute(
      page,
      "logoutAuth",
      "POST",
      api.origin + authEndpoints.logout.path,
      {},
    );
    expect(logout.status()).toBe(200);
    expect(AuthLogoutResponseSchema.parse(await logout.json())).toEqual({
      status: "signed_out",
    });
    const final = await page.evaluate(
      async (path) =>
        (
          await fetch(path, { cache: "no-store", credentials: "same-origin" })
        ).json(),
      authEndpoints.session.path,
    );
    expect(AuthSessionResponseSchema.parse(final).user).toBeNull();
  } finally {
    await api.stop();
  }
});
