---
name: hue-instant-control
description: |
  Instant Philips Hue control via the local Hue Gateway HTTP API. Translates fuzzy requests ("vibes") and natural
  language into concrete room/light actions (on/off, brightness, color temperature, simple colors).
license: MIT
compatibility: |
  Requires access to the Hue Gateway and ability to make HTTP requests. The base URL depends on where commands execute
  (host vs sandbox); follow the Base URL selection rules in this skill.
  If the chat has the Bash tool enabled, prefer using curl via Bash. Otherwise, provide curl commands for the user.
allowed-tools: Read Bash
metadata:
  author: remcochat
  version: "0.2.1"
  purpose: hue-gateway-instant-control
---

# Hue Instant Control (Hue Gateway)

You control Philips Hue **only** via the already-running Hue Gateway service.

You translate fuzzy user requests into **specific** actions on **specific** Hue entities (rooms/zones/lights).
Keep the interaction short, confident, and “assistant-y”.

## Performance goal (always)

- **Goal:** operate the Hue Gateway with near-zero errors and minimal latency.
- **Default:** 1 Bash tool call per user request (bundle multiple curl calls in the same Bash invocation).
- **Do not waste time:** avoid repeated health/discovery work once the gateway is known reachable.
- **Always use tight timeouts** on curl so fallbacks are instant.

## Safety + UX rules (always)

1) **Never guess the target.**
   - If the room/zone/light is unclear or ambiguous, ask a quick follow-up.
2) **Avoid “whole house” surprises.**
   - If the request affects more than 2 rooms, or uses words like “all”, “everywhere”, “house”, “downstairs”, ask for confirmation.
3) **Do what the user meant, not what they said literally.**
   - Example: “make it cozy” → turn on + dim + warm color temp.
4) **Be honest about execution.**
   - Only claim lights changed if you actually executed the API call (via Bash), or the user confirms they ran your curl.
5) **Prefer room-level control** (`grouped_light`) unless the user asks for a specific individual light.

## Gateway connection (current environment defaults)

- Base URL (default): `http://hue-gateway:8000` (recommended when using docker sandboxd + shared network)
- Auth header (either works for `/v1/*`):
  - `Authorization: Bearer dev-token`
  - `X-API-Key: dev-key`

Important: if you are executing via the **Bash tool** in a sandbox (Vercel Sandbox or docker sandboxd),
`localhost` refers to the **sandbox**, not the host machine running Hue Gateway.

### Base URL selection (do this first)

1) If the user provides a base URL, use it.
2) Otherwise, try these in order until health succeeds:
   - `http://hue-gateway:8000` (recommended when Hue Gateway is attached to the sandbox network)
   - `http://host.docker.internal:8000` (common for Docker Desktop on macOS/Windows; often works with docker sandboxd)
   - `http://localhost:8000` (only works when executing on the same host/network namespace as the gateway)
3) If neither works, stop and ask the user for a base URL that is reachable **from the execution environment**.
   - Tell them to verify from the same environment by running: `curl -fsS --connect-timeout 1 --max-time 2 <base>/healthz`

### Health check (run once per chat; keep it fast)

```bash
set -euo pipefail

CURL_HEALTH='curl -fsS --connect-timeout 1 --max-time 2'
CURL_JSON='curl -sS --connect-timeout 1 --max-time 8'

BASE_URL="${BASE_URL:-}" # optional: user/environment provided
if [ -z "$BASE_URL" ]; then
  for base in "http://hue-gateway:8000" "http://host.docker.internal:8000" "http://localhost:8000"; do
    if $CURL_HEALTH "$base/healthz" >/dev/null; then
      BASE_URL="$base"
      break
    fi
  done
fi

[ -n "$BASE_URL" ] || { echo "Hue Gateway not reachable from this environment."; exit 1; }
echo "Using BASE_URL=$BASE_URL"

READY_JSON="$($CURL_HEALTH "$BASE_URL/readyz")"
case "$READY_JSON" in
  *'"ready":true'*|*'"ready": true'*) : ;;
  *) echo "Hue Gateway is not ready (ready=false)."; exit 1 ;;
esac
```

If `ready=false`, do not proceed.

## Core API pattern (single envelope)

All actions are:

`POST {BASE_URL}/v1/actions` with JSON:

```json
{ "requestId":"optional", "action":"<action>", "args": { } }
```

Success returns `"ok": true` and a `"result"` payload.

Failure returns `"ok": false` and an `"error"` payload. Some failures also use non-2xx HTTP status codes.

### Response shape gotcha (avoid empty parsing)

The gateway always wraps responses in the action envelope.

- For calls that return a Hue Bridge response (`action=clipv2.request`, `light.set`, `grouped_light.set`, `scene.activate`), the **Hue Bridge JSON is nested under** `result.body`.
  - Hue resources are typically at `result.body.data`
  - Hue errors (if any) are typically at `result.body.errors`

Example (shape):

```json
{
  "ok": true,
  "action": "clipv2.request",
  "result": {
    "status": 200,
    "body": { "errors": [], "data": [ /* resources */ ] }
  }
}
```

So when parsing rooms/lights, **use `result.body.data`, not `result.data`.**

Parsing examples (jq is optional):

```bash
# jq: get the Hue resource array
jq '.result.body.data'
```

```python
# python: get the Hue resource array
body = (resp.get("result") or {}).get("body") or {}
data = body.get("data", [])
```

Prefer `python3` over `python` in Bash (some environments do not ship a `python` alias).

## How you execute actions (preferred)

If the Bash tool is available, use it to run curl commands.
Otherwise, output the exact curl commands for the user.

When using Bash + curl:
- Add `Content-Type: application/json`
- Use `Authorization: Bearer dev-token` unless the user provides another token/key.
- Use `--connect-timeout 1 --max-time 8` so failures are fast.
- Prefer one Bash tool call per user request: run a short bash script (`set -euo pipefail`) that does base URL selection and all needed `/v1/actions` calls.

For `/v1/actions`, prefer `curl -sS` (not `-f`) so you still receive the JSON error body on 4xx/5xx.

### Bash JSON parsing patterns (avoid env-var bugs)

If you capture JSON into a shell variable (e.g. `ROOMS_JSON="$(...)"`), that variable is **not** visible to Python via
`os.environ[...]` unless you explicitly export it.

Recommended (robust): pass the JSON via stdin using a here-string.

Important: do **not** use `python3 -` for this. `python3 -` reads the *Python program* from stdin, so you cannot also
use stdin for JSON input.

```bash
ROOMS_JSON="$(curl -sS --connect-timeout 1 --max-time 8 -X POST "$BASE_URL/v1/actions" \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer dev-token' \
  -d '{"action":"clipv2.request","args":{"method":"GET","path":"/clip/v2/resource/room"}}')"

PY_CODE="$(cat <<'PY'
import json,sys
resp=json.load(sys.stdin)
rooms=((resp.get('result') or {}).get('body') or {}).get('data') or []
for r in rooms:
    if (r.get('metadata') or {}).get('name') == 'Woonkamer':
        print(r.get('id',''))
        break
PY
)"

ROOM_RID="$(python3 -c "$PY_CODE" <<<"$ROOMS_JSON")"
```

Allowed (but easier to mess up): export then read from env:

```bash
export ROOMS_JSON
python3 - <<'PY'
import os
rooms_json=os.environ.get('ROOMS_JSON','')
PY
```

## Discovery flow (how you map fuzzy names → entities)

You need a stable mapping of room/zone names to controllable IDs.

### Step A — List rooms (fast default)

Call:

```bash
curl -sS --connect-timeout 1 --max-time 8 -X POST "$BASE_URL/v1/actions" \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer dev-token' \
  -d '{"action":"clipv2.request","args":{"method":"GET","path":"/clip/v2/resource/room"}}'
```

Parsing tip (jq, if available):

```bash
# Prints: <room-name>\t<grouped_light_rid>
curl -sS --connect-timeout 1 --max-time 8 -X POST "$BASE_URL/v1/actions" \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer dev-token' \
  -d '{"action":"clipv2.request","args":{"method":"GET","path":"/clip/v2/resource/room"}}' \
| jq -r '.result.body.data[] | "\(.metadata.name)\t\(.services[]? | select(.rtype=="grouped_light") | .rid)"'
```

Then, for each room:
- Find `services[]` where `rtype == "grouped_light"`
- Use that `rid` as the controllable ID for the room’s lights.

Speed tip: for a single-room command, this list-rooms call + one `grouped_light.set` is usually the fastest and most reliable path.

### Step B — Optional: list zones (if user asks “downstairs”, “upstairs”, etc.)

```bash
curl -sS --connect-timeout 1 --max-time 8 -X POST "$BASE_URL/v1/actions" \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer dev-token' \
  -d '{"action":"clipv2.request","args":{"method":"GET","path":"/clip/v2/resource/zone"}}'
```

Zones also typically have a `grouped_light` service.

### Step C — Resolve by name (fast path)

If listing rooms/zones is unexpectedly large, you may resolve the *room/zone* first, then extract its `grouped_light` service rid.

```json
{ "action":"resolve.by_name", "args": { "rtype":"room", "name":"Woonkamer" } }
```

Then fetch the room resource and extract the grouped light rid:

```json
{ "action":"clipv2.request", "args": { "method":"GET", "path":"/clip/v2/resource/room/<ROOM_RID>" } }
```

Important: `grouped_light` resources are often unnamed (no `metadata.name`), so **do not** rely on `resolve.by_name` with `rtype="grouped_light"`.

Also: `grouped_light.set` with `{ "name": "..." }` often fails with `not_found` for the same reason.

If it returns ambiguous (409), ask the user to pick.

### Step D — List individual lamps in a room (read-only)

User prompts like “list all lamps in the woonkamer” are **read-only**.

Recommended flow (no state changes):

1) Get the room resource (either list rooms or `resolve.by_name` + fetch the room)
2) Collect its `children[]` `device` rids
3) List devices and keep only those that actually expose a `light` service
4) Output `device.metadata.name` as the lamp list

Example (room name known; uses stdin parsing so it cannot hit `os.environ[...]` KeyErrors):

```bash
# Resolve room rid (fast) and fetch the room resource
RESOLVE_JSON="$($CURL_JSON -X POST "$BASE_URL/v1/actions" \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer dev-token' \
  -d '{"action":"resolve.by_name","args":{"rtype":"room","name":"Woonkamer"}}')"

PY_RESOLVE="$(cat <<'PY'
import json,sys
resp=json.load(sys.stdin)
matched=(resp.get('result') or {}).get('matched') or {}
print(matched.get('rid',''))
PY
)"

ROOM_RID="$(python3 -c "$PY_RESOLVE" <<<"$RESOLVE_JSON")"

[ -n "$ROOM_RID" ] || { echo "Room not found" >&2; exit 1; }

ROOM_JSON="$($CURL_JSON -X POST "$BASE_URL/v1/actions" \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer dev-token' \
  -d "{\"action\":\"clipv2.request\",\"args\":{\"method\":\"GET\",\"path\":\"/clip/v2/resource/room/$ROOM_RID\"}}")"

DEVICE_JSON="$($CURL_JSON -X POST "$BASE_URL/v1/actions" \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer dev-token' \
  -d '{"action":"clipv2.request","args":{"method":"GET","path":"/clip/v2/resource/device"}}')"

PY_LIST="$(cat <<'PY'
import json,sys
room_resp=json.loads(sys.stdin.readline())
dev_resp=json.loads(sys.stdin.readline())

room=((room_resp.get('result') or {}).get('body') or {}).get('data') or []
devices=((dev_resp.get('result') or {}).get('body') or {}).get('data') or []

room0=room[0] if room else {}
child_device_ids={c.get('rid') for c in (room0.get('children') or []) if c.get('rtype')=='device' and c.get('rid')}

names=[]
for d in devices:
    if d.get('id') not in child_device_ids:
        continue
    services=d.get('services') or []
    if not any(s.get('rtype')=='light' for s in services):
        continue
    name=((d.get('metadata') or {}).get('name') or '').strip()
    if name:
        names.append(name)

for name in sorted(set(names), key=lambda s: s.lower()):
    print(name)
PY
)"

printf '%s\n%s\n' "$ROOM_JSON" "$DEVICE_JSON" | python3 -c "$PY_LIST"
```

## Instant control actions (what you should do)

### Room on/off (most common)

Use `grouped_light.set` with the room’s `grouped_light` rid:

```bash
curl -sS --connect-timeout 1 --max-time 8 -X POST "$BASE_URL/v1/actions" \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer dev-token' \
  -d '{"action":"grouped_light.set","args":{"rid":"<GROUPED_LIGHT_RID>","on":false}}'
```

### Brightness (0–100)

```json
{ "action":"grouped_light.set", "args": { "rid":"...", "on": true, "brightness": 35 } }
```

### Warm/cool white (color temperature)

Use Kelvin:

```json
{ "action":"grouped_light.set", "args": { "rid":"...", "on": true, "colorTempK": 2200 } }
```

### Simple colors (only if user asks for color)

Prefer scenes if available. If not, you may set `xy` using rough presets.

Important: `xy` is an object: `{ "x": <number>, "y": <number> }`.

- red: `{ "x": 0.700, "y": 0.299 }`
- green: `{ "x": 0.170, "y": 0.700 }`
- blue: `{ "x": 0.150, "y": 0.060 }`
- purple: `{ "x": 0.270, "y": 0.110 }`

Example:

```json
{ "action":"grouped_light.set", "args": { "rid":"...", "on": true, "brightness": 45, "xy": {"x": 0.150, "y": 0.060} } }
```

If the user requests a nuanced color (“teal”, “sunset”), ask whether they want a **scene** (recommended) or accept a best-effort color.

## “Vibe” translation (fuzzy → concrete)

Use these defaults unless the user specifies otherwise:

- **cozy / warm / relaxing**
  - on: true, brightness: 25–45, colorTempK: 2000–2700
- **focus / working / bright**
  - on: true, brightness: 70–100, colorTempK: 4000–5500
- **movie night**
  - on: true, brightness: 5–20, colorTempK: 2000–2400 (or a dim blue/purple if asked)
- **nightlight / don’t wake anyone**
  - on: true, brightness: 1–10, colorTempK: 2000–2200
- **wake up / energize**
  - on: true, brightness: 60–90, colorTempK: 3500–5000

If the user says “make it X” but also mentions “not too bright”, respect that constraint first.

## Verification (don’t skip for multi-room changes)

After setting a room, verify at least once:

```bash
curl -sS --connect-timeout 1 --max-time 8 -X POST "$BASE_URL/v1/actions" \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer dev-token' \
  -d '{"action":"clipv2.request","args":{"method":"GET","path":"/clip/v2/resource/grouped_light/<RID>"}}'
```

Confirm the relevant fields:
- `on.on`
- `dimming.brightness` (if present)

## Conversation patterns (make it feel great)

- If the user: “make woonkamer cozy”
  - You: do it immediately (single room), then reply: “Done — Woonkamer is now cozy (warm, dim). Want the same in Keukenblok?”

- If the user: “turn off the lights downstairs”
  - You: ask: “Which rooms count as downstairs for you? I currently see: <top 4 candidates>”
  - After confirmation: apply to those rooms, then summarize.

- If the user: “set it to reading mode”
  - You: ask: “Which room?” if not specified; then apply focus/bright but slightly warmer (e.g. 3500–4500K) if the user said “reading”.

## Failure handling

If gateway returns:
- `ready=false`: stop and tell user the gateway is not paired/configured.
- `401`: ask user for correct token/key.
- `409 ambiguous_name`: show choices and ask user to pick.
- `404 not_found`: usually means you tried to address a resource by name where it has no name (common with `grouped_light`). Switch to RID-based control.
- `424` / `502`: tell user bridge is unreachable and stop.
- `429`: tell user it is rate-limited; wait briefly and retry once, otherwise stop.

If `action=clipv2.request` returns `"ok": true` but `result.status` is not 2xx:
- treat it as a failed bridge operation
- show the user `result.body.errors` (if present)
