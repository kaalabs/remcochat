#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  room_list_lamps.sh --room "<Hue room name>" [--print-ok]

Examples:
  bash ./.skills/hue-instant-control/scripts/room_list_lamps.sh --room "Woonkamer"
  bash ./.skills/hue-instant-control/scripts/room_list_lamps.sh --room "Woonkamer" --print-ok

Notes:
  - Read-only: uses only resolve.by_name (rtype=room) + clipv2.request reads.
  - Prints individual lamp device names (Hue devices that expose a "light" service).
EOF
}

ROOM=""
PRINT_OK=0

while [ $# -gt 0 ]; do
  case "${1:-}" in
    --room)
      ROOM="${2:-}"
      shift 2
      ;;
    --print-ok)
      PRINT_OK=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "room_list_lamps.sh: unknown arg: ${1:-}" >&2
      usage
      exit 2
      ;;
  esac
done

ROOM="$(echo "$ROOM" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
if [ -z "$ROOM" ]; then
  echo "room_list_lamps.sh: missing required: --room" >&2
  usage
  exit 2
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

HEALTH_EXPORTS="$(bash "$SCRIPT_DIR/health_check.sh")" || exit $?
eval "$HEALTH_EXPORTS"
BASE_URL="${BASE_URL%/}"

if ! command -v curl >/dev/null 2>&1; then
  echo "room_list_lamps.sh: missing required dependency: curl" >&2
  exit 127
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "room_list_lamps.sh: missing required dependency: python3" >&2
  exit 127
fi

AUTH_HEADER=""
if [ -n "${HUE_AUTH_HEADER:-}" ]; then
  AUTH_HEADER="$HUE_AUTH_HEADER"
elif [ -n "${HUE_API_KEY:-}" ]; then
  AUTH_HEADER="X-API-Key: $HUE_API_KEY"
else
  AUTH_HEADER="Authorization: Bearer ${HUE_TOKEN:-dev-token}"
fi

CURL_JSON="${CURL_JSON:-curl -sS --connect-timeout 1 --max-time 10}"

post_actions() {
  local payload="$1"
  $CURL_JSON -X POST "$BASE_URL/v1/actions" \
    -H 'Content-Type: application/json' \
    -H "$AUTH_HEADER" \
    -d "$payload"
}

export HUE_ROOM_NAME="$ROOM"
export HUE_ROOM_PRINT_OK="$PRINT_OK"

RESOLVE_JSON="$(post_actions "$(python3 - <<'PY'
import json, os
name=(os.environ.get("HUE_ROOM_NAME") or "").strip()
print(json.dumps({"action":"resolve.by_name","args":{"rtype":"room","name":name}}, separators=(",",":")))
PY
)")"

ROOMS_JSON="$(post_actions '{"action":"clipv2.request","args":{"method":"GET","path":"/clip/v2/resource/room"}}')"
DEVICES_JSON="$(post_actions '{"action":"clipv2.request","args":{"method":"GET","path":"/clip/v2/resource/device"}}')"

export RESOLVE_JSON ROOMS_JSON DEVICES_JSON

python3 - <<'PY'
import json
import os
import sys

room_name = (os.environ.get("HUE_ROOM_NAME") or "").strip()
print_ok = (os.environ.get("HUE_ROOM_PRINT_OK") or "0").strip() in ("1", "true", "yes", "on")

def eprint(msg: str) -> None:
    sys.stderr.write(msg.rstrip() + "\n")

def die(msg: str, code: int = 1) -> None:
    eprint(f"room_list_lamps.sh: {msg}")
    raise SystemExit(code)

def load_env_json(key: str) -> dict:
    raw = os.environ.get(key, "") or ""
    try:
        return json.loads(raw)
    except Exception:
        die(f"invalid JSON in env {key}")
        return {}

def unwrap_clip(resp: dict, what: str) -> list:
    if not resp.get("ok"):
        err = resp.get("error") or {}
        code = (err.get("code") or "unknown_error").strip()
        msg = (err.get("message") or "").strip()
        die(f"{what} failed ({code}) {msg}".rstrip(), 1)
    status = ((resp.get("result") or {}).get("status") or 0) or 0
    try:
        status_i = int(status)
    except Exception:
        status_i = 0
    if status_i and (status_i < 200 or status_i >= 300):
        errors = (((resp.get("result") or {}).get("body") or {}).get("errors") or [])
        extra = ""
        if errors:
            extra = " errors=" + json.dumps(errors, ensure_ascii=False)
        die(f"{what} returned status={status_i}{extra}", 1)
    return (((resp.get("result") or {}).get("body") or {}).get("data") or [])

resolve = load_env_json("RESOLVE_JSON")
rooms_resp = load_env_json("ROOMS_JSON")
devices_resp = load_env_json("DEVICES_JSON")

if not resolve.get("ok"):
    err = resolve.get("error") or {}
    code = (err.get("code") or "").strip()
    msg = (err.get("message") or "").strip()
    die(f"resolve.by_name failed ({code or 'unknown_error'}) {msg}".rstrip(), 1)

matched = (resolve.get("result") or {}).get("matched") or {}
room_rid = str(matched.get("rid") or "").strip()
if not room_rid:
    die("resolve.by_name returned empty rid", 1)

rooms = unwrap_clip(rooms_resp, "clipv2.request(room)")
room = next((r for r in rooms if str(r.get("id") or "").strip() == room_rid), None)
if not room:
    die(f'room "{room_name}" not found after resolve (rid={room_rid})', 1)

child_device_ids = {
    str(c.get("rid") or "").strip()
    for c in (room.get("children") or [])
    if str(c.get("rtype") or "") == "device" and str(c.get("rid") or "").strip()
}

devices = unwrap_clip(devices_resp, "clipv2.request(device)")

names = []
for d in devices:
    did = str(d.get("id") or "").strip()
    if not did or did not in child_device_ids:
        continue
    services = d.get("services") or []
    if not any(str(s.get("rtype") or "") == "light" for s in services):
        continue
    name = str(((d.get("metadata") or {}).get("name") or "")).strip()
    if name:
        names.append(name)

for name in sorted(set(names), key=lambda s: s.lower()):
    sys.stdout.write(name + "\n")

if print_ok:
    sys.stdout.write("ok\n")
PY

