# Hue Instant Control — Reference (Hue Gateway v2)

This file contains the detailed operational reference for the `hue-instant-control` skill.
Keep `SKILL.md` short; load this reference only when you need deeper guidance, exact payload shapes, or troubleshooting.

## Execution paths (choose in this order)

### 1) Server-side tool: `hueGateway` (preferred)

If the `hueGateway` tool is present in the tool list, use it:

- It calls Hue Gateway **v2** (`POST /v2/actions`) directly from the server (no bash/curl).
- It sets correlation + idempotency deterministically (safe retries without “remembering” keys).
- It applies safe defaults for matching and (some) verification.
- It retries **at most once** on `409 idempotency_in_progress` and `429 rate_limited` / `bridge_rate_limited` using `retryAfterMs`.

Tool input shape:

```json
{ "action": "<v2 action>", "args": { } }
```

Do **not** generate `requestId` / `idempotencyKey` yourself when using the tool.

#### Read-only listing (important; avoid loops)

For “list / what’s in / show me the lights in …” requests:
- Do **exactly 1** tool call: `inventory.snapshot`.
- Answer from `result.rooms[]`, `result.zones[]`, and `result.lights[]`.
- Avoid chaining `resolve.by_name` for basic listing; it is rarely needed and increases the chance of tool-call loops.

#### Rooms vs zones (treat user language as interchangeable)

Hue has **rooms** and **zones**:
- **Room**: contains lights.
- **Zone**: groups multiple rooms (e.g. “Downstairs/Upstairs/Beneden/Boven”).

Users often say “room” or “in <name>” when they mean an **area**. When a user provides a name (e.g. “Keuken”):

1) Call `inventory.snapshot`.
2) Normalize-match the name against **both** `result.rooms[].name` and `result.zones[].name`.
3) If it matches exactly one:
   - room match → list lights where `light.roomRid == room.rid`
   - zone match → collect `zone.roomRids[]` then list lights where `light.roomRid` is in that set
4) If it matches **both** a room and a zone → ask which they mean.
5) If it matches **neither** → ask a quick follow-up and show a few candidates from both rooms + zones.

Recommended actions:
- Read-only discovery: `inventory.snapshot`
- Actuation: `room.set`, `zone.set`, `light.set`, `grouped_light.set`, `scene.activate`
- Name resolution: `resolve.by_name` (use when inventory matching is insufficient)
- Escape hatch (read-only): `clipv2.request` with `method=GET|HEAD|OPTIONS`
- Multi-step: `actions.batch` (sequential)

### 2) Bash fallback (still v2)

Only use Bash when:
- the user explicitly asks for bash/curl,
- tool calling is unavailable, or
- Hue v2 tools are disabled by config / access policy.

Always Report back to the user why you needed to use Bash fallback.

Prefer executing the bundled scripts in `./.skills/hue-instant-control/scripts/`:

- `health_check.sh` → base URL selection + `/readyz` check
- `list_rooms.sh` → `inventory.snapshot` rooms list (`name\tgroupedLightRid\trid`)
- `room_set_by_name.sh` → `room.set` (verified by default; `verified=false` is a warning)
- `zone_set_by_name.sh` → `zone.set` (dry-run + confirm safety gate)
- `light_set_by_name.sh` → `light.set`
- `room_vibe.sh` → deterministic presets (delegates to `room_set_by_name.sh`)
- `zone_list_lights.sh` → inventory-based zone light listing (names or TSV)
- `room_list_lamps.sh` → inventory-based room light listing

## Gateway connection

- Base URL default (recommended for sandbox networking): `http://hue-gateway:8000`
- Auth header (either works for `/v2/*`):
  - `Authorization: Bearer dev-token`
  - `X-API-Key: dev-key`

Important: if you are executing via a sandboxed Bash tool, `localhost` refers to the sandbox, not the host machine.

Always perform an initial gateway health_check when this skill is activated by the user and report back to the user either "Hue gateway is healthy" or "Hue gateway is unhealthy".

### Auth header selection (bash)

```bash
AUTH_HEADER="${HUE_AUTH_HEADER:-}"
if [ -z "$AUTH_HEADER" ]; then
  if [ -n "${HUE_API_KEY:-}" ]; then
    AUTH_HEADER="X-API-Key: $HUE_API_KEY"
  else
    AUTH_HEADER="Authorization: Bearer ${HUE_TOKEN:-dev-token}"
  fi
fi
```

### Base URL selection + readiness (bash)

Use `scripts/health_check.sh` (recommended), or inline:

```bash
set -euo pipefail

CURL_HEALTH='curl -fsS --connect-timeout 1 --max-time 2'

BASE_URL="${BASE_URL:-}"
if [ -z "$BASE_URL" ]; then
  for base in "http://hue-gateway:8000" "http://host.docker.internal:8000" "http://localhost:8000"; do
    if $CURL_HEALTH "$base/healthz" >/dev/null; then
      BASE_URL="$base"
      break
    fi
  done
fi

[ -n "$BASE_URL" ] || { echo "Hue Gateway not reachable from this environment."; exit 1; }
BASE_URL="${BASE_URL%/}"

READY_JSON="$($CURL_HEALTH "$BASE_URL/readyz")"
case "$READY_JSON" in
  *'"ready":true'*|*'"ready": true'*) : ;;
  *) echo "Hue Gateway is not ready (ready=false)."; exit 1 ;;
esac
```

## Hue Gateway API v2 contract (what to build to)

Endpoints:
- `POST /v2/actions`
- `GET /v2/events/stream` (SSE; resume with `Last-Event-ID`)

Canonical envelope everywhere (including 401/429):

- Success: `{"requestId": "...", "action": "...", "ok": true, "result": ...}`
- Error: `{"requestId": "...", "action": "...", "ok": false, "error": { "code": "...", "message": "...", "details": {} }}`

Correlation vs idempotency:
- Correlation: `X-Request-Id` header preferred; body `requestId` echoed.
  - If both header + body are present they must match → else `400 request_id_mismatch`.
- Idempotency: `Idempotency-Key` header preferred; optional body `idempotencyKey`.
  - Header wins; mismatch → `400 invalid_idempotency_key`.

Retry/backoff:
- `409 idempotency_in_progress` returns `Retry-After` and/or `error.details.retryAfterMs`.
- `429 rate_limited` / `bridge_rate_limited` returns backoff hints similarly.
- Treat those as “wait then retry once” (scripts/tools do bounded retries; do not loop indefinitely).

Verification:
- State-changing actions return verification fields and `warnings[]`.
- `ok:true` can still mean `verified:false` → treat as success with warning unless the user asked for strict convergence.

## Inventory (recommended discovery model)

`inventory.snapshot` returns a normalized read model and a `revision`. In the full response:

- `rooms[]`: `{ rid, name, groupedLightRid }`
- `zones[]`: `{ rid, name, groupedLightRid, roomRids[]? }`
- `lights[]`: `{ rid, name, ownerDeviceRid, roomRid? }`

Use inventory for:
- listing rooms/zones/lights
- mapping zone → rooms → lights
- mapping room → lights

Notes:
- When listing lights “in <name>”, treat `<name>` as a room-or-zone candidate and match both lists.
- Prefer inventory matching for listing; reserve `resolve.by_name` for actuation or when inventory names are insufficient.

## Curl templates (v2)

Always use tight timeouts:
- `curl -sS --connect-timeout 1 --max-time 8`
- Avoid `curl -f` (it hides the useful JSON envelope on 4xx/5xx).

### inventory.snapshot (read-only)

```bash
REQ_ID="bash-snap-$(date -u +%Y%m%dT%H%M%SZ)-$RANDOM"
curl -sS --connect-timeout 1 --max-time 8 -X POST "$BASE_URL/v2/actions" \
  -H 'Content-Type: application/json' \
  -H "X-Request-Id: $REQ_ID" \
  -H "$AUTH_HEADER" \
  -d "$(printf '{"requestId":"%s","action":"inventory.snapshot","args":{}}' "$REQ_ID")"
```

### room.set (state change; idempotent)

```bash
REQ_ID="bash-room-$(date -u +%Y%m%dT%H%M%SZ)-$RANDOM"
IDEM_KEY="bash-idem-room-$REQ_ID"
curl -sS --connect-timeout 1 --max-time 8 -X POST "$BASE_URL/v2/actions" \
  -H 'Content-Type: application/json' \
  -H "X-Request-Id: $REQ_ID" \
  -H "Idempotency-Key: $IDEM_KEY" \
  -H "$AUTH_HEADER" \
  -d "$(printf '{"requestId":"%s","idempotencyKey":"%s","action":"room.set","args":{"roomName":"%s","state":{"on":true,"brightness":35,"colorTempK":2400}}}' \
    "$REQ_ID" "$IDEM_KEY" "Woonkamer")"
```

### grouped_light.set (state change; low-level)

```bash
REQ_ID="bash-gl-$(date -u +%Y%m%dT%H%M%SZ)-$RANDOM"
IDEM_KEY="bash-idem-gl-$REQ_ID"
curl -sS --connect-timeout 1 --max-time 8 -X POST "$BASE_URL/v2/actions" \
  -H 'Content-Type: application/json' \
  -H "X-Request-Id: $REQ_ID" \
  -H "Idempotency-Key: $IDEM_KEY" \
  -H "$AUTH_HEADER" \
  -d "$(printf '{"requestId":"%s","idempotencyKey":"%s","action":"grouped_light.set","args":{"rid":"%s","state":{"on":true,"brightness":35}}}' \
    "$REQ_ID" "$IDEM_KEY" "<GROUPED_LIGHT_RID>")"
```

### clipv2.request (read-only escape hatch)

```bash
REQ_ID="bash-clip-$(date -u +%Y%m%dT%H%M%SZ)-$RANDOM"
curl -sS --connect-timeout 1 --max-time 8 -X POST "$BASE_URL/v2/actions" \
  -H 'Content-Type: application/json' \
  -H "X-Request-Id: $REQ_ID" \
  -H "$AUTH_HEADER" \
  -d "$(printf '{"requestId":"%s","action":"clipv2.request","args":{"method":"GET","path":"/clip/v2/resource/room"}}' "$REQ_ID")"
```

Note: for `clipv2.request`, Hue Bridge resources are nested under `result.body.data`.

## Troubleshooting checklist

- `healthz` works but `readyz` is `ready=false`: the gateway is up but not paired/configured; don’t proceed.
- `401`/`403`: auth header wrong/missing.
- `400 request_id_mismatch`: you set both `X-Request-Id` and body `requestId` but they differ.
- `409 idempotency_in_progress`: wait then retry once (use retryAfter hints).
- `verified=false`: treat as success with warning; do not auto-loop unless the user asked for strict verification.
