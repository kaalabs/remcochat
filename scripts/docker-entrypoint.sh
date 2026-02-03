#!/usr/bin/env bash
set -euo pipefail

config_path="${REMCOCHAT_CONFIG_PATH:-/app/config.toml}"
seed_path="${REMCOCHAT_CONFIG_SEED_PATH:-/app/config.seed.toml}"

mkdir -p "$(dirname "$config_path")"

if [[ ! -f "$config_path" && -f "$seed_path" ]]; then
  cp "$seed_path" "$config_path"
fi

exec "$@"
