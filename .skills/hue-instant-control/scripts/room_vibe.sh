#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  room_vibe.sh --room "<Hue room name>" --vibe cozy|focus|movie|nightlight|energize [--verify|--no-verify]

Examples:
  bash ./.skills/hue-instant-control/scripts/room_vibe.sh --room "Woonkamer" --vibe cozy
  bash ./.skills/hue-instant-control/scripts/room_vibe.sh --room "Slaapkamer" --vibe nightlight --no-verify

Notes:
  - Provides deterministic presets for common "vibes".
  - Delegates to scripts/room_set_by_name.sh.
EOF
}

ROOM=""
VIBE=""
VERIFY_FLAG=""

while [ $# -gt 0 ]; do
  case "${1:-}" in
    --room)
      ROOM="${2:-}"
      shift 2
      ;;
    --vibe)
      VIBE="${2:-}"
      shift 2
      ;;
    --verify)
      VERIFY_FLAG="--verify"
      shift
      ;;
    --no-verify)
      VERIFY_FLAG="--no-verify"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "room_vibe.sh: unknown arg: ${1:-}" >&2
      usage
      exit 2
      ;;
  esac
done

ROOM="$(echo "$ROOM" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
VIBE="$(echo "$VIBE" | tr '[:upper:]' '[:lower:]' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"

if [ -z "$ROOM" ]; then
  echo "room_vibe.sh: missing required: --room" >&2
  usage
  exit 2
fi

if [ -z "$VIBE" ]; then
  echo "room_vibe.sh: missing required: --vibe" >&2
  usage
  exit 2
fi

BRIGHTNESS=""
COLOR_TEMP_K=""

case "$VIBE" in
  cozy|warm|relax|relaxing)
    BRIGHTNESS="35"
    COLOR_TEMP_K="2400"
    ;;
  focus|work|working|bright)
    BRIGHTNESS="85"
    COLOR_TEMP_K="4500"
    ;;
  movie|movie-night|movienight)
    BRIGHTNESS="12"
    COLOR_TEMP_K="2200"
    ;;
  nightlight|night|sleep)
    BRIGHTNESS="5"
    COLOR_TEMP_K="2100"
    ;;
  energize|energy|wake|wakeup|wake-up)
    BRIGHTNESS="80"
    COLOR_TEMP_K="4000"
    ;;
  *)
    echo "room_vibe.sh: unknown vibe: $VIBE" >&2
    echo "supported vibes: cozy, focus, movie, nightlight, energize" >&2
    exit 2
    ;;
esac

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

exec bash "$SCRIPT_DIR/room_set_by_name.sh" \
  --room "$ROOM" \
  --on true \
  --brightness "$BRIGHTNESS" \
  --color-temp-k "$COLOR_TEMP_K" \
  ${VERIFY_FLAG:+"$VERIFY_FLAG"}

