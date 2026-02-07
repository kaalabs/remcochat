# RemcoChat

Minimal ChatGPT-like chat UI for local / home network use (**no built-in auth**).

- Next.js app + local SQLite database.
- Model/provider metadata via `modelsdev`.
- Optional tools: skills (`.skills/`), web tools, sandboxed bash tools, Philips Hue control (Hue Gateway v2).

## Quickstart (local dev)

Prereqs:
- Node + npm
- `modelsdev` installed and on `PATH`: `modelsdev --version`

1) Create a config:
- `cp config.toml.example config.toml`

2) Set at least one provider API key in your shell:
- `export VERCEL_AI_GATEWAY_API_KEY=...`
- `export OPENCODE_API_KEY=...` (if your active provider is OpenCode Zen)

3) Install deps + run:
- `npm install`
- `npm run dev`

4) Open `http://localhost:3000` (or your machine’s LAN IP).

## Docker (LAN / home server)

Prereqs:
- Docker Engine + docker compose v2
- `modelsdev` installed on the host (mounted into the container)

1) Create a Docker config:
- `cp config.docker.toml.example config.docker.toml`

2) Create `.env` from `.env.example` and set at least:
- `REMCOCHAT_ADMIN_TOKEN=$(openssl rand -hex 32)` (required for LAN access + sandboxd auth)
- `REMCOCHAT_ENABLE_BASH_TOOL=1` (required if you want bash tools / sandboxd)
- `REMCOCHAT_CONFIG_TOML=./config.docker.toml`
- `REMCOCHAT_MODELSDEV_CLI_HOST_DIR=/path/to/modelsdev` (must contain `bin/run.js` or `bin/modelsdev`)
- Plus your provider keys (`VERCEL_AI_GATEWAY_API_KEY` and/or `OPENCODE_API_KEY`)

3) Start:
- `scripts/start-remcochat.sh --build`
- Optional reverse proxy: `scripts/start-remcochat.sh --proxy`

4) Open:
- Host-only: `http://127.0.0.1:3100`
- With proxy: `https://<host>/remcochat/`

Notes:
- In `docker-compose.yml`, RemcoChat port `3100` is bound to `127.0.0.1` by default; use the proxy (or change compose ports) for LAN access.
- `sandboxd` is private to the Docker network by default; RemcoChat talks to it via `http://sandboxd:8080`.

### Reverse proxy (/remcochat)

The optional nginx proxy is defined by:
- `docker-compose.proxy.yml`
- `nginx/remcochat.conf` (update `server_name` / hostnames for your environment)

Generate local CA + TLS certs:
- `scripts/generate-proxy-cert.sh`

CA download endpoints (served by the proxy):
- `https://<host>/remcochat-ca.cer`
- `https://<host>/remcochat-ca.mobileconfig` (iOS)

## Configuration

- Local: `config.toml.example`
- Docker: `config.docker.toml.example`
- Override config path: `REMCOCHAT_CONFIG_PATH=/abs/path/to/config.toml`

## Hue (optional)

Hue control is implemented via:
- skill: `.skills/hue-instant-control`
- server tool: `hueGateway` (when enabled via config/access policy)

Docs: `docs/integrations/hue/hue.md`

## OV NL / NS Reisinformatie (optional)

Train travel data is exposed through:
- server tool: `ovNlGateway` (stations, departures, arrivals, trips, journey detail, disruptions)
- optional skill: `.skills/ov-nl-travel` (explicit `/ov-nl-travel ...` activation)
- UI card: NS-style OV card rendered from `tool-ovNlGateway` output

Setup:
1) Enable in `config.toml`:
- `[app.ov_nl]`
- `enabled = true`
- `access = "localhost"` (or `"lan"` with admin-token policy)
- `base_urls = ["https://gateway.apiportal.ns.nl/reisinformatie-api"]`
- `subscription_key_env = "NS_APP_SUBSCRIPTION_KEY"`

2) Export your NS subscription key:
- `export NS_APP_SUBSCRIPTION_KEY='...'`

Notes:
- No runtime dependency on `NS-App-API-keys.md`; only environment variables are used at runtime.
- Responses are normalized and cached with short TTL capped by `app.ov_nl.cache_max_ttl_seconds`.

## Tools & security

This project is intended for trusted machines / LAN. There is no built-in auth.

Bash tools are disabled by default and require:
- `app.bash_tools.enabled = true` in config
- `REMCOCHAT_ENABLE_BASH_TOOL=1` at runtime
- if `access="lan"`: the browser must send `x-remcochat-admin-token` matching `REMCOCHAT_ADMIN_TOKEN` (set in the UI)

Implementation details: `docs/agents/bash-tools.md`

Admin endpoints are disabled by default; enable with `REMCOCHAT_ENABLE_ADMIN=1`.

## Data

- SQLite database defaults to `data/remcochat.sqlite` (override with `REMCOCHAT_DB_PATH`).

## Tests

- Unit: `npm run test:unit`
- E2E (opt-in): `npm run test:e2e` (install WebKit: `npx playwright install webkit`)

Testing policy: `docs/agents/testing.md`
