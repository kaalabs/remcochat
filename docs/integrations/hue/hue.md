# Hue Gateway (v2) integration

You are integrating with an already-running **Hue Gateway** service. Assume it is reachable and functioning; you are **not** responsible for deploying or operating it. RemcoChat uses this gateway as the single interface to Philips Hue.

## Authoritative v2 docs (in this repo)

- Architecture + locked decisions: `docs/integrations/hue/v2-migration/hue-gateway-api-architecture-0v91.md`
- OpenAPI skeleton (codegen input): `docs/integrations/hue/v2-migration/openapi-v2.skeleton.yaml`
- Semantic companion: `docs/integrations/hue/v2-migration/spec-v2.md`
- Gateway team implementation plan: `docs/integrations/hue/v2-migration/plan-v2.md`

## Pragmatic connection details (typical dev)

- Gateway base URL: `http://localhost:8000`
- Health: `GET /healthz` → `{ "ok": true }`
- Readiness: `GET /readyz` → `{ "ready": true }`
  - If `ready=false`, the gateway is not paired/configured; don’t proceed.
- Auth (either works):
  - Bearer token: `Authorization: Bearer dev-token`
  - API key: `X-API-Key: dev-key`

## Host vs sandbox networking (important)

This document uses `http://localhost:8000` assuming you run requests **on the host** where Hue Gateway is exposed.

If you run curl **inside a RemcoChat Bash tool sandbox** (docker sandboxd), `localhost` refers to the sandbox container and will not reach Hue Gateway. Use one of:

- Recommended: `http://hue-gateway:8000` by attaching the Hue Gateway container to the sandbox network with a stable alias:
  - `docker network connect --alias hue-gateway remcochat-sandbox-net <hue-gateway-container-name>`
  - Verify from a sandbox container: `curl -sS http://hue-gateway:8000/healthz`
- Fallback (Docker Desktop): `http://host.docker.internal:8000` if Hue Gateway is published on the host on port 8000

## What this service is (v2)

- Hue Gateway is a LAN-only HTTP API that controls a Philips Hue Bridge (Hue API v2 / CLIP v2).
- It exposes a small set of **high-level actions** plus a CLIP v2 pass-through.
- v2 keeps `/v1/*` behavior/shape-frozen and introduces `/v2/*` as the codegen-friendly contract.

## v2 endpoints (build to these)

- `POST /v2/actions`
- `GET /v2/events/stream` (SSE; resume with `Last-Event-ID`)
- `GET /openapi.json` (runtime OpenAPI; optional validation)

## Canonical envelope (every response, including 401/429)

- Success: `{"requestId": "...", "action": "...", "ok": true, "result": ...}`
- Error (any non-2xx): `{"requestId": "...", "action": "...", "ok": false, "error": { "code": "...", "message": "...", "details": {} }}`

## Correlation vs idempotency (explicitly separated)

Correlation:
- Prefer `X-Request-Id` header.
- Body may include `requestId` (echoed back).
- If both header + body are present they must match → `400 request_id_mismatch`.

Idempotency (state changes):
- Prefer `Idempotency-Key` header; body may include `idempotencyKey`.
- Header wins; mismatch → `400 invalid_idempotency_key`.
- In-flight dedupe → `409 idempotency_in_progress` with `Retry-After` and/or `error.details.retryAfterMs`.
- Key reuse with different request → `409 idempotency_key_reuse_mismatch`.

## Inventory + revisions (recommended integration model)

Hue Gateway supports an “inventory + SSE cache” pattern:

1) On startup: call `inventory.snapshot` and seed your local cache with `revision`.
2) Subscribe to `GET /v2/events/stream`, apply deltas, persist the last SSE `id`.
3) Resume with `Last-Event-ID`.
4) On `needs_resync`: refresh `inventory.snapshot` and reset cursor tracking.

RemcoChat currently uses `inventory.snapshot` on-demand for discovery and does **not** maintain a persistent SSE cache yet.

### `inventory.snapshot`

The action returns a normalized read model:
- `rooms[]`: `{ rid, name, groupedLightRid }`
- `zones[]`: `{ rid, name, groupedLightRid, roomRids[]? }`
- `lights[]`: `{ rid, name, ownerDeviceRid, roomRid? }`

It also returns `revision`, and supports `ifRevision` → `{notModified:true, revision}` when unchanged.

## High-level actions (prefer these)

- `room.set`
- `zone.set`
- `inventory.snapshot`
- `actions.batch` (sequential; `continueOnError=true` → `207` with per-step results)

Keep `clipv2.request` as an escape hatch, but prefer structured actions where possible.

## RemcoChat integration

RemcoChat provides two ways to call Hue Gateway v2:

1) Preferred: server-side tool **`hueGateway`** (deterministic, typed, no bash/curl).
2) Fallback: `.skills/hue-instant-control` bash scripts (still v2, useful for local debugging or models without tool calling).

### Enable `hueGateway` tool (config)

In `config.toml`:

```toml
[app.hue_gateway]
enabled = false
access = "localhost"  # "localhost" | "lan"
base_urls = ["http://hue-gateway:8000", "http://host.docker.internal:8000", "http://localhost:8000"]
timeout_ms = 8000

# Env var NAMES (not secret values):
auth_header_env = "HUE_AUTH_HEADER"
bearer_token_env = "HUE_TOKEN"
api_key_env = "HUE_API_KEY"
```

Tool availability rules:
- Requires `app.hue_gateway.enabled=true`.
- `access="localhost"`: only localhost requests can use the tool.
- `access="lan"`: requires RemcoChat admin policy/token (same policy used for other privileged tools).
- Tool is included only when Hue skill is relevant (explicit `/hue-instant-control` invocation or the skill is already active in the chat).

### Tool behavior (important)

- Always sets `X-Request-Id` and body `requestId` to the same value.
- For state-changing actions, always sets `Idempotency-Key` (and body `idempotencyKey`) deterministically per turn + payload.
- Retries at most once on `409 idempotency_in_progress` and `429 rate_limited` / `bridge_rate_limited` using `retryAfterMs` / `Retry-After`.
- Treats `verified=false` as success-with-warning (the action still returns `ok:true`).
- In RemcoChat, `clipv2.request` is intentionally restricted to `GET|HEAD|OPTIONS` and paths starting with `/clip/v2/`.

### Bash fallback (skill)

If you need bash/curl:
- Use `.skills/hue-instant-control` and prefer its scripts under `.skills/hue-instant-control/scripts/`.
- All scripts use `/v2/actions` and the v2 envelope.

## Error handling (client guidance)

Handle errors primarily by `error.code` (not by ad-hoc string matching). For retryable cases, prefer `error.details.retryAfterMs` over fixed sleeps.

Common classes:
- Auth/config: `unauthorized`, `forbidden`, `bridge_unreachable`
- Match safety: `ambiguous_name`, `no_confident_match`
- Idempotency: `idempotency_in_progress`, `idempotency_key_reuse_mismatch`
- Rate limits: `rate_limited`, `bridge_rate_limited`

## Deliverables RemcoChat should maintain

- Generated TypeScript types from the stable skeleton OpenAPI:
  - `docs/integrations/hue/v2-migration/openapi-v2.skeleton.yaml`
  - Generated to: `src/server/integrations/hue-gateway/v2/openapi.ts`
- Server-side v2 client/tooling (no `/v1/*` integration paths in RemcoChat code/tests/scripts).
