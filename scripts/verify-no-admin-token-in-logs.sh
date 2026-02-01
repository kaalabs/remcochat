#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
verify-no-admin-token-in-logs.sh

Scan logs for accidental prints of REMCOCHAT_ADMIN_TOKEN (or an explicitly provided token).

Default scan targets:
  - /tmp/remcochat-startup.log (if present)

Optional:
  - --docker: include `docker compose logs` output
  - --scan-file <path>: add additional files to scan (repeatable)

Usage:
  scripts/verify-no-admin-token-in-logs.sh
  scripts/verify-no-admin-token-in-logs.sh --docker
  scripts/verify-no-admin-token-in-logs.sh --token "<token>" --scan-file ./some.log
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

TOKEN=""
DOTENV_PATH=""
INCLUDE_DOCKER=0
SCAN_FILES=()

while [[ "${#}" -gt 0 ]]; do
  case "${1}" in
    --token)
      TOKEN="${2:-}"
      shift 2
      ;;
    --dotenv)
      DOTENV_PATH="${2:-}"
      shift 2
      ;;
    --scan-file)
      SCAN_FILES+=("${2:-}")
      shift 2
      ;;
    --docker)
      INCLUDE_DOCKER=1
      shift
      ;;
    *)
      echo "ERROR: unexpected arg: ${1}" >&2
      usage >&2
      exit 2
      ;;
  esac
done

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "$(ts) [remcochat-token-scan] $*"; }
die() { log "ERROR: $*"; exit 3; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

dotenv_get() {
  local key="$1"
  local file="$2"
  local line raw
  [[ -f "$file" ]] || { echo ""; return 0; }
  line="$(
    grep -E "^[[:space:]]*(export[[:space:]]+)?${key}=" "$file" 2>/dev/null | tail -n 1 || true
  )"
  if [[ -z "$line" ]]; then
    echo ""
    return 0
  fi
  raw="${line#*=}"
  raw="${raw# }"
  raw="${raw%$'\r'}"
  if [[ "${raw:0:1}" == '"' && "${raw: -1}" == '"' ]]; then
    raw="${raw:1:${#raw}-2}"
  elif [[ "${raw:0:1}" == "'" && "${raw: -1}" == "'" ]]; then
    raw="${raw:1:${#raw}-2}"
  fi
  echo "$raw"
}

if [[ -z "$TOKEN" ]]; then
  if [[ -z "$DOTENV_PATH" ]]; then
    DOTENV_PATH="$REPO_DIR/.env"
  elif [[ "$DOTENV_PATH" != /* ]]; then
    DOTENV_PATH="$REPO_DIR/$DOTENV_PATH"
  fi
  TOKEN="$(dotenv_get REMCOCHAT_ADMIN_TOKEN "$DOTENV_PATH")"
fi

TOKEN="$(printf "%s" "${TOKEN:-}" | xargs)"
if [[ -z "$TOKEN" ]]; then
  die "REMCOCHAT_ADMIN_TOKEN missing/empty (set it in .env or pass --token)"
fi

targets=()

startup_log="/tmp/remcochat-startup.log"
if [[ -f "$startup_log" ]]; then
  targets+=("$startup_log")
fi

for f in "${SCAN_FILES[@]}"; do
  if [[ -z "$f" ]]; then
    continue
  fi
  if [[ "$f" != /* ]]; then
    f="$REPO_DIR/$f"
  fi
  targets+=("$f")
done

found=0

scan_file() {
  local f="$1"
  if [[ ! -f "$f" ]]; then
    log "Skip (not a file): $f"
    return 0
  fi
  if rg --fixed-strings -n "$TOKEN" "$f" >/dev/null 2>&1; then
    log "FOUND token in file: $f"
    # Print only file:line to avoid re-printing the token.
    rg --fixed-strings -n "$TOKEN" "$f" | cut -d: -f1-2 | head -n 20 || true
    found=1
  else
    log "OK (no token): $f"
  fi
}

for f in "${targets[@]}"; do
  scan_file "$f"
done

if [[ "$INCLUDE_DOCKER" -eq 1 ]]; then
  if ! command -v docker >/dev/null 2>&1; then
    die "--docker requested but docker not found"
  fi

  # Best-effort: scan compose logs without printing them unless a match is found.
  if docker compose version >/dev/null 2>&1; then
    log "Scanning docker compose logs for token (best-effort)"
    if docker compose -f "$REPO_DIR/docker-compose.yml" -f "$REPO_DIR/docker-compose.proxy.yml" logs --no-color 2>/dev/null | rg --fixed-strings -n "$TOKEN" >/dev/null 2>&1; then
      log "FOUND token in docker compose logs (not printing full logs)."
      found=1
    else
      log "OK (no token) in docker compose logs"
    fi
  else
    log "Skip docker compose log scan (docker compose not available)"
  fi
fi

if [[ "$found" -eq 1 ]]; then
  die "Admin token leaked into logs. Rotate REMCOCHAT_ADMIN_TOKEN and remove any logs containing it."
fi

log "OK: no admin token found in scanned targets"
