#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
update-remcochat.sh

Cron-safe updater for a RemcoChat git clone that runs via docker compose.

Environment variables:
  REPO_DIR      Path to the RemcoChat git repo (default: script's parent dir)
  BRANCH        Git branch to track (default: main)
  REMOTE        Git remote to track (default: origin)
  COMPOSE_FILE  Compose file path relative to REPO_DIR (default: docker-compose.yml)
  COMPOSE_FILES Comma-separated compose file paths relative to REPO_DIR (overrides COMPOSE_FILE)
               Example: docker-compose.yml,docker-compose.proxy.yml
  REMOVE_ORPHANS Whether to delete orphan containers during update (default: 1)
  LOCK_FILE     Flock lock file path (default: /tmp/remcochat-update.lock)

Exit codes:
  0  Up to date or updated successfully
  2  Repo not clean / not safe to update
  3  Missing prerequisites (git/docker/compose file)
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "$(ts) [remcochat-update] $*"; }
die() { log "ERROR: $*"; exit 3; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-"$(cd -- "$SCRIPT_DIR/.." && pwd)"}"
BRANCH="${BRANCH:-main}"
REMOTE="${REMOTE:-origin}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
COMPOSE_FILES="${COMPOSE_FILES:-}"
REMOVE_ORPHANS="${REMOVE_ORPHANS:-1}"
LOCK_FILE="${LOCK_FILE:-/tmp/remcochat-update.lock}"

command -v git >/dev/null 2>&1 || die "git not found"
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

validate_toml_syntax() {
  local path="$1"
  [[ -f "$path" ]] || die "TOML file not found: $path"

  # Use docker so the host doesn't need python/node/toml tooling installed.
  # tomllib gives clear row/col errors for corrupted files.
  if ! docker run --rm -v "$path":/cfg.toml:ro python:3.12-alpine \
    python - <<'PY'
import sys, tomllib
path="/cfg.toml"
try:
  with open(path, "rb") as f:
    data = tomllib.load(f)
except Exception as e:
  print(str(e), file=sys.stderr)
  raise SystemExit(1)
if not isinstance(data, dict):
  print("TOML root is not an object.", file=sys.stderr)
  raise SystemExit(1)
PY
  then
    die "Invalid TOML syntax: $path"
  fi
}

compose_seed_config_source() {
  # Find the bind-mount source for /app/config.seed.toml.
  # Use a simple scan because /app/config.seed.toml should be unique in the compose output.
  compose "${COMPOSE_ARGS[@]}" config | awk '
    /^[[:space:]]*source:[[:space:]]*/ { src=$0; sub(/^[[:space:]]*source:[[:space:]]*/, "", src); last_src=src }
    /^[[:space:]]*target:[[:space:]]*\/app\/config\.seed\.toml[[:space:]]*$/ { print last_src; exit }
  '
}

compose_volume_name() {
  local logical="$1"
  compose "${COMPOSE_ARGS[@]}" config | awk -v logical="^[[:space:]]*"logical":[[:space:]]*$" '
    /^volumes:[[:space:]]*$/ { in_vols=1; next }
    in_vols && $0 ~ logical { in_one=1; next }
    in_vols && in_one && /^[[:space:]]*name:[[:space:]]*/ {
      name=$0
      sub(/^[[:space:]]*name:[[:space:]]*/, "", name)
      print name
      exit
    }
  '
}

preflight_validate_configs() {
  log "Preflight: validating docker config TOML files"

  local seed_src
  seed_src="$(compose_seed_config_source)"
  [[ -n "${seed_src:-}" ]] || die "Could not resolve config seed source (mount for /app/config.seed.toml)"
  validate_toml_syntax "$seed_src"

  # Validate the persisted config in the config volume (if present).
  local vol_name
  vol_name="$(compose_volume_name remcochat_config || true)"
  if [[ -n "${vol_name:-}" ]] && docker volume inspect "$vol_name" >/dev/null 2>&1; then
    if ! docker run --rm -v "$vol_name":/cfg:ro python:3.12-alpine \
      python - <<'PY'
import sys, tomllib, os
path="/cfg/config.toml"
if not os.path.exists(path):
  raise SystemExit(0)
try:
  with open(path, "rb") as f:
    tomllib.load(f)
except Exception as e:
  print(str(e), file=sys.stderr)
  raise SystemExit(1)
PY
    then
      die "Invalid TOML syntax in docker config volume ($vol_name:/config.toml). Fix it or delete the volume before updating."
    fi
  fi
}

is_truthy() {
  local v
  v="$(printf "%s" "${1:-}" | tr '[:upper:]' '[:lower:]' | xargs)"
  [[ "$v" == "1" || "$v" == "true" || "$v" == "yes" || "$v" == "on" ]]
}

cd "$REPO_DIR"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "REPO_DIR is not a git repo: $REPO_DIR"

compose_files=()
if [[ -n "$COMPOSE_FILES" ]]; then
  IFS=',' read -r -a compose_files <<<"$COMPOSE_FILES"
else
  compose_files=("$COMPOSE_FILE")

  # If a proxy container already exists, default to including the proxy compose file to avoid
  # accidentally deleting it via --remove-orphans when COMPOSE_FILES isn't set.
  if [[ -f "docker-compose.proxy.yml" ]] && docker ps -a --format '{{.Names}}' | grep -qx 'remcochat-proxy'; then
    compose_files+=("docker-compose.proxy.yml")
  fi
fi

COMPOSE_ARGS=()
for f in "${compose_files[@]}"; do
  f="$(printf "%s" "$f" | xargs)"
  [[ -n "$f" ]] || continue
  [[ -f "$f" ]] || die "compose file missing: $REPO_DIR/$f"
  COMPOSE_ARGS+=(-f "$f")
done

if [[ "${#COMPOSE_ARGS[@]}" -eq 0 ]]; then
  die "no compose files specified (set COMPOSE_FILE or COMPOSE_FILES)"
fi

if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    log "Another update run is in progress; exiting."
    exit 0
  fi
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  log "Repo has uncommitted tracked changes; refusing to update."
  git status --porcelain=v1 | sed 's/^/  /'
  exit 2
fi

current_branch="$(git symbolic-ref --short HEAD 2>/dev/null || true)"
if [[ "$current_branch" != "$BRANCH" ]]; then
  if [[ -n "$current_branch" ]]; then
    log "Switching branch $current_branch -> $BRANCH"
  else
    log "Checking out $BRANCH"
  fi
  git checkout "$BRANCH"
fi

log "Fetching $REMOTE/$BRANCH"
git fetch --prune "$REMOTE" "$BRANCH"

remote_ref="$REMOTE/$BRANCH"
local_sha="$(git rev-parse HEAD)"
remote_sha="$(git rev-parse "$remote_ref")"

if [[ "$local_sha" == "$remote_sha" ]]; then
  preflight_validate_configs
  log "Up to date: $local_sha"
  exit 0
fi

log "Update available: $local_sha -> $remote_sha"
git pull --ff-only "$REMOTE" "$BRANCH"

preflight_validate_configs

log "Rebuilding & restarting via docker compose"
REMOVE_ARGS=()
if is_truthy "$REMOVE_ORPHANS"; then
  REMOVE_ARGS+=(--remove-orphans)
fi

compose "${COMPOSE_ARGS[@]}" up -d --build "${REMOVE_ARGS[@]}"

log "Update complete: $(git rev-parse HEAD)"
