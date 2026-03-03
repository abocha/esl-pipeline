#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEFAULT_BACKUP_DIR="${ROOT_DIR}/tmp/backups/postgres"
DEFAULT_COMPOSE_FILE="${ROOT_DIR}/docker-compose.yml"

COMPOSE_PROJECT="${PG_COMPOSE_PROJECT:-esl-pipeline}"
COMPOSE_FILE="${PG_COMPOSE_FILE:-$DEFAULT_COMPOSE_FILE}"
SERVICE_NAME="${PG_SERVICE_NAME:-postgres}"
CONTAINER_NAME_OVERRIDE="${PG_CONTAINER_NAME:-}"
DB_NAME="${PG_DATABASE:-esl_batch}"
DB_USER="${PG_USER:-esl}"
BACKUP_DIR="${PG_BACKUP_DIR:-$DEFAULT_BACKUP_DIR}"
RESOLVED_CONTAINER_REF=""

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

  echo "Creating backups for database '${DB_NAME}' from container '${container_label}'..."

  docker exec "$container_ref" env PGUSER="$DB_USER" PGDATABASE="$DB_NAME" sh -lc \
    'pg_dump --no-owner --no-privileges -U "$PGUSER" -d "$PGDATABASE"' | gzip -9 > "$plain_gz"

  docker exec "$container_ref" env PGUSER="$DB_USER" PGDATABASE="$DB_NAME" sh -lc \
    'pg_dump -Fc --no-owner --no-privileges -U "$PGUSER" -d "$PGDATABASE"' > "$custom_dump"

  docker exec "$container_ref" env PGUSER="$DB_USER" PGDATABASE="$DB_NAME" sh -lc \
    'pg_dump --schema-only --no-owner --no-privileges -U "$PGUSER" -d "$PGDATABASE"' > "$schema_sql"

  sha256sum "$plain_gz" "$custom_dump" "$schema_sql" > "$checksum_file"

  # Sanity check custom-format backup by reading TOC through stdin in container.
  cat "$custom_dump" | docker exec -i "$container_ref" sh -lc 'pg_restore -l >/dev/null'

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
    cat "$backup_file" | docker exec -i "$container_ref" sh -lc "pg_restore -l | sed -n '1,20p'"
  fi
}

do_restore() {
  local backup_file="$1"
  local clean_mode="${2:-false}"
  local tmp_dump_in_container
  local container_ref container_label

  if [[ ! -f "$backup_file" ]]; then
    echo "ERROR: file not found: $backup_file" >&2
    exit 1
  fi

  ensure_container_running
  container_ref="$(resolve_container_ref)"
  container_label="$(resolve_container_label)"
  echo "Restoring into database '${DB_NAME}' on container '${container_label}'..."

  case "$backup_file" in
    *.dump)
      if [[ "$clean_mode" == "true" ]]; then
        cat "$backup_file" | docker exec -i "$container_ref" env PGUSER="$DB_USER" PGDATABASE="$DB_NAME" sh -lc \
          'pg_restore --clean --if-exists --no-owner --no-privileges -U "$PGUSER" -d "$PGDATABASE"'
      else
        cat "$backup_file" | docker exec -i "$container_ref" env PGUSER="$DB_USER" PGDATABASE="$DB_NAME" sh -lc \
          'pg_restore --no-owner --no-privileges -U "$PGUSER" -d "$PGDATABASE"'
      fi
      ;;
    *.sql.gz)
      if [[ "$clean_mode" == "true" ]]; then
        echo "ERROR: --clean is supported only for .dump restores." >&2
        exit 1
      fi
      gunzip -c "$backup_file" | docker exec -i "$container_ref" env PGUSER="$DB_USER" PGDATABASE="$DB_NAME" sh -lc \
        'psql -v ON_ERROR_STOP=1 -U "$PGUSER" -d "$PGDATABASE"'
      ;;
    *.sql)
      if [[ "$clean_mode" == "true" ]]; then
        echo "ERROR: --clean is supported only for .dump restores." >&2
        exit 1
      fi
      cat "$backup_file" | docker exec -i "$container_ref" env PGUSER="$DB_USER" PGDATABASE="$DB_NAME" sh -lc \
        'psql -v ON_ERROR_STOP=1 -U "$PGUSER" -d "$PGDATABASE"'
      ;;
    *)
      echo "ERROR: unsupported backup file extension: $backup_file" >&2
      echo "Supported: .dump, .sql, .sql.gz" >&2
      exit 1
      ;;
  esac

  echo "Restore complete from: $backup_file"
}

main() {
  require_commands

  local action="${1:-}"
  if [[ -z "$action" ]]; then
    print_usage
    exit 1
  fi
  shift || true

  case "$action" in
    backup)
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
      if [[ "${1:-}" == "--" ]]; then
        shift
      fi
      if [[ $# -lt 1 ]]; then
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
