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
allowed-tools: Read Bash(curl:*) Bash(jq:*) Bash(python3:*)
metadata:
  author: remcochat
  version: "0.3.0"
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

## Quick start (recommended path)

1) **Select `BASE_URL` + ensure ready** (fast; once per chat):
   - Recommended: run `scripts/health_check.sh` and `eval` its output:

```bash
eval "$(bash scripts/health_check.sh)"
```

2) **Discover rooms** (room name → controllable grouped-light RID):

```bash
bash scripts/list_rooms.sh
```

This prints: `<room-name>\t<grouped_light_rid>\t<room_rid>`.

3) **Set the room** using `grouped_light.set` (RID-based; no guessing):

```bash
curl -sS --connect-timeout 1 --max-time 8 -X POST "$BASE_URL/v1/actions" \
  -H 'Content-Type: application/json' \
  -H "${HUE_AUTH_HEADER:-Authorization: Bearer ${HUE_TOKEN:-dev-token}}" \
  -d '{"action":"grouped_light.set","args":{"rid":"<GROUPED_LIGHT_RID>","on":true,"brightness":35,"colorTempK":2400}}'
```

Note: for `clipv2.request` responses, Hue resources are at `result.body.data` (not `result.data`).

## When you need details

- Full reference (discovery flows, parsing patterns, vibe presets, verification, failure handling): `references/REFERENCE.md`

## Resources (Level 3)

- Health + readiness: `scripts/health_check.sh`
- Room discovery: `scripts/list_rooms.sh`
