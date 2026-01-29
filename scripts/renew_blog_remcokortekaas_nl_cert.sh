#!/usr/bin/env bash
set -euo pipefail

PATH=/usr/sbin:/usr/bin:/sbin:/bin

BASE_DIR=/home/rrk/server/remcochat
WEBROOT_DIR="$BASE_DIR/nginx/acme-challenge"
LE_DIR="$BASE_DIR/letsencrypt"
LE_LIB_DIR="$BASE_DIR/letsencrypt-lib"

LOCK_FILE="$BASE_DIR/letsencrypt-renew.lock"
LOG_FILE="$BASE_DIR/letsencrypt-renew.log"

mkdir -p "$WEBROOT_DIR" "$LE_DIR" "$LE_LIB_DIR"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  exit 0
fi

ts() { date -Is; }

{
  echo "[$(ts)] renew start blog.remcokortekaas.nl"

  /usr/bin/docker run --rm \
    -v "$WEBROOT_DIR:/var/www/certbot" \
    -v "$LE_DIR:/etc/letsencrypt" \
    -v "$LE_LIB_DIR:/var/lib/letsencrypt" \
    certbot/certbot:latest \
    renew --quiet

  # Reload nginx to pick up renewed certs (no-op if unchanged).
  /usr/bin/docker exec remcochat-proxy nginx -t
  /usr/bin/docker exec remcochat-proxy nginx -s reload

  echo "[$(ts)] renew done blog.remcokortekaas.nl"
} >>"$LOG_FILE" 2>&1
