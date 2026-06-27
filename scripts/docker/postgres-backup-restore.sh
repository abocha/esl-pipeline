#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEFAULT_BACKUP_DIR="${ROOT_DIR}/tmp/backups/postgres"
DEFAULT_COMPOSE_FILE="${ROOT_DIR}/docker-compose.yml"
DEFAULT_ENV_FILE="${ROOT_DIR}/.env"

ENV_FILE="${PG_BACKUP_ENV_FILE:-$DEFAULT_ENV_FILE}"
RESOLVED_CONTAINER_REF=""
NOTIFY_ACTION=""
NOTIFY_STEP="startup"
NOTIFY_START_EPOCH=0
NOTIFY_SOURCE=""
NOTIFY_TARGET=""
NOTIFY_FAILURE_HINT=""
BACKUP_GUARD_SUMMARY=""
BACKUP_GUARD_DECISION=""
BACKUP_GUARD_OVERRIDE_USED="false"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck source=/dev/null
  . "$ENV_FILE"
  set +a
fi

COMPOSE_PROJECT="${PG_COMPOSE_PROJECT:-esl-pipeline}"
COMPOSE_FILE="${PG_COMPOSE_FILE:-$DEFAULT_COMPOSE_FILE}"
SERVICE_NAME="${PG_SERVICE_NAME:-postgres}"
CONTAINER_NAME_OVERRIDE="${PG_CONTAINER_NAME:-}"
DB_NAME="${PG_DATABASE:-esl_batch}"
DB_USER="${PG_USER:-esl}"
BACKUP_DIR="${PG_BACKUP_DIR:-$DEFAULT_BACKUP_DIR}"
PG_BACKUP_ALLOW_EMPTY_SOURCE="${PG_BACKUP_ALLOW_EMPTY_SOURCE:-false}"
PG_BACKUP_NOTIFY_SUPPRESS="${PG_BACKUP_NOTIFY_SUPPRESS:-false}"
PG_BACKUP_ALERT_TELEGRAM_DISABLE="${PG_BACKUP_ALERT_TELEGRAM_DISABLE:-false}"
PG_BACKUP_ALERT_TELEGRAM_BOT_TOKEN="${PG_BACKUP_ALERT_TELEGRAM_BOT_TOKEN:-}"
PG_BACKUP_ALERT_TELEGRAM_CHAT_ID="${PG_BACKUP_ALERT_TELEGRAM_CHAT_ID:-}"
PG_BACKUP_ALERT_TELEGRAM_THREAD_ID="${PG_BACKUP_ALERT_TELEGRAM_THREAD_ID:-}"

print_usage() {
  cat <<'USAGE'
Usage:
  postgres-backup-restore.sh backup [label]
  postgres-backup-restore.sh list
  postgres-backup-restore.sh verify <backup-file>
  postgres-backup-restore.sh restore <backup-file> [--clean]

Environment overrides:
  PG_COMPOSE_PROJECT (default: esl-pipeline)
  PG_COMPOSE_FILE    (default: <repo>/docker-compose.yml)
  PG_SERVICE_NAME    (default: postgres)
  PG_CONTAINER_NAME  (override compose discovery)
  PG_DATABASE        (default: esl_batch)
  PG_USER            (default: esl)
  PG_BACKUP_DIR      (default: <repo>/tmp/backups/postgres)
  PG_BACKUP_ENV_FILE (default: <repo>/.env if present)
  PG_BACKUP_ALLOW_EMPTY_SOURCE (default: false)
  PG_BACKUP_NOTIFY_SUPPRESS (default: false; internal use)

Notes:
  - backup creates four files:
      <prefix>.sql.gz
      <prefix>.dump
      <prefix>_schema.sql
      <prefix>.sha256
  - restore supports: .dump, .sql, .sql.gz
  - --clean is only supported for .dump restores
USAGE
}

require_commands() {
  local cmd
  for cmd in docker gzip gunzip sha256sum; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      echo "ERROR: required command not found: $cmd" >&2
      exit 1
    fi
  done
}

bool_is_true() {
  local value="${1:-}"
  case "${value,,}" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

html_escape() {
  local value="$1"
  printf '%s' "$value" \
    | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'
}

compact_resource_label() {
  local value="${1:-}"
  if [[ -z "$value" || "$value" == "n/a" ]]; then
    printf 'n/a'
    return 0
  fi
  if [[ "$value" == s3://* || "$value" == postgres:* ]]; then
    printf '%s' "$value"
    return 0
  fi
  basename "$value"
}

is_notification_suppressed() {
  bool_is_true "$PG_BACKUP_NOTIFY_SUPPRESS"
}

can_send_completion_telegram() {
  if is_notification_suppressed; then
    return 1
  fi
  if bool_is_true "$PG_BACKUP_ALERT_TELEGRAM_DISABLE"; then
    return 1
  fi
  [[ -n "$PG_BACKUP_ALERT_TELEGRAM_BOT_TOKEN" && -n "$PG_BACKUP_ALERT_TELEGRAM_CHAT_ID" ]]
}

warn_if_telegram_chat_targets_differ() {
  local backup_chat_id="${PG_BACKUP_ALERT_TELEGRAM_CHAT_ID:-}"
  local ops_chat_id="${TELEGRAM_OPS_BOT_CHAT_ID:-}"
  if [[ -n "$backup_chat_id" && -n "$ops_chat_id" && "$backup_chat_id" != "$ops_chat_id" ]]; then
    echo "WARN: PG_BACKUP_ALERT_TELEGRAM_CHAT_ID (${backup_chat_id}) differs from TELEGRAM_OPS_BOT_CHAT_ID (${ops_chat_id}). Backup completion notifications will use PG_BACKUP_ALERT_TELEGRAM_CHAT_ID."
  fi
}

send_completion_telegram() {
  local text="$1"
  local url="https://api.telegram.org/bot${PG_BACKUP_ALERT_TELEGRAM_BOT_TOKEN}/sendMessage"
  local args=(-sS -X POST "$url" -d "chat_id=${PG_BACKUP_ALERT_TELEGRAM_CHAT_ID}" -d "parse_mode=HTML" --data-urlencode "text=${text}" -d "disable_web_page_preview=true")
  local response
  if [[ -n "$PG_BACKUP_ALERT_TELEGRAM_THREAD_ID" ]]; then
    args+=(-d "message_thread_id=${PG_BACKUP_ALERT_TELEGRAM_THREAD_ID}")
  fi
  if ! response="$(curl "${args[@]}")"; then
    return 1
  fi
  if [[ "$response" == *'"ok":true'* ]]; then
    return 0
  fi
  echo "WARN: Telegram API rejected completion message: $response" >&2
  return 1
}

emit_completion_notification() {
  local status="$1"
  local exit_code="$2"
  local end_epoch elapsed_seconds now_utc message
  local action_title status_emoji status_verb
  local source_label target_label
  local esc_db esc_source esc_target esc_now_utc
  local guard_decision guard_emoji esc_guard_decision esc_guard_summary
  local esc_step esc_hint
  end_epoch="$(date -u +%s)"
  if (( NOTIFY_START_EPOCH > 0 && end_epoch >= NOTIFY_START_EPOCH )); then
    elapsed_seconds="$((end_epoch - NOTIFY_START_EPOCH))"
  else
    elapsed_seconds=0
  fi
  now_utc="$(date -u '+%Y-%m-%d %H:%M:%S UTC')"

  if [[ "$NOTIFY_ACTION" != "backup" && "$NOTIFY_ACTION" != "restore" ]]; then
    return 0
  fi
  if is_notification_suppressed; then
    return 0
  fi

  case "$NOTIFY_ACTION" in
    backup) action_title="Local Backup" ;;
    restore) action_title="Local Restore" ;;
    *) action_title="$NOTIFY_ACTION" ;;
  esac
  if [[ "$status" == "success" ]]; then
    status_emoji="✅"
    status_verb="Succeeded"
  else
    status_emoji="❌"
    status_verb="Failed"
  fi

  source_label="$(compact_resource_label "${NOTIFY_SOURCE:-n/a}")"
  target_label="$(compact_resource_label "${NOTIFY_TARGET:-n/a}")"
  esc_db="$(html_escape "$DB_NAME")"
  esc_source="$(html_escape "$source_label")"
  esc_target="$(html_escape "$target_label")"
  esc_now_utc="$(html_escape "$now_utc")"

  message=$(
    cat <<EOF
<b>${status_emoji} ${action_title} ${status_verb}</b>

<code>db=${esc_db}</code> • <code>${elapsed_seconds}s</code> • <code>${esc_now_utc}</code>

<b>Source</b> <code>${esc_source}</code>
<b>Target</b> <code>${esc_target}</code>
EOF
  )

  if [[ "$NOTIFY_ACTION" == "backup" ]]; then
    guard_decision="${BACKUP_GUARD_DECISION:-n/a}"
    case "$guard_decision" in
      allow_non_empty) guard_emoji="🟢" ;;
      allow_override) guard_emoji="🟡" ;;
      block_empty) guard_emoji="🔴" ;;
      *) guard_emoji="⚪" ;;
    esac
    esc_guard_decision="$(html_escape "$guard_decision")"
    esc_guard_summary="$(html_escape "${BACKUP_GUARD_SUMMARY:-n/a}")"
    message+=$'\n\n'"<b>Guard</b> ${guard_emoji} <code>${esc_guard_decision}</code>"
    message+=$'\n'"<code>${esc_guard_summary}</code>"
    if [[ "${BACKUP_GUARD_OVERRIDE_USED}" == "true" ]]; then
      message+=$'\n'"<b>Override</b> ⚠️ <code>PG_BACKUP_ALLOW_EMPTY_SOURCE=true</code>"
    fi
  fi

  if [[ "$status" == "failure" ]]; then
    esc_step="$(html_escape "${NOTIFY_STEP:-unknown}")"
    esc_hint="$(html_escape "${NOTIFY_FAILURE_HINT:-n/a}")"
    message+=$'\n\n'"<b>Step</b> <code>${esc_step}</code>"
    message+=$'\n'"<b>Hint</b> <code>${esc_hint}</code>"
    message+=$'\n'"<b>Exit</b> <code>${exit_code}</code>"
  fi

  if ! can_send_completion_telegram; then
    echo "Completion Telegram skipped for ${NOTIFY_ACTION} (${status}): disabled or missing config."
    return 0
  fi
  if ! command -v curl >/dev/null 2>&1; then
    echo "WARN: completion Telegram skipped for ${NOTIFY_ACTION} (${status}): curl not found."
    return 0
  fi

  if send_completion_telegram "$message"; then
    echo "Completion Telegram sent for ${NOTIFY_ACTION} (${status})."
  else
    echo "WARN: completion Telegram failed for ${NOTIFY_ACTION} (${status})."
  fi
}

on_exit() {
  local rc="$1"
  set +e
  if [[ "$NOTIFY_ACTION" == "backup" || "$NOTIFY_ACTION" == "restore" ]]; then
    if [[ "$rc" -eq 0 ]]; then
      emit_completion_notification "success" "$rc"
    else
      emit_completion_notification "failure" "$rc"
    fi
  fi
  return 0
}

trap 'on_exit "$?"' EXIT

compose() {
  docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" "$@"
}

resolve_container_ref() {
  if [[ -n "$RESOLVED_CONTAINER_REF" ]]; then
    echo "$RESOLVED_CONTAINER_REF"
    return
  fi

  if [[ -n "$CONTAINER_NAME_OVERRIDE" ]]; then
    RESOLVED_CONTAINER_REF="$CONTAINER_NAME_OVERRIDE"
    echo "$RESOLVED_CONTAINER_REF"
    return
  fi

  local container_id
  container_id="$(compose ps -q "$SERVICE_NAME" | head -n 1)"
  if [[ -z "$container_id" ]]; then
    echo "ERROR: failed to resolve postgres container from compose service '${SERVICE_NAME}'." >&2
    echo "Tip: run 'pnpm docker:up' or set PG_CONTAINER_NAME to a running container." >&2
    exit 1
  fi

  RESOLVED_CONTAINER_REF="$container_id"
  echo "$RESOLVED_CONTAINER_REF"
}

resolve_container_label() {
  local container_ref
  container_ref="$(resolve_container_ref)"
  local display_name
  display_name="$(docker inspect -f '{{.Name}}' "$container_ref" 2>/dev/null || true)"
  if [[ -n "$display_name" ]]; then
    echo "${display_name#/}"
  else
    echo "$container_ref"
  fi
}

ensure_container_running() {
  local container_ref
  container_ref="$(resolve_container_ref)"
  local running
  running="$(docker inspect -f '{{.State.Running}}' "$container_ref" 2>/dev/null || echo false)"
  if [[ "$running" != "true" ]]; then
    local container_label
    container_label="$(resolve_container_label)"
    echo "ERROR: container is not running: ${container_label}" >&2
    echo "Tip: run 'pnpm docker:up' or 'compose up -d ${SERVICE_NAME}' for project '${COMPOSE_PROJECT}'." >&2
    exit 1
  fi
}

safe_label() {
  local value="$1"
  value="${value// /_}"
  value="$(echo "$value" | tr -cd '[:alnum:]_.-')"
  if [[ -z "$value" ]]; then
    echo "manual"
  else
    echo "$value"
  fi
}

query_table_has_rows() {
  local container_ref="$1"
  local table_name="$2"
  local exists_result rows_result

  exists_result="$(
    docker exec "$container_ref" env PGUSER="$DB_USER" PGDATABASE="$DB_NAME" sh -lc \
      "psql -v ON_ERROR_STOP=1 -At -U \"\$PGUSER\" -d \"\$PGDATABASE\" -c \"SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='${table_name}');\""
  )"
  if [[ "$exists_result" != "t" ]]; then
    echo "missing"
    return 0
  fi

  rows_result="$(
    docker exec "$container_ref" env PGUSER="$DB_USER" PGDATABASE="$DB_NAME" sh -lc \
      "psql -v ON_ERROR_STOP=1 -At -U \"\$PGUSER\" -d \"\$PGDATABASE\" -c \"SELECT EXISTS(SELECT 1 FROM public.\\\"${table_name}\\\" LIMIT 1);\""
  )"
  if [[ "$rows_result" == "t" ]]; then
    echo "true"
  else
    echo "false"
  fi
}

check_backup_source_guard() {
  local container_ref="$1"
  local has_any_data="false"
  local allow_empty="false"
  local users_has_data jobs_has_data transcripts_has_data

  if bool_is_true "$PG_BACKUP_ALLOW_EMPTY_SOURCE"; then
    allow_empty="true"
  fi

  users_has_data="$(query_table_has_rows "$container_ref" "users")"
  jobs_has_data="$(query_table_has_rows "$container_ref" "jobs")"
  transcripts_has_data="$(query_table_has_rows "$container_ref" "transcripts")"

  if [[ "$users_has_data" == "true" || "$jobs_has_data" == "true" || "$transcripts_has_data" == "true" ]]; then
    has_any_data="true"
  fi

  BACKUP_GUARD_SUMMARY="users=${users_has_data},jobs=${jobs_has_data},transcripts=${transcripts_has_data}"
  BACKUP_GUARD_OVERRIDE_USED="false"

  if [[ "$has_any_data" == "true" ]]; then
    BACKUP_GUARD_DECISION="allow_non_empty"
  elif [[ "$allow_empty" == "true" ]]; then
    BACKUP_GUARD_DECISION="allow_override"
    BACKUP_GUARD_OVERRIDE_USED="true"
  else
    BACKUP_GUARD_DECISION="block_empty"
  fi

  echo "Backup guard summary: ${BACKUP_GUARD_SUMMARY}; decision=${BACKUP_GUARD_DECISION}; override_used=${BACKUP_GUARD_OVERRIDE_USED}"

  if [[ "$BACKUP_GUARD_DECISION" == "block_empty" ]]; then
    NOTIFY_FAILURE_HINT="all anchor tables are empty (users/jobs/transcripts). Set PG_BACKUP_ALLOW_EMPTY_SOURCE=true to override intentionally."
    echo "ERROR: backup guard blocked empty-source snapshot."
    echo "ERROR: Anchor tables users/jobs/transcripts have no rows."
    echo "ERROR: If this is intentional, rerun with PG_BACKUP_ALLOW_EMPTY_SOURCE=true."
    return 1
  fi

  if [[ "$BACKUP_GUARD_DECISION" == "allow_override" ]]; then
    echo "WARN: backup guard override is active (PG_BACKUP_ALLOW_EMPTY_SOURCE=true). Continuing with empty-source backup."
  fi
}

do_backup() {
  local label="${1:-}"
  local stamp prefix plain_gz custom_dump schema_sql checksum_file
  local container_ref container_label
  container_ref="$(resolve_container_ref)"
  container_label="$(resolve_container_label)"

  mkdir -p "$BACKUP_DIR"
  stamp="$(date +%Y%m%d_%H%M%S)"
  if [[ -n "$label" ]]; then
    prefix="${DB_NAME}_${stamp}_$(safe_label "$label")"
  else
    prefix="${DB_NAME}_${stamp}"
  fi

  plain_gz="${BACKUP_DIR}/${prefix}.sql.gz"
  custom_dump="${BACKUP_DIR}/${prefix}.dump"
  schema_sql="${BACKUP_DIR}/${prefix}_schema.sql"
  checksum_file="${BACKUP_DIR}/${prefix}.sha256"
  NOTIFY_TARGET="$custom_dump"
  NOTIFY_STEP="backup_guard"

  echo "Creating backups for database '${DB_NAME}' from container '${container_label}'..."
  check_backup_source_guard "$container_ref"

  NOTIFY_STEP="pg_dump_plain_sql"
  docker exec "$container_ref" env PGUSER="$DB_USER" PGDATABASE="$DB_NAME" sh -lc \
    'pg_dump --no-owner --no-privileges -U "$PGUSER" -d "$PGDATABASE"' | gzip -9 > "$plain_gz"

  NOTIFY_STEP="pg_dump_custom"
  docker exec "$container_ref" env PGUSER="$DB_USER" PGDATABASE="$DB_NAME" sh -lc \
    'pg_dump -Fc --no-owner --no-privileges -U "$PGUSER" -d "$PGDATABASE"' > "$custom_dump"

  NOTIFY_STEP="pg_dump_schema"
  docker exec "$container_ref" env PGUSER="$DB_USER" PGDATABASE="$DB_NAME" sh -lc \
    'pg_dump --schema-only --no-owner --no-privileges -U "$PGUSER" -d "$PGDATABASE"' > "$schema_sql"

  NOTIFY_STEP="write_checksums"
  sha256sum "$plain_gz" "$custom_dump" "$schema_sql" > "$checksum_file"

  # Sanity check custom-format backup by reading TOC through stdin in container.
  NOTIFY_STEP="validate_custom_dump_toc"
  docker exec -i "$container_ref" sh -lc 'pg_restore -l >/dev/null' < "$custom_dump"
  NOTIFY_STEP="backup_complete"

  echo "Backup complete."
  echo "  plain:     $plain_gz"
  echo "  custom:    $custom_dump"
  echo "  schema:    $schema_sql"
  echo "  checksums: $checksum_file"
}

do_list() {
  if [[ ! -d "$BACKUP_DIR" ]]; then
    echo "No backups directory found: $BACKUP_DIR"
    return
  fi

  echo "Backups in $BACKUP_DIR:"
  find "$BACKUP_DIR" -maxdepth 1 -type f \
    \( -name '*.dump' -o -name '*.sql.gz' -o -name '*_schema.sql' -o -name '*.sha256' \) \
    -printf '%TY-%Tm-%Td %TH:%TM:%TS %9s %p\n' | sort -r
}

do_verify() {
  local backup_file="$1"
  local checksum_file

  if [[ ! -f "$backup_file" ]]; then
    echo "ERROR: file not found: $backup_file" >&2
    exit 1
  fi

  echo "Verifying file: $backup_file"

  if [[ "$backup_file" == *.sql.gz ]]; then
    checksum_file="${backup_file%.sql.gz}.sha256"
  elif [[ "$backup_file" == *_schema.sql ]]; then
    checksum_file="${backup_file%_schema.sql}.sha256"
  elif [[ "$backup_file" == *.sql || "$backup_file" == *.dump ]]; then
    checksum_file="${backup_file%.*}.sha256"
  else
    checksum_file="${backup_file%.*}.sha256"
  fi

  if [[ -f "$checksum_file" ]]; then
    echo "Checking checksums using: $checksum_file"
    sha256sum -c "$checksum_file"
  else
    echo "WARN: checksum file not found next to backup: $checksum_file"
  fi

  if [[ "$backup_file" == *.dump ]]; then
    ensure_container_running
    local container_ref
    container_ref="$(resolve_container_ref)"
    docker exec -i "$container_ref" sh -lc "pg_restore -l | sed -n '1,20p'" < "$backup_file"
  fi
}

do_restore() {
  local backup_file="$1"
  local clean_mode="${2:-false}"
  local container_ref container_label

  if [[ ! -f "$backup_file" ]]; then
    NOTIFY_FAILURE_HINT="backup file not found"
    echo "ERROR: file not found: $backup_file" >&2
    exit 1
  fi

  NOTIFY_SOURCE="$backup_file"
  ensure_container_running
  container_ref="$(resolve_container_ref)"
  container_label="$(resolve_container_label)"
  echo "Restoring into database '${DB_NAME}' on container '${container_label}'..."

  case "$backup_file" in
    *.dump)
      if [[ "$clean_mode" == "true" ]]; then
        NOTIFY_STEP="pg_restore_clean"
        docker exec -i "$container_ref" env PGUSER="$DB_USER" PGDATABASE="$DB_NAME" sh -lc \
          'pg_restore --clean --if-exists --no-owner --no-privileges -U "$PGUSER" -d "$PGDATABASE"' < "$backup_file"
      else
        NOTIFY_STEP="pg_restore"
        docker exec -i "$container_ref" env PGUSER="$DB_USER" PGDATABASE="$DB_NAME" sh -lc \
          'pg_restore --no-owner --no-privileges -U "$PGUSER" -d "$PGDATABASE"' < "$backup_file"
      fi
      ;;
    *.sql.gz)
      if [[ "$clean_mode" == "true" ]]; then
        NOTIFY_FAILURE_HINT="--clean is not valid for .sql.gz restore"
        echo "ERROR: --clean is supported only for .dump restores." >&2
        exit 1
      fi
      NOTIFY_STEP="psql_restore_sql_gz"
      gunzip -c "$backup_file" | docker exec -i "$container_ref" env PGUSER="$DB_USER" PGDATABASE="$DB_NAME" sh -lc \
        'psql -v ON_ERROR_STOP=1 -U "$PGUSER" -d "$PGDATABASE"'
      ;;
    *.sql)
      if [[ "$clean_mode" == "true" ]]; then
        NOTIFY_FAILURE_HINT="--clean is not valid for .sql restore"
        echo "ERROR: --clean is supported only for .dump restores." >&2
        exit 1
      fi
      NOTIFY_STEP="psql_restore_sql"
      docker exec -i "$container_ref" env PGUSER="$DB_USER" PGDATABASE="$DB_NAME" sh -lc \
        'psql -v ON_ERROR_STOP=1 -U "$PGUSER" -d "$PGDATABASE"' < "$backup_file"
      ;;
    *)
      NOTIFY_FAILURE_HINT="unsupported backup extension"
      echo "ERROR: unsupported backup file extension: $backup_file" >&2
      echo "Supported: .dump, .sql, .sql.gz" >&2
      exit 1
      ;;
  esac

  NOTIFY_STEP="restore_complete"
  echo "Restore complete from: $backup_file"
}

main() {
  require_commands
  warn_if_telegram_chat_targets_differ

  local action="${1:-}"
  if [[ -z "$action" ]]; then
    print_usage
    exit 1
  fi
  shift || true

  case "$action" in
    backup)
      NOTIFY_ACTION="backup"
      NOTIFY_START_EPOCH="$(date -u +%s)"
      NOTIFY_STEP="validate_backup_args"
      NOTIFY_SOURCE="postgres:${DB_NAME}"
      ensure_container_running
      if [[ "${1:-}" == "--" ]]; then
        shift
      fi
      do_backup "${1:-}"
      ;;
    list)
      do_list
      ;;
    verify)
      if [[ "${1:-}" == "--" ]]; then
        shift
      fi
      if [[ $# -lt 1 ]]; then
        echo "ERROR: verify requires <backup-file>" >&2
        print_usage
        exit 1
      fi
      do_verify "$1"
      ;;
    restore)
      NOTIFY_ACTION="restore"
      NOTIFY_START_EPOCH="$(date -u +%s)"
      NOTIFY_STEP="validate_restore_args"
      NOTIFY_TARGET="postgres:${DB_NAME}"
      if [[ "${1:-}" == "--" ]]; then
        shift
      fi
      if [[ $# -lt 1 ]]; then
        NOTIFY_FAILURE_HINT="restore requires <backup-file>"
        echo "ERROR: restore requires <backup-file>" >&2
        print_usage
        exit 1
      fi

      local backup_file="$1"
      shift
      local clean_mode="false"
      while [[ $# -gt 0 ]]; do
        case "$1" in
          --clean)
            clean_mode="true"
            shift
            ;;
          *)
            echo "ERROR: unknown option: $1" >&2
            print_usage
            exit 1
            ;;
        esac
      done
      do_restore "$backup_file" "$clean_mode"
      ;;
    *)
      echo "ERROR: unknown action: $action" >&2
      print_usage
      exit 1
      ;;
  esac
}

main "$@"
