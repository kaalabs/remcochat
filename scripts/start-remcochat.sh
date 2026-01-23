#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
start-remcochat.sh

Boot/start helper for the RemcoChat docker compose stack (remcochat + sandboxd).

Usage:
  scripts/start-remcochat.sh [--build]

Options:
  --build   Force rebuild of compose images and sandbox runtime image.

Prereqs:
  - docker engine running
  - docker compose v2 (or docker-compose)
  - repo contains .env and config.toml

Notes:
  - For bash tools (lan): you must enter REMCOCHAT_ADMIN_TOKEN in the UI so
    requests include x-remcochat-admin-token.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

FORCE_BUILD=0
if [[ "${1:-}" == "--build" ]]; then
  FORCE_BUILD=1
  shift
fi
if [[ "${#}" -ne 0 ]]; then
  echo "ERROR: unexpected arguments: $*" >&2
  usage >&2
  exit 2
fi

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "$(ts) [remcochat-start] $*"; }
die() { log "ERROR: $*"; exit 3; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

command -v docker >/dev/null 2>&1 || die "docker not found"

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose "$@"
    return
  fi
  if command -v docker-compose >/dev/null 2>&1; then
    docker-compose "$@"
    return
  fi
  die "docker compose not available (need docker compose v2 or docker-compose)"
}

cd "$REPO_DIR"

[[ -f docker-compose.yml ]] || die "missing docker-compose.yml in $REPO_DIR"
[[ -f config.toml ]] || die "missing config.toml in $REPO_DIR"
[[ -f .env ]] || die "missing .env in $REPO_DIR (copy from .env.example and set required values)"

dotenv_get() {
  local key="$1"
  local line raw
  line="$(
    grep -E "^[[:space:]]*(export[[:space:]]+)?${key}=" .env 2>/dev/null | tail -n 1 || true
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

is_truthy() {
  local v
  v="$(printf "%s" "${1:-}" | tr '[:upper:]' '[:lower:]' | xargs)"
  [[ "$v" == "1" || "$v" == "true" || "$v" == "yes" || "$v" == "on" ]]
}

admin_token="$(dotenv_get REMCOCHAT_ADMIN_TOKEN)"
enable_bash="$(dotenv_get REMCOCHAT_ENABLE_BASH_TOOL)"
opencode_key="$(dotenv_get OPENCODE_API_KEY)"
vercel_key="$(dotenv_get VERCEL_AI_GATEWAY_API_KEY)"
modelsdev_host_dir="$(dotenv_get REMCOCHAT_MODELSDEV_CLI_HOST_DIR)"

if [[ -z "$admin_token" ]]; then
  die "REMCOCHAT_ADMIN_TOKEN missing/empty in .env (required for access=\"lan\" and sandboxd auth)"
fi
if ! is_truthy "$enable_bash"; then
  die "REMCOCHAT_ENABLE_BASH_TOOL must be truthy in .env (set REMCOCHAT_ENABLE_BASH_TOOL=1)"
fi
if [[ -z "$opencode_key" ]]; then
  log "WARN: OPENCODE_API_KEY missing/empty in .env (required if opencode is active/router provider)"
fi
if [[ -z "$vercel_key" ]]; then
  log "WARN: VERCEL_AI_GATEWAY_API_KEY missing/empty in .env (required if switching active provider to vercel)"
fi
if [[ -n "$modelsdev_host_dir" ]]; then
  if [[ ! -x "${modelsdev_host_dir}/bin/run.js" && ! -x "${modelsdev_host_dir}/bin/modelsdev" ]]; then
    log "WARN: REMCOCHAT_MODELSDEV_CLI_HOST_DIR does not look like a modelsdev install (expected bin/run.js or bin/modelsdev): ${modelsdev_host_dir}"
  fi
fi

log "Ensuring sandbox runtime image exists: remcochat-sandbox:node24"
if [[ "$FORCE_BUILD" -eq 1 ]] || ! docker image inspect remcochat-sandbox:node24 >/dev/null 2>&1; then
  docker build -t remcochat-sandbox:node24 -f sandbox-images/node24/Dockerfile .
fi

log "Starting compose stack"
if [[ "$FORCE_BUILD" -eq 1 ]]; then
  compose up -d --build
else
  compose up -d
fi

log "Health checks"
curl -fsS http://127.0.0.1:8080/v1/health >/dev/null || die "sandboxd not healthy on http://127.0.0.1:8080"
curl -fsS http://127.0.0.1:3100/ >/dev/null || die "remcochat not serving on http://127.0.0.1:3100"

log "OK: remcochat on http://0.0.0.0:3100 (LAN); sandboxd on http://0.0.0.0:8080"
