#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE_DEFAULT="$ROOT_DIR/tmp/gh-auth.env"
ENV_FILE="${1:-$ENV_FILE_DEFAULT}"

log() {
  echo "[gh-auth-from-env] $*"
}

die() {
  echo "[gh-auth-from-env] error: $*" >&2
  exit 1
}

command -v gh >/dev/null 2>&1 || die "gh CLI is not installed"

if [[ ! -f "$ENV_FILE" ]]; then
  die "env file not found: $ENV_FILE"
fi

set -a
# shellcheck source=/dev/null
. "$ENV_FILE"
set +a

TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
[[ -n "$TOKEN" ]] || die "set GH_TOKEN (or GITHUB_TOKEN) in $ENV_FILE"

log "authenticating gh for github.com using token from $ENV_FILE"
printf '%s\n' "$TOKEN" | gh auth login --hostname github.com --with-token
gh auth status -h github.com

