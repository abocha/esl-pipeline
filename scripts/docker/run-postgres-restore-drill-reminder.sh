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
S3_PROFILE="${PG_BACKUP_S3_PROFILE:-}"
S3_ENV="${PG_BACKUP_S3_ENV:-dev}"
DB_NAME="${PG_DATABASE:-esl_batch}"

mkdir -p "$LOG_DIR"
stamp="$(date +%Y%m%d_%H%M%S)"
log_file="${LOG_DIR}/restore-drill-reminder-${stamp}.log"
report_file="${LOG_DIR}/restore-drill-report-${stamp}.json"
latest_report_file="${PG_BACKUP_RESTORE_DRILL_REPORT_LATEST:-${LOG_DIR}/restore-drill-report-latest.json}"
mkdir -p "$(dirname "$latest_report_file")"
prefix="${S3_PREFIX_BASE%/}/${S3_ENV}/${DB_NAME}/"
mode="reminder"
auto_run_enabled="false"
if [[ "${AUTO_RUN,,}" == "true" ]]; then
  mode="auto_download_only"
  auto_run_enabled="true"
fi

report_status="ok"
latest_remote_dump_key=""
suggested_command=""
drill_executed="false"
drill_result="not_run"

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "$value"
}

aws_cmd() {
  local args=(--region "$S3_REGION")
  if [[ -n "$S3_PROFILE" ]]; then
    args+=(--profile "$S3_PROFILE")
  fi
  aws "${args[@]}" "$@"
}

write_report() {
  cat >"$report_file" <<EOF
{
  "timestamp_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "mode": "$(json_escape "$mode")",
  "status": "$(json_escape "$report_status")",
  "latest_remote_dump_key": "$(json_escape "$latest_remote_dump_key")",
  "suggested_command": "$(json_escape "$suggested_command")",
  "auto_run_enabled": ${auto_run_enabled},
  "drill_executed": ${drill_executed},
  "drill_result": "$(json_escape "$drill_result")"
}
EOF
  cp "$report_file" "$latest_report_file"
}

if [[ -z "$S3_BUCKET" || -z "$S3_REGION" ]]; then
  report_status="error"
  drill_result="missing_s3_config"
  {
    echo "ERROR: restore-drill reminder needs PG_BACKUP_S3_BUCKET (or S3_BUCKET) and PG_BACKUP_S3_REGION (or AWS_REGION)." >&2
  } | tee -a "$log_file"
  write_report
  exit 1
fi

latest_key_output="$(aws_cmd s3api list-objects-v2 \
  --bucket "$S3_BUCKET" \
  --prefix "$prefix" \
  --query "sort_by(Contents[?ends_with(Key, '.dump')], &LastModified)[-1].Key" \
  --output text 2>&1)" || latest_key_rc=$?
latest_key_rc="${latest_key_rc:-0}"

if [[ "$latest_key_rc" -ne 0 ]]; then
  report_status="error"
  drill_result="s3_query_failed"
  {
    echo "[$(date -Iseconds)] Monthly restore drill reminder"
    echo "Failed querying latest remote dump from s3://${S3_BUCKET}/${prefix}"
    echo "AWS CLI error: ${latest_key_output}"
  } | tee -a "$log_file"
  write_report
  exit 1
fi

latest_key="$latest_key_output"
latest_remote_dump_key="$latest_key"

if [[ -z "$latest_key" || "$latest_key" == "None" ]]; then
  report_status="warn_missing_remote_dump"
  latest_remote_dump_key=""
  suggested_command="pnpm docker:db:backup:s3 -- monthly_checkpoint"
  drill_result="no_remote_dump_found"
  {
    echo "[$(date -Iseconds)] Monthly restore drill reminder"
    echo "No .dump backups found under s3://${S3_BUCKET}/${prefix}"
    echo "Run a backup first: ${suggested_command}"
  } | tee -a "$log_file"
  write_report
  exit 0
fi

command_hint="pnpm docker:db:restore:s3 -- ${latest_key} --download-only"
suggested_command="$command_hint"

{
  echo "[$(date -Iseconds)] Monthly restore drill reminder"
  echo "Latest remote dump: s3://${S3_BUCKET}/${latest_key}"
  echo "Suggested drill command: ${command_hint}"
} | tee -a "$log_file"

if [[ "$auto_run_enabled" == "true" ]]; then
  drill_executed="true"
  if [[ ! -x "$BACKUP_S3_SCRIPT" ]]; then
    report_status="error"
    drill_result="missing_backup_s3_script"
    echo "ERROR: backup script is missing or not executable: $BACKUP_S3_SCRIPT" | tee -a "$log_file"
    write_report
    exit 1
  fi

  set +e
  {
    echo "[$(date -Iseconds)] Auto-running download-only restore drill..."
    "$BACKUP_S3_SCRIPT" restore-remote "$latest_key" --download-only
    echo "[$(date -Iseconds)] Auto drill completed successfully."
  } | tee -a "$log_file"
  auto_drill_rc=$?
  set -e

  if [[ "$auto_drill_rc" -ne 0 ]]; then
    report_status="error"
    drill_result="auto_download_only_failed"
    write_report
    exit "$auto_drill_rc"
  fi
  drill_result="auto_download_only_ok"
fi

write_report
