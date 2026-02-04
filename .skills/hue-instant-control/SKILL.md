---
name: hue-instant-control
description: |
  Instant Philips Hue control via the local Hue Gateway HTTP API. Translates fuzzy requests ("vibes") and natural
  language into concrete room/zone/light actions (on/off, brightness, color temperature, simple colors).
  Use when the user asks to control Philips Hue lights (or mentions Hue, Hue Bridge, Hue scenes) and you can reach the
  Hue Gateway from the execution environment.
license: MIT
compatibility: |
  Requires reachability to the Hue Gateway and ability to make HTTP requests. The base URL depends on where commands
  execute (host vs sandbox). Requires curl; jq/python3 are optional helpers. If the Bash tool is enabled, prefer using
  curl via Bash; otherwise, provide exact curl commands for the user.
allowed-tools: Read Bash
metadata:
  author: remcochat
  version: "0.3.4"
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

## Gateway connection (defaults)

- Base URL (default): `http://hue-gateway:8000` (recommended when using docker sandboxd + shared network)
- Auth header (either works for `/v1/*`):
  - `Authorization: Bearer dev-token`
  - `X-API-Key: dev-key`

Environment override knobs:
- `BASE_URL`: Hue Gateway base URL.
- `HUE_AUTH_HEADER`: full header line to use for auth (e.g. `Authorization: Bearer ...` or `X-API-Key: ...`).
- `HUE_TOKEN`: bearer token value (used if `HUE_AUTH_HEADER` is unset).
- `HUE_API_KEY`: API key value (used if `HUE_AUTH_HEADER` is unset).

Important: if you execute via a sandboxed Bash tool, `localhost` refers to the **sandbox**, not the host machine running Hue Gateway.
Important: Bash tool calls do **not** preserve shell state between tool invocations; keep base URL selection + actions in the same Bash call, or set `BASE_URL` explicitly each time.

### Base URL selection (do this first)

If `BASE_URL` is not provided, try these in order until health succeeds:

1) `http://hue-gateway:8000` (recommended when Hue Gateway is attached to the sandbox network)
2) `http://host.docker.internal:8000` (common for Docker Desktop on macOS/Windows)
3) `http://localhost:8000` (only works when executing on the same host/network namespace as the gateway)

## Common mistakes (avoid)

- Do not use `localhost:8000` from a sandboxed Bash tool unless you know the gateway is in the same network namespace.
- Do not parse `result.data` for `clipv2.request`; Hue resources are at `result.body.data`.
- Do not use `curl -f` for `/v1/actions` calls (it hides useful JSON error bodies); use `curl -sS`.
- Prefer RID-based `grouped_light.set` (names are often missing/ambiguous for grouped lights).
- Do not try to parse curl JSON with `python3 - <<'PY' ... json.load(sys.stdin) ... PY` (stdin is already used for the
  Python program). Use `python3 -c ... <<<"$JSON"` (or `jq`) instead.

## Quick start (recommended path)

1) **Select `BASE_URL` + ensure ready** (fast; put this at the top of the same Bash tool call where you run actions):

```bash
set -euo pipefail

CURL_HEALTH='curl -fsS --connect-timeout 1 --max-time 2'

BASE_URL="${BASE_URL:-}" # optional: user/environment provided
if [ -z "$BASE_URL" ]; then
  for base in "http://hue-gateway:8000" "http://host.docker.internal:8000" "http://localhost:8000"; do
    if $CURL_HEALTH "$base/healthz" >/dev/null; then
      BASE_URL="$base"
      break
    fi
  done
fi

[ -n "$BASE_URL" ] || { echo "Hue Gateway not reachable from this environment. Set BASE_URL to a reachable base URL."; exit 1; }
BASE_URL="${BASE_URL%/}"
echo "Using BASE_URL=$BASE_URL"

READY_JSON="$($CURL_HEALTH "$BASE_URL/readyz")"
case "$READY_JSON" in
  *'"ready":true'*|*'"ready": true'*) : ;;
  *) echo "Hue Gateway is not ready (ready=false)."; exit 1 ;;
esac

AUTH_HEADER="${HUE_AUTH_HEADER:-}"
if [ -z "$AUTH_HEADER" ]; then
  if [ -n "${HUE_API_KEY:-}" ]; then
    AUTH_HEADER="X-API-Key: $HUE_API_KEY"
  else
    AUTH_HEADER="Authorization: Bearer ${HUE_TOKEN:-dev-token}"
  fi
fi
```

2) **Discover rooms** (room name → controllable grouped-light RID):

```bash
curl -sS --connect-timeout 1 --max-time 8 -X POST "$BASE_URL/v1/actions" \
  -H 'Content-Type: application/json' \
  -H "$AUTH_HEADER" \
  -d '{"action":"clipv2.request","args":{"method":"GET","path":"/clip/v2/resource/room"}}'
```

Optional helper: if this skill is installed under `./.skills` (RemcoChat default), you can get a parsed list as:

```bash
bash ./.skills/hue-instant-control/scripts/list_rooms.sh
```

This prints: `<room-name>\t<grouped_light_rid>\t<room_rid>`.

3) **Set the room** using `grouped_light.set` (RID-based; no guessing):

```bash
curl -sS --connect-timeout 1 --max-time 8 -X POST "$BASE_URL/v1/actions" \
  -H 'Content-Type: application/json' \
  -H "$AUTH_HEADER" \
  -d '{"action":"grouped_light.set","args":{"rid":"<GROUPED_LIGHT_RID>","on":true,"brightness":35,"colorTempK":2400}}'
```

Note: for `clipv2.request` responses, Hue resources are at `result.body.data` (not `result.data`).

4) **Set a named lamp / plug** using `light.set` (fast; no discovery needed):

```bash
curl -sS --connect-timeout 1 --max-time 8 -X POST "$BASE_URL/v1/actions" \
  -H 'Content-Type: application/json' \
  -H "$AUTH_HEADER" \
  -d '{"action":"light.set","args":{"name":"Vibiemme","on":true}}'
```

Optional helper script (handles base URL selection + readiness + auth):

```bash
bash ./.skills/hue-instant-control/scripts/light_set_by_name.sh --name "Vibiemme" --on true
```

5) **Set a named room (fast + verified)** using `resolve.by_name` → RID-based `grouped_light.set`:

```bash
bash ./.skills/hue-instant-control/scripts/room_set_by_name.sh --room "Woonkamer" --brightness 35 --color-temp-k 2400
```

6) **Apply a deterministic “vibe” preset** (reduces LLM variability):

```bash
bash ./.skills/hue-instant-control/scripts/room_vibe.sh --room "Woonkamer" --vibe cozy
```

7) **Set a named zone** (safe by default; requires `--confirm` when it affects >2 rooms):

```bash
bash ./.skills/hue-instant-control/scripts/zone_set_by_name.sh --zone "Downstairs" --on false
bash ./.skills/hue-instant-control/scripts/zone_set_by_name.sh --zone "Downstairs" --on false --confirm
```

8) **List all lights in a named zone (read-only; first-time-right)**:

```bash
bash ./.skills/hue-instant-control/scripts/zone_list_lights.sh --zone "Beneden" --print-ok
```

9) **List individual lamps in a named room (read-only; first-time-right)**:

```bash
bash ./.skills/hue-instant-control/scripts/room_list_lamps.sh --room "Woonkamer" --print-ok
```

## When you need details

- Full reference (discovery flows, parsing patterns, vibe presets, verification, failure handling): `references/REFERENCE.md`

## Resources (Level 3)

- Health + readiness: `scripts/health_check.sh`
- Room discovery: `scripts/list_rooms.sh`
- Named lamp/plug control: `scripts/light_set_by_name.sh`
- Named room control: `scripts/room_set_by_name.sh`
- Vibe presets (room): `scripts/room_vibe.sh`
- Named zone control: `scripts/zone_set_by_name.sh`
- List zone lights (read-only): `scripts/zone_list_lights.sh`
- List room lamps (read-only): `scripts/room_list_lamps.sh`
