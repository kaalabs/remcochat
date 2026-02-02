#!/usr/bin/env bash
set -euo pipefail

if ! command -v curl >/dev/null 2>&1; then
  echo "health_check.sh: missing required dependency: curl" >&2
  exit 127
fi

CURL_HEALTH="${CURL_HEALTH:-curl -fsS --connect-timeout 1 --max-time 2}"

BASE_URL="${BASE_URL:-}"
if [ -z "$BASE_URL" ]; then
  for base in "http://hue-gateway:8000" "http://host.docker.internal:8000" "http://localhost:8000"; do
    if $CURL_HEALTH "$base/healthz" >/dev/null 2>&1; then
      BASE_URL="$base"
      break
    fi
  done
fi

if [ -z "$BASE_URL" ]; then
  echo "Hue Gateway not reachable from this environment. Set BASE_URL to a reachable base URL (e.g. http://hue-gateway:8000)." >&2
  exit 1
fi

BASE_URL="${BASE_URL%/}"

READY_JSON="$($CURL_HEALTH "$BASE_URL/readyz" 2>/dev/null || true)"
case "$READY_JSON" in
  *'"ready":true'*|*'"ready": true'*) : ;;
  *)
    echo "Hue Gateway is not ready (ready=false) at BASE_URL=$BASE_URL." >&2
    echo "readyz response: ${READY_JSON:-<empty>}" >&2
    exit 1
    ;;
esac

# Print only shell-safe exports on stdout so callers can: eval "$(<cmd>)"
printf "export BASE_URL=%q\n" "$BASE_URL"
