import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the real stack: local Supabase (pnpm db:start), the API server and the
 * client. Servers are started automatically unless already running.
 * Set PW_CHROMIUM_PATH to use a preinstalled Chromium instead of `playwright install`.
 */
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: "http://localhost:5174",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: { executablePath },
  },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"], launchOptions: { executablePath } } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } } },
  ],
  // Fresh servers on their own ports every run, so in-memory rate limits never carry over.
  webServer: [
    {
      command: "pnpm --filter @hearth/server exec tsx --env-file-if-exists=../../.env src/index.ts",
      url: "http://localhost:2568/api/health",
      reuseExistingServer: false,
      cwd: "../..",
      env: { PORT: "2568", APP_URL: "http://localhost:5174", REDIS_URL: "", OTP_IP_SENDS_PER_HOUR: "100" },
    },
    {
      command: "pnpm --filter @hearth/client exec vite",
      url: "http://localhost:5174",
      reuseExistingServer: false,
      cwd: "../..",
      env: { CLIENT_PORT: "5174", API_PROXY_TARGET: "http://localhost:2568" },
    },
  ],
});
