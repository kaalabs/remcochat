#!/usr/bin/env bash
set -euo pipefail

config_path="${REMCOCHAT_CONFIG_PATH:-/app/config.toml}"
seed_path="${REMCOCHAT_CONFIG_SEED_PATH:-/app/config.seed.toml}"

mkdir -p "$(dirname "$config_path")"

if [[ ! -f "$config_path" && -f "$seed_path" ]]; then
  cp "$seed_path" "$config_path"
fi

has_section_header() {
  local file="$1"
  local header="$2"
  awk -v header="$header" '
    {
      line=$0
      sub(/^[[:space:]]+/, "", line)
      sub(/[[:space:]]+$/, "", line)
      if (line == header) { found=1; exit }
    }
    END { exit(found ? 0 : 1) }
  ' "$file"
}

append_section_if_missing() {
  local section="$1" # e.g. "app.ov_nl"
  local header="[$section]"

  [[ -f "$seed_path" ]] || return 0
  [[ -f "$config_path" ]] || return 0

  # Don't overwrite existing config. Only append missing sections from the seed.
  if has_section_header "$config_path" "$header"; then
    return 0
  fi
  if ! has_section_header "$seed_path" "$header"; then
    return 0
  fi

  {
    printf "\n\n"
    printf "# Added from config seed (%s) because this config was missing section %s.\n" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" "$header"
    awk -v header="$header" '
      {
        line=$0
        sub(/^[[:space:]]+/, "", line)
        sub(/[[:space:]]+$/, "", line)
        if (line == header) p=1
        if (p) {
          if (started && substr(line, 1, 1) == "[" && line != header) exit
          started=1
          print
        }
      }
    ' "$seed_path"
  } >>"$config_path"
}

# Keep long-lived docker volume configs forward-compatible with new optional features.
append_section_if_missing "app.ov_nl"

exec "$@"
