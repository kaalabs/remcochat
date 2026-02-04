#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  zone_set_by_name.sh --zone "<Hue zone name>" [--on true|false] [--brightness 0-100] [--color-temp-k <kelvin>] [--xy "x,y"] [--confirm] [--verify|--no-verify]

Examples:
  # Safe default: will refuse if zone contains >2 rooms unless you pass --confirm
  bash ./.skills/hue-instant-control/scripts/zone_set_by_name.sh --zone "Downstairs" --on false

  # After user confirmation:
  bash ./.skills/hue-instant-control/scripts/zone_set_by_name.sh --zone "Downstairs" --on false --confirm

Notes:
  - Resolves the zone rid via resolve.by_name (rtype=zone).
  - Fetches the zone resource and extracts its grouped_light rid.
  - Applies grouped_light.set using the grouped_light rid (RID-based).
  - Uses scripts/health_check.sh for base URL selection + ready check.
EOF
}

ZONE=""
ON=""
BRIGHTNESS=""
COLOR_TEMP_K=""
XY=""
CONFIRM=0
VERIFY=1

while [ $# -gt 0 ]; do
  case "${1:-}" in
    --zone)
      ZONE="${2:-}"
      shift 2
      ;;
    --on)
      ON="${2:-}"
      shift 2
      ;;
    --brightness)
      BRIGHTNESS="${2:-}"
      shift 2
      ;;
    --color-temp-k)
      COLOR_TEMP_K="${2:-}"
      shift 2
      ;;
    --xy)
      XY="${2:-}"
      shift 2
      ;;
    --confirm|--yes)
      CONFIRM=1
      shift
      ;;
    --verify)
      VERIFY=1
      shift
      ;;
    --no-verify)
      VERIFY=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "zone_set_by_name.sh: unknown arg: ${1:-}" >&2
      usage
      exit 2
      ;;
  esac
done

ZONE="$(echo "$ZONE" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
if [ -z "$ZONE" ]; then
  echo "zone_set_by_name.sh: missing required: --zone" >&2
  usage
  exit 2
fi

if [ -z "${ON:-}" ] && [ -z "${BRIGHTNESS:-}" ] && [ -z "${COLOR_TEMP_K:-}" ] && [ -z "${XY:-}" ]; then
  echo "zone_set_by_name.sh: provide at least one of: --on/--brightness/--color-temp-k/--xy" >&2
  usage
  exit 2
fi

# If the user sets a lighting attribute but forgets --on, default to turning the zone on.
if [ -z "${ON:-}" ] && { [ -n "${BRIGHTNESS:-}" ] || [ -n "${COLOR_TEMP_K:-}" ] || [ -n "${XY:-}" ]; }; then
  ON="true"
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

HEALTH_EXPORTS="$(bash "$SCRIPT_DIR/health_check.sh")" || exit $?
eval "$HEALTH_EXPORTS"

BASE_URL="${BASE_URL%/}"

if ! command -v curl >/dev/null 2>&1; then
  echo "zone_set_by_name.sh: missing required dependency: curl" >&2
  exit 127
fi

if ! command -v python3 >/dev/null 2>&1 && ! command -v jq >/dev/null 2>&1; then
  echo "zone_set_by_name.sh: need python3 or jq to build/parse JSON (neither found)." >&2
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

CURL_JSON="${CURL_JSON:-curl -sS --connect-timeout 1 --max-time 8}"

post_actions() {
  local payload="$1"
  $CURL_JSON -X POST "$BASE_URL/v1/actions" \
    -H 'Content-Type: application/json' \
    -H "$AUTH_HEADER" \
    -d "$payload"
}

RESOLVE_PAYLOAD=""
if command -v python3 >/dev/null 2>&1; then
  export HUE_ZONE_NAME="$ZONE"
  RESOLVE_PAYLOAD="$(python3 - <<'PY'
import json
import os
import sys

name = (os.environ.get("HUE_ZONE_NAME") or "").strip()
if not name:
    sys.stderr.write("zone_set_by_name.sh: empty --zone\n")
    raise SystemExit(2)

print(json.dumps({"action": "resolve.by_name", "args": {"rtype": "zone", "name": name}}, separators=(",", ":")))
PY
)"
else
  RESOLVE_PAYLOAD="$(jq -nc --arg name "$ZONE" '{action:"resolve.by_name",args:{rtype:"zone",name:$name}}')"
fi

RESOLVE_JSON="$(post_actions "$RESOLVE_PAYLOAD")"

ZONE_RID=""
if command -v python3 >/dev/null 2>&1; then
  PY_RESOLVE_PARSE="$(cat <<'PY'
import json
import sys

resp = json.load(sys.stdin)
if not resp.get("ok"):
    err = resp.get("error") or {}
    code = (err.get("code") or "unknown_error").strip()
    msg = (err.get("message") or "").strip()
    sys.stderr.write(f"zone_set_by_name.sh: resolve.by_name failed ({code}) {msg}".rstrip() + "\n")
    sys.stderr.write(json.dumps(resp, ensure_ascii=False) + "\n")
    raise SystemExit(1)

matched = (resp.get("result") or {}).get("matched") or {}
rid = (matched.get("rid") or "").strip()
if not rid:
    sys.stderr.write("zone_set_by_name.sh: resolve.by_name returned empty rid\n")
    sys.stderr.write(json.dumps(resp, ensure_ascii=False) + "\n")
    raise SystemExit(1)

print(rid)
PY
)"
  ZONE_RID="$(python3 -c "$PY_RESOLVE_PARSE" <<<"$RESOLVE_JSON")"
else
  OK="$(echo "$RESOLVE_JSON" | jq -r '.ok // empty' 2>/dev/null || true)"
  if [ "$OK" != "true" ]; then
    ERR="$(echo "$RESOLVE_JSON" | jq -r '.error.message // .error.code // "unknown error"' 2>/dev/null || true)"
    echo "zone_set_by_name.sh: resolve.by_name failed (${ERR:-unknown error})" >&2
    echo "$RESOLVE_JSON" >&2
    exit 1
  fi
  ZONE_RID="$(echo "$RESOLVE_JSON" | jq -r '.result.matched.rid // empty' 2>/dev/null || true)"
  if [ -z "$ZONE_RID" ]; then
    echo "zone_set_by_name.sh: resolve.by_name returned empty rid" >&2
    echo "$RESOLVE_JSON" >&2
    exit 1
  fi
fi

ZONE_GET_PAYLOAD=""
if command -v python3 >/dev/null 2>&1; then
  export HUE_ZONE_RID="$ZONE_RID"
  ZONE_GET_PAYLOAD="$(python3 - <<'PY'
import json
import os
import sys

rid = (os.environ.get("HUE_ZONE_RID") or "").strip()
if not rid:
    sys.stderr.write("zone_set_by_name.sh: empty zone rid\n")
    raise SystemExit(2)

print(json.dumps({"action": "clipv2.request", "args": {"method": "GET", "path": f"/clip/v2/resource/zone/{rid}"}}, separators=(",", ":")))
PY
)"
else
  ZONE_GET_PAYLOAD="$(jq -nc --arg path "/clip/v2/resource/zone/$ZONE_RID" '{action:"clipv2.request",args:{method:"GET",path:$path}}')"
fi

ZONE_JSON="$(post_actions "$ZONE_GET_PAYLOAD")"

PARSED_ZONE=""
if command -v python3 >/dev/null 2>&1; then
  PY_ZONE_PARSE="$(cat <<'PY'
import json
import sys

resp = json.load(sys.stdin)
if not resp.get("ok"):
    err = resp.get("error") or {}
    code = (err.get("code") or "unknown_error").strip()
    msg = (err.get("message") or "").strip()
    sys.stderr.write(f"zone_set_by_name.sh: clipv2.request(zone) failed ({code}) {msg}".rstrip() + "\n")
    sys.stderr.write(json.dumps(resp, ensure_ascii=False) + "\n")
    raise SystemExit(1)

status = ((resp.get("result") or {}).get("status") or 0) or 0
try:
    status_i = int(status)
except Exception:
    status_i = 0
if status_i and (status_i < 200 or status_i >= 300):
    errors = (((resp.get("result") or {}).get("body") or {}).get("errors") or [])
    sys.stderr.write(f"zone_set_by_name.sh: Hue Bridge returned status={status_i} for zone\n")
    if errors:
        sys.stderr.write("errors: " + json.dumps(errors, ensure_ascii=False) + "\n")
    sys.stderr.write(json.dumps(resp, ensure_ascii=False) + "\n")
    raise SystemExit(1)

data = (((resp.get("result") or {}).get("body") or {}).get("data") or [])
zone = data[0] if data else {}

gl_rid = ""
for s in (zone.get("services") or []):
    if (s.get("rtype") or "") == "grouped_light" and (s.get("rid") or ""):
        gl_rid = (s.get("rid") or "").strip()
        break
if not gl_rid:
    sys.stderr.write("zone_set_by_name.sh: missing grouped_light rid for zone\n")
    sys.stderr.write(json.dumps(resp, ensure_ascii=False) + "\n")
    raise SystemExit(1)

room_rids = []
for c in (zone.get("children") or []):
    if (c.get("rtype") or "") == "room" and (c.get("rid") or ""):
        room_rids.append((c.get("rid") or "").strip())

print(json.dumps({"grouped_light_rid": gl_rid, "room_rids": room_rids}, separators=(",", ":")))
PY
)"
  PARSED_ZONE="$(python3 -c "$PY_ZONE_PARSE" <<<"$ZONE_JSON")"
else
  OK="$(echo "$ZONE_JSON" | jq -r '.ok // empty' 2>/dev/null || true)"
  if [ "$OK" != "true" ]; then
    ERR="$(echo "$ZONE_JSON" | jq -r '.error.message // .error.code // "unknown error"' 2>/dev/null || true)"
    echo "zone_set_by_name.sh: clipv2.request(zone) failed (${ERR:-unknown error})" >&2
    echo "$ZONE_JSON" >&2
    exit 1
  fi
  STATUS="$(echo "$ZONE_JSON" | jq -r '.result.status // empty' 2>/dev/null || true)"
  if [[ -n "$STATUS" && "$STATUS" =~ ^[0-9]+$ ]]; then
    if [ "$STATUS" -lt 200 ] || [ "$STATUS" -ge 300 ]; then
      ERRORS="$(echo "$ZONE_JSON" | jq -c '.result.body.errors // []' 2>/dev/null || true)"
      echo "zone_set_by_name.sh: Hue Bridge returned status=$STATUS for zone" >&2
      if [ -n "$ERRORS" ] && [ "$ERRORS" != "[]" ]; then
        echo "errors: $ERRORS" >&2
      fi
      echo "$ZONE_JSON" >&2
      exit 1
    fi
  fi
  GROUPED_LIGHT_RID="$(echo "$ZONE_JSON" | jq -r '(.result.body.data // [])[0].services[]? | select(.rtype=="grouped_light") | .rid' 2>/dev/null | head -n 1 || true)"
  if [ -z "$GROUPED_LIGHT_RID" ]; then
    echo "zone_set_by_name.sh: missing grouped_light rid for zone" >&2
    echo "$ZONE_JSON" >&2
    exit 1
  fi
  PARSED_ZONE="$(jq -nc --arg gl "$GROUPED_LIGHT_RID" '{grouped_light_rid:$gl,room_rids:[]}' 2>/dev/null || true)"
fi

GROUPED_LIGHT_RID=""
ROOM_RIDS_JSON="[]"
if command -v python3 >/dev/null 2>&1; then
  export PARSED_ZONE_JSON="$PARSED_ZONE"
  PY_EXTRACT="$(cat <<'PY'
import json
import os
import sys

parsed = json.loads(os.environ.get("PARSED_ZONE_JSON") or "{}")
gl = (parsed.get("grouped_light_rid") or "").strip()
rooms = parsed.get("room_rids") or []
if not isinstance(rooms, list):
    rooms = []
print(gl)
print(json.dumps([r for r in rooms if isinstance(r, str) and r.strip()], separators=(",", ":")))
PY
)"
  GROUPED_LIGHT_RID="$(python3 -c "$PY_EXTRACT" | head -n 1)"
  ROOM_RIDS_JSON="$(python3 -c "$PY_EXTRACT" | tail -n 1)"
else
  GROUPED_LIGHT_RID="$(echo "$PARSED_ZONE" | jq -r '.grouped_light_rid // empty' 2>/dev/null || true)"
  ROOM_RIDS_JSON="$(echo "$PARSED_ZONE" | jq -c '.room_rids // []' 2>/dev/null || echo '[]')"
fi

if [ -z "$GROUPED_LIGHT_RID" ]; then
  echo "zone_set_by_name.sh: missing grouped_light rid for zone" >&2
  exit 1
fi

ROOM_COUNT=0
if command -v python3 >/dev/null 2>&1; then
  export ROOM_RIDS_JSON
  ROOM_COUNT="$(python3 - <<'PY'
import json
import os
import sys

rooms = json.loads(os.environ.get("ROOM_RIDS_JSON") or "[]")
if not isinstance(rooms, list):
    rooms = []
print(len([r for r in rooms if isinstance(r, str) and r.strip()]))
PY
)"
else
  ROOM_COUNT="$(echo "$ROOM_RIDS_JSON" | jq -r 'length' 2>/dev/null || echo 0)"
fi

if [ "$CONFIRM" -ne 1 ]; then
  # Safety guard: avoid multi-room surprises for zones unless user explicitly confirmed.
  if [ "$ROOM_COUNT" -eq 0 ] || [ "$ROOM_COUNT" -gt 2 ]; then
    if [ "$ROOM_COUNT" -gt 0 ] && command -v python3 >/dev/null 2>&1; then
      # Best-effort: list room names in this zone to help the user confirm quickly.
      ROOMS_LIST_JSON="$(post_actions '{"action":"clipv2.request","args":{"method":"GET","path":"/clip/v2/resource/room"}}')"
      export ROOMS_LIST_JSON ROOM_RIDS_JSON ZONE_NAME="$ZONE"
      python3 - <<'PY'
import json
import os
import sys

zone = (os.environ.get("ZONE_NAME") or "").strip()
rooms_resp = json.loads(os.environ.get("ROOMS_LIST_JSON") or "{}")
zone_room_ids = set(json.loads(os.environ.get("ROOM_RIDS_JSON") or "[]") or [])

names = []
data = (((rooms_resp.get("result") or {}).get("body") or {}).get("data") or [])
for r in data:
    rid = (r.get("id") or "").strip()
    if rid and rid in zone_room_ids:
        name = ((r.get("metadata") or {}).get("name") or "").strip()
        if name:
            names.append(name)

names = sorted(set(names), key=lambda s: s.lower())
msg = f'zone_set_by_name.sh: zone "{zone}" affects {len(zone_room_ids)} room(s). Re-run with --confirm to proceed.'
sys.stderr.write(msg + "\n")
if names:
    sys.stderr.write("rooms: " + ", ".join(names[:12]) + ("\n" if len(names) <= 12 else ", ...\n"))
PY
      exit 3
    fi

    if [ "$ROOM_COUNT" -eq 0 ]; then
      echo "zone_set_by_name.sh: zone \"$ZONE\" may affect multiple rooms (room list unknown). Re-run with --confirm to proceed." >&2
    else
      echo "zone_set_by_name.sh: zone \"$ZONE\" affects $ROOM_COUNT room(s). Re-run with --confirm to proceed." >&2
    fi
    exit 3
  fi
fi

SET_PAYLOAD=""
if command -v python3 >/dev/null 2>&1; then
  export HUE_GROUPED_LIGHT_RID="$GROUPED_LIGHT_RID"
  export HUE_ZONE_ON="${ON:-}"
  export HUE_ZONE_BRIGHTNESS="${BRIGHTNESS:-}"
  export HUE_ZONE_COLOR_TEMP_K="${COLOR_TEMP_K:-}"
  export HUE_ZONE_XY="${XY:-}"
  SET_PAYLOAD="$(python3 - <<'PY'
import json
import os
import sys

def die(msg: str) -> None:
    sys.stderr.write(f"zone_set_by_name.sh: {msg}\n")
    raise SystemExit(2)

rid = (os.environ.get("HUE_GROUPED_LIGHT_RID") or "").strip()
if not rid:
    die("empty grouped_light rid")

args = {"rid": rid}

on_raw = (os.environ.get("HUE_ZONE_ON") or "").strip()
if on_raw:
    v = on_raw.lower()
    if v in ("1", "true", "yes", "on"):
        args["on"] = True
    elif v in ("0", "false", "no", "off"):
        args["on"] = False
    else:
        die(f"invalid --on value: {on_raw!r} (expected true/false)")

brightness_raw = (os.environ.get("HUE_ZONE_BRIGHTNESS") or "").strip()
if brightness_raw:
    try:
        b = float(brightness_raw)
    except Exception:
        die(f"invalid --brightness value: {brightness_raw!r} (expected 0-100)")
    if b < 0 or b > 100:
        die(f"invalid --brightness value: {brightness_raw!r} (expected 0-100)")
    args["brightness"] = int(b) if b.is_integer() else b

ct_raw = (os.environ.get("HUE_ZONE_COLOR_TEMP_K") or "").strip()
if ct_raw:
    try:
        ct = int(ct_raw, 10)
    except Exception:
        die(f"invalid --color-temp-k value: {ct_raw!r} (expected integer kelvin)")
    if ct <= 0:
        die(f"invalid --color-temp-k value: {ct_raw!r} (expected positive integer)")
    args["colorTempK"] = ct

xy_raw = (os.environ.get("HUE_ZONE_XY") or "").strip()
if xy_raw:
    parts = [p.strip() for p in xy_raw.split(",") if p.strip()]
    if len(parts) != 2:
        die(f"invalid --xy value: {xy_raw!r} (expected \"x,y\")")
    try:
        x = float(parts[0])
        y = float(parts[1])
    except Exception:
        die(f"invalid --xy value: {xy_raw!r} (expected numeric \"x,y\")")
    args["xy"] = {"x": x, "y": y}

print(json.dumps({"action": "grouped_light.set", "args": args}, separators=(",", ":")))
PY
)"
else
  # jq fallback (limited: on and name only)
  if [ -z "${ON:-}" ]; then
    echo "zone_set_by_name.sh: jq fallback requires --on (python3 not found)." >&2
    exit 2
  fi
  ON_JSON="false"
  case "$(echo "$ON" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) ON_JSON="true" ;;
    0|false|no|off) ON_JSON="false" ;;
    *) echo "zone_set_by_name.sh: invalid --on value: $ON (expected true/false)" >&2; exit 2 ;;
  esac
  SET_PAYLOAD="$(jq -nc --arg rid "$GROUPED_LIGHT_RID" --argjson on "$ON_JSON" '{action:"grouped_light.set",args:{rid:$rid,on:$on}}')"
fi

SET_JSON="$(post_actions "$SET_PAYLOAD")"

if command -v python3 >/dev/null 2>&1; then
  PY_SET_CHECK="$(cat <<'PY'
import json
import sys

def die(msg: str, resp: dict, code: int = 1) -> None:
    sys.stderr.write(msg.rstrip() + "\n")
    sys.stderr.write(json.dumps(resp, ensure_ascii=False) + "\n")
    raise SystemExit(code)

resp = json.load(sys.stdin)
if not resp.get("ok"):
    err = resp.get("error") or {}
    code = (err.get("code") or "unknown_error").strip()
    msg = (err.get("message") or "").strip()
    die(f"zone_set_by_name.sh: grouped_light.set failed ({code}) {msg}".rstrip(), resp, 1)

status = ((resp.get("result") or {}).get("status") or 0) or 0
try:
    status_i = int(status)
except Exception:
    status_i = 0
if status_i and (status_i < 200 or status_i >= 300):
    errors = (((resp.get("result") or {}).get("body") or {}).get("errors") or [])
    msg = f"zone_set_by_name.sh: Hue Bridge returned status={status_i} for grouped_light.set"
    if errors:
        msg += " errors=" + json.dumps(errors, ensure_ascii=False)
    die(msg, resp, 1)
PY
)"
  python3 -c "$PY_SET_CHECK" <<<"$SET_JSON"
else
  case "$SET_JSON" in
    *'"ok":true'*|*'"ok": true'*) : ;;
    *) echo "zone_set_by_name.sh: grouped_light.set failed" >&2; echo "$SET_JSON" >&2; exit 1 ;;
  esac
fi

if [ "$VERIFY" -ne 1 ]; then
  echo "ok"
  exit 0
fi

VERIFY_PAYLOAD=""
if command -v python3 >/dev/null 2>&1; then
  export HUE_GROUPED_LIGHT_RID="$GROUPED_LIGHT_RID"
  VERIFY_PAYLOAD="$(python3 - <<'PY'
import json
import os
import sys

rid = (os.environ.get("HUE_GROUPED_LIGHT_RID") or "").strip()
if not rid:
    sys.stderr.write("zone_set_by_name.sh: empty grouped_light rid for verify\n")
    raise SystemExit(2)

print(json.dumps({"action": "clipv2.request", "args": {"method": "GET", "path": f"/clip/v2/resource/grouped_light/{rid}"}}, separators=(",", ":")))
PY
)"
else
  VERIFY_PAYLOAD="$(jq -nc --arg path "/clip/v2/resource/grouped_light/$GROUPED_LIGHT_RID" '{action:"clipv2.request",args:{method:"GET",path:$path}}')"
fi

VERIFY_JSON="$(post_actions "$VERIFY_PAYLOAD")"

if command -v python3 >/dev/null 2>&1; then
  export HUE_VERIFY_ON="${ON:-}"
  export HUE_VERIFY_BRIGHTNESS="${BRIGHTNESS:-}"
  export HUE_VERIFY_COLOR_TEMP_K="${COLOR_TEMP_K:-}"

  PY_VERIFY="$(cat <<'PY'
import json
import math
import os
import sys

def die(msg: str, resp: dict, code: int = 1) -> None:
    sys.stderr.write(msg.rstrip() + "\n")
    sys.stderr.write(json.dumps(resp, ensure_ascii=False) + "\n")
    raise SystemExit(code)

resp = json.load(sys.stdin)
if not resp.get("ok"):
    err = resp.get("error") or {}
    code = (err.get("code") or "unknown_error").strip()
    msg = (err.get("message") or "").strip()
    die(f"zone_set_by_name.sh: verify clipv2.request failed ({code}) {msg}".rstrip(), resp, 1)

status = ((resp.get("result") or {}).get("status") or 0) or 0
try:
    status_i = int(status)
except Exception:
    status_i = 0
if status_i and (status_i < 200 or status_i >= 300):
    errors = (((resp.get("result") or {}).get("body") or {}).get("errors") or [])
    msg = f"zone_set_by_name.sh: Hue Bridge returned status={status_i} for verify"
    if errors:
        msg += " errors=" + json.dumps(errors, ensure_ascii=False)
    die(msg, resp, 1)

data = (((resp.get("result") or {}).get("body") or {}).get("data") or [])
gl = data[0] if data else {}

desired_on_raw = (os.environ.get("HUE_VERIFY_ON") or "").strip().lower()
if desired_on_raw:
    desired_on = desired_on_raw in ("1", "true", "yes", "on")
    actual_on = bool((gl.get("on") or {}).get("on"))
    if actual_on != desired_on:
        die(f"zone_set_by_name.sh: verify failed: on={actual_on} (expected {desired_on})", resp, 1)

desired_brightness_raw = (os.environ.get("HUE_VERIFY_BRIGHTNESS") or "").strip()
if desired_brightness_raw:
    try:
        desired_brightness = float(desired_brightness_raw)
    except Exception:
        desired_brightness = None
    actual_brightness = (gl.get("dimming") or {}).get("brightness")
    if desired_brightness is not None and actual_brightness is not None:
        try:
            actual_brightness_f = float(actual_brightness)
        except Exception:
            die("zone_set_by_name.sh: verify failed: brightness not numeric in grouped_light resource", resp, 1)
        # grouped_light "brightness" can drift (zone aggregates, device limits). Use a wide tolerance to avoid false negatives.
        if math.fabs(actual_brightness_f - desired_brightness) > 25.0:
            die(
                f"zone_set_by_name.sh: verify failed: brightness={actual_brightness_f} (expected ~{desired_brightness})",
                resp,
                1,
            )

desired_ct_raw = (os.environ.get("HUE_VERIFY_COLOR_TEMP_K") or "").strip()
if desired_ct_raw:
    try:
        desired_ct = float(desired_ct_raw)
    except Exception:
        desired_ct = None

    mirek = (gl.get("color_temperature") or {}).get("mirek")
    if desired_ct is not None and mirek is not None:
        try:
            mirek_f = float(mirek)
        except Exception:
            die("zone_set_by_name.sh: verify failed: mirek not numeric in grouped_light resource", resp, 1)
        if mirek_f <= 0:
            die("zone_set_by_name.sh: verify failed: mirek <= 0 in grouped_light resource", resp, 1)
        actual_ct = 1_000_000.0 / mirek_f
        # Very loose tolerance: many grouped lights omit or quantize color temp.
        if math.fabs(actual_ct - desired_ct) > 800.0:
            die(f"zone_set_by_name.sh: verify failed: colorTempK≈{actual_ct:.0f} (expected ~{desired_ct:.0f})", resp, 1)

print("ok")
PY
)"

  python3 -c "$PY_VERIFY" <<<"$VERIFY_JSON"
  exit 0
fi

case "$VERIFY_JSON" in
  *'"ok":true'*|*'"ok": true'*) echo "ok" ;;
  *) echo "zone_set_by_name.sh: verify failed" >&2; echo "$VERIFY_JSON" >&2; exit 1 ;;
esac
