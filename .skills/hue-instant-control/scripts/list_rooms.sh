#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

HEALTH_EXPORTS="$(bash "$SCRIPT_DIR/health_check.sh")" || exit $?
eval "$HEALTH_EXPORTS"

BASE_URL="${BASE_URL%/}"

if ! command -v curl >/dev/null 2>&1; then
  echo "list_rooms.sh: missing required dependency: curl" >&2
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

REQ_ID="bash-rooms-$(date -u +%Y%m%dT%H%M%SZ)-$RANDOM"
INVENTORY_JSON="$($CURL_JSON -X POST "$BASE_URL/v2/actions" \
  -H 'Content-Type: application/json' \
  -H "X-Request-Id: $REQ_ID" \
  -H "$AUTH_HEADER" \
  -d "$(printf '{"requestId":"%s","action":"inventory.snapshot","args":{}}' "$REQ_ID")")"

if command -v jq >/dev/null 2>&1; then
  OK="$(echo "$INVENTORY_JSON" | jq -r '.ok // empty' 2>/dev/null || true)"
  if [ "$OK" != "true" ]; then
    ERR="$(echo "$INVENTORY_JSON" | jq -r '.error.message // .error.code // "unknown error"' 2>/dev/null || true)"
    echo "list_rooms.sh: inventory.snapshot failed at BASE_URL=$BASE_URL (${ERR:-unknown error})" >&2
    echo "$INVENTORY_JSON" >&2
    exit 1
  fi

  NOT_MODIFIED="$(echo "$INVENTORY_JSON" | jq -r '.result.notModified // empty' 2>/dev/null || true)"
  if [ "$NOT_MODIFIED" = "true" ]; then
    REV="$(echo "$INVENTORY_JSON" | jq -r '.result.revision // empty' 2>/dev/null || true)"
    echo "list_rooms.sh: inventory.snapshot returned notModified=true (revision=${REV:-unknown})" >&2
    exit 1
  fi

  echo "$INVENTORY_JSON" | jq -r '(.result.rooms // [])[] | "\(.name)\t\(.groupedLightRid)\t\(.rid)"' \
  | awk -F'\t' 'NF>=2 && $1!="" && $2!="" {print}' \
  | sort -f
  exit 0
fi

if command -v python3 >/dev/null 2>&1; then
  PY_CODE="$(cat <<'PY'
import json
import sys

resp = json.load(sys.stdin)
if not resp.get("ok"):
    err = resp.get("error") or {}
    msg = (err.get("message") or err.get("code") or "unknown error").strip()
    sys.stderr.write(f"list_rooms.sh: inventory.snapshot failed ({msg})\n")
    sys.stderr.write(json.dumps(resp, ensure_ascii=False) + "\n")
    raise SystemExit(1)

result = resp.get("result") or {}
if result.get("notModified") is True:
    sys.stderr.write("list_rooms.sh: inventory.snapshot returned notModified=true\n")
    sys.stderr.write(json.dumps(resp, ensure_ascii=False) + "\n")
    raise SystemExit(1)

rooms = result.get("rooms") or []

rows = []
for r in rooms:
    name = str(r.get("name") or "").strip()
    gl = str(r.get("groupedLightRid") or "").strip()
    rid = str(r.get("rid") or "").strip()
    if name and gl and rid:
        rows.append((name, gl, rid))

for name, gl, rid in sorted(rows, key=lambda t: t[0].lower()):
    sys.stdout.write(f"{name}\t{gl}\t{rid}\n")
PY
)"

  python3 -c "$PY_CODE" <<<"$INVENTORY_JSON"
  exit 0
fi

echo "list_rooms.sh: need jq or python3 to parse JSON (neither found)." >&2
exit 127
