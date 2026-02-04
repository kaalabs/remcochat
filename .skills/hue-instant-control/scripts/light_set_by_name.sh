#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  light_set_by_name.sh --name "<Hue device name>" [--on true|false] [--brightness 0-100] [--color-temp-k <kelvin>] [--xy "x,y"]

Examples:
  bash ./.skills/hue-instant-control/scripts/light_set_by_name.sh --name "Vibiemme" --on true
  bash ./.skills/hue-instant-control/scripts/light_set_by_name.sh --name "Staande lamp" --on true --brightness 30 --color-temp-k 2400

Notes:
  - Uses Hue Gateway high-level action: light.set (by name).
  - Runs base URL selection + ready check via scripts/health_check.sh.
EOF
}

NAME=""
ON=""
BRIGHTNESS=""
COLOR_TEMP_K=""
XY=""

while [ $# -gt 0 ]; do
  case "${1:-}" in
    --name)
      NAME="${2:-}"
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
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "light_set_by_name.sh: unknown arg: ${1:-}" >&2
      usage
      exit 2
      ;;
  esac
done

NAME="$(echo "$NAME" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
if [ -z "$NAME" ]; then
  echo "light_set_by_name.sh: missing required: --name" >&2
  usage
  exit 2
fi

if [ -z "${ON:-}" ] && [ -z "${BRIGHTNESS:-}" ] && [ -z "${COLOR_TEMP_K:-}" ] && [ -z "${XY:-}" ]; then
  echo "light_set_by_name.sh: provide at least one of: --on/--brightness/--color-temp-k/--xy" >&2
  usage
  exit 2
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

HEALTH_EXPORTS="$(bash "$SCRIPT_DIR/health_check.sh")" || exit $?
eval "$HEALTH_EXPORTS"

BASE_URL="${BASE_URL%/}"

if ! command -v curl >/dev/null 2>&1; then
  echo "light_set_by_name.sh: missing required dependency: curl" >&2
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

if ! command -v python3 >/dev/null 2>&1 && ! command -v jq >/dev/null 2>&1; then
  echo "light_set_by_name.sh: need python3 or jq to build/parse JSON (neither found)." >&2
  exit 127
fi

export HUE_LIGHT_NAME="$NAME"
export HUE_LIGHT_ON="${ON:-}"
export HUE_LIGHT_BRIGHTNESS="${BRIGHTNESS:-}"
export HUE_LIGHT_COLOR_TEMP_K="${COLOR_TEMP_K:-}"
export HUE_LIGHT_XY="${XY:-}"

PAYLOAD=""
if command -v python3 >/dev/null 2>&1; then
  PAYLOAD="$(python3 - <<'PY'
import json
import os
import sys

def die(msg: str) -> None:
    sys.stderr.write(f"light_set_by_name.sh: {msg}\n")
    raise SystemExit(2)

name = (os.environ.get("HUE_LIGHT_NAME") or "").strip()
if not name:
    die("empty --name")

args = {"name": name}

on_raw = (os.environ.get("HUE_LIGHT_ON") or "").strip()
if on_raw:
    v = on_raw.lower()
    if v in ("1", "true", "yes", "on"):
        args["on"] = True
    elif v in ("0", "false", "no", "off"):
        args["on"] = False
    else:
        die(f"invalid --on value: {on_raw!r} (expected true/false)")

brightness_raw = (os.environ.get("HUE_LIGHT_BRIGHTNESS") or "").strip()
if brightness_raw:
    try:
        b = float(brightness_raw)
    except Exception:
        die(f"invalid --brightness value: {brightness_raw!r} (expected 0-100)")
    if b < 0 or b > 100:
        die(f"invalid --brightness value: {brightness_raw!r} (expected 0-100)")
    args["brightness"] = int(b) if b.is_integer() else b

ct_raw = (os.environ.get("HUE_LIGHT_COLOR_TEMP_K") or "").strip()
if ct_raw:
    try:
        ct = int(ct_raw, 10)
    except Exception:
        die(f"invalid --color-temp-k value: {ct_raw!r} (expected integer kelvin)")
    if ct <= 0:
        die(f"invalid --color-temp-k value: {ct_raw!r} (expected positive integer)")
    args["colorTempK"] = ct

xy_raw = (os.environ.get("HUE_LIGHT_XY") or "").strip()
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

print(json.dumps({"action": "light.set", "args": args}, separators=(",", ":")))
PY
)"
else
  # jq fallback (limited: on and name only)
  if [ -z "${ON:-}" ]; then
    echo "light_set_by_name.sh: jq fallback requires --on (python3 not found)." >&2
    exit 2
  fi
  ON_JSON="false"
  case "$(echo "$ON" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) ON_JSON="true" ;;
    0|false|no|off) ON_JSON="false" ;;
    *) echo "light_set_by_name.sh: invalid --on value: $ON (expected true/false)" >&2; exit 2 ;;
  esac
  PAYLOAD="$(jq -nc --arg name "$NAME" --argjson on "$ON_JSON" '{action:"light.set",args:{name:$name,on:$on}}')"
fi

CURL_JSON="${CURL_JSON:-curl -sS --connect-timeout 1 --max-time 8}"

SET_JSON="$($CURL_JSON -X POST "$BASE_URL/v1/actions" \
  -H 'Content-Type: application/json' \
  -H "$AUTH_HEADER" \
  -d "$PAYLOAD")"

if command -v python3 >/dev/null 2>&1; then
  PY_CHECK="$(cat <<'PY'
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
    die(f"light_set_by_name.sh: gateway action failed ({code}) {msg}".rstrip(), resp, 1)

status = ((resp.get("result") or {}).get("status") or 0) or 0
try:
    status_i = int(status)
except Exception:
    status_i = 0
if status_i and (status_i < 200 or status_i >= 300):
    errors = (((resp.get("result") or {}).get("body") or {}).get("errors") or [])
    msg = f"light_set_by_name.sh: Hue Bridge returned status={status_i}"
    if errors:
        msg += " errors=" + json.dumps(errors, ensure_ascii=False)
    die(msg, resp, 1)

print("ok")
PY
)"

  python3 -c "$PY_CHECK" <<<"$SET_JSON"
  exit 0
fi

case "$SET_JSON" in
  *'"ok":true'*|*'"ok": true'*) echo "ok" ;;
  *) echo "light_set_by_name.sh: unexpected response" >&2; echo "$SET_JSON" >&2; exit 1 ;;
esac

