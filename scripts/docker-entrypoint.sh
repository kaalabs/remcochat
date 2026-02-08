#!/usr/bin/env bash
set -euo pipefail

config_path="${REMCOCHAT_CONFIG_PATH:-/app/config.toml}"
seed_path="${REMCOCHAT_CONFIG_SEED_PATH:-/app/config.seed.toml}"

mkdir -p "$(dirname "$config_path")"

if [[ ! -f "$config_path" && -f "$seed_path" ]]; then
  cp "$seed_path" "$config_path"
fi

append_section_if_missing() {
  local section="$1" # e.g. "app.ov_nl"
  local section_re
  section_re="${section//./\\.}"

  [[ -f "$seed_path" ]] || return 0
  [[ -f "$config_path" ]] || return 0

  # Don't overwrite existing config. Only append missing sections from the seed.
  if grep -Eq "^[[:space:]]*\\[$section_re\\][[:space:]]*$" "$config_path"; then
    return 0
  fi
  if ! grep -Eq "^[[:space:]]*\\[$section_re\\][[:space:]]*$" "$seed_path"; then
    return 0
  fi

  {
    printf "\n\n"
    printf "# Added from config seed (%s) because this config was missing [%s].\n" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$section"
    awk -v re="^\\[$section_re\\][[:space:]]*$" '
      $0 ~ re {p=1}
      p {
        if (started && $0 ~ /^[[:space:]]*\\[/ && $0 !~ re) exit
        started=1
        print
      }
    ' "$seed_path"
  } >>"$config_path"
}

# Keep long-lived docker volume configs forward-compatible with new optional features.
append_section_if_missing "app.ov_nl"

exec "$@"
