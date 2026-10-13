#!/usr/bin/env bash

# Shared helpers for host-owned PostgreSQL backup operations. This file is sourced by scripts; it
# intentionally does not enable shell options or execute work on its own.

pg_backup_default_host_state_dir() {
  local state_home="${XDG_STATE_HOME:-}"
  if [[ -z "$state_home" ]]; then
    if [[ -z "${HOME:-}" ]]; then
      echo "ERROR: set PG_BACKUP_HOST_STATE_DIR (HOME and XDG_STATE_HOME are unavailable)." >&2
      return 1
    fi
    state_home="${HOME}/.local/state"
  fi
  printf '%s/esl-pipeline/ops' "${state_home%/}"
}

pg_backup_resolve_host_state_dir() {
  local state_dir="${PG_BACKUP_HOST_STATE_DIR:-}"
  if [[ -z "$state_dir" ]]; then
    state_dir="$(pg_backup_default_host_state_dir)"
  fi
  if [[ "$state_dir" != /* ]]; then
    echo "ERROR: PG_BACKUP_HOST_STATE_DIR must be an absolute host path: $state_dir" >&2
    return 1
  fi
  if [[ "${ROOT_DIR:-}" == /opt/esl-pipeline || "${PG_COMPOSE_PROJECT:-}" == esl-pipeline-prod ]]; then
    node "${ROOT_DIR}/scripts/deploy/production-paths.mjs" ops-state "${state_dir%/}" || return 1
  fi
  printf '%s' "${state_dir%/}"
}

pg_backup_set_production_defaults() {
  local root_dir="$1"
  export PG_COMPOSE_PROJECT="${PG_COMPOSE_PROJECT:-esl-pipeline-prod}"
  export PG_BACKUP_ENV_FILE="${PG_BACKUP_ENV_FILE:-/etc/esl-pipeline/production.env}"
  export PG_COMPOSE_FILE="${PG_COMPOSE_FILE:-${root_dir}/docker-compose.prod.yml}"
  export PG_CONTAINER_NAME="${PG_CONTAINER_NAME:-${PG_COMPOSE_PROJECT}-postgres-1}"
  export PG_BACKUP_HOST_STATE_DIR="${PG_BACKUP_HOST_STATE_DIR:-/var/lib/esl-pipeline/ops}"
  export PG_BACKUP_S3_ENV="${PG_BACKUP_S3_ENV:-prod}"
}

pg_backup_aws_cmd() {
  local region="$1"
  local profile="$2"
  shift 2

  local args=(--region "$region")
  if [[ -n "$profile" ]]; then
    args+=(--profile "$profile")
  fi
  aws "${args[@]}" "$@"
}

pg_backup_latest_remote_dump() {
  local bucket="$1"
  local prefix="$2"
  local region="$3"
  local profile="$4"

  # S3 returns Contents=null for an empty prefix. Coalescing it to [] keeps a mistargeted or empty
  # namespace a normal "not found" result rather than a JMESPath type error.
  # JMESPath backticks are literal syntax, not shell command substitution.
  # shellcheck disable=SC2016
  pg_backup_aws_cmd "$region" "$profile" s3api list-objects-v2 \
    --bucket "$bucket" \
    --prefix "$prefix" \
    --query 'sort_by((Contents || `[]`)[?ends_with(Key, `.dump`)], &LastModified)[-1].[Key,LastModified]' \
    --output text
}

# Development keeps repo-local .env. Production wrappers/systemd use one protected file.
pg_backup_select_env_file() {
  local root_dir="$1" env_file="$2"
  if [[ "$root_dir" == /opt/esl-pipeline || "${PG_COMPOSE_PROJECT:-}" == esl-pipeline-prod || "${PG_COMPOSE_FILE:-}" == */docker-compose.prod.yml ]]; then
    env_file="${PG_BACKUP_ENV_FILE:-/etc/esl-pipeline/production.env}"
    node "$root_dir/scripts/deploy/production-paths.mjs" env "$root_dir" "$env_file" || return 1
  fi
  printf '%s' "$env_file"
}
