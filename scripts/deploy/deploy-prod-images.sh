#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-${APP_DIR}/docker-compose.prod.yml}"
PROJECT_NAME="${PROJECT_NAME:-esl-pipeline-prod}"
DEPLOY_STATE_DIR="${DEPLOY_STATE_DIR:-/var/lib/esl-pipeline/deploy}"
ESL_IMAGE_PREFIX="${ESL_IMAGE_PREFIX:-ghcr.io/abocha/esl-pipeline}"
DEPLOY_MIN_FREE_MB="${DEPLOY_MIN_FREE_MB:-2048}"
DEPLOY_INCLUDE_EDGE="${DEPLOY_INCLUDE_EDGE:-true}"
DEPLOY_INCLUDE_OPS_BOT="${DEPLOY_INCLUDE_OPS_BOT:-false}"

SHA="${1:-}"
SHORT_SHA=""
PENDING_ENV=""
CURRENT_ENV="${DEPLOY_STATE_DIR}/current-images.env"
PREVIOUS_ENV="${DEPLOY_STATE_DIR}/previous-images.env"
KNOWN_GOOD_ENV="${DEPLOY_STATE_DIR}/known-good-images.env"
DEPLOY_LOG="${DEPLOY_STATE_DIR}/deployments.log"
LOCK_FILE="${DEPLOY_STATE_DIR}/deploy.lock"
UPDATED_SERVICES=false

usage() {
  cat <<'USAGE'
Usage:
  scripts/deploy/deploy-prod-images.sh <40-character-git-sha>

Environment:
  APP_DIR                 Defaults to repository root resolved from this script.
  COMPOSE_FILE            Defaults to $APP_DIR/docker-compose.prod.yml.
  DEPLOY_STATE_DIR        Defaults to /var/lib/esl-pipeline/deploy.
  ESL_IMAGE_PREFIX        Defaults to ghcr.io/abocha/esl-pipeline.
  DEPLOY_MIN_FREE_MB      Defaults to 2048.
  DEPLOY_INCLUDE_EDGE     Defaults to true.
  DEPLOY_INCLUDE_OPS_BOT  Defaults to false. Also enabled by COMPOSE_PROFILES=ops-bot.

The script deploys CI-built GHCR images tagged with the supplied Git SHA.
Application rollback and database restore are separate operations.
USAGE
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

info() {
  echo "INFO: $*"
}

bool_is_true() {
  case "${1:-}" in
    1 | true | TRUE | yes | YES | on | ON) return 0 ;;
    *) return 1 ;;
  esac
}

ops_bot_enabled() {
  if bool_is_true "$DEPLOY_INCLUDE_OPS_BOT"; then
    return 0
  fi
  [[ ",${COMPOSE_PROFILES:-}," == *",ops-bot,"* ]]
}

edge_enabled() {
  bool_is_true "$DEPLOY_INCLUDE_EDGE" || [[ ",${COMPOSE_PROFILES:-}," == *",edge,"* ]]
}

validate_edge_configuration() {
  if ! edge_enabled; then
    return 0
  fi

  local hostname="${CADDY_PUBLIC_HOSTNAME:-}"
  local email="${CADDY_ACME_EMAIL:-}"
  hostname="${hostname#"${hostname%%[![:space:]]*}"}"
  hostname="${hostname%"${hostname##*[![:space:]]}"}"
  email="${email#"${email%%[![:space:]]*}"}"
  email="${email%"${email##*[![:space:]]}"}"

  [[ -n "$hostname" ]] || die "CADDY_PUBLIC_HOSTNAME is required when the edge profile is enabled"
  [[ -n "$email" ]] || die "CADDY_ACME_EMAIL is required when the edge profile is enabled"
  [[ "$hostname" != "localhost" && "$hostname" != "127.0.0.1" ]] \
    || die "CADDY_PUBLIC_HOSTNAME must be a plain public DNS hostname"
  [[ "$hostname" == *.* && "$hostname" != *"/"* && "$hostname" != *":"* ]] \
    || die "CADDY_PUBLIC_HOSTNAME must be a plain public DNS hostname"
  [[ "$hostname" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] \
    || die "CADDY_PUBLIC_HOSTNAME must be a plain public DNS hostname"
  [[ "$email" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] \
    || die "CADDY_ACME_EMAIL must be a valid email address"
}

handle_failure() {
  local line="$1"
  echo "ERROR: deployment failed near line ${line}." >&2
  if [[ "$UPDATED_SERVICES" == "true" && -f "$PREVIOUS_ENV" ]]; then
    cat >&2 <<EOF

Application rollback instructions:
  docker compose -p ${PROJECT_NAME} -f "${COMPOSE_FILE}" --env-file "${PREVIOUS_ENV}" up -d --no-build

Rollback warning:
  This only rolls application images back. It does not restore PostgreSQL.
  Application rollback is safe only when the migrated schema remains compatible with the previous image.
  Restore the database only as a separate, deliberate recovery step from a verified backup.
EOF
  elif [[ "$UPDATED_SERVICES" == "true" ]]; then
    cat >&2 <<EOF

No previous application image state file exists at:
  ${PREVIOUS_ENV}

Database restore is not automatic. Use verified backups only after deciding that schema rollback is required.
EOF
  fi
}

trap 'handle_failure "$LINENO"' ERR

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

compose_args() {
  local -n target_ref="$1"
  target_ref=(docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE")
  if edge_enabled; then
    target_ref+=(--profile edge)
  fi
  if ops_bot_enabled; then
    target_ref+=(--profile ops-bot)
  fi
}

compose_with_env() {
  local env_file="$1"
  shift
  local compose_cmd=()
  compose_args compose_cmd
  "${compose_cmd[@]}" --env-file "$env_file" "$@"
}

validate_sha() {
  [[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || die "deployment requires a full lowercase 40-character Git SHA"
  SHORT_SHA="${SHA:0:12}"
}

ensure_state_dir() {
  install -d -m 0750 "$DEPLOY_STATE_DIR"
  install -d -m 0750 "${DEPLOY_STATE_DIR}/backups/postgres"
  touch "$DEPLOY_LOG"
  chmod 0640 "$DEPLOY_LOG"
}

validate_state_file() {
  local file="$1"
  [[ -f "$file" ]] || return 0

  local line key
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" ]] && continue
    [[ "$line" == \#* ]] && continue
    key="${line%%=*}"
    case "$key" in
      BATCH_BACKEND_IMAGE | BATCH_FRONTEND_IMAGE | TELEGRAM_OPS_BOT_IMAGE | BATCH_BACKEND_DIGEST | BATCH_FRONTEND_DIGEST | TELEGRAM_OPS_BOT_DIGEST) ;;
      *) die "state file ${file} contains non-image key: ${key}" ;;
    esac
  done <"$file"
}

check_disk_free() {
  local label="$1"
  local target="$2"
  local available_mb
  available_mb="$(df -Pm "$target" | awk 'NR == 2 { print $4 }')"
  [[ -n "$available_mb" ]] || die "could not determine free disk space for ${target}"
  if (( available_mb < DEPLOY_MIN_FREE_MB )); then
    die "${label} has ${available_mb} MB free; required at least ${DEPLOY_MIN_FREE_MB} MB"
  fi
  info "${label} has ${available_mb} MB free"
}

image_ref() {
  local name="$1"
  printf '%s/%s:%s' "$ESL_IMAGE_PREFIX" "$name" "$SHA"
}

pull_image() {
  local image="$1"
  info "Pulling ${image}"
  docker pull "$image"
}

image_digest() {
  local image="$1"
  local digest
  digest="$(docker image inspect --format '{{index .RepoDigests 0}}' "$image" 2>/dev/null || true)"
  if [[ -z "$digest" || "$digest" == "<no value>" ]]; then
    digest="$(docker image inspect --format '{{.Id}}' "$image")"
  fi
  printf '%s' "$digest"
}

write_pending_env() {
  local backend_image="$1"
  local frontend_image="$2"
  local bot_image="$3"
  local backend_digest="$4"
  local frontend_digest="$5"
  local bot_digest="$6"

  PENDING_ENV="${DEPLOY_STATE_DIR}/pending-${SHA}.env"
  umask 0077
  {
    printf 'BATCH_BACKEND_IMAGE=%s\n' "$backend_image"
    printf 'BATCH_FRONTEND_IMAGE=%s\n' "$frontend_image"
    printf 'BATCH_BACKEND_DIGEST=%s\n' "$backend_digest"
    printf 'BATCH_FRONTEND_DIGEST=%s\n' "$frontend_digest"
    if ops_bot_enabled; then
      printf 'TELEGRAM_OPS_BOT_IMAGE=%s\n' "$bot_image"
      printf 'TELEGRAM_OPS_BOT_DIGEST=%s\n' "$bot_digest"
    fi
  } >"$PENDING_ENV"
  chmod 0640 "$PENDING_ENV"
  validate_state_file "$PENDING_ENV"
}

postgres_container_id() {
  compose_with_env "$PENDING_ENV" ps -q postgres | head -n 1
}

require_postgres_healthy() {
  local container_id health running
  container_id="$(postgres_container_id)"
  [[ -n "$container_id" ]] || die "postgres container was not found for project ${PROJECT_NAME}"
  running="$(docker inspect -f '{{.State.Running}}' "$container_id")"
  [[ "$running" == "true" ]] || die "postgres container is not running"
  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id")"
  [[ "$health" == "healthy" ]] || die "postgres container health is ${health}, expected healthy"
}

latest_dump_after() {
  local start_epoch="$1"
  find "${DEPLOY_STATE_DIR}/backups/postgres" -type f -name '*.dump' -printf '%T@ %p\n' \
    | awk -v start="$start_epoch" '$1 >= start { print $0 }' \
    | sort -nr \
    | head -n 1 \
    | cut -d' ' -f2-
}

verify_backup_artifacts() {
  local dump_file="$1"
  [[ -n "$dump_file" ]] || die "backup command succeeded but no new .dump file was found"
  [[ -s "$dump_file" ]] || die "backup dump is missing or empty: ${dump_file}"

  local prefix plain_gz schema_sql checksum_file
  prefix="${dump_file%.dump}"
  plain_gz="${prefix}.sql.gz"
  schema_sql="${prefix}_schema.sql"
  checksum_file="${prefix}.sha256"

  [[ -s "$plain_gz" ]] || die "backup plain SQL artifact is missing or empty: ${plain_gz}"
  [[ -s "$schema_sql" ]] || die "backup schema artifact is missing or empty: ${schema_sql}"
  [[ -s "$checksum_file" ]] || die "backup checksum artifact is missing or empty: ${checksum_file}"

  (cd "$(dirname "$checksum_file")" && sha256sum -c "$(basename "$checksum_file")")

  PG_COMPOSE_PROJECT="$PROJECT_NAME" \
    PG_COMPOSE_FILE="$COMPOSE_FILE" \
    PG_BACKUP_DIR="${DEPLOY_STATE_DIR}/backups/postgres" \
    bash "${APP_DIR}/scripts/docker/postgres-backup-restore.sh" verify "$dump_file" >/dev/null
}

create_pre_migration_backup() {
  local backup_start dump_file
  backup_start="$(date +%s)"
  info "Creating pre-migration PostgreSQL backup"
  PG_COMPOSE_PROJECT="$PROJECT_NAME" \
    PG_COMPOSE_FILE="$COMPOSE_FILE" \
    PG_BACKUP_DIR="${DEPLOY_STATE_DIR}/backups/postgres" \
    bash "${APP_DIR}/scripts/docker/postgres-prod-backup-s3.sh" backup-upload "pre_deploy_${SHORT_SHA}"
  dump_file="$(latest_dump_after "$backup_start")"
  verify_backup_artifacts "$dump_file"
  info "Verified pre-migration backup: ${dump_file}"
}

run_migrations_once() {
  info "Running database migrations once with requested backend image"
  compose_with_env "$PENDING_ENV" run --rm --no-deps batch-backend node dist/tools/migrate-db.js migrate
}

run_in_backend() {
  compose_with_env "$PENDING_ENV" exec -T batch-backend "$@"
}

retry_curl() {
  local url="$1"
  local attempts="${2:-30}"
  local delay_seconds="${3:-2}"
  local index
  for ((index = 1; index <= attempts; index += 1)); do
    if curl -fsS "$url" >/dev/null; then
      return 0
    fi
    sleep "$delay_seconds"
  done
  curl -fsS "$url" >/dev/null
}

assert_service_command() {
  local service="$1"
  local expected="$2"
  local container_id command
  container_id="$(compose_with_env "$PENDING_ENV" ps -q "$service" | head -n 1)"
  [[ -n "$container_id" ]] || die "${service} container was not found"
  command="$(docker inspect -f '{{range .Config.Cmd}}{{.}} {{end}}' "$container_id")"
  [[ "$command" == *"$expected"* ]] || die "${service} command '${command}' did not include '${expected}'"
  local running
  running="$(docker inspect -f '{{.State.Running}}' "$container_id")"
  [[ "$running" == "true" ]] || die "${service} is not running"
}

assert_recent_logs_clean() {
  local service="$1"
  local logs
  logs="$(compose_with_env "$PENDING_ENV" logs --tail=80 "$service" 2>&1 || true)"
  if printf '%s\n' "$logs" | grep -Eiq 'fatal|uncaught|unhandled|exited|cannot find module'; then
    printf '%s\n' "$logs" >&2
    die "${service} recent logs contain startup failure markers"
  fi
}

recreate_edge_service() {
  if ! edge_enabled; then
    return 0
  fi

  info "Force-recreating caddy-edge to refresh mounted edge configuration"
  compose_with_env "$PENDING_ENV" up -d --no-build --force-recreate caddy-edge
}

assert_caddy_upstream_config() {
  if ! edge_enabled; then
    return 0
  fi

  local config
  config="$(compose_with_env "$PENDING_ENV" exec -T caddy-edge cat /etc/caddy/Caddyfile 2>/dev/null || true)"
  if ! printf '%s\n' "$config" | grep -Fq 'reverse_proxy batch-frontend:8080'; then
    printf '%s\n' "$config" >&2
    die "caddy-edge Caddyfile does not contain reverse_proxy batch-frontend:8080"
  fi
}

run_smoke_checks() {
  local backend_port="${BATCH_BACKEND_HOST_PORT:-8080}"
  local frontend_port="${BATCH_FRONTEND_HOST_PORT:-5173}"

  info "Running bounded health and smoke checks"
  retry_curl "http://127.0.0.1:${backend_port}/health"
  retry_curl "http://127.0.0.1:${frontend_port}/api/health"

  if edge_enabled && [[ -n "${CADDY_PUBLIC_HOSTNAME:-}" ]]; then
    retry_curl "https://${CADDY_PUBLIC_HOSTNAME}/api/health" 20 3
    assert_caddy_upstream_config
  fi

  run_in_backend node dist/tools/migrate-db.js verify
  run_in_backend node dist/tools/smoke-s3-storage.js

  assert_service_command batch-worker 'dist/transport/worker-runner.js'
  assert_service_command transcribe-worker 'dist/transport/transcribe-worker.js'
  assert_recent_logs_clean batch-worker
  assert_recent_logs_clean transcribe-worker
}

append_deploy_log() {
  local status="$1"
  {
    printf 'time=%s status=%s sha=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$status" "$SHA"
    sed 's/^/  /' "$PENDING_ENV"
  } >>"$DEPLOY_LOG"
  chmod 0640 "$DEPLOY_LOG"
}

copy_state_file() {
  local source="$1"
  local target="$2"
  cp "$source" "$target"
  chmod 0640 "$target"
  validate_state_file "$target"
}

image_is_retained() {
  local image="$1"
  local state_file
  for state_file in "$CURRENT_ENV" "$PREVIOUS_ENV" "$KNOWN_GOOD_ENV"; do
    [[ -f "$state_file" ]] || continue
    if grep -Fxq "${image}" <(sed -n 's/^[A-Z_]*IMAGE=//p' "$state_file"); then
      return 0
    fi
  done
  return 1
}

remove_old_custom_images() {
  local repo image tag
  for repo in batch-backend batch-frontend telegram-ops-bot; do
    docker image ls --format '{{.Repository}}:{{.Tag}}' "${ESL_IMAGE_PREFIX}/${repo}" \
      | while IFS= read -r image; do
          tag="${image##*:}"
          [[ "$tag" =~ ^[0-9a-f]{40}$ ]] || continue
          if image_is_retained "$image"; then
            continue
          fi
          info "Removing old custom image ${image}"
          docker image rm "$image" >/dev/null || true
        done
  done
}

main() {
  if [[ "$SHA" == "-h" || "$SHA" == "--help" ]]; then
    usage
    return 0
  fi

  validate_sha
  require_command docker
  require_command curl
  require_command awk
  require_command sha256sum
  require_command find
  require_command flock
  require_command aws

  [[ -f "$COMPOSE_FILE" ]] || die "compose file not found: ${COMPOSE_FILE}"
  [[ -f "${APP_DIR}/.env.batch-backend" ]] || die "missing required env file: ${APP_DIR}/.env.batch-backend"
  validate_edge_configuration

  ensure_state_dir
  validate_state_file "$CURRENT_ENV"
  validate_state_file "$PREVIOUS_ENV"
  validate_state_file "$KNOWN_GOOD_ENV"

  exec 9>"$LOCK_FILE"
  chmod 0640 "$LOCK_FILE"
  flock -n 9 || die "another deployment is already running"

  docker info >/dev/null
  check_disk_free "Application checkout filesystem" "$APP_DIR"
  local docker_root
  docker_root="$(docker info --format '{{.DockerRootDir}}')"
  check_disk_free "Docker data filesystem" "$docker_root"

  local backend_image frontend_image bot_image backend_digest frontend_digest bot_digest
  backend_image="$(image_ref batch-backend)"
  frontend_image="$(image_ref batch-frontend)"
  bot_image="$(image_ref telegram-ops-bot)"

  pull_image "$backend_image"
  pull_image "$frontend_image"
  if ops_bot_enabled; then
    pull_image "$bot_image"
    bot_digest="$(image_digest "$bot_image")"
  else
    bot_digest=""
  fi

  backend_digest="$(image_digest "$backend_image")"
  frontend_digest="$(image_digest "$frontend_image")"
  write_pending_env "$backend_image" "$frontend_image" "$bot_image" "$backend_digest" "$frontend_digest" "$bot_digest"

  compose_with_env "$PENDING_ENV" config --quiet
  require_postgres_healthy
  create_pre_migration_backup
  run_migrations_once

  if [[ -f "$CURRENT_ENV" ]]; then
    copy_state_file "$CURRENT_ENV" "$PREVIOUS_ENV"
  fi

  UPDATED_SERVICES=true
  compose_with_env "$PENDING_ENV" up -d --no-build
  recreate_edge_service
  run_smoke_checks

  copy_state_file "$PENDING_ENV" "$CURRENT_ENV"
  append_deploy_log success
  remove_old_custom_images
  info "Deployment completed for ${SHA}"
}

main "$@"
