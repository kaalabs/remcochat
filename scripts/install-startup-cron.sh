#!/usr/bin/env bash
set -euo pipefail

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "$(ts) [remcochat-cron] $*"; }
die() { log "ERROR: $*"; exit 1; }

command -v crontab >/dev/null 2>&1 || die "crontab not found"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
START_CMD="${REPO_DIR}/scripts/start-remcochat.sh --proxy"

CRON_TAG="# remcochat:startup"
CRON_LINE="@reboot ${START_CMD} >> /tmp/remcochat-startup.log 2>&1"

existing="$(crontab -l 2>/dev/null || true)"

if printf "%s\n" "$existing" | grep -Fq "$CRON_TAG"; then
  log "Startup cron entry already present"
  exit 0
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

{
  if [[ -n "${existing}" ]]; then
    printf "%s\n" "$existing"
  fi
  printf "%s\n" "$CRON_TAG"
  printf "%s\n" "$CRON_LINE"
} >"$tmp"

crontab "$tmp"
log "Installed startup cron entry"
