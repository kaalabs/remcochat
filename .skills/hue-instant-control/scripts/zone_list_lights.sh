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

  # TSV with room mapping (best-effort, from inventory snapshot)
  bash ./.skills/hue-instant-control/scripts/zone_list_lights.sh --zone "Beneden" --format tsv

Notes:
  - Read-only: uses a single v2 `inventory.snapshot` call.
  - Uses scripts/health_check.sh for base URL selection + ready check.
  - Prefers python3 parsing for the TSV format.
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

AUTH_HEADER=""
if [ -n "${HUE_AUTH_HEADER:-}" ]; then
  AUTH_HEADER="$HUE_AUTH_HEADER"
elif [ -n "${HUE_API_KEY:-}" ]; then
  AUTH_HEADER="X-API-Key: $HUE_API_KEY"
else
  AUTH_HEADER="Authorization: Bearer ${HUE_TOKEN:-dev-token}"
fi

CURL_JSON="${CURL_JSON:-curl -sS --connect-timeout 1 --max-time 10}"

REQ_ID="bash-zone-lights-$(date -u +%Y%m%dT%H%M%SZ)-$RANDOM"
INVENTORY_JSON="$($CURL_JSON -X POST "$BASE_URL/v2/actions" \
  -H 'Content-Type: application/json' \
  -H "X-Request-Id: $REQ_ID" \
  -H "$AUTH_HEADER" \
  -d "$(printf '{"requestId":"%s","action":"inventory.snapshot","args":{}}' "$REQ_ID")")"

if [ "$FORMAT" = "names" ] && command -v jq >/dev/null 2>&1; then
  OK="$(echo "$INVENTORY_JSON" | jq -r '.ok // empty' 2>/dev/null || true)"
  if [ "$OK" != "true" ]; then
    ERR="$(echo "$INVENTORY_JSON" | jq -r '.error.message // .error.code // "unknown error"' 2>/dev/null || true)"
    echo "zone_list_lights.sh: inventory.snapshot failed at BASE_URL=$BASE_URL (${ERR:-unknown error})" >&2
    echo "$INVENTORY_JSON" >&2
    exit 1
  fi

  NOT_MODIFIED="$(echo "$INVENTORY_JSON" | jq -r '.result.notModified // empty' 2>/dev/null || true)"
  if [ "$NOT_MODIFIED" = "true" ]; then
    REV="$(echo "$INVENTORY_JSON" | jq -r '.result.revision // empty' 2>/dev/null || true)"
    echo "zone_list_lights.sh: inventory.snapshot returned notModified=true (revision=${REV:-unknown})" >&2
    exit 1
  fi

  ZONE_RIDS="$(echo "$INVENTORY_JSON" | jq -r --arg zone "$ZONE" '
    def norm: gsub("^\\s+|\\s+$";"") | ascii_downcase;
    (.result.zones // []) | map(select((.name // "" | norm) == ($zone | norm))) | map(.rid) | .[]
  ' 2>/dev/null || true)"

  ZONE_MATCH_COUNT="$(echo "$ZONE_RIDS" | awk 'NF{c++} END{print c+0}')"
  if [ "$ZONE_MATCH_COUNT" -eq 0 ]; then
    CANDIDATES="$(echo "$INVENTORY_JSON" | jq -r '(.result.zones // [])[]?.name // empty' 2>/dev/null || true | head -n 12 | paste -sd ', ' -)"
    echo "zone_list_lights.sh: zone not found: $ZONE" >&2
    if [ -n "$CANDIDATES" ]; then
      echo "zone_list_lights.sh: candidates: $CANDIDATES" >&2
    fi
    exit 1
  fi
  if [ "$ZONE_MATCH_COUNT" -gt 1 ]; then
    MATCHES="$(echo "$INVENTORY_JSON" | jq -r --arg zone "$ZONE" '
      def norm: gsub("^\\s+|\\s+$";"") | ascii_downcase;
      (.result.zones // []) | map(select((.name // "" | norm) == ($zone | norm))) | map(.name) | .[]
    ' 2>/dev/null || true | head -n 12 | paste -sd ', ' -)"
    echo "zone_list_lights.sh: zone name is ambiguous: $ZONE" >&2
    if [ -n "$MATCHES" ]; then
      echo "zone_list_lights.sh: matches: $MATCHES" >&2
    fi
    exit 1
  fi

  ZONE_RID="$(echo "$ZONE_RIDS" | awk 'NF{print; exit}')"
  if [ -z "$ZONE_RID" ]; then
    echo "zone_list_lights.sh: missing zone rid after match" >&2
    exit 1
  fi

  ROOM_RIDS="$(echo "$INVENTORY_JSON" | jq -r --arg rid "$ZONE_RID" '
    (.result.zones // []) | map(select((.rid // "") == $rid)) | .[0].roomRids // [] | .[]
  ' 2>/dev/null || true)"

  if [ -z "$ROOM_RIDS" ]; then
    if [ "$PRINT_OK" -eq 1 ]; then
      echo "ok"
    fi
    exit 0
  fi

  echo "$INVENTORY_JSON" | jq -r --argjson roomRids "$(printf '%s\n' "$ROOM_RIDS" | jq -R . | jq -s .)" '
    (.result.lights // [])[]
    | select(((.roomRid // "") as $r | ($roomRids | index($r)) != null))
    | (.name // empty)
  ' 2>/dev/null \
  | awk 'NF>0 {print}' \
  | sort -f \
  | uniq

  if [ "$PRINT_OK" -eq 1 ]; then
    echo "ok"
  fi
  exit 0
fi

if command -v python3 >/dev/null 2>&1; then
  export HUE_ZONE_NAME="$ZONE"
  export HUE_ZONE_FORMAT="$FORMAT"
  export HUE_ZONE_PRINT_OK="$PRINT_OK"

  PY_CODE="$(cat <<'PY'
import json
import os
import sys

zone_name = (os.environ.get("HUE_ZONE_NAME") or "").strip()
fmt = (os.environ.get("HUE_ZONE_FORMAT") or "names").strip().lower()
print_ok = (os.environ.get("HUE_ZONE_PRINT_OK") or "0").strip().lower() in ("1", "true", "yes", "on")

def eprint(msg: str) -> None:
    sys.stderr.write(msg.rstrip() + "\n")

def die(msg: str, code: int = 1) -> None:
    eprint(f"zone_list_lights.sh: {msg}")
    raise SystemExit(code)

resp = json.load(sys.stdin)
if not resp.get("ok"):
    err = resp.get("error") or {}
    msg = (err.get("message") or err.get("code") or "unknown error").strip()
    die(f"inventory.snapshot failed ({msg})")

result = resp.get("result") or {}
if result.get("notModified") is True:
    die("inventory.snapshot returned notModified=true")

def norm(s: str) -> str:
    return " ".join((s or "").strip().lower().split())

zones = result.get("zones") or []
matches = [z for z in zones if norm(str(z.get("name") or "")) == norm(zone_name)]
if not matches:
    candidates = [str(z.get("name") or "").strip() for z in zones if (z.get("name") or "").strip()]
    candidates = sorted(set(candidates), key=lambda s: s.lower())
    extra = ""
    if candidates:
        extra = " Candidates: " + ", ".join(candidates[:12]) + (" ..." if len(candidates) > 12 else "")
    die(f'zone not found: "{zone_name}".{extra}')

if len(matches) > 1:
    names = sorted({str(z.get("name") or "").strip() for z in matches if (z.get("name") or "").strip()}, key=lambda s: s.lower())
    extra = " Matches: " + ", ".join(names[:12]) + (" ..." if len(names) > 12 else "")
    die(f'zone name is ambiguous: "{zone_name}".{extra}')

room_rids = matches[0].get("roomRids") or []
room_rids = [str(r).strip() for r in room_rids if str(r).strip()]
room_rids_set = set(room_rids)

rooms = result.get("rooms") or []
room_name_by_rid = {}
for r in rooms:
    rid = str(r.get("rid") or "").strip()
    name = str(r.get("name") or "").strip()
    if rid and name:
        room_name_by_rid[rid] = name

lights = result.get("lights") or []
rows = []
names = []
for l in lights:
    room_rid = str(l.get("roomRid") or "").strip()
    if not room_rid or room_rid not in room_rids_set:
        continue
    light_name = str(l.get("name") or "").strip()
    light_rid = str(l.get("rid") or "").strip()
    owner = str(l.get("ownerDeviceRid") or "").strip()
    room_name = room_name_by_rid.get(room_rid, "")
    rows.append((light_name or light_rid or "(unnamed)", room_name, light_rid, room_rid, owner))
    if light_name:
        names.append(light_name)
    elif light_rid:
        names.append(light_rid)

if fmt == "tsv":
    sys.stdout.write("Name\tRoom\tLightRID\tRoomRID\tOwnerDeviceRID\n")
    for name, room, lrid, rrid, owner in sorted(rows, key=lambda t: (t[0].lower(), t[1].lower(), t[2].lower())):
        sys.stdout.write(f"{name}\t{room}\t{lrid}\t{rrid}\t{owner}\n")
else:
    for name in sorted(set(names), key=lambda s: s.lower()):
        sys.stdout.write(name + "\n")

if print_ok:
    sys.stdout.write("ok\n")
PY
)"

  python3 -c "$PY_CODE" <<<"$INVENTORY_JSON"
  exit 0
fi

echo "zone_list_lights.sh: need python3 (for tsv) or jq (for names) to parse JSON." >&2
exit 127
