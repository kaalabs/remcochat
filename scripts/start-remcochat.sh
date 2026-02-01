#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
start-remcochat.sh

Boot/start helper for the RemcoChat docker compose stack (remcochat + sandboxd).

Usage:
  scripts/start-remcochat.sh [--build] [--proxy]

Options:
  --build   Force rebuild of compose images and sandbox runtime image.
  --proxy   Also start the nginx reverse proxy (serves https://<host>/remcochat on port 443).

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
ENABLE_PROXY=0
while [[ "${#}" -gt 0 ]]; do
  case "${1}" in
    --build)
      FORCE_BUILD=1
      shift
      ;;
    --proxy)
      ENABLE_PROXY=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unexpected arguments: $*" >&2
      usage >&2
      exit 2
      ;;
  esac
done

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
  if [[ "$ENABLE_PROXY" -eq 1 ]]; then
    [[ -f docker-compose.proxy.yml ]] || die "missing docker-compose.proxy.yml in $REPO_DIR"
    [[ -f nginx/remcochat.conf ]] || die "missing nginx/remcochat.conf in $REPO_DIR"
    [[ -x scripts/check-proxy-certs.sh ]] || die "missing scripts/check-proxy-certs.sh"
    scripts/check-proxy-certs.sh || die "proxy cert preflight failed"
  fi
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
sandboxd_host_bind_ip="$(dotenv_get SANDBOXD_HOST_BIND_IP)"
sandboxd_publish_host_ip="$(dotenv_get SANDBOXD_PUBLISH_HOST_IP)"

min_admin_token_chars=32

if [[ -z "$admin_token" ]]; then
  die "REMCOCHAT_ADMIN_TOKEN missing/empty in .env (required for access=\"lan\" and sandboxd auth)"
fi
if [[ "${#admin_token}" -lt "$min_admin_token_chars" ]]; then
  die "REMCOCHAT_ADMIN_TOKEN is too short (min ${min_admin_token_chars} chars). Recommended: openssl rand -hex 32"
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

if [[ -z "$sandboxd_host_bind_ip" ]]; then
  sandboxd_host_bind_ip="127.0.0.1"
fi
if [[ -z "$sandboxd_publish_host_ip" ]]; then
  sandboxd_publish_host_ip="127.0.0.1"
fi
if [[ "$sandboxd_host_bind_ip" == "0.0.0.0" ]]; then
  die "SANDBOXD_HOST_BIND_IP must not be 0.0.0.0 (use 127.0.0.1 or your Tailscale IP)"
fi
if [[ "$sandboxd_publish_host_ip" == "0.0.0.0" ]]; then
  die "SANDBOXD_PUBLISH_HOST_IP must not be 0.0.0.0 (use 127.0.0.1 or your Tailscale IP)"
fi

log "Ensuring sandbox runtime image exists: remcochat-sandbox:node24"
if [[ "$FORCE_BUILD" -eq 1 ]] || ! docker image inspect remcochat-sandbox:node24 >/dev/null 2>&1; then
  docker build -t remcochat-sandbox:node24 -f sandbox-images/node24/Dockerfile .
fi

COMPOSE_FILES=(-f docker-compose.yml)
if [[ "$ENABLE_PROXY" -eq 1 ]]; then
  COMPOSE_FILES+=(-f docker-compose.proxy.yml)
else
  if [[ -f docker-compose.proxy.yml ]]; then
    log "NOTE: reverse proxy not started (pass --proxy to start remcochat-proxy)"
  fi
fi

log "Starting compose stack"
if [[ "$FORCE_BUILD" -eq 1 ]]; then
  compose "${COMPOSE_FILES[@]}" up -d --build
else
  compose "${COMPOSE_FILES[@]}" up -d
fi

wait_http_ok() {
  local url="$1"
  local label="$2"
  local attempts="${3:-30}"
  local sleep_s="${4:-1}"

  local i=1
  while [[ "$i" -le "$attempts" ]]; do
    if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$sleep_s"
    i=$((i + 1))
  done
  return 1
}

log "Health checks"
wait_http_ok "http://${sandboxd_host_bind_ip}:8080/v1/health" "sandboxd" 40 1 || die "sandboxd not healthy on http://${sandboxd_host_bind_ip}:8080"
wait_http_ok "http://127.0.0.1:3100/" "remcochat" 60 1 || die "remcochat not serving on http://127.0.0.1:3100"
  if [[ "$ENABLE_PROXY" -eq 1 ]]; then
    curl -fsSk --max-time 2 https://127.0.0.1/remcochat/ >/dev/null 2>&1 || die "proxy not serving on https://127.0.0.1/remcochat/"
    if ! compose "${COMPOSE_FILES[@]}" ps --services --status running 2>/dev/null | grep -qx "remcochat-proxy"; then
      log "ERROR: remcochat-proxy is not running"
      compose "${COMPOSE_FILES[@]}" ps -a || true
      compose "${COMPOSE_FILES[@]}" logs --tail 200 remcochat-proxy || true
      exit 3
    fi
  fi

log "OK: remcochat on http://127.0.0.1:3100 (local only); sandboxd on http://${sandboxd_host_bind_ip}:8080 (published ports bind to ${sandboxd_publish_host_ip})"
if [[ "$ENABLE_PROXY" -eq 1 ]]; then
  log "OK: proxy on https://<host>/remcochat/ (443)"
fi
