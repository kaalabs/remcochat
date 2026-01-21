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

## Bash tools (sandbox)

Bash tools are disabled by default and require both:
- `app.bash_tools.enabled = true` in `config.toml`
- `export REMCOCHAT_ENABLE_BASH_TOOL=1` at runtime

Two sandbox backends are supported:
- **Vercel Sandbox** (default): `app.bash_tools.provider = "vercel"` (requires Vercel Sandbox creds)
- **Docker sandboxd**: `app.bash_tools.provider = "docker"` (requires local Docker Engine + sandboxd)

### Docker sandboxd quickstart

1. Build the sandbox image: `docker build -t remcochat-sandbox:node24 -f sandbox-images/node24/Dockerfile .`
2. Build and run the orchestrator (mount Docker socket):
   - `docker build -t remcochat-sandboxd -f sandboxd/Dockerfile .`
   - `docker run --rm -p 8080:8080 -v /var/run/docker.sock:/var/run/docker.sock remcochat-sandboxd`
3. In `config.toml` set:
   - `app.bash_tools.provider = "docker"`
   - `app.bash_tools.docker.orchestrator_url = "http://127.0.0.1:8080"`
4. To access a web server running in the sandbox, set `app.bash_tools.sandbox.ports = [3000]` and use the `sandboxUrl` tool (it returns a host URL mapped to that sandbox port).
   - Works even if the app binds to `127.0.0.1` inside the sandbox (sandboxd runs an internal loopback proxy).
   - LAN access: run sandboxd with `SANDBOXD_BIND_HOST=0.0.0.0` and `SANDBOXD_PUBLISH_HOST_IP=0.0.0.0`, set `SANDBOXD_ADMIN_TOKEN`, and point `orchestrator_url` at your server LAN IP (not `127.0.0.1`).

## Admin (optional)

Admin actions are disabled by default (no auth, local LAN app). To enable them:

- `export REMCOCHAT_ENABLE_ADMIN=1`

This enables:
- `GET /api/admin/export` (download full JSON backup)
- `POST /api/admin/reset` with body `{ "confirm": "RESET" }` (wipe local DB)

## E2E

### Playwright

- Install WebKit once: `npx playwright install webkit`
- Run WebKit E2E: `npm run test:e2e`

### Agent-browser
Install agent-browser once:
  `npm install -g agent-browser`
  `agent-browser install`
Run agent-browser integrated user tests:
  `npm run test:agent-browser`
