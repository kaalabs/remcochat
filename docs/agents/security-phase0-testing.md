# Phase 0 Security Changes: Dev Test Strategy

Scope: Phase 0 security hardening implemented on 2026-02-01:
- Token strength enforcement for bash tools LAN gating and Docker sandboxd auth.
- (Compose/proxy changes are deployment-time; dev strategy focuses on `npm run dev` preflight behavior.)

## Goals (Dev)

- Ensure `npm run dev` fails fast when bash tools are enabled but the security-critical env is missing/weak.
- Ensure `npm run dev` succeeds when configuration is correct.

## Strategy

- Unit-level integration tests that execute the real dev preflight script:
  - `node scripts/check-env.mjs`
  - Run in an isolated temporary working directory with a minimal `config.toml`.
  - Provide env vars explicitly per test case.
  - Assert on exit code and error output.

Rationale:
- This is the actual gate used by dev (`npm run dev` / `npm run start`).
- Testing it via subprocess matches real behavior without mocking internals.

## Coverage (What We Test)

Dev (current):
- LLM provider is OpenCode (`default_provider_id = "opencode"`).
- Bash tools use local Docker sandboxd (`provider="docker"`, `orchestrator_url` points at localhost).
- LAN access (`access="lan"`):
  - Missing admin token -> fails
  - Short token (<32 chars) -> fails
  - Long token (>=32 chars) -> passes

Note:
- If `orchestrator_url` points to a non-local host, `scripts/check-env.mjs` requires a strong token for sandboxd auth (>= 32 chars), since that configuration is effectively “LAN sandboxd”.

## How To Run

- Unit tests: `npm run test:unit`

## Out Of Scope (Dev)

- Docker Compose interface binding and nginx cert mounts:
  - Validated by manual smoke checks in deployment (e.g. `docker compose config`, container reachability checks).
