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
  - Uses Hue Gateway v2 high-level action: zone.set.
  - Uses zone.set dryRun=true to compute impact, then requires --confirm for wide impact.
  - Verification failures return ok:true with verified=false; this script prints a warning but exits 0.
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

if ! command -v python3 >/dev/null 2>&1; then
  echo "zone_set_by_name.sh: missing required dependency: python3" >&2
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

REQ_ID_DRY="bash-zone-dry-$(date -u +%Y%m%dT%H%M%SZ)-$RANDOM"
export HUE_ZONE_NAME="$ZONE"
export HUE_ZONE_ON="${ON:-}"
export HUE_ZONE_BRIGHTNESS="${BRIGHTNESS:-}"
export HUE_ZONE_COLOR_TEMP_K="${COLOR_TEMP_K:-}"
export HUE_ZONE_XY="${XY:-}"
export HUE_REQ_ID="$REQ_ID_DRY"

DRY_PAYLOAD="$(python3 - <<'PY'
import json, os, sys

def die(msg: str) -> None:
    sys.stderr.write(f"zone_set_by_name.sh: {msg}\n")
    raise SystemExit(2)

zone = (os.environ.get("HUE_ZONE_NAME") or "").strip()
if not zone:
    die("empty --zone")

state: dict[str, object] = {}

on_raw = (os.environ.get("HUE_ZONE_ON") or "").strip()
if on_raw:
    v = on_raw.lower()
    if v in ("1", "true", "yes", "on"):
        state["on"] = True
    elif v in ("0", "false", "no", "off"):
        state["on"] = False
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
    state["brightness"] = int(b) if b.is_integer() else b

ct_raw = (os.environ.get("HUE_ZONE_COLOR_TEMP_K") or "").strip()
if ct_raw:
    try:
        ct = int(ct_raw, 10)
    except Exception:
        die(f"invalid --color-temp-k value: {ct_raw!r} (expected integer kelvin)")
    if ct <= 0:
        die(f"invalid --color-temp-k value: {ct_raw!r} (expected positive integer)")
    state["colorTempK"] = ct

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
    state["xy"] = {"x": x, "y": y}

if not state:
    die("state is empty (provide at least one state field)")

req_id = (os.environ.get("HUE_REQ_ID") or "").strip() or "bash-zone-dry"

payload = {
    "requestId": req_id,
    "action": "zone.set",
    "args": {
        "zoneName": zone,
        "dryRun": True,
        "match": {"mode": "normalized", "minConfidence": 0.85, "minGap": 0.15, "maxCandidates": 10},
        "state": state,
    },
}
print(json.dumps(payload, separators=(",", ":")))
PY
)"

DRY_JSON="$($CURL_JSON -X POST "$BASE_URL/v2/actions" \
  -H 'Content-Type: application/json' \
  -H "X-Request-Id: $REQ_ID_DRY" \
  -H "$AUTH_HEADER" \
  -d "$DRY_PAYLOAD")"

export DRY_JSON
python3 - <<'PY' >/dev/null
import json, os, sys

resp = json.loads(os.environ.get("DRY_JSON") or "{}")
if not resp.get("ok"):
    err = resp.get("error") or {}
    code = (err.get("code") or "unknown_error").strip()
    msg = (err.get("message") or "").strip()
    sys.stderr.write(f"zone_set_by_name.sh: zone.set dryRun failed ({code}) {msg}".rstrip() + "\n")
    sys.stderr.write(json.dumps(resp, ensure_ascii=False) + "\n")
    raise SystemExit(1)

result = resp.get("result") or {}
if result.get("dryRun") is not True:
    sys.stderr.write("zone_set_by_name.sh: expected dryRun result from zone.set\n")
    sys.stderr.write(json.dumps(resp, ensure_ascii=False) + "\n")
    raise SystemExit(1)

impact = result.get("impact") or {}
rooms = impact.get("affectedRooms") or []
count = len([r for r in rooms if isinstance(r, dict)])
print(count)
PY

ROOM_COUNT="$(python3 - <<'PY' <<<"$DRY_JSON"
import json, sys
resp=json.load(sys.stdin)
result=resp.get("result") or {}
impact=result.get("impact") or {}
rooms=impact.get("affectedRooms") or []
print(len([r for r in rooms if isinstance(r, dict)]))
PY
)"

if [ "$CONFIRM" -ne 1 ]; then
  if [ "$ROOM_COUNT" -eq 0 ] || [ "$ROOM_COUNT" -gt 2 ]; then
    python3 - <<'PY' <<<"$DRY_JSON" >&2
import json, sys
resp=json.load(sys.stdin)
zone=(resp.get("result") or {}).get("zoneRid") or ""
impact=(resp.get("result") or {}).get("impact") or {}
rooms=impact.get("affectedRooms") or []
names=[str((r or {}).get("name") or (r or {}).get("rid") or "").strip() for r in rooms if isinstance(r, dict)]
names=[n for n in names if n]
names_sorted=sorted(set(names), key=lambda s: s.lower())
sys.stderr.write(f'zone_set_by_name.sh: zone "{os.environ.get("HUE_ZONE_NAME","")}" affects {len(rooms)} room(s). Re-run with --confirm to proceed.\n')
if names_sorted:
    sys.stderr.write("rooms: " + ", ".join(names_sorted[:12]) + (" ...\n" if len(names_sorted) > 12 else "\n"))
PY
    exit 3
  fi
fi

REQ_ID_APPLY="bash-zone-apply-$(date -u +%Y%m%dT%H%M%SZ)-$RANDOM"
IDEM_KEY="bash-idem-$REQ_ID_APPLY"
export HUE_REQ_ID="$REQ_ID_APPLY"
export HUE_IDEM_KEY="$IDEM_KEY"
export HUE_ZONE_VERIFY="$VERIFY"

APPLY_PAYLOAD="$(python3 - <<'PY'
import json, os, sys

def die(msg: str) -> None:
    sys.stderr.write(f"zone_set_by_name.sh: {msg}\n")
    raise SystemExit(2)

zone = (os.environ.get("HUE_ZONE_NAME") or "").strip()
if not zone:
    die("empty --zone")

state: dict[str, object] = {}

on_raw = (os.environ.get("HUE_ZONE_ON") or "").strip()
if on_raw:
    v = on_raw.lower()
    if v in ("1", "true", "yes", "on"):
        state["on"] = True
    elif v in ("0", "false", "no", "off"):
        state["on"] = False
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
    state["brightness"] = int(b) if b.is_integer() else b

ct_raw = (os.environ.get("HUE_ZONE_COLOR_TEMP_K") or "").strip()
if ct_raw:
    try:
        ct = int(ct_raw, 10)
    except Exception:
        die(f"invalid --color-temp-k value: {ct_raw!r} (expected integer kelvin)")
    if ct <= 0:
        die(f"invalid --color-temp-k value: {ct_raw!r} (expected positive integer)")
    state["colorTempK"] = ct

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
    state["xy"] = {"x": x, "y": y}

if not state:
    die("state is empty (provide at least one state field)")

verify_enabled = (os.environ.get("HUE_ZONE_VERIFY") or "1").strip() in ("1", "true", "yes", "on")
verify = {"mode": "poll", "timeoutMs": 2000, "pollIntervalMs": 150} if verify_enabled else {"mode": "none"}

req_id = (os.environ.get("HUE_REQ_ID") or "").strip() or "bash-zone-apply"
idem = (os.environ.get("HUE_IDEM_KEY") or "").strip() or ("bash-idem-" + req_id)

payload = {
    "requestId": req_id,
    "idempotencyKey": idem,
    "action": "zone.set",
    "args": {
        "zoneName": zone,
        "match": {"mode": "normalized", "minConfidence": 0.85, "minGap": 0.15, "maxCandidates": 10},
        "state": state,
        "verify": verify,
    },
}
print(json.dumps(payload, separators=(",", ":")))
PY
)"

APPLY_JSON="$($CURL_JSON -X POST "$BASE_URL/v2/actions" \
  -H 'Content-Type: application/json' \
  -H "X-Request-Id: $REQ_ID_APPLY" \
  -H "Idempotency-Key: $IDEM_KEY" \
  -H "$AUTH_HEADER" \
  -d "$APPLY_PAYLOAD")"

python3 - <<'PY' <<<"$APPLY_JSON"
import json
import sys

resp = json.load(sys.stdin)
if not resp.get("ok"):
    err = resp.get("error") or {}
    code = (err.get("code") or "unknown_error").strip()
    msg = (err.get("message") or "").strip()
    sys.stderr.write(f"zone_set_by_name.sh: zone.set failed ({code}) {msg}".rstrip() + "\n")
    sys.stderr.write(json.dumps(resp, ensure_ascii=False) + "\n")
    raise SystemExit(1)

result = resp.get("result") or {}
if result.get("dryRun") is True:
    sys.stderr.write("zone_set_by_name.sh: unexpected dryRun result on apply\n")
    sys.stderr.write(json.dumps(resp, ensure_ascii=False) + "\n")
    raise SystemExit(1)

verified = bool(result.get("verified"))
if not verified:
    sys.stderr.write("zone_set_by_name.sh: warning: verification did not converge (verified=false)\n")
    warnings = result.get("warnings") or []
    if warnings:
        try:
            sys.stderr.write("warnings: " + json.dumps(warnings, ensure_ascii=False) + "\n")
        except Exception:
            pass

sys.stdout.write("ok\n")
PY

