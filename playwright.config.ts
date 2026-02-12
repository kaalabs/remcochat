import fs from "node:fs";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

function parseDotenvValue(raw: string): string {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return "";

  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    const inner = trimmed.slice(1, -1);
    if (first === "'") return inner;
    return inner
      .replaceAll("\\n", "\n")
      .replaceAll("\\r", "\r")
      .replaceAll("\\t", "\t")
      .replaceAll('\\"', '"')
      .replaceAll("\\\\", "\\");
  }

  let out = "";
  let sawWhitespace = false;
  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    if (ch === "#") {
      if (sawWhitespace) break;
    }
    if (ch === " " || ch === "\t") {
      sawWhitespace = true;
      out += ch;
    } else {
      sawWhitespace = false;
      out += ch;
    }
  }
  return out.trim();
}

function loadDotenvFile(filePath: string) {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const normalized = trimmed.startsWith("export ")
      ? trimmed.slice("export ".length).trim()
      : trimmed;

    const idx = normalized.indexOf("=");
    if (idx <= 0) continue;

    const key = normalized.slice(0, idx).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (Object.prototype.hasOwnProperty.call(process.env, key)) continue;

    const rawValue = normalized.slice(idx + 1);
    process.env[key] = parseDotenvValue(rawValue);
  }
}

function loadDotenvFromCwd() {
  const nodeEnv = String(process.env.NODE_ENV ?? "").trim() || "development";
  const cwd = process.cwd();
  const candidates = [
    `.env.${nodeEnv}.local`,
    ".env.local",
    `.env.${nodeEnv}`,
    ".env",
  ];
  for (const name of candidates) {
    const filePath = path.join(cwd, name);
    if (!fs.existsSync(filePath)) continue;
    loadDotenvFile(filePath);
  }
}

// Keep Playwright runner env consistent with server startup (`scripts/check-env.mjs`)
// so e2e `test.skip` guards can see `.env.local` values.
loadDotenvFromCwd();

const PORT = Number(process.env.REMCOCHAT_E2E_PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const E2E_DB = "data/remcochat-e2e.sqlite";
const E2E_CONFIG = "data/remcochat-e2e-config.toml";
const ENABLE_VERCEL_SANDBOX_BASH =
  process.env.REMCOCHAT_E2E_ENABLE_VERCEL_SANDBOX === "1";
const ENABLE_DOCKER_SANDBOXD_BASH =
  process.env.REMCOCHAT_E2E_ENABLE_DOCKER_SANDBOXD === "1";
const ENABLE_BASH = ENABLE_VERCEL_SANDBOX_BASH || ENABLE_DOCKER_SANDBOXD_BASH;

const RESET_ENV = [
  `REMCOCHAT_DB_PATH=${E2E_DB}`,
  `REMCOCHAT_CONFIG_PATH=${E2E_CONFIG}`,
  ENABLE_BASH ? "REMCOCHAT_ENABLE_BASH_TOOL=1" : "",
]
  .filter(Boolean)
  .join(" ");

const SERVER_ENV = [
  `REMCOCHAT_DB_PATH=${E2E_DB}`,
  `REMCOCHAT_CONFIG_PATH=${E2E_CONFIG}`,
  "REMCOCHAT_ENABLE_ADMIN=1",
  ENABLE_BASH ? "REMCOCHAT_ENABLE_BASH_TOOL=1" : "",
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
    locale: "en-US",
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
