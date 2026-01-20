import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const E2E_DB = "data/remcochat-e2e.sqlite";
const E2E_CONFIG = "data/remcochat-e2e-config.toml";
const ENABLE_VERCEL_SANDBOX_BASH =
  process.env.REMCOCHAT_E2E_ENABLE_VERCEL_SANDBOX === "1";

const RESET_ENV = [
  `REMCOCHAT_DB_PATH=${E2E_DB}`,
  `REMCOCHAT_CONFIG_PATH=${E2E_CONFIG}`,
  ENABLE_VERCEL_SANDBOX_BASH ? "REMCOCHAT_ENABLE_BASH_TOOL=1" : "",
]
  .filter(Boolean)
  .join(" ");

const SERVER_ENV = [
  `REMCOCHAT_DB_PATH=${E2E_DB}`,
  `REMCOCHAT_CONFIG_PATH=${E2E_CONFIG}`,
  "REMCOCHAT_ENABLE_ADMIN=1",
  ENABLE_VERCEL_SANDBOX_BASH ? "REMCOCHAT_ENABLE_BASH_TOOL=1" : "",
]
  .filter(Boolean)
  .join(" ");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: [
      `${RESET_ENV} node scripts/reset-e2e-db.mjs`,
      "npm run build",
      `${SERVER_ENV} node scripts/check-env.mjs && ${SERVER_ENV} next start -p ${PORT}`,
    ].join(" && "),
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
  projects: [
    {
      name: "webkit",
      use: {
        ...devices["Desktop Safari"],
      },
    },
  ],
});
