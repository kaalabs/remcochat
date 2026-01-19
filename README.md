# remcochat

Minimal ChatGPT-like chat UI for local network use (no auth).

## Local dev

1. Create `config.toml` from the example:
   - `cp config.toml.example config.toml`
2. Ensure `modelsdev` is installed and on your `PATH` (required for dynamic model metadata): `modelsdev --version`
3. Export your Vercel AI Gateway key in your shell:
   - `export VERCEL_AI_GATEWAY_API_KEY=...`
   - If your active provider uses OpenCode Zen: `export OPENCODE_API_KEY=...`
4. Install deps: `npm install`
5. Run: `npm run dev`
6. Open `http://localhost:3000` (or your machine’s LAN IP)

## Docker (LAN / home server)

1. Create `config.toml` from the example:
   - `cp config.toml.example config.toml`
2. Ensure the container has `modelsdev` available on `PATH` (required): `modelsdev --version`
3. Create a `.env` file based on `.env.example` and set your `VERCEL_AI_GATEWAY_API_KEY`.
4. Run: `docker compose up -d --build`
5. Open `http://<server-lan-ip>:3100`

### Auto-update (cron)

Use `scripts/update-remcochat.sh` to pull the latest `main` and restart the compose stack only when updates exist.

- Example cron (hourly): `0 * * * * /path/to/remcochat/scripts/update-remcochat.sh >> /var/log/remcochat-update.log 2>&1`
- The script refuses to update if the repo has uncommitted changes.

## Data

- SQLite database defaults to `data/remcochat.sqlite` (override with `REMCOCHAT_DB_PATH`).

## Admin (optional)

Admin actions are disabled by default (no auth, local LAN app). To enable them:

- `export REMCOCHAT_ENABLE_ADMIN=1`

This enables:
- `GET /api/admin/export` (download full JSON backup)
- `POST /api/admin/reset` with body `{ "confirm": "RESET" }` (wipe local DB)

## E2E (Playwright)

- Install WebKit once: `npx playwright install webkit`
- Run WebKit E2E: `npm run test:e2e`
