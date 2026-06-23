#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DOCS_CHECK="true"
RUN_CHECK_FAST="true"

log() {
  echo "[setup-agent-env] $*"
}

die() {
  echo "[setup-agent-env] error: $*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Bootstraps this repository for agent runs in a clean environment.

Usage:
  bash scripts/setup-agent-env.sh [--skip-docs-check] [--skip-check-fast] [--help]

Options:
  --skip-docs-check  Skip `pnpm docs:check`.
  --skip-check-fast  Skip `pnpm check:fast`.
  --help             Show this help message.
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --skip-docs-check)
        RUN_DOCS_CHECK="false"
        shift
        ;;
      --skip-check-fast)
        RUN_CHECK_FAST="false"
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "unknown argument: $1"
        ;;
    esac
  done
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

load_nvm() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  [[ -s "$NVM_DIR/nvm.sh" ]] || die "nvm not found at $NVM_DIR/nvm.sh"
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
}

symlink_node_toolchain() {
  local node_bin_dir="$1"
  local user_bin_dir="$HOME/.local/bin"

  mkdir -p "$user_bin_dir"

  local tools=(node npm npx corepack pnpm pnpx)
  local tool=""
  for tool in "${tools[@]}"; do
    if [[ -x "$node_bin_dir/$tool" ]]; then
      ln -sf "$node_bin_dir/$tool" "$user_bin_dir/$tool"
    fi
  done
}

ensure_env_files() {
  local env_files=(".env")
  local target=""
  for target in "${env_files[@]}"; do
    if [[ -f "$target" ]]; then
      log "kept existing $target"
      continue
    fi

    local source_file="${target}.example"
    [[ -f "$source_file" ]] || die "missing template file: $source_file"
    cp "$source_file" "$target"
    log "created $target from $source_file"
  done
}

sanitize_frontend_dist() {
  local dist_dir="$ROOT_DIR/packages/batch-frontend/dist"
  if [[ ! -d "$dist_dir" ]]; then
    return
  fi

  if [[ ! -w "$dist_dir" ]] || find "$dist_dir" -mindepth 1 ! -writable -print -quit | grep -q .; then
    local backup_dir=""
    backup_dir="$HOME/tmp/esl-pipeline-batch-frontend-dist-backup-$(date +%Y%m%d%H%M%S)"
    mkdir -p "$(dirname "$backup_dir")"
    mv "$dist_dir" "$backup_dir"
    mkdir -p "$dist_dir"
    log "moved non-writable frontend dist to $backup_dir"
  fi
}

main() {
  parse_args "$@"
  cd "$ROOT_DIR"

  require_cmd bash
  require_cmd ffmpeg
  require_cmd git

  local node_version_raw=""
  node_version_raw="$(tr -d '[:space:]' < .nvmrc)"
  [[ -n "$node_version_raw" ]] || die ".nvmrc is empty"
  local node_version="${node_version_raw#v}"

  load_nvm
  nvm install "$node_version"
  nvm alias default "$node_version" >/dev/null
  nvm use "$node_version" >/dev/null

  local node_bin_dir="$NVM_DIR/versions/node/v${node_version}/bin"
  [[ -x "$node_bin_dir/node" ]] || die "expected node binary not found in $node_bin_dir"

  symlink_node_toolchain "$node_bin_dir"
  export PATH="$HOME/.local/bin:$PATH"
  hash -r

  local pnpm_version=""
  pnpm_version="$(node -p "const pm=require('./package.json').packageManager||''; const m=/^pnpm@([^+]+)/.exec(pm); if(!m){process.exit(1)}; m[1]")"
  [[ -n "$pnpm_version" ]] || die "failed to resolve pnpm version from package.json"

  corepack enable
  corepack prepare "pnpm@${pnpm_version}" --activate
  symlink_node_toolchain "$node_bin_dir"

  ensure_env_files
  sanitize_frontend_dist

  pnpm install

  if [[ "$RUN_DOCS_CHECK" == "true" ]]; then
    pnpm docs:check
  fi

  if [[ "$RUN_CHECK_FAST" == "true" ]]; then
    pnpm check:fast
  fi

  log "environment is ready"
  log "node: $(node -v) ($(command -v node))"
  log "npm: $(npm -v)"
  log "pnpm: $(pnpm -v) ($(command -v pnpm))"
  log "ffmpeg: $(ffmpeg -version | head -n 1)"
}

main "$@"
