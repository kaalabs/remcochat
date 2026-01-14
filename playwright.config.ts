import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const E2E_DB = "data/remcochat-e2e.sqlite";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
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
      `REMCOCHAT_DB_PATH=${E2E_DB} node scripts/reset-e2e-db.mjs`,
      "npm run build",
      `REMCOCHAT_DB_PATH=${E2E_DB} REMCOCHAT_ENABLE_ADMIN=1 node scripts/check-env.mjs && REMCOCHAT_DB_PATH=${E2E_DB} REMCOCHAT_ENABLE_ADMIN=1 next start -p ${PORT}`,
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
