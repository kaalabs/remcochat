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
  - Read-only: uses a single v2 `inventory.snapshot` call.
  - Prints Hue light names that belong to the room (from the normalized inventory read model).
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

AUTH_HEADER=""
if [ -n "${HUE_AUTH_HEADER:-}" ]; then
  AUTH_HEADER="$HUE_AUTH_HEADER"
elif [ -n "${HUE_API_KEY:-}" ]; then
  AUTH_HEADER="X-API-Key: $HUE_API_KEY"
else
  AUTH_HEADER="Authorization: Bearer ${HUE_TOKEN:-dev-token}"
fi

CURL_JSON="${CURL_JSON:-curl -sS --connect-timeout 1 --max-time 10}"

REQ_ID="bash-room-lamps-$(date -u +%Y%m%dT%H%M%SZ)-$RANDOM"
INVENTORY_JSON="$($CURL_JSON -X POST "$BASE_URL/v2/actions" \
  -H 'Content-Type: application/json' \
  -H "X-Request-Id: $REQ_ID" \
  -H "$AUTH_HEADER" \
  -d "$(printf '{"requestId":"%s","action":"inventory.snapshot","args":{}}' "$REQ_ID")")"

if command -v jq >/dev/null 2>&1; then
  OK="$(echo "$INVENTORY_JSON" | jq -r '.ok // empty' 2>/dev/null || true)"
  if [ "$OK" != "true" ]; then
    ERR="$(echo "$INVENTORY_JSON" | jq -r '.error.message // .error.code // "unknown error"' 2>/dev/null || true)"
    echo "room_list_lamps.sh: inventory.snapshot failed at BASE_URL=$BASE_URL (${ERR:-unknown error})" >&2
    echo "$INVENTORY_JSON" >&2
    exit 1
  fi

  NOT_MODIFIED="$(echo "$INVENTORY_JSON" | jq -r '.result.notModified // empty' 2>/dev/null || true)"
  if [ "$NOT_MODIFIED" = "true" ]; then
    REV="$(echo "$INVENTORY_JSON" | jq -r '.result.revision // empty' 2>/dev/null || true)"
    echo "room_list_lamps.sh: inventory.snapshot returned notModified=true (revision=${REV:-unknown})" >&2
    exit 1
  fi

  MATCH_COUNT="$(echo "$INVENTORY_JSON" | jq -r --arg room "$ROOM" '
    def norm: gsub("^\\s+|\\s+$";"") | ascii_downcase;
    (.result.rooms // []) | map(select((.name // "" | norm) == ($room | norm))) | length
  ' 2>/dev/null || true)"
  case "$MATCH_COUNT" in
    ''|*[!0-9]*)
      echo "room_list_lamps.sh: failed to parse rooms from inventory.snapshot" >&2
      echo "$INVENTORY_JSON" >&2
      exit 1
      ;;
  esac

  if [ "$MATCH_COUNT" -eq 0 ]; then
    CANDIDATES="$(echo "$INVENTORY_JSON" | jq -r '(.result.rooms // [])[]?.name // empty' 2>/dev/null || true | head -n 12 | paste -sd ', ' -)"
    echo "room_list_lamps.sh: room not found: $ROOM" >&2
    if [ -n "$CANDIDATES" ]; then
      echo "room_list_lamps.sh: candidates: $CANDIDATES" >&2
    fi
    exit 1
  fi
  if [ "$MATCH_COUNT" -gt 1 ]; then
    MATCHES="$(echo "$INVENTORY_JSON" | jq -r --arg room "$ROOM" '
      def norm: gsub("^\\s+|\\s+$";"") | ascii_downcase;
      (.result.rooms // []) | map(select((.name // "" | norm) == ($room | norm))) | map(.name) | .[]
    ' 2>/dev/null || true | head -n 12 | paste -sd ', ' -)"
    echo "room_list_lamps.sh: room name is ambiguous: $ROOM" >&2
    if [ -n "$MATCHES" ]; then
      echo "room_list_lamps.sh: matches: $MATCHES" >&2
    fi
    exit 1
  fi

  ROOM_RID="$(echo "$INVENTORY_JSON" | jq -r --arg room "$ROOM" '
    def norm: gsub("^\\s+|\\s+$";"") | ascii_downcase;
    (.result.rooms // []) | map(select((.name // "" | norm) == ($room | norm))) | .[0].rid // empty
  ' 2>/dev/null || true)"
  if [ -z "$ROOM_RID" ]; then
    echo "room_list_lamps.sh: missing room rid after match" >&2
    exit 1
  fi

  echo "$INVENTORY_JSON" | jq -r --arg rid "$ROOM_RID" '
    (.result.lights // [])[]
    | select((.roomRid // "") == $rid)
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
  export HUE_ROOM_NAME="$ROOM"
  export HUE_ROOM_PRINT_OK="$PRINT_OK"

  PY_CODE="$(cat <<'PY'
import json
import os
import sys

room_name = (os.environ.get("HUE_ROOM_NAME") or "").strip()
print_ok = (os.environ.get("HUE_ROOM_PRINT_OK") or "0").strip().lower() in ("1", "true", "yes", "on")

def eprint(msg: str) -> None:
    sys.stderr.write(msg.rstrip() + "\n")

def die(msg: str, code: int = 1) -> None:
    eprint(f"room_list_lamps.sh: {msg}")
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

rooms = result.get("rooms") or []
matches = [r for r in rooms if norm(str(r.get("name") or "")) == norm(room_name)]
if not matches:
    candidates = [str(r.get("name") or "").strip() for r in rooms if (r.get("name") or "").strip()]
    candidates = sorted(set(candidates), key=lambda s: s.lower())
    extra = ""
    if candidates:
        extra = " Candidates: " + ", ".join(candidates[:12]) + (" ..." if len(candidates) > 12 else "")
    die(f'room not found: "{room_name}".{extra}')

if len(matches) > 1:
    names = sorted({str(r.get("name") or "").strip() for r in matches if (r.get("name") or "").strip()}, key=lambda s: s.lower())
    extra = " Matches: " + ", ".join(names[:12]) + (" ..." if len(names) > 12 else "")
    die(f'room name is ambiguous: "{room_name}".{extra}')

room_rid = str(matches[0].get("rid") or "").strip()
if not room_rid:
    die("matched room missing rid")

lights = result.get("lights") or []
names = []
for l in lights:
    if str(l.get("roomRid") or "").strip() != room_rid:
        continue
    name = str(l.get("name") or "").strip()
    if name:
        names.append(name)

for name in sorted(set(names), key=lambda s: s.lower()):
    sys.stdout.write(name + "\n")

if print_ok:
    sys.stdout.write("ok\n")
PY
)"

  python3 -c "$PY_CODE" <<<"$INVENTORY_JSON"
  exit 0
fi

echo "room_list_lamps.sh: need jq or python3 to parse JSON (neither found)." >&2
exit 127
