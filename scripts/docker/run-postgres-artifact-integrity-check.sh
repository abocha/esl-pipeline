#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEFAULT_ENV_FILE="${ROOT_DIR}/.env"
COMMON_SCRIPT="${ROOT_DIR}/scripts/docker/postgres-ops-common.sh"
BACKUP_S3_SCRIPT="${ROOT_DIR}/scripts/docker/postgres-backup-s3.sh"

# shellcheck source=scripts/docker/postgres-ops-common.sh
. "$COMMON_SCRIPT"

ENV_FILE="${PG_BACKUP_ENV_FILE:-$DEFAULT_ENV_FILE}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck source=/dev/null
  . "$ENV_FILE"
  set +a
fi

HOST_STATE_DIR="$(pg_backup_resolve_host_state_dir)"
LOG_DIR="${PG_BACKUP_LOG_DIR:-${HOST_STATE_DIR}/logs}"
REPORT_DIR="${HOST_STATE_DIR}/reports"
BACKUP_DIR="${PG_BACKUP_DIR:-${HOST_STATE_DIR}/backups/postgres}"
S3_BUCKET="${PG_BACKUP_S3_BUCKET:-${S3_BUCKET:-}}"
S3_PREFIX_BASE="${PG_BACKUP_S3_PREFIX:-backups/postgres}"
S3_REGION="${PG_BACKUP_S3_REGION:-${AWS_REGION:-}}"
S3_PROFILE="${PG_BACKUP_S3_PROFILE:-}"
S3_ENV="${PG_BACKUP_S3_ENV:-dev}"
DB_NAME="${PG_DATABASE:-esl_batch}"

mkdir -p "$LOG_DIR" "$REPORT_DIR"
stamp="$(date -u +%Y%m%d_%H%M%S)"
log_file="${LOG_DIR}/postgres-artifact-integrity-${stamp}.log"
report_file="${REPORT_DIR}/artifact-integrity-report-${stamp}.json"
latest_report_file="${REPORT_DIR}/artifact-integrity-report-latest.json"

status="error"
result="not_started"
dump_key=""
dump_last_modified_utc=""
local_dump_path=""
dump_sha256=""
checksum_verified="false"

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "$value"
}

write_report() {
  local tmp_report="${report_file}.tmp.$$"
  cat >"$tmp_report" <<EOF
{
  "timestamp_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "status": "$(json_escape "$status")",
  "result": "$(json_escape "$result")",
  "namespace": "$(json_escape "$S3_ENV")",
  "database": "$(json_escape "$DB_NAME")",
  "remote_dump_key": "$(json_escape "$dump_key")",
  "remote_last_modified_utc": "$(json_escape "$dump_last_modified_utc")",
  "checksum_verified": ${checksum_verified},
  "dump_sha256": "$(json_escape "$dump_sha256")",
  "local_dump_path": "$(json_escape "$local_dump_path")"
}
EOF
  mv "$tmp_report" "$report_file"
  cp "$report_file" "$latest_report_file"
  if [[ -n "${PG_BACKUP_ARTIFACT_RESULT_FILE:-}" ]]; then
    printf '%s\n' "$local_dump_path" >"$PG_BACKUP_ARTIFACT_RESULT_FILE"
  fi
}

on_exit() {
  local rc="$1"
  set +e
  if [[ "$rc" -eq 0 ]]; then
    status="ok"
  fi
  write_report
}
trap 'on_exit "$?"' EXIT

if [[ ! -x "$BACKUP_S3_SCRIPT" ]]; then
  result="missing_backup_s3_script"
  echo "ERROR: backup S3 script is missing or not executable: $BACKUP_S3_SCRIPT" | tee -a "$log_file" >&2
  exit 1
fi
if [[ -z "$S3_BUCKET" || -z "$S3_REGION" ]]; then
  result="missing_s3_config"
  echo "ERROR: PG_BACKUP_S3_BUCKET and PG_BACKUP_S3_REGION/AWS_REGION are required." | tee -a "$log_file" >&2
  exit 1
fi
if [[ $# -gt 1 ]]; then
  result="invalid_arguments"
  echo "Usage: run-postgres-artifact-integrity-check.sh [dump-key-or-s3-uri]" | tee -a "$log_file" >&2
  exit 1
fi

if [[ $# -eq 1 ]]; then
  dump_key="$1"
else
  prefix="${S3_PREFIX_BASE%/}/${S3_ENV}/${DB_NAME}/"
  latest_output="$(pg_backup_latest_remote_dump "$S3_BUCKET" "$prefix" "$S3_REGION" "$S3_PROFILE")" || {
    result="s3_query_failed"
    echo "ERROR: failed querying latest dump under s3://${S3_BUCKET}/${prefix}" | tee -a "$log_file" >&2
    exit 1
  }
  read -r dump_key dump_last_modified_utc <<<"$latest_output"
  if [[ -z "$dump_key" || "$dump_key" == "None" ]]; then
    dump_key=""
    result="no_remote_dump_found"
    echo "ERROR: no .dump backups found under s3://${S3_BUCKET}/${prefix}" | tee -a "$log_file" >&2
    exit 1
  fi
fi

echo "[$(date -Iseconds)] Checking remote backup artifact: ${dump_key}" | tee -a "$log_file"
set +e
PG_BACKUP_DIR="$BACKUP_DIR" PG_BACKUP_NOTIFY_SUPPRESS=true \
  "$BACKUP_S3_SCRIPT" verify-remote "$dump_key" 2>&1 | tee -a "$log_file"
verify_rc=${PIPESTATUS[0]}
set -e
if [[ "$verify_rc" -ne 0 ]]; then
  result="download_or_checksum_failed"
  exit "$verify_rc"
fi

local_dump_path="${BACKUP_DIR}/remote-restore/$(basename "$dump_key")"
if [[ ! -f "$local_dump_path" ]]; then
  result="verified_dump_missing_from_staging"
  echo "ERROR: verified dump was not found at expected staging path: $local_dump_path" | tee -a "$log_file" >&2
  exit 1
fi

dump_sha256="$(sha256sum "$local_dump_path" | awk '{print $1}')"
checksum_verified="true"
result="download_checksum_verified"
echo "[$(date -Iseconds)] Artifact integrity check succeeded: ${local_dump_path}" | tee -a "$log_file"
