#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EXPECTED_OWNER="$(id -u):$(id -g)"
REQUIRED_DIRS=(
  "uploads"
  "uploads/drafts"
  ".pnpm-store"
)

stat_owner() {
  local target="$1"
  if stat -c '%u:%g' "$target" >/dev/null 2>&1; then
    stat -c '%u:%g' "$target"
    return
  fi
  stat -f '%u:%g' "$target"
}

echo "Preparing Docker host paths..."

for rel in "${REQUIRED_DIRS[@]}"; do
  abs="${ROOT_DIR}/${rel}"
  mkdir -p "$abs"

  if [[ ! -d "$abs" ]]; then
    echo "ERROR: expected directory was not created: $rel"
    exit 1
  fi

  if [[ ! -w "$abs" ]]; then
    echo "ERROR: directory is not writable: $rel"
    echo "Fix with:"
    echo "  sudo chown -R $(id -un):$(id -gn) \"$abs\""
    exit 1
  fi

  owner="$(stat_owner "$abs")"
  if [[ "$owner" != "$EXPECTED_OWNER" ]]; then
    echo "WARN: $rel is owned by $owner (expected $EXPECTED_OWNER)"
  fi
done

echo "Docker host paths are ready."
