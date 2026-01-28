---
name: hue-instant-control
description: |
  Instant Philips Hue control via the local Hue Gateway HTTP API. Translates fuzzy “vibes” and natural language
  requests into concrete room/light actions (on/off, brightness, color temperature, simple colors).
license: MIT
compatibility: |
  Requires access to the Hue Gateway and ability to make HTTP requests. The base URL depends on where commands execute
  (host vs sandbox); follow the Base URL selection rules in this skill.
  If the chat has the Bash tool enabled, prefer using curl via Bash. Otherwise, provide curl commands for the user.
allowed-tools: Read Bash
metadata:
  author: remcochat
  version: "0.1.1"
  purpose: hue-gateway-instant-control
---

# Hue Instant Control (Hue Gateway)

You control Philips Hue **only** via the already-running Hue Gateway service.

You translate fuzzy user requests into **specific** actions on **specific** Hue entities (rooms/zones/lights).
Keep the interaction short, confident, and “assistant-y”.

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
   - Tell them to verify from the same environment by running: `curl -sS <base>/healthz`

### Health check (must pass before controlling lights)

```bash
BASE_URL=""
for base in "http://hue-gateway:8000" "http://host.docker.internal:8000" "http://localhost:8000"; do
  if curl -fsS "$base/healthz" >/dev/null; then
    BASE_URL="$base"
    break
  fi
done

test -n "$BASE_URL" || { echo "Hue Gateway not reachable from this environment."; exit 1; }
echo "Using BASE_URL=$BASE_URL"

curl -fsS "$BASE_URL/readyz" | tee /tmp/hue-readyz.json
grep -q '"ready"[[:space:]]*:[[:space:]]*true' /tmp/hue-readyz.json || {
  echo "Hue Gateway is not ready (ready=false)."
  exit 1
}
```

If `ready=false`, do not proceed.

## Core API pattern (single envelope)

All actions are:

`POST {BASE_URL}/v1/actions` with JSON:

```json
{ "requestId":"optional", "action":"<action>", "args": { } }
```

Success returns `"ok": true` and a `"result"` payload.

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

## How you execute actions (preferred)

If the Bash tool is available, use it to run curl commands.
Otherwise, output the exact curl commands for the user.

When using Bash + curl:
- Add `-sS` and `Content-Type: application/json`
- Use `Authorization: Bearer dev-token` unless the user provides another token/key.

## Discovery flow (how you map fuzzy names → entities)

You need a stable mapping of room/zone names to controllable IDs.

### Step A — List rooms

Call:

```bash
curl -sS -X POST "$BASE_URL/v1/actions" \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer dev-token' \
  -d '{"action":"clipv2.request","args":{"method":"GET","path":"/clip/v2/resource/room"}}'
```

Parsing tip (jq, if available):

```bash
# Prints: <room-name>\t<grouped_light_rid>
curl -sS -X POST "$BASE_URL/v1/actions" \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer dev-token' \
  -d '{"action":"clipv2.request","args":{"method":"GET","path":"/clip/v2/resource/room"}}' \
| jq -r '.result.body.data[] | "\(.metadata.name)\t\(.services[]? | select(.rtype=="grouped_light") | .rid)"'
```

Then, for each room:
- Find `services[]` where `rtype == "grouped_light"`
- Use that `rid` as the controllable ID for the room’s lights.

### Step B — Optional: list zones (if user asks “downstairs”, “upstairs”, etc.)

```bash
curl -sS -X POST "$BASE_URL/v1/actions" \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer dev-token' \
  -d '{"action":"clipv2.request","args":{"method":"GET","path":"/clip/v2/resource/zone"}}'
```

Zones also typically have a `grouped_light` service.

### Step C — Resolve by name (fast path)

If the user clearly provided an exact name (and you want a simpler flow), you may resolve the *room/zone* first, then extract its `grouped_light` service rid.

```json
{ "action":"resolve.by_name", "args": { "rtype":"room", "name":"Woonkamer" } }
```

Then fetch the room resource and extract the grouped light rid:

```json
{ "action":"clipv2.request", "args": { "method":"GET", "path":"/clip/v2/resource/room/<ROOM_RID>" } }
```

Important: `grouped_light` resources are often unnamed (no `metadata.name`), so **do not** rely on `resolve.by_name` with `rtype="grouped_light"`.

If it returns ambiguous (409), ask the user to pick.

## Instant control actions (what you should do)

### Room on/off (most common)

Use `grouped_light.set` with the room’s `grouped_light` rid:

```bash
curl -sS -X POST "$BASE_URL/v1/actions" \
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
curl -sS -X POST "$BASE_URL/v1/actions" \
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
- `424` / `502`: tell user bridge is unreachable and stop.

If `action=clipv2.request` returns `"ok": true` but `result.status` is not 2xx:
- treat it as a failed bridge operation
- show the user `result.body.errors` (if present)
