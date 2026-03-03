#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEFAULT_ENV_FILE="${ROOT_DIR}/.env.batch-backend"
DEFAULT_LOG_DIR="${ROOT_DIR}/tmp/logs/backup"
BACKUP_S3_SCRIPT="${ROOT_DIR}/scripts/docker/postgres-backup-s3.sh"

ENV_FILE="${PG_BACKUP_ENV_FILE:-$DEFAULT_ENV_FILE}"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck source=/dev/null
  set -a
  . "$ENV_FILE"
  set +a
fi

LOG_DIR="${PG_BACKUP_LOG_DIR:-$DEFAULT_LOG_DIR}"
AUTO_RUN="${PG_BACKUP_RESTORE_DRILL_AUTO:-false}"

S3_BUCKET="${PG_BACKUP_S3_BUCKET:-${S3_BUCKET:-}}"
S3_PREFIX_BASE="${PG_BACKUP_S3_PREFIX:-backups/postgres}"
S3_REGION="${PG_BACKUP_S3_REGION:-${AWS_REGION:-}}"
S3_ENV="${PG_BACKUP_S3_ENV:-dev}"
DB_NAME="${PG_DATABASE:-esl_batch}"

if [[ -z "$S3_BUCKET" || -z "$S3_REGION" ]]; then
  echo "ERROR: restore-drill reminder needs PG_BACKUP_S3_BUCKET (or S3_BUCKET) and PG_BACKUP_S3_REGION (or AWS_REGION)." >&2
  exit 1
fi

mkdir -p "$LOG_DIR"
stamp="$(date +%Y%m%d_%H%M%S)"
log_file="${LOG_DIR}/restore-drill-reminder-${stamp}.log"
prefix="${S3_PREFIX_BASE%/}/${S3_ENV}/${DB_NAME}/"

latest_key="$(aws --region "$S3_REGION" s3api list-objects-v2 \
  --bucket "$S3_BUCKET" \
  --prefix "$prefix" \
  --query "sort_by(Contents[?ends_with(Key, '.dump')], &LastModified)[-1].Key" \
  --output text \
  2>/dev/null || true)"

if [[ -z "$latest_key" || "$latest_key" == "None" ]]; then
  {
    echo "[$(date -Iseconds)] Monthly restore drill reminder"
    echo "No .dump backups found under s3://${S3_BUCKET}/${prefix}"
    echo "Run a backup first: pnpm docker:db:backup:s3 -- monthly_checkpoint"
  } | tee -a "$log_file"
  exit 0
fi

command_hint="pnpm docker:db:restore:s3 -- ${latest_key} --download-only"

{
  echo "[$(date -Iseconds)] Monthly restore drill reminder"
  echo "Latest remote dump: s3://${S3_BUCKET}/${latest_key}"
  echo "Suggested drill command: ${command_hint}"
} | tee -a "$log_file"

if [[ "$AUTO_RUN" == "true" ]]; then
  {
    echo "[$(date -Iseconds)] Auto-running download-only restore drill..."
    "$BACKUP_S3_SCRIPT" restore-remote "$latest_key" --download-only
    echo "[$(date -Iseconds)] Auto drill completed successfully."
  } | tee -a "$log_file"
fi
