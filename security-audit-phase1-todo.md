## Priority 1 — Make sandboxd private to the Docker network

Goal (from `security-audit.md`):
- Remove host port publish for `sandboxd` (no `ports:` stanza)
- Set `app.bash_tools.docker.orchestrator_url = "http://sandboxd:8080"` in `config.toml`
- Ensure only `remcochat` can call `sandboxd` (not every LAN/Tailnet client)

### Priority 1.1 — Decide the dev/deploy split (avoid breaking local dev)

  - [x] Confirm the intended workflows:
      - [x] Docker host “production-like” deployment: `sandboxd` must not be reachable from the host/LAN (private to compose network).
      - [x] Local dev (if Next.js runs on the host): do we still need host access to `sandboxd`?
          - Option A: keep a dev-only compose override that publishes `sandboxd:8080` to localhost
          - Option B: run dev inside Docker (so `http://sandboxd:8080` works)
          - Option C: run `sandboxd` as a local node process for dev (no Docker publish needed)

### Priority 1.2 — Make sandboxd private in compose (deploy)

  - [x] Update `docker-compose.yml`:
      - [x] Remove the `sandboxd.ports:` stanza entirely (no host port publish).
      - [x] Ensure `remcochat` can still resolve `sandboxd` via compose DNS:
          - [x] Add `depends_on: [sandboxd]` for `remcochat` (optional, startup-order only).
      - [x] Keep `sandboxd` binding to `0.0.0.0` *inside* the container (required for cross-container access):
          - [x] Keep `SANDBOXD_BIND_HOST="0.0.0.0"`
      - [x] Keep token requirement for non-local bind (expected):
          - [x] Ensure `SANDBOXD_ADMIN_TOKEN` is set (still sourced from `REMCOCHAT_ADMIN_TOKEN`)

  - [x] If needed for dev, add a compose override file (recommended):
      - [x] Create `docker-compose.dev.yml` (or similar) that re-adds:
          - [x] `sandboxd.ports: ["127.0.0.1:8080:8080"]` (or `${SANDBOXD_HOST_BIND_IP:-127.0.0.1}:8080:8080`)
      - [x] Update `scripts/start-remcochat.sh` to accept a flag like `--dev` (or `--publish-sandboxd`) that includes the override compose file.

### Priority 1.3 — Point RemcoChat to internal sandboxd URL (deploy)

  - [x] Decide how config should work across dev vs deploy:
      - [x] Option A: keep `config.toml` as dev-focused and create `config.docker.toml` for deployment
      - [ ] Option B: keep `config.toml` as deploy-focused and create `config.dev.toml` for local dev
      - [ ] Option C: patch `config.toml` at start-time (not preferred; harder to reason about)

  - [x] Implement the chosen option:
      - [x] Set Docker deployment config to:
          - [x] `app.bash_tools.docker.orchestrator_url = "http://sandboxd:8080"`
      - [x] Ensure `REMCOCHAT_ADMIN_TOKEN` is available in the `remcochat` container so the docker sandbox client can authenticate to `sandboxd`.

### Priority 1.4 — Update health checks / scripts to match the new topology

  - [x] Update `scripts/start-remcochat.sh`:
      - [x] Replace host curl check `http://<bind-ip>:8080/v1/health` (will no longer work without publish).
      - [x] Add a new health check that runs *inside the compose network*, e.g.:
          - [x] `docker compose exec -T sandboxd node -e 'fetch(\"http://127.0.0.1:8080/v1/health\")...'`
      - [x] Keep logging accurate: sandboxd should be reported as “private to docker network”.

### Priority 1.5 — Documentation updates

  - [x] Update `security-audit.md` Priority 1 section with any implementation details/flags you add (e.g. `--dev` override).
  - [x] Update `README.md`:
      - [x] Document the recommended deployment topology: sandboxd private, orchestrator URL `http://sandboxd:8080`.
      - [x] If a dev override exists, document how to run it.

### Priority 1.6 — Verification (must pass)

  - [ ] On the Docker host (deploy topology):
      - [ ] Confirm host has no listener on 8080:
          - [ ] `lsof -nP -iTCP:8080 -sTCP:LISTEN` shows nothing (or equivalent).
      - [ ] Confirm sandboxd is not reachable from LAN/Tailnet:
          - [ ] `curl http://<host-ip>:8080/v1/health` times out / connection refused.
      - [ ] Confirm RemcoChat can still use bash tools (with correct admin token policy):
          - [ ] A request that enables bash tools successfully runs a sandbox command.
      - [ ] Confirm `sandboxUrl` still works and published sandbox ports bind only to the intended interface (per Phase 0 settings).
