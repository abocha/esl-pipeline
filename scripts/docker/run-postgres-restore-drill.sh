#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEFAULT_ENV_FILE="${ROOT_DIR}/.env"
COMMON_SCRIPT="${ROOT_DIR}/scripts/docker/postgres-ops-common.sh"
INTEGRITY_SCRIPT="${ROOT_DIR}/scripts/docker/run-postgres-artifact-integrity-check.sh"

# shellcheck source=scripts/docker/postgres-ops-common.sh
. "$COMMON_SCRIPT"

ENV_FILE="$(pg_backup_select_env_file "$ROOT_DIR" "${PG_BACKUP_ENV_FILE:-$DEFAULT_ENV_FILE}")"
[[ "$ENV_FILE" != /etc/esl-pipeline/production.env ]] || umask 0077
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck source=/dev/null
  . "$ENV_FILE"
  set +a
fi

HOST_STATE_DIR="$(pg_backup_resolve_host_state_dir)"
LOG_DIR="${PG_BACKUP_LOG_DIR:-${HOST_STATE_DIR}/logs}"
REPORT_DIR="${HOST_STATE_DIR}/reports"
RUN_DIR="${HOST_STATE_DIR}/run"
IMAGE="${PG_BACKUP_RESTORE_DRILL_IMAGE:-postgres:18.6-alpine3.24}"
EXPECTED_VERSION="${PG_BACKUP_RESTORE_DRILL_EXPECTED_VERSION:-18.6}"
DRILL_DB="esl_restore_drill"
DRILL_USER="esl_restore_drill"

mkdir -p "$LOG_DIR" "$REPORT_DIR" "$RUN_DIR"
stamp="$(date -u +%Y%m%d_%H%M%S)"
resource_suffix="${stamp}-$$"
container_name="esl-pg-restore-drill-${resource_suffix}"
volume_name="esl-pg-restore-drill-${resource_suffix}"
log_file="${LOG_DIR}/postgres-restore-drill-${stamp}.log"
report_file="${REPORT_DIR}/restore-drill-report-${stamp}.json"
latest_report_file="${REPORT_DIR}/restore-drill-report-latest.json"
integrity_result_file="${RUN_DIR}/artifact-path-${resource_suffix}"

status="error"
result="not_started"
remote_dump_key="${1:-}"
local_dump_path=""
postgres_version=""
public_table_count=""
schema_migration_count=""
users_count=""
jobs_count=""
transcripts_count=""
checksum_verified="false"
restore_verified="false"
cleanup_status="not_started"
container_created="false"
container_run_attempted="false"
volume_created="false"

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "$value"
}

json_number_or_null() {
  if [[ "${1:-}" =~ ^[0-9]+$ ]]; then
    printf '%s' "$1"
  else
    printf 'null'
  fi
}

write_report() {
  local tmp_report="${report_file}.tmp.$$"
  local tmp_latest="${latest_report_file}.tmp.$$"
  cat >"$tmp_report" <<EOF || return 1
{
  "timestamp_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "status": "$(json_escape "$status")",
  "result": "$(json_escape "$result")",
  "remote_dump_key": "$(json_escape "$remote_dump_key")",
  "local_dump_path": "$(json_escape "$local_dump_path")",
  "postgres_image": "$(json_escape "$IMAGE")",
  "postgres_version": "$(json_escape "$postgres_version")",
  "checksum_verified": ${checksum_verified},
  "restore_verified": ${restore_verified},
  "verification": {
    "public_table_count": $(json_number_or_null "$public_table_count"),
    "schema_migration_count": $(json_number_or_null "$schema_migration_count"),
    "anchor_row_counts": {
      "users": $(json_number_or_null "$users_count"),
      "jobs": $(json_number_or_null "$jobs_count"),
      "transcripts": $(json_number_or_null "$transcripts_count")
    }
  },
  "isolation": {
    "published_ports": false,
    "network": "none",
    "production_volume_touched": false
  },
  "cleanup_status": "$(json_escape "$cleanup_status")"
}
EOF
  mv "$tmp_report" "$report_file" || return 1
  cp "$report_file" "$tmp_latest" || return 1
  mv -T "$tmp_latest" "$latest_report_file" || return 1
}

cleanup() {
  local cleanup_rc=0
  local owned_container=""
  if [[ "$container_run_attempted" == "true" && "$container_created" != "true" ]]; then
    # A failed run may already have created the container. Match both this invocation's exact
    # name and label; a name collision must never authorize removal of someone else's resource.
    if owned_container="$(docker container ls --all --filter "name=^/${container_name}$" --filter "label=esl-pipeline.restore-drill-run=${resource_suffix}" --format '{{.Names}}')"; then
      if [[ "$owned_container" == "$container_name" ]]; then container_created="true"; fi
    else
      echo "ERROR: could not determine failed-start container cleanup state: ${container_name}" | tee -a "$log_file" >&2
      cleanup_rc=1
    fi
  fi
  if [[ "$container_created" == "true" ]]; then
    if ! docker rm -f "$container_name" >/dev/null 2>&1; then
      echo "ERROR: could not remove disposable container: ${container_name}" | tee -a "$log_file" >&2
      cleanup_rc=1
    fi
  fi
  if [[ "$volume_created" == "true" ]]; then
    if ! docker volume rm "$volume_name" >/dev/null 2>&1; then
      echo "ERROR: could not remove disposable volume: ${volume_name}" | tee -a "$log_file" >&2
      cleanup_rc=1
    fi
  fi
  if ! rm -f "$integrity_result_file"; then cleanup_rc=1; fi
  if [[ "$cleanup_rc" -eq 0 ]]; then
    cleanup_status="removed"
  else
    cleanup_status="failed"
  fi
  return "$cleanup_rc"
}

on_exit() {
  local rc="$1"
  local operation_rc="$1" operation_result="$result"
  trap - EXIT
  set +e
  if ! cleanup; then
    echo "ERROR: disposable cleanup failed (operation exit=${operation_rc}, result=${operation_result}); inspect the named resources above." | tee -a "$log_file" >&2
    if [[ "$rc" -eq 0 ]]; then
      rc=1
      status="error"
      result="disposable_cleanup_failed"
    fi
  fi
  if ! write_report; then
    echo "ERROR: evidence publication failed (operation exit=${operation_rc}, result=${operation_result}, status=${status}, cleanup=${cleanup_status}). Expected report: ${report_file}; latest report was not replaced and must not be treated as this run: ${latest_report_file}" | tee -a "$log_file" >&2
    rm -f "${report_file}.tmp.$$" "${latest_report_file}.tmp.$$"
    if [[ "$rc" -eq 0 ]]; then rc=1; fi
  fi
  exit "$rc"
}
trap 'on_exit "$?"' EXIT

if [[ $# -gt 1 ]]; then
  result="invalid_arguments"
  echo "Usage: run-postgres-restore-drill.sh [dump-key-or-s3-uri]" | tee -a "$log_file" >&2
  exit 1
fi
for command_name in docker node; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    result="missing_${command_name}"
    echo "ERROR: required command not found: $command_name" | tee -a "$log_file" >&2
    exit 1
  fi
done
if [[ ! -f "$INTEGRITY_SCRIPT" ]]; then
  result="missing_integrity_script"
  echo "ERROR: artifact integrity script is missing or not a regular file: $INTEGRITY_SCRIPT" | tee -a "$log_file" >&2
  exit 1
fi

echo "[$(date -Iseconds)] Starting isolated PostgreSQL restore drill" | tee -a "$log_file"
integrity_args=()
if [[ -n "$remote_dump_key" ]]; then
  integrity_args+=("$remote_dump_key")
fi
set +e
PG_BACKUP_ARTIFACT_RESULT_FILE="$integrity_result_file" \
  bash "$INTEGRITY_SCRIPT" "${integrity_args[@]}" 2>&1 | tee -a "$log_file"
integrity_rc=${PIPESTATUS[0]}
set -e
if [[ "$integrity_rc" -ne 0 ]]; then
  result="artifact_integrity_failed"
  exit "$integrity_rc"
fi
local_dump_path="$(head -n 1 "$integrity_result_file")"
if [[ -z "$local_dump_path" || ! -f "$local_dump_path" ]]; then
  result="verified_dump_path_missing"
  echo "ERROR: artifact integrity check did not return a usable dump path." | tee -a "$log_file" >&2
  exit 1
fi
if [[ -z "$remote_dump_key" ]]; then
  remote_dump_key="$(node -e "const fs=require('node:fs');const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(d.remote_dump_key ?? '')" "${REPORT_DIR}/artifact-integrity-report-latest.json")"
fi
checksum_verified="true"

result="create_disposable_volume"
docker volume create --label esl-pipeline.role=postgres-restore-drill "$volume_name" >/dev/null
volume_created="true"

result="start_disposable_postgres"
container_run_attempted="true"
docker run -d \
  --name "$container_name" \
  --network none \
  --label esl-pipeline.role=postgres-restore-drill \
  --label "esl-pipeline.restore-drill-run=${resource_suffix}" \
  --mount "type=volume,source=${volume_name},target=/var/lib/postgresql" \
  -e "POSTGRES_DB=${DRILL_DB}" \
  -e "POSTGRES_USER=${DRILL_USER}" \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  "$IMAGE" >/dev/null
container_created="true"

result="wait_for_disposable_postgres"
ready="false"
for _ in $(seq 1 60); do
  if docker exec "$container_name" pg_isready -U "$DRILL_USER" -d "$DRILL_DB" >/dev/null 2>&1; then
    ready="true"
    break
  fi
  sleep 1
done
if [[ "$ready" != "true" ]]; then
  echo "ERROR: disposable PostgreSQL did not become ready within 60 seconds." | tee -a "$log_file" >&2
  exit 1
fi

result="restore_dump"
docker exec -i "$container_name" pg_restore \
  --exit-on-error --no-owner --no-privileges \
  -U "$DRILL_USER" -d "$DRILL_DB" <"$local_dump_path" 2>&1 | tee -a "$log_file"

result="verify_restored_schema_and_reads"
postgres_version="$(docker exec "$container_name" psql -X -A -t -v ON_ERROR_STOP=1 -U "$DRILL_USER" -d "$DRILL_DB" -c 'SHOW server_version;')"
if [[ "$postgres_version" != "$EXPECTED_VERSION" && "$postgres_version" != "${EXPECTED_VERSION}."* ]]; then
  echo "ERROR: disposable PostgreSQL version ${postgres_version} does not match expected ${EXPECTED_VERSION}." | tee -a "$log_file" >&2
  exit 1
fi
public_table_count="$(docker exec "$container_name" psql -X -A -t -v ON_ERROR_STOP=1 -U "$DRILL_USER" -d "$DRILL_DB" -c "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public';")"
schema_migration_count="$(docker exec "$container_name" psql -X -A -t -v ON_ERROR_STOP=1 -U "$DRILL_USER" -d "$DRILL_DB" -c 'SELECT count(*) FROM public.schema_migrations;')"
anchor_counts="$(docker exec "$container_name" psql -X -A -t -F $'\t' -v ON_ERROR_STOP=1 -U "$DRILL_USER" -d "$DRILL_DB" -c 'SELECT (SELECT count(*) FROM public.users), (SELECT count(*) FROM public.jobs), (SELECT count(*) FROM public.transcripts);')"
read -r users_count jobs_count transcripts_count <<<"$anchor_counts"

if (( public_table_count < 1 || schema_migration_count < 1 )); then
  echo "ERROR: restored database failed schema verification (tables=${public_table_count}, migrations=${schema_migration_count})." | tee -a "$log_file" >&2
  exit 1
fi

restore_verified="true"
status="ok"
result="restore_schema_and_reads_verified"
echo "[$(date -Iseconds)] Restore drill succeeded (PostgreSQL ${postgres_version}, tables=${public_table_count}, migrations=${schema_migration_count})." | tee -a "$log_file"
