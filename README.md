# remcochat

Minimal ChatGPT-like chat UI for local network use (no auth).

## Local dev

1. Export your Vercel AI Gateway key in your shell:
   - `export VERCEL_AI_GATEWAY_API_KEY=...` (or `export AI_GATEWAY_API_KEY=...`)
2. Install deps: `npm install`
3. Run: `npm run dev`
4. Open `http://localhost:3000` (or your machine’s LAN IP)

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
