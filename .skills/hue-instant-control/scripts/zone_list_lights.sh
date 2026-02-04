#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  zone_list_lights.sh --zone "<Hue zone name>" [--format names|tsv] [--print-ok]

Examples:
  # Names only (one per line)
  bash ./.skills/hue-instant-control/scripts/zone_list_lights.sh --zone "Beneden"

  # Names only + trailing "ok" sentinel (useful for chat/E2E)
  bash ./.skills/hue-instant-control/scripts/zone_list_lights.sh --zone "Beneden" --print-ok

  # TSV with room mapping (best-effort)
  bash ./.skills/hue-instant-control/scripts/zone_list_lights.sh --zone "Beneden" --format tsv

Notes:
  - Read-only: uses only clipv2.request + resolve.by_name (rtype=zone).
  - Uses scripts/health_check.sh for base URL selection + ready check.
  - Prefers python3 parsing to avoid complex jq programs.
EOF
}

ZONE=""
FORMAT="names"
PRINT_OK=0

while [ $# -gt 0 ]; do
  case "${1:-}" in
    --zone)
      ZONE="${2:-}"
      shift 2
      ;;
    --format)
      FORMAT="${2:-}"
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
      echo "zone_list_lights.sh: unknown arg: ${1:-}" >&2
      usage
      exit 2
      ;;
  esac
done

ZONE="$(echo "$ZONE" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
if [ -z "$ZONE" ]; then
  echo "zone_list_lights.sh: missing required: --zone" >&2
  usage
  exit 2
fi

case "$(echo "$FORMAT" | tr '[:upper:]' '[:lower:]')" in
  names|tsv) : ;;
  *)
    echo "zone_list_lights.sh: invalid --format: $FORMAT (expected names|tsv)" >&2
    exit 2
    ;;
esac

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

HEALTH_EXPORTS="$(bash "$SCRIPT_DIR/health_check.sh")" || exit $?
eval "$HEALTH_EXPORTS"

BASE_URL="${BASE_URL%/}"

if ! command -v curl >/dev/null 2>&1; then
  echo "zone_list_lights.sh: missing required dependency: curl" >&2
  exit 127
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "zone_list_lights.sh: missing required dependency: python3" >&2
  echo "zone_list_lights.sh: install python3 or use a simpler flow with jq (not recommended)." >&2
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

export HUE_ZONE_NAME="$ZONE"
export HUE_ZONE_FORMAT="$FORMAT"
export HUE_ZONE_PRINT_OK="$PRINT_OK"

RESOLVE_JSON="$(post_actions "$(python3 - <<'PY'
import json, os
name=(os.environ.get("HUE_ZONE_NAME") or "").strip()
print(json.dumps({"action":"resolve.by_name","args":{"rtype":"zone","name":name}}, separators=(",",":")))
PY
)")"

ZONES_JSON="$(post_actions '{"action":"clipv2.request","args":{"method":"GET","path":"/clip/v2/resource/zone"}}')"
ROOMS_JSON="$(post_actions '{"action":"clipv2.request","args":{"method":"GET","path":"/clip/v2/resource/room"}}')"
LIGHTS_JSON="$(post_actions '{"action":"clipv2.request","args":{"method":"GET","path":"/clip/v2/resource/light"}}')"

export RESOLVE_JSON ZONES_JSON ROOMS_JSON LIGHTS_JSON

python3 - <<'PY'
import json
import os
import sys

zone_name = (os.environ.get("HUE_ZONE_NAME") or "").strip()
fmt = (os.environ.get("HUE_ZONE_FORMAT") or "names").strip().lower()
print_ok = (os.environ.get("HUE_ZONE_PRINT_OK") or "0").strip() in ("1", "true", "yes", "on")

def eprint(msg: str) -> None:
    sys.stderr.write(msg.rstrip() + "\n")

def die(msg: str, code: int = 1) -> None:
    eprint(f"zone_list_lights.sh: {msg}")
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
zones_resp = load_env_json("ZONES_JSON")
rooms_resp = load_env_json("ROOMS_JSON")
lights_resp = load_env_json("LIGHTS_JSON")

zone_rid = ""
if not resolve.get("ok"):
    err = resolve.get("error") or {}
    code = (err.get("code") or "").strip()
    # If ambiguous, print candidates to guide the follow-up question.
    if code == "ambiguous_name":
        zones = unwrap_clip(zones_resp, "clipv2.request(zone)")
        names = sorted(
            {str((z.get("metadata") or {}).get("name") or "").strip() for z in zones if (z.get("metadata") or {}).get("name")},
            key=lambda s: s.lower(),
        )
        die(f'zone name "{zone_name}" is ambiguous. Candidates: ' + ", ".join(names[:12]) + (" ..." if len(names) > 12 else ""))
    msg = (err.get("message") or "").strip()
    die(f"resolve.by_name failed ({code or 'unknown_error'}) {msg}".rstrip(), 1)

matched = (resolve.get("result") or {}).get("matched") or {}
zone_rid = str(matched.get("rid") or "").strip()
if not zone_rid:
    die("resolve.by_name returned empty rid", 1)

zones = unwrap_clip(zones_resp, "clipv2.request(zone)")
target = next((z for z in zones if str(z.get("id") or "").strip() == zone_rid), None)
if not target:
    die(f'zone "{zone_name}" not found after resolve (rid={zone_rid})', 1)

zone_child_lights = {
    str(c.get("rid") or "").strip()
    for c in (target.get("children") or [])
    if str(c.get("rtype") or "") == "light" and str(c.get("rid") or "").strip()
}
zone_child_rooms = {
    str(c.get("rid") or "").strip()
    for c in (target.get("children") or [])
    if str(c.get("rtype") or "") == "room" and str(c.get("rid") or "").strip()
}
zone_child_devices = {
    str(c.get("rid") or "").strip()
    for c in (target.get("children") or [])
    if str(c.get("rtype") or "") == "device" and str(c.get("rid") or "").strip()
}

rooms = unwrap_clip(rooms_resp, "clipv2.request(room)")

# Build device -> room name map (best-effort) from *all* rooms so we can map zone->lights->owner->room even when
# the zone children are direct light resources (common).
device_to_room: dict[str, str] = {}
for r in rooms:
    room_name = str(((r.get("metadata") or {}).get("name") or "")).strip() or "(unnamed room)"
    for c in (r.get("children") or []):
        if str(c.get("rtype") or "") != "device":
            continue
        drid = str(c.get("rid") or "").strip()
        if not drid:
            continue
        device_to_room.setdefault(drid, room_name)

# If the zone includes room children, collect their device ids so we can match lights via owner.rid.
zone_room_device_ids: set[str] = set()
if zone_child_rooms:
    for r in rooms:
        if str(r.get("id") or "").strip() not in zone_child_rooms:
            continue
        for c in (r.get("children") or []):
            if str(c.get("rtype") or "") != "device":
                continue
            drid = str(c.get("rid") or "").strip()
            if drid:
                zone_room_device_ids.add(drid)

lights = unwrap_clip(lights_resp, "clipv2.request(light)")

rows = []
names = []
for l in lights:
    owner = l.get("owner") or {}
    owner_rid = str(owner.get("rid") or "").strip()
    light_rid = str(l.get("id") or "").strip()

    selected = False
    if light_rid and light_rid in zone_child_lights:
        selected = True
    elif owner_rid and owner_rid in zone_child_devices:
        selected = True
    elif owner_rid and owner_rid in zone_room_device_ids:
        selected = True
    if not selected:
        continue

    light_name = str(((l.get("metadata") or {}).get("name") or "")).strip() or "(unnamed light)"
    room_name = device_to_room.get(owner_rid, "") if owner_rid else ""
    product = ""
    pd = l.get("product_data") or {}
    product = str(pd.get("product_name") or pd.get("archetype") or "").strip()
    rows.append((light_name, room_name, light_rid, product))
    if light_name:
        # Prefer names, but keep unnamed placeholders so the list isn't mysteriously empty.
        names.append(light_name if light_name != "(unnamed light)" else (light_rid or light_name))

if fmt == "tsv":
    # Header first
    sys.stdout.write("Name\tRoom\tLightRID\tProduct\n")
    for name, room, rid, product in sorted(rows, key=lambda t: (t[0].lower(), t[1].lower())):
        sys.stdout.write(f"{name}\t{room}\t{rid}\t{product}\n")
else:
    for name in sorted(set(names), key=lambda s: s.lower()):
        sys.stdout.write(name + "\n")

if print_ok:
    sys.stdout.write("ok\n")
PY
