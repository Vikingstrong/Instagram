import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { parseEnv } from "node:util";

// Real compiled API with the TEST role/database, on an OS-selected port.
// Browser fixtures never use a shared development/production account.
export async function startAuthApi() {
  const env = {
    ...parseEnv(
      readFileSync(new URL("../../../../.env", import.meta.url), "utf8"),
    ),
    ...process.env,
  };
  let development: URL;
  let test: URL;
  try {
    development = new URL(env.DATABASE_URL ?? "");
    test = new URL(env.TEST_DATABASE_URL ?? "");
  } catch {
    throw new Error(
      "Auth browser tests require valid separate dev/test PostgreSQL configuration.",
    );
  }
  if (
    development.pathname === test.pathname ||
    development.username === test.username
  )
    throw new Error(
      "Auth browser tests require separate database names and roles.",
    );
  const suffix = randomUUID().replaceAll("-", "");
  const account = {
    email: `swagger-${suffix}@example.test`,
    username: `u_${suffix.slice(0, 20)}`,
    password: "synthetic swagger password 🔐",
  };
  const nest = new URL(
    "../../../api/node_modules/@nestjs/core/index.js",
    import.meta.url,
  );
  const appModule = new URL("../../../api/dist/app.module.js", import.meta.url);
  const configure = new URL(
    "../../../api/dist/configure-app.js",
    import.meta.url,
  );
  const config = new URL(
    "../../../api/dist/auth/auth.config.js",
    import.meta.url,
  );
  const database = new URL(
    "../../../api/dist/infrastructure/database/database.service.js",
    import.meta.url,
  );
  const code = [
    `import { NestFactory } from ${JSON.stringify(nest.href)};`,
    `import { AppModule } from ${JSON.stringify(appModule.href)};`,
    `import { configureApp } from ${JSON.stringify(configure.href)};`,
    `import { AUTH_CONFIG } from ${JSON.stringify(config.href)};`,
    `import { DatabaseService } from ${JSON.stringify(database.href)};`,
    "const app = await NestFactory.create(AppModule, { logger: false });",
    "configureApp(app); await app.listen(0, '127.0.0.1');",
    "const origin = await app.getUrl(); app.get(AUTH_CONFIG).allowedOrigins.add(origin);",
    "process.once('SIGTERM', async () => { let status = 0; try {",
    `await app.get(DatabaseService).prisma.user.deleteMany({ where: { emailKey: ${JSON.stringify(account.email)}, usernameKey: ${JSON.stringify(account.username)} } });`,
    "} catch { status = 1; } finally { await app.close(); process.exit(status); } });",
    "process.send({ origin });",
  ].join("\n");
  const child = spawn(
    process.execPath,
    ["--input-type=module", "--eval", code],
    {
      env: {
        ...env,
        DATABASE_URL: test.href,
        NODE_ENV: "test",
        AUTH_PUBLIC_ORIGIN: "http://localhost:3000",
        AUTH_CSRF_SECRET: randomBytes(32).toString("hex"),
      },
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
          new Error("Isolated Auth API did not clean up within 10 seconds."),
        );
      }, 10_000);
      child.once("exit", (code) => {
        clearTimeout(timeout);
        if (code === 0) resolve();
        else reject(new Error("Isolated Auth API cleanup failed."));
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
            "Isolated Auth API failed to start; check API build and test database configuration.",
          ),
        );
      };
      const timeout = setTimeout(fail, 15_000);
      child.once("error", fail);
      child.once("exit", fail);
      child.once("message", (payload: { origin?: unknown }) => {
        if (
          typeof payload.origin !== "string" ||
          !/^http:\/\/127\.0\.0\.1:\d+$/.test(payload.origin)
        ) {
          fail();
          return;
        }
        clearTimeout(timeout);
        resolve(payload.origin);
      });
    });
    return { origin, account, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
