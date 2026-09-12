#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEFAULT_ENV_FILE="${ROOT_DIR}/.env"
BACKUP_SCRIPT="${ROOT_DIR}/scripts/docker/postgres-backup-s3.sh"
COMMON_SCRIPT="${ROOT_DIR}/scripts/docker/postgres-ops-common.sh"

# shellcheck source=scripts/docker/postgres-ops-common.sh
. "$COMMON_SCRIPT"

ENV_FILE="${PG_BACKUP_ENV_FILE:-$DEFAULT_ENV_FILE}"

if [[ ! -x "$BACKUP_SCRIPT" ]]; then
  echo "ERROR: backup script is missing or not executable: $BACKUP_SCRIPT" >&2
  exit 1
fi

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
else
  echo "WARN: env file not found, continuing with current shell env: $ENV_FILE"
fi

HOST_STATE_DIR="$(pg_backup_resolve_host_state_dir)"
LOG_DIR="${PG_BACKUP_LOG_DIR:-${HOST_STATE_DIR}/logs}"
RETENTION_DAYS="${PG_BACKUP_LOG_RETENTION_DAYS:-30}"
BACKUP_DIR="${PG_BACKUP_DIR:-${HOST_STATE_DIR}/backups/postgres}"
LOCAL_RETENTION_DAYS="${PG_BACKUP_LOCAL_RETENTION_DAYS:-30}"
REMOTE_RESTORE_RETENTION_DAYS="${PG_BACKUP_REMOTE_RESTORE_RETENTION_DAYS:-14}"
LABEL="${PG_BACKUP_SCHEDULE_LABEL:-nightly}"

mkdir -p "$LOG_DIR"

stamp="$(date +%Y%m%d_%H%M%S)"
log_file="${LOG_DIR}/postgres-backup-s3-${stamp}.log"

echo "[$(date -Iseconds)] Starting scheduled Postgres S3 backup" | tee -a "$log_file"
"$BACKUP_SCRIPT" backup-upload "$LABEL" 2>&1 | tee -a "$log_file"
echo "[$(date -Iseconds)] Scheduled Postgres S3 backup completed" | tee -a "$log_file"

if [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  find "$LOG_DIR" -maxdepth 1 -type f -name 'postgres-backup-s3-*.log' -mtime "+$RETENTION_DAYS" -delete
fi

if [[ "$LOCAL_RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  find "$BACKUP_DIR" -maxdepth 1 -type f \
    \( -name '*.dump' -o -name '*.sql.gz' -o -name '*_schema.sql' -o -name '*.sha256' \) \
    -mtime "+$LOCAL_RETENTION_DAYS" -delete
fi

if [[ "$REMOTE_RESTORE_RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  find "${BACKUP_DIR}/remote-restore" -maxdepth 1 -type f \
    \( -name '*.dump' -o -name '*.sha256' \) \
    -mtime "+$REMOTE_RESTORE_RETENTION_DAYS" -delete 2>/dev/null || true
fi
