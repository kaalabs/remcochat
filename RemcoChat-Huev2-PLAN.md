# RemcoChat → Hue Gateway API v2 Migration (PLAN)

Status: Draft  
Last updated: 2026-02-05  
Owner: RemcoChat

## Summary

Migrate RemcoChat’s Philips Hue integration from Hue Gateway API **v1** (`/v1/*`) to the new **v2** contract (`/v2/*`) by:

1) Adding a **server-side, typed Hue Gateway v2 client** + a **new LLM tool** `hueGateway` (preferred execution path; deterministic, no bash/curl).  
2) Updating the existing `hue-instant-control` skill to **prefer the `hueGateway` tool** and keep **bash scripts as fallback** (still v2).  
3) Updating docs + tests so **RemcoChat no longer depends on `/v1/actions`**.

This plan assumes Hue Gateway v2 is already implemented and reachable, and **RemcoChat will require v2** (no fallback to v1).

## Inputs / sources of truth (authoritative)

- Team email in this chat (v2 endpoints, envelope, headers, idempotency/verify/SSE/inventory rules).
- `docs/integrations/hue/v2-migration/hue-gateway-api-architecture-0v91.md`
  - RemcoChat-side goals + “move execution out of bash/curl”, tool-loop discipline, locked decisions (sections 6–9).
- `docs/integrations/hue/v2-migration/openapi-v2.skeleton.yaml` (stable codegen input; includes `x-error-code-registry`).
- `docs/integrations/hue/v2-migration/spec-v2.md` (semantics that OpenAPI can’t fully express).

## Goals

- **No `/v1/*` usage** in RemcoChat integration paths.
- **Codegen-friendly**, strongly typed v2 action calls.
- **Deterministic execution**: LLM produces structured intent; code executes safely.
- **Reliable targeting**: “never guess” via v2 match options + error codes (`ambiguous_name`, `no_confident_match`).
- **Safe retries**: v2 idempotency + actionable backoff for 409/429.
- Keep a **bash fallback** for local debugging and for models without tool calling (but fallback still uses v2).

## Non-goals

- Implementing/altering Hue Gateway itself (assumed already deployed with v2).
- Building a full RemcoChat-side persistent SSE cache (that’s the “full” scope; deferred).
- Internet/cloud exposure or multi-tenant auth.

## Public interface changes (RemcoChat)

### 1) New config surface (required)

Add a new optional config section to `config.toml`:

```toml
[app.hue_gateway]
enabled = false
access = "localhost"  # "localhost" | "lan"
base_urls = ["http://hue-gateway:8000", "http://host.docker.internal:8000", "http://localhost:8000"]
timeout_ms = 8000

# Auth resolution (all values are ENV VAR NAMES, not secrets):
auth_header_env = "HUE_AUTH_HEADER"   # optional (full header line)
bearer_token_env = "HUE_TOKEN"        # optional
api_key_env = "HUE_API_KEY"           # optional
```

Defaults / behavior:
- `enabled=false` by default (opt-in).
- `access="localhost"` by default.
- `access="lan"` requires RemcoChat admin policy to pass (reuse `isRequestAllowedByAdminPolicy` logic).
- Auth header resolution order:
  1) If env var named by `auth_header_env` is set → use its full header line verbatim.
  2) Else if env var named by `api_key_env` is set → `X-API-Key: <value>`.
  3) Else if env var named by `bearer_token_env` is set → `Authorization: Bearer <value>`.
  4) Else (dev-only) fall back to `Authorization: Bearer dev-token` (only when `NODE_ENV !== "production"`); in production: error.

Files impacted:
- `src/server/config.ts` (schema + normalization)
- `config.toml.example` (+ `config.docker.toml.example` if applicable)
- New unit tests: `tests/config-hue-gateway.test.ts`

### 2) New LLM tool: `hueGateway` (required)

Expose a new tool name: **`hueGateway`**.

Availability rules (to keep scope tight and avoid accidental use):
- Tool is included only when all are true:
  - `app.hue_gateway.enabled == true`
  - Request allowed by `app.hue_gateway.access` (localhost, or admin policy for lan)
  - Hue skill is relevant:
    - explicit `/hue-instant-control` invocation **OR**
    - chat already has `hue-instant-control` activated

Tool input schema (validated with zod; “validated command schema”):
- `action`: enum of allowed v2 actions (initial allowlist):
  - `inventory.snapshot`
  - `room.set`
  - `zone.set`
  - `light.set`
  - `grouped_light.set`
  - `scene.activate`
  - `resolve.by_name`
  - `clipv2.request` (GET-only in tool v1; see Safety)
  - `actions.batch`
- `args`: per action, shaped per `openapi-v2.skeleton.yaml` (subset-only, but structurally identical).

Tool defaults applied server-side (not left to LLM):
- Correlation:
  - Always set `X-Request-Id` header.
  - Always set body `requestId` to the same value.
- Idempotency (for state-changing requests):
  - Always set `Idempotency-Key` header.
  - Always set body `idempotencyKey` to the same value.
  - Key is **deterministic per (turn, action payload)** to make retries safe without LLM remembering keys:
    - `idempotencyKey = "rc:" + <turnKey> + ":" + <hash(action,args)>`
    - `<turnKey>`:
      - non-temporary: `${chatId}:${turnUserMessageId}`
      - temporary: `${temporarySessionId}:${turnUserMessageId}`
- Safe match defaults for name-based state changes (if args.match is absent):
  - `mode="normalized"`, `minConfidence=0.85`, `minGap=0.15`, `maxCandidates=10`
- Verify defaults:
  - For `room.set` and `zone.set`: if args.verify is absent → `mode="poll"`, `timeoutMs=2000`, `pollIntervalMs=150`
  - For `light.set` and `grouped_light.set`: default `verify.mode="none"` unless explicitly provided

Retry policy inside the tool (bounded, deterministic):
- If response is:
  - `409 idempotency_in_progress` OR
  - `429 rate_limited` / `429 bridge_rate_limited`
- Then:
  - Parse `retryAfterMs` from `error.details.retryAfterMs` (preferred) or `Retry-After` header.
  - Wait `min(retryAfterMs, 1000)` and retry **once** with the **same** idempotency key and request id.
  - If still failing: return the canonical error to the model (do not loop).

Tool output (compact; model-friendly):
- `{ status, ok, action, requestId, result?, error?, retryAfterMs? }`
- `error` is the v2 canonical `{ code, message, details }` (pass through).
- Never throw for expected gateway errors; only throw for:
  - config missing when tool is enabled
  - non-JSON responses
  - network failures (return a structured `error.code="gateway_unreachable"` in output, not an exception)

Safety constraints:
- `clipv2.request` allowed only for `method=GET|HEAD|OPTIONS` initially.
- Enforce `path` starts with `/clip/v2/` and contains no scheme/host.

Files impacted:
- New: `src/server/integrations/hue-gateway/v2/client.ts` (HTTP + envelopes)
- New: `src/ai/hue-gateway-tools.ts` (tool zod schemas + execute)
- Update: `src/app/api/chat/route.ts` (conditional inclusion of tool set)
- Potential small update: `src/ai/system-prompt.ts` (optional: mention `hueGateway` exists only when Hue skill active; not strictly required)

## Codegen (types) – required

Generate TypeScript types from the stable skeleton:

- Add dev dependency: `openapi-typescript`
- Add npm script:
  - `npm run gen:hue-gateway-v2` → generates `src/server/integrations/hue-gateway/v2/openapi.ts` from `docs/integrations/hue/v2-migration/openapi-v2.skeleton.yaml`
- Commit the generated file to keep builds deterministic.

Files impacted:
- `package.json` (+ lockfile)
- New generated: `src/server/integrations/hue-gateway/v2/openapi.ts`
- Optional helper script: `scripts/gen-hue-gateway-v2.mjs` (only if CLI flags need wrapping)

## Skill migration (required): `hue-instant-control`

### 1) Skill instructions: prefer tool, keep bash fallback

Update `.skills/hue-instant-control/SKILL.md`:
- Replace v1 references with v2 (`/v2/actions`).
- Add a “Preferred path” section:
  - If tool calling is available and `hueGateway` tool exists → use it for:
    - `inventory.snapshot` for discovery
    - `room.set` / `zone.set` / `light.set` for actuation
  - Use bash scripts only when:
    - user explicitly asks for bash/curl
    - tool calling is unavailable
    - Hue tool is disabled by config
- Update examples to v2 shapes:
  - `light.set` / `grouped_light.set` now take `args.state`
  - show `room.set` and `zone.set` as first choice

Update `.skills/hue-instant-control/references/REFERENCE.md` similarly (deep reference doc).

### 2) Bash scripts: keep as fallback, but migrate to v2 + high-level actions

Update scripts under `.skills/hue-instant-control/scripts/`:

- `health_check.sh`
  - unchanged (still uses `/healthz` + `/readyz`)
- `list_rooms.sh`
  - switch to `POST $BASE_URL/v2/actions` with `action:"inventory.snapshot"`
  - output: `<room-name>\t<groupedLightRid>\t<roomRid>` (from normalized snapshot)
- `room_set_by_name.sh`
  - replace resolve+clip+grouped_light.set+verify with single v2 action:
    - `action:"room.set"`, `args:{ roomName, state:{...}, verify:{mode:"poll"...} }`
  - treat `result.verified=false` as **success with warning** (exit 0; print warning to stderr)
- `room_vibe.sh`
  - keep; it delegates to room_set_by_name
- `light_set_by_name.sh`
  - call `action:"light.set"`, `args:{ name, state:{...} }`
- `zone_set_by_name.sh`
  - implement confirm flow using v2:
    1) Call `zone.set` with `dryRun:true` to get `impact`
    2) If `--confirm` not passed and impacted rooms >2 (or 0/unknown) → exit code 3 with human-friendly room list (from `impact.affectedRooms`)
    3) On `--confirm`, call `zone.set` with `dryRun:false` (default) and `verify` enabled
  - exit 0 even if `verified=false` (warn)
- `zone_list_lights.sh`
  - use `inventory.snapshot` and zone resolution:
    - resolve zone rid via `resolve.by_name` (with safe match defaults) OR do a strict normalized string match over snapshot zones
    - select lights where `light.roomRid` is in `zone.roomRids`
  - preserve `--format names|tsv` and `--print-ok`
- `room_list_lamps.sh`
  - switch to inventory-based listing:
    - resolve room rid
    - list snapshot lights where `roomRid` matches
  - keep `--print-ok`

Also update any remaining hard-coded `/v1/actions` strings.

## Docs migration (required)

Update `docs/integrations/hue/hue.md`:
- “Start here” and “How to integrate” sections updated to v2:
  - endpoints: `POST /v2/actions`, `GET /v2/events/stream`
  - canonical envelope on all statuses
  - correlation vs idempotency headers and mismatch rules
  - prefer `inventory.snapshot`, `room.set`, `zone.set`, `actions.batch`
- Add “RemcoChat integration” section:
  - enabling `app.hue_gateway` config
  - when `hueGateway` tool is available vs bash fallback
- Keep a short note that `/v1/*` remains supported by gateway but is not used by RemcoChat.

## Tests (required)

### Unit tests (run by default)

1) Add config parsing coverage:
- New: `tests/config-hue-gateway.test.ts`
  - parses `app.hue_gateway` enabled/access/base_urls/auth env names/timeout
  - rejects invalid values (bad URL list, invalid access enum, negative timeouts)

2) Add deterministic idempotency key tests (pure logic; no mocks):
- New: `tests/hue-gateway-idempotency.test.ts` (or colocate with tool tests)
  - same `(turnKey, action,args)` → same key
  - different payload → different key
  - verify no secrets appear in key

### E2E tests (do not run by default; update existing)

Update `e2e/hue-instant-control.spec.ts`:
- Change helper `hueHostAction()` to call `${BASE_URL}/v2/actions` and parse v2 envelope.
- Update any v1-shaped action payloads:
  - `grouped_light.set` must send `args.state`
- Update assertions:
  - replace `"/v1/actions"` with `"/v2/actions"`
  - replace room listing expectation from `/clip/v2/resource/room` to `inventory.snapshot` if `list_rooms.sh` changes
- Add one new test to validate the new tool path (no bash):
  - Message: `/hue-instant-control` + “Use hueGateway tool (not bash) to call inventory.snapshot and list rooms; reply done”
  - Assert tool-input/tool-output includes `toolName === "hueGateway"` and no `bash` usage

## Rollout / acceptance

### Rollout steps
1) Ship config + tool disabled by default.
2) Document required env vars (no secrets in repo):
   - `HUE_AUTH_HEADER` or `HUE_TOKEN`/`HUE_API_KEY`
   - (optional) `REMCOCHAT_ADMIN_TOKEN` if `access="lan"`
3) Enable on a dev instance:
   - set `[app.hue_gateway].enabled=true`
   - ensure Hue Gateway v2 is reachable and paired (`/readyz`)
4) Manual smoke in chat UI:
   - `/hue-instant-control` list rooms
   - `/hue-instant-control` room cozy (room.set)
   - `/hue-instant-control` zone dryRun confirm + apply (zone.set)
5) Keep bash fallback for debugging and for models without tool calling.

### Acceptance criteria (must meet)
- No RemcoChat integration codepaths call `/v1/actions` (docs may mention, but code/tests/scripts must use v2).
- `hueGateway` tool:
  - always sends `X-Request-Id` and `Idempotency-Key` correctly (no mismatch errors caused by RemcoChat)
  - returns canonical v2 error info by `error.code` on failures
  - retries at most once on `429` / `idempotency_in_progress`
- `hue-instant-control` skill:
  - prefers `hueGateway` tool by default
  - still works via bash scripts when explicitly requested
- Unit tests pass (`npm run test:unit`).
- Updated Hue E2E suite is runnable and logically correct (not required to run by default).

## Explicit assumptions / defaults

- Hue Gateway v2 is deployed and exposes:
  - `POST /v2/actions`
  - `GET /v2/events/stream`
- RemcoChat will **require v2** (no automatic v1 fallback).
- Tool uses **read-only** `clipv2.request` methods initially (GET/HEAD/OPTIONS).
- No persistent RemcoChat-side SSE cache in this migration (can be a follow-on).

