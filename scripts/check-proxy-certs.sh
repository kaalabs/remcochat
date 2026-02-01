#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
check-proxy-certs.sh

Fail-fast preflight for the nginx reverse proxy certificate mounts.

Ensures required cert artifacts exist as regular, non-empty files so Docker
doesn't auto-create directories for missing bind-mount sources.

Usage:
  scripts/check-proxy-certs.sh
  scripts/check-proxy-certs.sh --cert-dir nginx/certs
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

CERT_DIR=""
while [[ "${#}" -gt 0 ]]; do
  case "${1}" in
    --cert-dir)
      CERT_DIR="${2:-}"
      shift 2
      ;;
    *)
      echo "ERROR: unexpected arg: ${1}" >&2
      usage >&2
      exit 2
      ;;
  esac
done

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "$(ts) [remcochat-proxy-preflight] $*"; }
die() { log "ERROR: $*"; exit 3; }

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

if [[ -z "$CERT_DIR" ]]; then
  CERT_DIR="$REPO_DIR/nginx/certs"
elif [[ "$CERT_DIR" != /* ]]; then
  CERT_DIR="$REPO_DIR/$CERT_DIR"
fi

required=(
  "tls.pem"
  "tls.key"
  "ca.pem"
  "ca.cer"
  "remcochat-ca.mobileconfig"
)

missing=()
bad=()
empty=()

for rel in "${required[@]}"; do
  p="$CERT_DIR/$rel"
  if [[ ! -e "$p" ]]; then
    missing+=("$p")
    continue
  fi
  if [[ ! -f "$p" ]]; then
    bad+=("$p")
    continue
  fi
  # Portable non-empty check (works on macOS/Linux).
  if [[ "$(wc -c <"$p" | tr -d '[:space:]')" == "0" ]]; then
    empty+=("$p")
    continue
  fi
done

if [[ "${#missing[@]}" -gt 0 || "${#bad[@]}" -gt 0 || "${#empty[@]}" -gt 0 ]]; then
  if [[ "${#missing[@]}" -gt 0 ]]; then
    log "Missing required proxy cert files:"
    for p in "${missing[@]}"; do
      log "  - $p"
    done
  fi
  if [[ "${#bad[@]}" -gt 0 ]]; then
    log "Invalid proxy cert mount sources (must be regular files):"
    for p in "${bad[@]}"; do
      log "  - $p"
    done
  fi
  if [[ "${#empty[@]}" -gt 0 ]]; then
    log "Invalid proxy cert files (must be non-empty):"
    for p in "${empty[@]}"; do
      log "  - $p"
    done
  fi
  log "Fix: run scripts/generate-proxy-cert.sh (or provide your own certs)."
  exit 1
fi

log "OK: proxy cert artifacts present in $CERT_DIR"
