#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

eval "$("$SCRIPT_DIR/health_check.sh")"

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

CURL_JSON="${CURL_JSON:-curl -sS --connect-timeout 1 --max-time 8}"

ROOMS_JSON="$($CURL_JSON -X POST "$BASE_URL/v1/actions" \
  -H 'Content-Type: application/json' \
  -H "$AUTH_HEADER" \
  -d '{"action":"clipv2.request","args":{"method":"GET","path":"/clip/v2/resource/room"}}')"

if command -v jq >/dev/null 2>&1; then
  echo "$ROOMS_JSON" | jq -r '.result.body.data[] | "\(.metadata.name)\t\(.services[]? | select(.rtype==\"grouped_light\") | .rid)\t\(.id)"' \
  | awk -F'\t' 'NF>=2 && $1!="" && $2!="" {print}' \
  | sort -f
  exit 0
fi

if command -v python3 >/dev/null 2>&1; then
  PY_CODE="$(cat <<'PY'
import json
import sys

resp = json.load(sys.stdin)
rooms = ((resp.get("result") or {}).get("body") or {}).get("data") or []

rows = []
for r in rooms:
    name = ((r.get("metadata") or {}).get("name") or "").strip()
    rid = ""
    for s in (r.get("services") or []):
        if (s.get("rtype") or "") == "grouped_light" and (s.get("rid") or ""):
            rid = s.get("rid")
            break
    room_id = (r.get("id") or "").strip()
    if name and rid:
        rows.append((name, rid, room_id))

for name, rid, room_id in sorted(rows, key=lambda t: t[0].lower()):
    sys.stdout.write(f"{name}\t{rid}\t{room_id}\n")
PY
)"

  python3 -c "$PY_CODE" <<<"$ROOMS_JSON"
  exit 0
fi

echo "list_rooms.sh: need jq or python3 to parse JSON (neither found)." >&2
exit 127
