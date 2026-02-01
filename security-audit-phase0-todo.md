## Priority 0.1 — Restrict sandboxd exposure + restrict published sandbox ports

  - [x] Decide the single “allowed interface” for both: (verified in docker host testing)
      - sandboxd API (host port 8080)
      - sandbox-published ports (random high ports from sandboxUrl)
        Options: 127.0.0.1 (local-only) or host Tailscale IP (preferred for tailnet-only access).
  - [x] Add explicit env knobs (and document them):
      - [x] .env.example: add e.g. SANDBOXD_HOST_BIND_IP= and SANDBOXD_PUBLISH_HOST_IP=
      - [x] .env (deploy host): set both values to the chosen restricted IP (never 0.0.0.0 for Priority 0) (verified in docker host testing)
  - [x] Bind sandboxd host port to the restricted interface in docker-compose.yml:
      - [x] Change sandboxd.ports from - "8080:8080" to - "${SANDBOXD_HOST_BIND_IP}:8080:8080" (or provide a safe default like 127.0.0.1)
  - [x] Restrict sandbox port publishing in docker-compose.yml:
      - [x] Change sandboxd.environment.SANDBOXD_PUBLISH_HOST_IP from "0.0.0.0" to "${SANDBOXD_PUBLISH_HOST_IP}" (or default 127.0.0.1)
  - [x] Ensure RemcoChat can still reach sandboxd:
      - [x] config.toml: set app.bash_tools.docker.orchestrator_url to http://<same restricted IP>:8080 (if you bind to a Tailscale IP, do not keep
        127.0.0.1)
  - [x] Keep the dev/start workflow accurate:
      - [x] scripts/start-remcochat.sh: update the sandboxd health check URL and the final log line to use the configured bind IP (not hardcoded 127.0.0.1 /
        0.0.0.0)
  - [x] Verification (must pass before calling it “done”): (verified in docker host testing)
      - [x] From the host: curl -fsS http://<bind-ip>:8080/v1/health
      - [x] From a LAN client (non-tailnet): confirm http://<host-lan-ip>:8080 is unreachable/timeouts
      - [x] Create a sandbox that publishes a port and confirm the published port binds only to the restricted IP (not 0.0.0.0)

  ## Priority 0.2 — Stop mounting nginx/certs wholesale; keep ca.key host-only

  - [x] Change docker-compose.proxy.yml to file-mount only what nginx needs (and stop mounting the directory):
      - [x] Replace ./nginx/certs:/etc/nginx/certs:ro with individual mounts for:
          - ./nginx/certs/tls.pem:/etc/nginx/certs/tls.pem:ro
          - ./nginx/certs/tls.key:/etc/nginx/certs/tls.key:ro
          - ./nginx/certs/ca.pem:/etc/nginx/certs/ca.pem:ro
          - ./nginx/certs/ca.cer:/etc/nginx/certs/ca.cer:ro
          - ./nginx/certs/remcochat-ca.mobileconfig:/etc/nginx/certs/remcochat-ca.mobileconfig:ro
            (This excludes nginx/certs/ca.key from the container by default.)
  - [x] Make proxy startup fail-fast in a helpful way:
      - [x] scripts/start-remcochat.sh: when --proxy, also check that the CA public artifacts exist if nginx/remcochat.conf serves them (currently it does)
  - [x] Optional-but-clean (still small diff): move the CA private key out of the runtime cert dir
      - [x] Update scripts/generate-proxy-cert.sh to store ca.key under a host-only path that is never mounted (e.g. nginx/ca/ca.key) and copy only public
        CA artifacts into nginx/certs/
      - [x] Update the script output list + any docs/comments in nginx/remcochat.conf
  - [x] Verification: (verified in docker host testing)
      - [x] docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d
      - [x] Confirm remcochat-proxy container filesystem does not contain ca.key
      - [x] Confirm /remcochat-ca.pem still downloads correctly

  ## Priority 0.3 — Admin token hygiene (length + rotation procedure)

  - [x] Define a minimum token strength standard (practical):
      - [x] Require at least 32 bytes of randomness (e.g. openssl rand -hex 32 → 64 hex chars)
  - [x] Enforce/guide it in tooling:
      - [x] scripts/start-remcochat.sh: add a validation/warn-or-die if REMCOCHAT_ADMIN_TOKEN is too short
      - [x] scripts/check-env.mjs: if app.bash_tools.access="lan" (and/or whenever provider="docker"), warn/fail on short tokens
  - [x] Rotate token safely (operational checklist to add to README / ops docs):
      - [x] Generate new token; replace REMCOCHAT_ADMIN_TOKEN in .env
      - [x] Restart compose stack
      - [x] Update the token stored in the browser UI (so requests include the new x-remcochat-admin-token)
      - [x] Verify old token no longer works:
          - [x] sandboxd returns 401 for the old token
          - [x] RemcoChat no longer advertises bash tools when the old token is used (if access="lan")
  - [x] Confirm token is not leaking:
      - [x] Grep logs / startup output to ensure the token value is never printed (only “set/missing/too short” messaging)
