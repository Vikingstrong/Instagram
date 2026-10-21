import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

import { expect, test, type Page } from "@playwright/test";
import {
  ApiErrorResponseSchema,
  ReadinessResponseSchema,
  readinessEndpoint,
} from "@instagram/contracts";

async function executeReadiness(page: Page, origin: string) {
  await page.goto(`${origin}/api/docs/`);
  const operation = page.locator("#operations-Foundation-getReadiness");
  await operation.locator(".opblock-summary").click();
  await operation
    .getByRole("button", { name: "Try it out", exact: true })
    .click();

  const responsePromise = page.waitForResponse(
    (response) =>
      response.url() === `${origin}${readinessEndpoint.path}` &&
      response.request().method() === "GET",
  );
  await operation.getByRole("button", { name: "Execute", exact: true }).click();
  const response = await responsePromise;
  await expect(
    operation.locator(".live-responses-table tbody .response-col_status"),
  ).toHaveText(String(response.status()));
  expect(response.headers()["cache-control"]).toBe("no-store");
  return response;
}

// An isolated Nest process checks a real PostgreSQL refusal. Never stop or
// reconfigure the shared API/DB used by the other browser tests or developers.
async function startUnavailableApi() {
  const configuration = {
    ...parseEnv(
      readFileSync(new URL("../../../.env", import.meta.url), "utf8"),
    ),
    ...process.env,
  };
  if (!configuration.DATABASE_URL || !configuration.TEST_DATABASE_URL) {
    throw new Error(
      "Swagger error smoke requires configured dev/test databases.",
    );
  }
  let development: URL;
  let forbidden: URL;
  try {
    development = new URL(configuration.DATABASE_URL);
    forbidden = new URL(configuration.TEST_DATABASE_URL);
  } catch {
    // Native URL errors can include the full input, including credentials.
    throw new Error("Swagger error smoke requires valid PostgreSQL URLs.");
  }
  if (
    development.pathname === forbidden.pathname ||
    development.username === forbidden.username
  ) {
    throw new Error(
      "Swagger error smoke requires separate dev/test roles and databases.",
    );
  }
  forbidden.pathname = development.pathname;

  const nest = new URL(
    "../../api/node_modules/@nestjs/core/index.js",
    import.meta.url,
  );
  const appModule = new URL("../../api/dist/app.module.js", import.meta.url);
  const configure = new URL("../../api/dist/configure-app.js", import.meta.url);
  const code = [
    `import { NestFactory } from ${JSON.stringify(nest.href)};`,
    `import { AppModule } from ${JSON.stringify(appModule.href)};`,
    `import { configureApp } from ${JSON.stringify(configure.href)};`,
    "const app = await NestFactory.create(AppModule, { logger: false });",
    "configureApp(app); app.enableShutdownHooks();",
    "await app.listen(0, '127.0.0.1');",
    "process.send({ origin: await app.getUrl() });",
  ].join("\n");
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", code],
    {
      env: { ...configuration, DATABASE_URL: forbidden.href },
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    },
  );
  async function stop() {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null)
      return;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        reject(
          new Error("Isolated Swagger API did not stop within 10 seconds."),
        );
      }, 10_000);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
      child.kill("SIGTERM");
    });
  }
  try {
    const origin = await new Promise<string>((resolve, reject) => {
      const fail = () => {
        clearTimeout(timeout);
        reject(
          new Error(
            "Isolated Swagger API failed to start; check API build and database configuration.",
          ),
        );
      };
      const timeout = setTimeout(fail, 10_000);
      child.once("error", fail);
      child.once("exit", fail);
      child.once("message", (message: { origin?: unknown }) => {
        if (
          typeof message.origin !== "string" ||
          !/^http:\/\/127\.0\.0\.1:\d+$/.test(message.origin)
        ) {
          fail();
          return;
        }
        clearTimeout(timeout);
        resolve(message.origin);
      });
    });
    return { origin, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

test("Swagger Execute queries the real database and renders readiness 200", async ({
  page,
}) => {
  const response = await executeReadiness(page, "http://127.0.0.1:4000");
  expect(response.status()).toBe(readinessEndpoint.successStatus);
  expect(ReadinessResponseSchema.parse(await response.json())).toEqual({
    status: "ready",
  });
});

test("Swagger Execute renders safe 503 when PostgreSQL denies access", async ({
  page,
}) => {
  const api = await startUnavailableApi();
  try {
    const response = await executeReadiness(page, api.origin);
    expect(response.status()).toBe(readinessEndpoint.unavailableStatus);
    expect(
      ApiErrorResponseSchema.safeParse(await response.json()).success,
    ).toBe(true);
  } finally {
    await api.stop();
  }
});
