import { defineConfig, devices } from "@playwright/test";

const port = 3000;

// Locally run the installed Google Chrome, so no 200 MB browser download is
// needed; PLAYWRIGHT_CHANNEL overrides it (e.g. "msedge"). CI uses the bundled
// Chromium from `playwright install chromium`.
const channel = process.env.CI
  ? undefined
  : (process.env.PLAYWRIGHT_CHANNEL ?? "chrome");

// Browser smoke against the real Next.js server. Desktop and mobile projects
// cover both shell layouts.
export default defineConfig({
  testDir: "./e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    channel,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "pnpm dev",
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
