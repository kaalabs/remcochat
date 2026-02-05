#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  light_set_by_name.sh --name "<Hue light name>" [--on true|false] [--brightness 0-100] [--color-temp-k <kelvin>] [--xy "x,y"]

Examples:
  bash ./.skills/hue-instant-control/scripts/light_set_by_name.sh --name "Vibiemme" --on true
  bash ./.skills/hue-instant-control/scripts/light_set_by_name.sh --name "Staande lamp" --on true --brightness 30 --color-temp-k 2400

Notes:
  - Uses Hue Gateway v2 high-level action: light.set (by name).
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

CURL_JSON="${CURL_JSON:-curl -sS --connect-timeout 1 --max-time 12}"

REQ_ID="bash-light-set-$(date -u +%Y%m%dT%H%M%SZ)-$RANDOM"
IDEM_KEY="bash-idem-$REQ_ID"

if command -v python3 >/dev/null 2>&1; then
  export HUE_LIGHT_NAME="$NAME"
  export HUE_LIGHT_ON="${ON:-}"
  export HUE_LIGHT_BRIGHTNESS="${BRIGHTNESS:-}"
  export HUE_LIGHT_COLOR_TEMP_K="${COLOR_TEMP_K:-}"
  export HUE_LIGHT_XY="${XY:-}"
  export HUE_REQ_ID="$REQ_ID"
  export HUE_IDEM_KEY="$IDEM_KEY"

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

state: dict[str, object] = {}

on_raw = (os.environ.get("HUE_LIGHT_ON") or "").strip()
if on_raw:
    v = on_raw.lower()
    if v in ("1", "true", "yes", "on"):
        state["on"] = True
    elif v in ("0", "false", "no", "off"):
        state["on"] = False
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
    state["brightness"] = int(b) if b.is_integer() else b

ct_raw = (os.environ.get("HUE_LIGHT_COLOR_TEMP_K") or "").strip()
if ct_raw:
    try:
        ct = int(ct_raw, 10)
    except Exception:
        die(f"invalid --color-temp-k value: {ct_raw!r} (expected integer kelvin)")
    if ct <= 0:
        die(f"invalid --color-temp-k value: {ct_raw!r} (expected positive integer)")
    state["colorTempK"] = ct

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
    state["xy"] = {"x": x, "y": y}

if not state:
    die("state is empty (provide at least one state field)")

req_id = (os.environ.get("HUE_REQ_ID") or "").strip() or "bash-light-set"
idem = (os.environ.get("HUE_IDEM_KEY") or "").strip() or ("bash-idem-" + req_id)

payload = {
    "requestId": req_id,
    "idempotencyKey": idem,
    "action": "light.set",
    "args": {
        "name": name,
        "match": {"mode": "normalized", "minConfidence": 0.85, "minGap": 0.15, "maxCandidates": 10},
        "state": state,
        "verify": {"mode": "none"},
    },
}
print(json.dumps(payload, separators=(",", ":")))
PY
)"

  RESP_JSON="$($CURL_JSON -X POST "$BASE_URL/v2/actions" \
    -H 'Content-Type: application/json' \
    -H "X-Request-Id: $REQ_ID" \
    -H "Idempotency-Key: $IDEM_KEY" \
    -H "$AUTH_HEADER" \
    -d "$PAYLOAD")"

  python3 - <<'PY' <<<"$RESP_JSON"
import json
import sys

resp = json.load(sys.stdin)
if not resp.get("ok"):
    err = resp.get("error") or {}
    code = (err.get("code") or "unknown_error").strip()
    msg = (err.get("message") or "").strip()
    sys.stderr.write(f"light_set_by_name.sh: light.set failed ({code}) {msg}".rstrip() + "\n")
    sys.stderr.write(json.dumps(resp, ensure_ascii=False) + "\n")
    raise SystemExit(1)

sys.stdout.write("ok\n")
PY
  exit 0
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "light_set_by_name.sh: need python3 or jq to build/parse JSON (neither found)." >&2
  exit 127
fi

# jq fallback (limited: requires --on; no brightness/ct/xy)
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

PAYLOAD="$(jq -nc \
  --arg requestId "$REQ_ID" \
  --arg idem "$IDEM_KEY" \
  --arg name "$NAME" \
  --argjson on "$ON_JSON" \
  '{requestId:$requestId,idempotencyKey:$idem,action:"light.set",args:{name:$name,match:{mode:"normalized",minConfidence:0.85,minGap:0.15,maxCandidates:10},state:{on:$on},verify:{mode:"none"}}}')"

RESP_JSON="$($CURL_JSON -X POST "$BASE_URL/v2/actions" \
  -H 'Content-Type: application/json' \
  -H "X-Request-Id: $REQ_ID" \
  -H "Idempotency-Key: $IDEM_KEY" \
  -H "$AUTH_HEADER" \
  -d "$PAYLOAD")"

OK="$(echo "$RESP_JSON" | jq -r '.ok // empty' 2>/dev/null || true)"
if [ "$OK" != "true" ]; then
  ERR="$(echo "$RESP_JSON" | jq -r '.error.message // .error.code // "unknown error"' 2>/dev/null || true)"
  echo "light_set_by_name.sh: light.set failed (${ERR:-unknown error})" >&2
  echo "$RESP_JSON" >&2
  exit 1
fi

echo "ok"

