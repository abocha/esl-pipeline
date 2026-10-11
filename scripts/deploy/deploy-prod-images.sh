#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${APP_DIR}/scripts/deploy/deploy-prod-images-plan.sh"
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
QUIESCED=false
MIGRATION_STARTED=false
IMAGE_ROLLBACK_SAFE=false
COMPATIBILITY_PLAN="${DEPLOY_STATE_DIR}/rollback-compatibility.json"
PLAN_ONLY=false
[[ "${2:-}" == "--plan" ]] && PLAN_ONLY=true

usage() {
  cat <<'USAGE'
Usage:
  scripts/deploy/deploy-prod-images.sh <40-character-git-sha> [--plan]

Environment:
  APP_DIR                 Defaults to repository root resolved from this script.
  COMPOSE_FILE            Defaults to $APP_DIR/docker-compose.prod.yml.
  DEPLOY_STATE_DIR        Defaults to /var/lib/esl-pipeline/deploy.
  ESL_IMAGE_PREFIX        Defaults to ghcr.io/abocha/esl-pipeline.
  DEPLOY_MIN_FREE_MB      Defaults to 2048.
  DEPLOY_INCLUDE_EDGE     Defaults to true.
  DEPLOY_INCLUDE_OPS_BOT  Defaults to false. Also enabled by COMPOSE_PROFILES=ops-bot.

The script deploys a complete CI-published GHCR release bundle tagged with the supplied Git SHA.
Unchanged image digests are aliased locally; database and restart work follows the computed plan.
Application rollback and database restore are separate operations.
--plan resolves images and reads schema state, but does not back up, migrate, or stop/recreate services.
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

trim_whitespace() {
  local value="${1:-}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

strip_optional_env_quotes() {
  local value="$1"
  if [[ "${#value}" -ge 2 && "$value" == \"*\" && "$value" == *\" ]]; then
    value="${value:1:${#value}-2}"
  elif [[ "${#value}" -ge 2 && "$value" == \'*\' && "$value" == *\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

read_env_file_value() {
  local env_file="$1"
  local key="$2"
  local line value

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="$(trim_whitespace "$line")"
    [[ -z "$line" ]] && continue
    [[ "$line" == \#* ]] && continue
    if [[ "$line" == export[[:space:]]* ]]; then
      line="${line#export}"
      line="$(trim_whitespace "$line")"
    fi
    [[ "$line" == "${key}="* ]] || continue

    value="${line#*=}"
    value="$(trim_whitespace "$value")"
    strip_optional_env_quotes "$value"
    return 0
  done <"$env_file"

  return 1
}

load_edge_env_from_application_env_file() {
  if ! edge_enabled; then
    return 0
  fi

  local env_file="${APP_DIR}/.env"
  local value

  if [[ -n "${CADDY_PUBLIC_HOSTNAME:-}" ]]; then
    :
  elif value="$(read_env_file_value "$env_file" CADDY_PUBLIC_HOSTNAME)"; then
    export CADDY_PUBLIC_HOSTNAME="$value"
  fi

  if [[ -n "${CADDY_ACME_EMAIL:-}" ]]; then
    :
  elif value="$(read_env_file_value "$env_file" CADDY_ACME_EMAIL)"; then
    export CADDY_ACME_EMAIL="$value"
  fi

  # Explicit empty shell values can clear a transition saved in .env.
  if [[ ! -v CADDY_TRANSITION_HOSTNAME ]]; then
    value="$(read_env_file_value "$env_file" CADDY_TRANSITION_HOSTNAME || true)"
    export CADDY_TRANSITION_HOSTNAME="$value"
  fi
  if [[ ! -v CADDY_TRANSITION_MODE ]]; then
    value="$(read_env_file_value "$env_file" CADDY_TRANSITION_MODE || true)"
    export CADDY_TRANSITION_MODE="${value:-disabled}"
  fi
}

validate_edge_configuration() {
  if ! edge_enabled; then
    return 0
  fi

  node "${APP_DIR}/scripts/docker/validate-edge-env.mjs" || die "invalid Caddy edge configuration"
}

handle_failure() {
  local line="$1"
  echo "ERROR: deployment failed near line ${line}." >&2
  if [[ "$MIGRATION_STARTED" == "true" && "$IMAGE_ROLLBACK_SAFE" != "true" ]]; then
    cat >&2 <<EOF

Image-only rollback to the previous runtime is BLOCKED.
  An incompatible or unclassified schema boundary may have committed, even if migration failed.
  Keep old application writers stopped. Recover with a schema-compatible image, or deliberately
  restore a verified backup from BEFORE the blocked boundary that supports the previous runtime.
  A backup taken during a later deploy retry may already contain the incompatible schema.
  Database restore remains a separate operator-controlled operation; it is never automatic.
  Compatibility record: ${COMPATIBILITY_PLAN}
EOF
  elif [[ "$QUIESCED" == "true" && "$MIGRATION_STARTED" != "true" ]]; then
    echo 'Application containers may be stopped; migrations were not invoked. No automatic restart was attempted.' >&2
  elif [[ "$UPDATED_SERVICES" == "true" && "$IMAGE_ROLLBACK_SAFE" == "true" && -f "$PREVIOUS_ENV" ]]; then
    cat >&2 <<EOF

Application rollback instructions:
  docker compose -p ${PROJECT_NAME} -f "${COMPOSE_FILE}" --env-file "${PREVIOUS_ENV}" up -d --no-build

Rollback warning:
  This only rolls application images back. It does not restore PostgreSQL.
  The compatibility preflight permits this previous runtime on the planned schema.
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

FAILURE_LINE=unknown
trap 'FAILURE_LINE=$LINENO' ERR
trap 'status=$?; if (( status != 0 )); then handle_failure "$FAILURE_LINE"; fi' EXIT

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
      BATCH_BACKEND_IMAGE | BATCH_FRONTEND_IMAGE | TELEGRAM_OPS_BOT_IMAGE | BATCH_BACKEND_DIGEST | BATCH_FRONTEND_DIGEST | TELEGRAM_OPS_BOT_DIGEST | CADDY_CONFIG_DIGEST | APPLICATION_CONFIG_DIGEST) ;;
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

image_digest() {
  local image="$1"
  local digest
  digest="$(docker image inspect --format '{{index .RepoDigests 0}}' "$image" 2>/dev/null || true)"
  if [[ -z "$digest" || "$digest" == "<no value>" ]]; then
    digest="$(docker image inspect --format '{{.Id}}' "$image")"
  fi
  printf '%s' "$digest"
}

remote_image_digest() {
  local image="$1"
  local descriptor digest repository
  descriptor="$(docker buildx imagetools inspect "$image" --format '{{json .Manifest}}' 2>/dev/null || true)"
  if [[ "$descriptor" =~ \"digest\"[[:space:]]*:[[:space:]]*\"(sha256:[0-9a-f]+)\" ]]; then
    digest="${BASH_REMATCH[1]}"
  else
    return 1
  fi
  repository="${image%:*}"
  printf '%s@%s' "$repository" "$digest"
}

PREPARED_IMAGE_DIGEST=""
prepare_image() {
  local requested_image="$1"
  local current_image="$2"
  local current_digest="$3"
  local requested_digest

  requested_digest="$(remote_image_digest "$requested_image" || true)"
  if [[ -n "$requested_digest" \
    && "$requested_digest" == "$current_digest" \
    && -n "$current_image" ]] \
    && docker image inspect "$current_image" >/dev/null 2>&1; then
    if [[ "$current_image" != "$requested_image" ]]; then
      info "Aliasing unchanged image ${current_image} as ${requested_image}"
      docker image tag "$current_image" "$requested_image"
    else
      info "Requested image is already available locally: ${requested_image}"
    fi
    PREPARED_IMAGE_DIGEST="$requested_digest"
    return 0
  fi

  info "Pulling ${requested_image}"
  docker pull "$requested_image"
  PREPARED_IMAGE_DIGEST="${requested_digest:-$(image_digest "$requested_image")}"
}

state_value() {
  local key="$1"
  if [[ -f "$CURRENT_ENV" ]]; then
    read_env_file_value "$CURRENT_ENV" "$key" || true
  fi
}

caddy_config_digest() {
  local caddyfile="${APP_DIR}/deploy/caddy/Caddyfile"
  [[ -f "$caddyfile" ]] || die "Caddyfile not found: ${caddyfile}"
  # Include effective interpolation values, including shell overrides.
  printf 'sha256:%s' "$(
    { cat "$caddyfile"; printf '\0%s\0%s\0%s\0%s' \
        "${CADDY_PUBLIC_HOSTNAME:-}" "${CADDY_ACME_EMAIL:-}" \
        "${CADDY_TRANSITION_HOSTNAME:-}" "${CADDY_TRANSITION_MODE:-disabled}"; } \
      | sha256sum | awk '{ print $1 }'
  )"
}

application_config_digest() {
  # Store only a digest, never environment contents or secrets, in deployment state.
  printf 'sha256:%s' "$(
    sha256sum "${APP_DIR}/.env" "$COMPOSE_FILE" | awk '{ print $1 }' | sha256sum | awk '{ print $1 }'
  )"
}

write_pending_env() {
  local backend_image="$1"
  local frontend_image="$2"
  local bot_image="$3"
  local backend_digest="$4"
  local frontend_digest="$5"
  local bot_digest="$6"
  local caddy_digest="$7"
  local application_digest="$8"

  PENDING_ENV="${DEPLOY_STATE_DIR}/pending-${SHA}.env"
  umask 0077
  {
    printf 'BATCH_BACKEND_IMAGE=%s\n' "$backend_image"
    printf 'BATCH_FRONTEND_IMAGE=%s\n' "$frontend_image"
    printf 'BATCH_BACKEND_DIGEST=%s\n' "$backend_digest"
    printf 'BATCH_FRONTEND_DIGEST=%s\n' "$frontend_digest"
    printf 'CADDY_CONFIG_DIGEST=%s\n' "$caddy_digest"
    printf 'APPLICATION_CONFIG_DIGEST=%s\n' "$application_digest"
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

read_schema_compatibility_plan() {
  local requested_inventory="${DEPLOY_STATE_DIR}/requested-migrations.json"
  local previous_inventory="${DEPLOY_STATE_DIR}/previous-migrations.json"
  local applied_ledger="${DEPLOY_STATE_DIR}/applied-migrations.json"
  local previous_arg=-
  local helper="${APP_DIR}/scripts/deploy/schema-compatibility.mjs"
  # Read image contents without booting application code, loading secrets, or joining a network.
  docker run --rm -i --network none --read-only --entrypoint node "$backend_image" \
    --input-type=module - inventory /app/migrations <"$helper" >"$requested_inventory"
  if [[ -n "$current_backend_image" ]]; then
    docker run --rm -i --network none --read-only --entrypoint node "$current_backend_image" \
      --input-type=module - inventory /app/migrations <"$helper" >"$previous_inventory"
    previous_arg="$previous_inventory"
  fi
  # Unlike the application's status command, this never creates schema_migrations.
  # Expand PostgreSQL credentials inside the container rather than on the host.
  # shellcheck disable=SC2016
  compose_with_env "$PENDING_ENV" exec -T postgres sh -ec '
    table="$(psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "SELECT to_regclass('\''public.schema_migrations'\'')")"
    if [ -n "$table" ]; then
      psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc \
        "SELECT COALESCE(json_agg(row_to_json(m)), '\''[]'\''::json) FROM (SELECT id, checksum FROM public.schema_migrations ORDER BY id) m"
    else
      echo "[]"
    fi
  ' >"$applied_ledger"
  node "$helper" plan "$requested_inventory" "$applied_ledger" "$previous_arg" \
    "${DEPLOY_STATE_DIR}/pending-compatibility.json" "$SHA" "$backend_image" "$current_backend_image"
  IMAGE_ROLLBACK_SAFE="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1])).imageRollbackSafe' "${DEPLOY_STATE_DIR}/pending-compatibility.json")"
  SCHEMA_QUIESCE_REQUIRED="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1])).quiesce' "${DEPLOY_STATE_DIR}/pending-compatibility.json")"
}

running_application_containers() {
  local ids id service
  # Explicit propagation is necessary: Bash clears errexit inside command substitutions.
  ids="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT_NAME}")" || return 1
  for id in $ids; do
    service="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "$id")" || return 1
    case "$service" in
      postgres | redis | caddy-edge) ;;
      batch-backend | batch-worker | transcribe-worker | student-memory-worker | batch-frontend | telegram-ops-bot)
        printf '%s\n' "$id" ;;
      *) die "unknown live Compose service ${service}; cannot establish writer quiescence" ;;
    esac
  done
}

quiesce_application() {
  local ids remaining
  ids="$(running_application_containers)"
  info "Quiescing application containers before incompatible schema work"
  QUIESCED=true
  # Include live profile services regardless of selected profiles. Leave DB/Redis/edge running.
  if [[ -n "$ids" ]]; then
    local -a containers
    mapfile -t containers <<<"$ids"
    docker stop --time 30 "${containers[@]}"
  fi
  remaining="$(running_application_containers)"
  [[ -z "$remaining" ]] || die "application containers remain running; refusing incompatible migration"
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
  if ! edge_enabled || [[ "$EDGE_RESTART_REQUIRED" != "true" ]]; then
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

  if [[ "$DATABASE_WORK_REQUIRED" == "true" ]]; then
    run_in_backend node dist/tools/migrate-db.js verify
    run_in_backend node dist/tools/smoke-s3-storage.js
  fi

  assert_service_command batch-worker 'dist/transport/worker-runner.js'
  assert_service_command transcribe-worker 'dist/transport/transcribe-worker.js'
  assert_service_command student-memory-worker 'dist/transport/student-memory-worker.js'
  local -a worker_ids
  mapfile -t worker_ids < <(compose_with_env "$PENDING_ENV" ps -q batch-worker transcribe-worker student-memory-worker)
  [[ "${#worker_ids[@]}" -eq 3 ]] || die "Expected three current worker instances"
  node "${APP_DIR}/scripts/deploy/verify-workers-ready.mjs" "${worker_ids[@]}" || die "Worker readiness verification failed"
  assert_recent_logs_clean batch-worker
  assert_recent_logs_clean transcribe-worker
  assert_recent_logs_clean student-memory-worker
}

print_deployment_plan() {
  info "Deployment plan: backend_changed=${BACKEND_CHANGED} frontend_changed=${FRONTEND_CHANGED} bot_changed=${BOT_CHANGED} caddy_changed=${CADDY_CONFIG_CHANGED} application_config_changed=${APPLICATION_CONFIG_CHANGED}"
  info "Deployment plan: initial=${INITIAL_DEPLOY} database_work=${DATABASE_WORK_REQUIRED} edge_restart=${EDGE_RESTART_REQUIRED} services=${DEPLOYMENT_SERVICES[*]:-none}"
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

  [[ "$#" -eq 1 || ( "$#" -eq 2 && "${2:-}" == "--plan" ) ]] || die "expected a Git SHA and optional --plan"

  validate_sha
  require_command docker
  require_command curl
  require_command awk
  require_command sha256sum
  require_command find
  require_command flock
  require_command node

  [[ -f "$COMPOSE_FILE" ]] || die "compose file not found: ${COMPOSE_FILE}"
  [[ -f "${APP_DIR}/.env" ]] || die "missing required env file: ${APP_DIR}/.env"
  load_edge_env_from_application_env_file
  validate_edge_configuration

  ensure_state_dir
  validate_state_file "$CURRENT_ENV"
  validate_state_file "$PREVIOUS_ENV"
  validate_state_file "$KNOWN_GOOD_ENV"

  exec 9>"$LOCK_FILE"
  chmod 0640 "$LOCK_FILE"
  flock -n 9 || die "another deployment is already running"

  docker info >/dev/null
  # Remember a live bot even when its profile was omitted; quiescence must cover it.
  local live_bot
  live_bot="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT_NAME}" --filter 'label=com.docker.compose.service=telegram-ops-bot')"
  check_disk_free "Application checkout filesystem" "$APP_DIR"
  local docker_root
  docker_root="$(docker info --format '{{.DockerRootDir}}')"
  check_disk_free "Docker data filesystem" "$docker_root"

  local backend_image frontend_image bot_image backend_digest frontend_digest bot_digest caddy_digest application_digest
  local current_backend_image current_frontend_image current_bot_image
  local current_backend_digest current_frontend_digest current_bot_digest current_caddy_digest current_application_digest
  backend_image="$(image_ref batch-backend)"
  frontend_image="$(image_ref batch-frontend)"
  bot_image="$(image_ref telegram-ops-bot)"

  current_backend_image="$(state_value BATCH_BACKEND_IMAGE)"
  current_frontend_image="$(state_value BATCH_FRONTEND_IMAGE)"
  current_bot_image="$(state_value TELEGRAM_OPS_BOT_IMAGE)"
  current_backend_digest="$(state_value BATCH_BACKEND_DIGEST)"
  current_frontend_digest="$(state_value BATCH_FRONTEND_DIGEST)"
  current_bot_digest="$(state_value TELEGRAM_OPS_BOT_DIGEST)"
  current_caddy_digest="$(state_value CADDY_CONFIG_DIGEST)"
  current_application_digest="$(state_value APPLICATION_CONFIG_DIGEST)"

  prepare_image "$backend_image" "$current_backend_image" "$current_backend_digest"
  backend_digest="$PREPARED_IMAGE_DIGEST"
  prepare_image "$frontend_image" "$current_frontend_image" "$current_frontend_digest"
  frontend_digest="$PREPARED_IMAGE_DIGEST"
  if ops_bot_enabled; then
    prepare_image "$bot_image" "$current_bot_image" "$current_bot_digest"
    bot_digest="$PREPARED_IMAGE_DIGEST"
  else
    bot_digest=""
  fi

  caddy_digest="$(caddy_config_digest)"
  application_digest="$(application_config_digest)"
  write_pending_env "$backend_image" "$frontend_image" "$bot_image" "$backend_digest" "$frontend_digest" "$bot_digest" "$caddy_digest" "$application_digest"

  local include_bot=false include_edge=false
  ops_bot_enabled && include_bot=true
  edge_enabled && include_edge=true
  build_deployment_plan \
    "$current_backend_digest" "$current_frontend_digest" "$current_bot_digest" "$current_caddy_digest" \
    "$backend_digest" "$frontend_digest" "$bot_digest" "$caddy_digest" \
    "$include_bot" "$include_edge" "$current_application_digest" "$application_digest"
  print_deployment_plan

  compose_with_env "$PENDING_ENV" config --quiet
  compose_with_env "$PENDING_ENV" config --format json | node "${APP_DIR}/scripts/deploy/schema-compatibility.mjs" check-compose

  if edge_enabled; then
    compose_with_env "$PENDING_ENV" run --rm --no-deps \
      caddy-edge caddy validate --config /etc/caddy/Caddyfile
  fi

  # Validate the requested image's production contract before stopping or recreating anything.
  # The edge hostname override must agree with the backend's issuer/resource in .env.
  local -a validation_edge_args=()
  if edge_enabled; then
    validation_edge_args=(-e "CADDY_PUBLIC_HOSTNAME=${CADDY_PUBLIC_HOSTNAME}")
  fi
  compose_with_env "$PENDING_ENV" run --rm --no-deps \
    "${validation_edge_args[@]}" \
    batch-backend node dist/tools/validate-env.js --runtime --profile production

  # Always check schema compatibility, including image downgrade and alias-only attempts.
  require_postgres_healthy
  read_schema_compatibility_plan
  if [[ "$SCHEMA_QUIESCE_REQUIRED" == "true" && -n "$live_bot" ]] && ! ops_bot_enabled; then
    # Enable recovery of a bot that will be stopped, without widening ordinary deploys.
    DEPLOY_INCLUDE_OPS_BOT=true
    include_bot=true
    prepare_image "$bot_image" "$current_bot_image" "$current_bot_digest"
    bot_digest="$PREPARED_IMAGE_DIGEST"
    write_pending_env "$backend_image" "$frontend_image" "$bot_image" "$backend_digest" "$frontend_digest" "$bot_digest" "$caddy_digest" "$application_digest"
    build_deployment_plan \
      "$current_backend_digest" "$current_frontend_digest" "$current_bot_digest" "$current_caddy_digest" \
      "$backend_digest" "$frontend_digest" "$bot_digest" "$caddy_digest" \
      "$include_bot" "$include_edge" "$current_application_digest" "$application_digest"
    print_deployment_plan
    compose_with_env "$PENDING_ENV" config --quiet
    compose_with_env "$PENDING_ENV" config --format json | node "${APP_DIR}/scripts/deploy/schema-compatibility.mjs" check-compose
  fi
  if [[ "$PLAN_ONLY" == "true" ]]; then
    info "Plan only: no database or service mutation performed"
    return 0
  fi

  if [[ -f "$CURRENT_ENV" ]]; then
    copy_state_file "$CURRENT_ENV" "$PREVIOUS_ENV"
  fi
  cp "${DEPLOY_STATE_DIR}/pending-compatibility.json" "${COMPATIBILITY_PLAN}.tmp"
  chmod 0640 "${COMPATIBILITY_PLAN}.tmp"
  mv "${COMPATIBILITY_PLAN}.tmp" "$COMPATIBILITY_PLAN"

  if [[ "$DATABASE_WORK_REQUIRED" == "true" ]]; then
    require_command aws
    if [[ "$SCHEMA_QUIESCE_REQUIRED" == "true" ]]; then
      quiesce_application
      if ops_bot_enabled && [[ "$BOT_CHANGED" != "true" ]]; then
        DEPLOYMENT_SERVICES+=(telegram-ops-bot)
      fi
    fi
    create_pre_migration_backup
    MIGRATION_STARTED=true
    run_migrations_once
  elif [[ "$SCHEMA_QUIESCE_REQUIRED" == "true" ]]; then
    die "current image state is incompatible with the database; deploy a schema-compatible backend image"
  fi

  if [[ "${#DEPLOYMENT_SERVICES[@]}" -gt 0 ]]; then
    UPDATED_SERVICES=true
    if [[ "$INITIAL_DEPLOY" == "true" ]]; then
      compose_with_env "$PENDING_ENV" up -d --no-build
    else
      compose_with_env "$PENDING_ENV" up -d --no-build --no-deps --force-recreate "${DEPLOYMENT_SERVICES[@]}"
    fi
  fi
  if [[ "$EDGE_RESTART_REQUIRED" == "true" ]]; then
    UPDATED_SERVICES=true
  fi
  recreate_edge_service
  run_smoke_checks

  copy_state_file "$PENDING_ENV" "$CURRENT_ENV"
  append_deploy_log success
  remove_old_custom_images
  info "Deployment completed for ${SHA}"
  if [[ "$IMAGE_ROLLBACK_SAFE" != "true" ]]; then
    info "Image-only rollback to the previous runtime is BLOCKED; recover with a schema-compatible image or deliberately restore a verified backup from BEFORE the blocked boundary that supports the previous runtime."
  fi
}

main "$@"
