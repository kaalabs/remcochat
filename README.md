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
4. Start the full stack (RemcoChat + sandboxd): `scripts/start-remcochat.sh --build`
5. Open `http://<server-lan-ip>:3100`

### Reverse proxy (/remcochat)

To serve RemcoChat at `http://klubnt01/remcochat` and `https://klubnt01/remcochat` (ports 80/443), generate a local CA + TLS cert and start the optional nginx proxy:

- `scripts/generate-proxy-cert.sh`
- `scripts/start-remcochat.sh --proxy`
- Or: `docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d`

This uses `nginx/remcochat.conf` and proxies `/remcochat/` to the internal `remcochat:3000` service.

Safari note: if you can’t “proceed anyway”, install/trust the local CA on your device:
- iOS (recommended): `http://klubnt01/remcochat-ca.mobileconfig` (or `http://100.71.169.51/remcochat-ca.mobileconfig`)
- macOS: `http://klubnt01/remcochat-ca.cer` (or `http://100.71.169.51/remcochat-ca.cer`)
- macOS: open in Keychain Access and set it to Always Trust.
- iOS: install the profile, then enable full trust under Settings → General → About → Certificate Trust Settings.

If Safari still says “This connection is not private” after trusting the CA, it may be caching an older TLS/HSTS decision for the same hostname. Workarounds:
- Try a Private Browsing window first.
- Clear Safari’s HSTS cache on macOS (last resort): `killall nsurlstoraged` then remove `~/Library/Cookies/HSTS.plist` (path may vary by macOS version), then restart Safari.

### Auto-start on reboot (proxy + full stack)

To bring up the full stack (RemcoChat + sandboxd + proxy) automatically after reboot:

- Install a `crontab` `@reboot` entry: `scripts/install-startup-cron.sh`
- Verify it’s present: `crontab -l | rg remcochat:startup`
- Startup log: `/tmp/remcochat-startup.log`

To remove it: edit `crontab -e` and delete the lines containing `remcochat:startup`.

### Stop / restart

- Stop stack (no proxy): `docker compose -f docker-compose.yml down`
- Stop stack (with proxy): `docker compose -f docker-compose.yml -f docker-compose.proxy.yml down`
- Start stack (with proxy): `scripts/start-remcochat.sh --proxy`

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

### LAN access checklist

When `app.bash_tools.access = "lan"`, bash tools are enabled **per request** only if the request includes the correct admin token header.

- Server: set `REMCOCHAT_ADMIN_TOKEN` (and `REMCOCHAT_ENABLE_BASH_TOOL=1`) in the runtime environment / `.env` used by Docker.
- Browser: enter the same token in the RemcoChat UI so `/api/chat` requests include `x-remcochat-admin-token`.
- Quick verify: run any chat request and check the response header `x-remcochat-bash-tools-enabled: 1` (otherwise tools will not be advertised to the model).

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
