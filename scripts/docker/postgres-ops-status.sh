#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEFAULT_ENV_FILE="${ROOT_DIR}/.env"
COMMON_SCRIPT="${ROOT_DIR}/scripts/docker/postgres-ops-common.sh"

# shellcheck source=scripts/docker/postgres-ops-common.sh
. "$COMMON_SCRIPT"

ENV_FILE="${PG_BACKUP_ENV_FILE:-$DEFAULT_ENV_FILE}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck source=/dev/null
  . "$ENV_FILE"
  set +a
fi

OUTPUT_MODE="table"
if [[ "${1:-}" == "--json" ]]; then
  OUTPUT_MODE="json"
elif [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'USAGE'
Usage:
  postgres-ops-status.sh [--json]

Outputs backup freshness, remote artifact integrity, and disposable restore-drill health.
USAGE
  exit 0
elif [[ $# -gt 0 ]]; then
  echo "ERROR: unknown option: $1" >&2
  exit 1
fi

HOST_STATE_DIR="$(pg_backup_resolve_host_state_dir)"
REPORT_DIR="${HOST_STATE_DIR}/reports"
INTEGRITY_REPORT_FILE="${REPORT_DIR}/artifact-integrity-report-latest.json"
DRILL_REPORT_FILE="${REPORT_DIR}/restore-drill-report-latest.json"
BACKUP_MAX_AGE_HOURS="${PG_BACKUP_HEALTH_MAX_BACKUP_AGE_HOURS:-26}"
INTEGRITY_MAX_AGE_DAYS="${PG_BACKUP_HEALTH_MAX_INTEGRITY_AGE_DAYS:-8}"
DRILL_MAX_AGE_DAYS="${PG_BACKUP_HEALTH_MAX_DRILL_AGE_DAYS:-35}"

S3_BUCKET="${PG_BACKUP_S3_BUCKET:-${S3_BUCKET:-}}"
S3_PREFIX_BASE="${PG_BACKUP_S3_PREFIX:-backups/postgres}"
S3_REGION="${PG_BACKUP_S3_REGION:-${AWS_REGION:-}}"
S3_ENV="${PG_BACKUP_S3_ENV:-dev}"
S3_PROFILE="${PG_BACKUP_S3_PROFILE:-}"
DB_NAME="${PG_DATABASE:-esl_batch}"

NOW_EPOCH="$(date -u +%s)"
CHECKED_AT_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

BACKUP_STATE="degraded"
BACKUP_REASON="backup check not executed"
BACKUP_LATEST_KEY=""
BACKUP_LAST_MODIFIED_UTC=""
BACKUP_AGE_HOURS=""

INTEGRITY_STATE="degraded"
INTEGRITY_REASON="artifact integrity check not executed"
INTEGRITY_LAST_REPORT_UTC=""
INTEGRITY_AGE_DAYS=""
INTEGRITY_REPORT_STATUS=""
INTEGRITY_RESULT=""
INTEGRITY_REMOTE_DUMP_KEY=""
INTEGRITY_CHECKSUM_VERIFIED="false"

DRILL_STATE="degraded"
DRILL_REASON="restore drill check not executed"
DRILL_LAST_REPORT_UTC=""
DRILL_AGE_DAYS=""
DRILL_REPORT_STATUS=""
DRILL_RESULT=""
DRILL_REMOTE_DUMP_KEY=""
DRILL_POSTGRES_VERSION=""
DRILL_RESTORE_VERIFIED="false"
DRILL_CLEANUP_STATUS=""
DRILL_PUBLIC_TABLE_COUNT=""
DRILL_SCHEMA_MIGRATION_COUNT=""

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "$value"
}

json_string_or_null() {
  if [[ -z "$1" ]]; then printf 'null'; else printf '"%s"' "$(json_escape "$1")"; fi
}

json_number_or_null() {
  if [[ "$1" =~ ^-?[0-9]+$ ]]; then printf '%s' "$1"; else printf 'null'; fi
}

json_bool() {
  if [[ "$1" == "true" ]]; then printf 'true'; else printf 'false'; fi
}

to_epoch() {
  [[ -n "$1" ]] || return 1
  date -u -d "$1" +%s 2>/dev/null
}

age_days_for_timestamp() {
  local report_epoch
  report_epoch="$(to_epoch "$1")" || return 1
  local age="$(((NOW_EPOCH - report_epoch) / 86400))"
  if (( age < 0 )); then age=0; fi
  printf '%s' "$age"
}

if [[ -z "$S3_BUCKET" || -z "$S3_REGION" ]]; then
  BACKUP_REASON="PG_BACKUP_S3_BUCKET and PG_BACKUP_S3_REGION/AWS_REGION are required."
else
  BACKUP_PREFIX="${S3_PREFIX_BASE%/}/${S3_ENV}/${DB_NAME}/"
  BACKUP_RC=0
  BACKUP_RAW="$(pg_backup_latest_remote_dump "$S3_BUCKET" "$BACKUP_PREFIX" "$S3_REGION" "$S3_PROFILE" 2>&1)" || BACKUP_RC=$?
  if [[ "$BACKUP_RC" -ne 0 ]]; then
    BACKUP_REASON="failed to query latest backup from S3: ${BACKUP_RAW}"
  else
    read -r BACKUP_LATEST_KEY BACKUP_LAST_MODIFIED_UTC <<<"$BACKUP_RAW"
    if [[ -z "$BACKUP_LATEST_KEY" || "$BACKUP_LATEST_KEY" == "None" ]]; then
      BACKUP_STATE="critical"
      BACKUP_REASON="no .dump backups found under s3://${S3_BUCKET}/${BACKUP_PREFIX}"
      BACKUP_LATEST_KEY=""
      BACKUP_LAST_MODIFIED_UTC=""
    else
      BACKUP_TS_EPOCH="$(to_epoch "$BACKUP_LAST_MODIFIED_UTC" || true)"
      if [[ -z "$BACKUP_TS_EPOCH" ]]; then
        BACKUP_REASON="could not parse backup timestamp: ${BACKUP_LAST_MODIFIED_UTC}"
      else
        BACKUP_AGE_HOURS="$(((NOW_EPOCH - BACKUP_TS_EPOCH) / 3600))"
        if (( BACKUP_AGE_HOURS < 0 )); then BACKUP_AGE_HOURS=0; fi
        if (( BACKUP_AGE_HOURS > BACKUP_MAX_AGE_HOURS )); then
          BACKUP_STATE="critical"
          BACKUP_REASON="latest backup is ${BACKUP_AGE_HOURS}h old (threshold ${BACKUP_MAX_AGE_HOURS}h)."
        else
          BACKUP_STATE="healthy"
          BACKUP_REASON="latest backup age ${BACKUP_AGE_HOURS}h within threshold."
        fi
      fi
    fi
  fi
fi

if [[ ! -f "$INTEGRITY_REPORT_FILE" ]]; then
  INTEGRITY_REASON="artifact integrity report not found at ${INTEGRITY_REPORT_FILE}"
else
  INTEGRITY_RC=0
  INTEGRITY_VALUES="$(node - "$INTEGRITY_REPORT_FILE" <<'NODE'
const fs = require('node:fs');
const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
process.stdout.write([
  d.timestamp_utc ?? '', d.status ?? '', d.result ?? '', d.remote_dump_key ?? '',
  d.checksum_verified === true ? 'true' : 'false',
].map((v) => String(v).replace(/\u001f/g, ' ')).join('\u001f'));
NODE
  )" || INTEGRITY_RC=$?
  if [[ "$INTEGRITY_RC" -ne 0 ]]; then
    INTEGRITY_REASON="could not parse artifact integrity report JSON."
  else
    IFS=$'\x1f' read -r INTEGRITY_LAST_REPORT_UTC INTEGRITY_REPORT_STATUS INTEGRITY_RESULT INTEGRITY_REMOTE_DUMP_KEY INTEGRITY_CHECKSUM_VERIFIED <<<"$INTEGRITY_VALUES"
    INTEGRITY_AGE_DAYS="$(age_days_for_timestamp "$INTEGRITY_LAST_REPORT_UTC" || true)"
    if [[ -z "$INTEGRITY_AGE_DAYS" ]]; then
      INTEGRITY_REASON="artifact integrity report has invalid timestamp: ${INTEGRITY_LAST_REPORT_UTC}"
    elif (( INTEGRITY_AGE_DAYS > INTEGRITY_MAX_AGE_DAYS )); then
      INTEGRITY_STATE="critical"
      INTEGRITY_REASON="last artifact integrity check is ${INTEGRITY_AGE_DAYS}d old (threshold ${INTEGRITY_MAX_AGE_DAYS}d)."
    elif [[ "$INTEGRITY_REPORT_STATUS" == "ok" && "$INTEGRITY_CHECKSUM_VERIFIED" == "true" ]]; then
      INTEGRITY_STATE="healthy"
      INTEGRITY_REASON="download and checksum were verified ${INTEGRITY_AGE_DAYS}d ago."
    else
      INTEGRITY_STATE="critical"
      INTEGRITY_REASON="last artifact integrity check failed (${INTEGRITY_RESULT:-unknown})."
    fi
  fi
fi

if [[ ! -f "$DRILL_REPORT_FILE" ]]; then
  DRILL_REASON="restore drill report not found at ${DRILL_REPORT_FILE}"
else
  DRILL_RC=0
  DRILL_VALUES="$(node - "$DRILL_REPORT_FILE" <<'NODE'
const fs = require('node:fs');
const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
process.stdout.write([
  d.timestamp_utc ?? '', d.status ?? '', d.result ?? '', d.remote_dump_key ?? '',
  d.postgres_version ?? '', d.restore_verified === true ? 'true' : 'false',
  d.cleanup_status ?? '', d.verification?.public_table_count ?? '',
  d.verification?.schema_migration_count ?? '',
].map((v) => String(v).replace(/\u001f/g, ' ')).join('\u001f'));
NODE
  )" || DRILL_RC=$?
  if [[ "$DRILL_RC" -ne 0 ]]; then
    DRILL_REASON="could not parse restore drill report JSON."
  else
    IFS=$'\x1f' read -r DRILL_LAST_REPORT_UTC DRILL_REPORT_STATUS DRILL_RESULT DRILL_REMOTE_DUMP_KEY DRILL_POSTGRES_VERSION DRILL_RESTORE_VERIFIED DRILL_CLEANUP_STATUS DRILL_PUBLIC_TABLE_COUNT DRILL_SCHEMA_MIGRATION_COUNT <<<"$DRILL_VALUES"
    DRILL_AGE_DAYS="$(age_days_for_timestamp "$DRILL_LAST_REPORT_UTC" || true)"
    if [[ -z "$DRILL_AGE_DAYS" ]]; then
      DRILL_REASON="restore drill report has invalid timestamp: ${DRILL_LAST_REPORT_UTC}"
    elif (( DRILL_AGE_DAYS > DRILL_MAX_AGE_DAYS )); then
      DRILL_STATE="critical"
      DRILL_REASON="last restore drill is ${DRILL_AGE_DAYS}d old (threshold ${DRILL_MAX_AGE_DAYS}d)."
    elif [[ "$DRILL_REPORT_STATUS" == "ok" && "$DRILL_RESTORE_VERIFIED" == "true" && "$DRILL_CLEANUP_STATUS" == "removed" ]]; then
      DRILL_STATE="healthy"
      DRILL_REASON="isolated restore and read verification passed ${DRILL_AGE_DAYS}d ago; disposable state was removed."
    else
      DRILL_STATE="critical"
      DRILL_REASON="last restore drill failed or left unverified cleanup (${DRILL_RESULT:-unknown}, cleanup=${DRILL_CLEANUP_STATUS:-unknown})."
    fi
  fi
fi

OVERALL_STATE="healthy"
OVERALL_REASONS=()
for component_state in "$BACKUP_STATE" "$INTEGRITY_STATE" "$DRILL_STATE"; do
  if [[ "$component_state" == "critical" ]]; then OVERALL_STATE="critical"; break; fi
  if [[ "$component_state" == "degraded" ]]; then OVERALL_STATE="degraded"; fi
done
if [[ "$BACKUP_STATE" != "healthy" ]]; then OVERALL_REASONS+=("backup: ${BACKUP_REASON}"); fi
if [[ "$INTEGRITY_STATE" != "healthy" ]]; then OVERALL_REASONS+=("artifactIntegrity: ${INTEGRITY_REASON}"); fi
if [[ "$DRILL_STATE" != "healthy" ]]; then OVERALL_REASONS+=("restoreDrill: ${DRILL_REASON}"); fi

if [[ "$OUTPUT_MODE" == "json" ]]; then
  printf '{\n'
  printf '  "checkedAtUtc": "%s",\n' "$(json_escape "$CHECKED_AT_UTC")"
  printf '  "overall": {"state": "%s", "reasons": [' "$(json_escape "$OVERALL_STATE")"
  for i in "${!OVERALL_REASONS[@]}"; do
    if (( i > 0 )); then printf ', '; fi
    printf '"%s"' "$(json_escape "${OVERALL_REASONS[$i]}")"
  done
  printf ']},\n'
  printf '  "thresholds": {"backupMaxAgeHours": %s, "integrityMaxAgeDays": %s, "drillMaxAgeDays": %s},\n' "$BACKUP_MAX_AGE_HOURS" "$INTEGRITY_MAX_AGE_DAYS" "$DRILL_MAX_AGE_DAYS"
  printf '  "backup": {"state": "%s", "reason": "%s", "latestDumpKey": %s, "lastModifiedUtc": %s, "ageHours": %s},\n' "$(json_escape "$BACKUP_STATE")" "$(json_escape "$BACKUP_REASON")" "$(json_string_or_null "$BACKUP_LATEST_KEY")" "$(json_string_or_null "$BACKUP_LAST_MODIFIED_UTC")" "$(json_number_or_null "$BACKUP_AGE_HOURS")"
  printf '  "artifactIntegrity": {"state": "%s", "reason": "%s", "lastReportUtc": %s, "ageDays": %s, "reportStatus": %s, "remoteDumpKey": %s, "result": %s, "checksumVerified": %s},\n' "$(json_escape "$INTEGRITY_STATE")" "$(json_escape "$INTEGRITY_REASON")" "$(json_string_or_null "$INTEGRITY_LAST_REPORT_UTC")" "$(json_number_or_null "$INTEGRITY_AGE_DAYS")" "$(json_string_or_null "$INTEGRITY_REPORT_STATUS")" "$(json_string_or_null "$INTEGRITY_REMOTE_DUMP_KEY")" "$(json_string_or_null "$INTEGRITY_RESULT")" "$(json_bool "$INTEGRITY_CHECKSUM_VERIFIED")"
  printf '  "restoreDrill": {"state": "%s", "reason": "%s", "lastReportUtc": %s, "ageDays": %s, "reportStatus": %s, "remoteDumpKey": %s, "result": %s, "postgresVersion": %s, "restoreVerified": %s, "cleanupStatus": %s, "publicTableCount": %s, "schemaMigrationCount": %s}\n' "$(json_escape "$DRILL_STATE")" "$(json_escape "$DRILL_REASON")" "$(json_string_or_null "$DRILL_LAST_REPORT_UTC")" "$(json_number_or_null "$DRILL_AGE_DAYS")" "$(json_string_or_null "$DRILL_REPORT_STATUS")" "$(json_string_or_null "$DRILL_REMOTE_DUMP_KEY")" "$(json_string_or_null "$DRILL_RESULT")" "$(json_string_or_null "$DRILL_POSTGRES_VERSION")" "$(json_bool "$DRILL_RESTORE_VERIFIED")" "$(json_string_or_null "$DRILL_CLEANUP_STATUS")" "$(json_number_or_null "$DRILL_PUBLIC_TABLE_COUNT")" "$(json_number_or_null "$DRILL_SCHEMA_MIGRATION_COUNT")"
  printf '}\n'
  exit 0
fi

echo "Postgres Ops Status (${CHECKED_AT_UTC})"
echo "Overall: ${OVERALL_STATE}"
echo
printf '%-20s %-9s %s\n' "Component" "State" "Details"
printf '%-20s %-9s %s\n' "backup" "$BACKUP_STATE" "$BACKUP_REASON"
printf '%-20s %-9s %s\n' "artifactIntegrity" "$INTEGRITY_STATE" "$INTEGRITY_REASON"
printf '%-20s %-9s %s\n' "restoreDrill" "$DRILL_STATE" "$DRILL_REASON"
if [[ "${#OVERALL_REASONS[@]}" -gt 0 ]]; then
  echo
  echo "Reasons:"
  for reason in "${OVERALL_REASONS[@]}"; do echo "- ${reason}"; done
fi
