#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEFAULT_ENV_FILE="${ROOT_DIR}/.env"
DEFAULT_LOG_DIR="${ROOT_DIR}/tmp/logs/backup"

ENV_FILE="${PG_BACKUP_ENV_FILE:-$DEFAULT_ENV_FILE}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
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

Outputs backup/drill/key-rotation operational health.
USAGE
  exit 0
elif [[ $# -gt 0 ]]; then
  echo "ERROR: unknown option: $1" >&2
  exit 1
fi

LOG_DIR="${PG_BACKUP_LOG_DIR:-$DEFAULT_LOG_DIR}"
REPORT_LATEST_FILE="${PG_BACKUP_RESTORE_DRILL_REPORT_LATEST:-${LOG_DIR}/restore-drill-report-latest.json}"
BACKUP_MAX_AGE_HOURS="${PG_BACKUP_HEALTH_MAX_BACKUP_AGE_HOURS:-26}"
DRILL_MAX_AGE_DAYS="${PG_BACKUP_HEALTH_MAX_DRILL_AGE_DAYS:-35}"
KEY_MAX_AGE_DAYS="${PG_BACKUP_KEY_ROTATION_MAX_AGE_DAYS:-80}"

S3_BUCKET="${PG_BACKUP_S3_BUCKET:-${S3_BUCKET:-}}"
S3_PREFIX_BASE="${PG_BACKUP_S3_PREFIX:-backups/postgres}"
S3_REGION="${PG_BACKUP_S3_REGION:-${AWS_REGION:-}}"
S3_ENV="${PG_BACKUP_S3_ENV:-dev}"
S3_PROFILE="${PG_BACKUP_S3_PROFILE:-}"
DB_NAME="${PG_DATABASE:-esl_batch}"
IAM_USER="${PG_BACKUP_IAM_USER:-}"

NOW_EPOCH="$(date -u +%s)"
CHECKED_AT_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

BACKUP_STATE="degraded"
BACKUP_REASON="backup check not executed"
BACKUP_LATEST_KEY=""
BACKUP_LAST_MODIFIED_UTC=""
BACKUP_AGE_HOURS=""

DRILL_STATE="degraded"
DRILL_REASON="restore drill check not executed"
DRILL_LAST_REPORT_UTC=""
DRILL_AGE_DAYS=""
DRILL_REPORT_STATUS=""
DRILL_REPORT_MODE=""
DRILL_LATEST_REMOTE_DUMP_KEY=""
DRILL_RESULT=""

KEY_STATE="degraded"
KEY_REASON="key rotation check not executed"
KEY_OLDEST_ACCESS_KEY_ID=""
KEY_OLDEST_CREATED_UTC=""
KEY_OLDEST_AGE_DAYS=""
KEY_OLDEST_LAST_USED_UTC=""

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
  local value="$1"
  if [[ -z "$value" ]]; then
    printf 'null'
  else
    printf '"%s"' "$(json_escape "$value")"
  fi
}

json_number_or_null() {
  local value="$1"
  if [[ "$value" =~ ^-?[0-9]+$ ]]; then
    printf '%s' "$value"
  else
    printf 'null'
  fi
}

to_epoch() {
  local ts="$1"
  if [[ -z "$ts" ]]; then
    return 1
  fi
  date -u -d "$ts" +%s 2>/dev/null || return 1
}

derive_iam_user_from_caller() {
  local arn
  arn="$(aws_cmd sts get-caller-identity --query Arn --output text 2>/dev/null || true)"
  if [[ "$arn" == arn:aws:iam::*:user/* ]]; then
    echo "${arn##*/}"
    return 0
  fi
  return 1
}

aws_cmd() {
  local args=()
  if [[ -n "$S3_PROFILE" ]]; then
    args+=(--profile "$S3_PROFILE")
  fi
  aws "${args[@]}" "$@"
}

if [[ -z "$IAM_USER" ]]; then
  IAM_USER="$(derive_iam_user_from_caller || true)"
fi

if [[ -z "$S3_BUCKET" || -z "$S3_REGION" ]]; then
  BACKUP_STATE="degraded"
  BACKUP_REASON="PG_BACKUP_S3_BUCKET and PG_BACKUP_S3_REGION/AWS_REGION are required."
else
  BACKUP_RC=0
  BACKUP_PREFIX="${S3_PREFIX_BASE%/}/${S3_ENV}/${DB_NAME}/"
  BACKUP_RAW="$(
    aws_cmd --region "$S3_REGION" s3api list-objects-v2 \
      --bucket "$S3_BUCKET" \
      --prefix "$BACKUP_PREFIX" \
      --query "sort_by(Contents[?ends_with(Key, '.dump')], &LastModified)[-1].[Key,LastModified]" \
      --output text 2>&1
  )" || BACKUP_RC=$?
  BACKUP_RC="${BACKUP_RC:-0}"

  if [[ "$BACKUP_RC" -ne 0 ]]; then
    BACKUP_STATE="degraded"
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
        BACKUP_STATE="degraded"
        BACKUP_REASON="could not parse backup timestamp: ${BACKUP_LAST_MODIFIED_UTC}"
      else
        BACKUP_AGE_HOURS="$(((NOW_EPOCH - BACKUP_TS_EPOCH) / 3600))"
        if (( BACKUP_AGE_HOURS < 0 )); then
          BACKUP_AGE_HOURS=0
        fi
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

if [[ ! -f "$REPORT_LATEST_FILE" ]]; then
  DRILL_STATE="degraded"
  DRILL_REASON="restore drill report not found at ${REPORT_LATEST_FILE}"
else
  DRILL_PARSE_RC=0
  DRILL_VALUES="$(
    node - "$REPORT_LATEST_FILE" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
const report = JSON.parse(fs.readFileSync(file, 'utf8'));
const values = [
  report.timestamp_utc ?? '',
  report.status ?? '',
  report.mode ?? '',
  report.latest_remote_dump_key ?? '',
  report.drill_result ?? '',
];
process.stdout.write(values.map((v) => String(v).replace(/\t/g, ' ')).join('\t'));
NODE
  )" || DRILL_PARSE_RC=$?
  DRILL_PARSE_RC="${DRILL_PARSE_RC:-0}"

  if [[ "$DRILL_PARSE_RC" -ne 0 ]]; then
    DRILL_STATE="degraded"
    DRILL_REASON="could not parse restore drill report JSON."
  else
    read -r DRILL_LAST_REPORT_UTC DRILL_REPORT_STATUS DRILL_REPORT_MODE DRILL_LATEST_REMOTE_DUMP_KEY DRILL_RESULT <<<"$DRILL_VALUES"
    DRILL_TS_EPOCH="$(to_epoch "$DRILL_LAST_REPORT_UTC" || true)"
    if [[ -z "$DRILL_TS_EPOCH" ]]; then
      DRILL_STATE="degraded"
      DRILL_REASON="restore drill report has invalid timestamp: ${DRILL_LAST_REPORT_UTC}"
    else
      DRILL_AGE_DAYS="$(((NOW_EPOCH - DRILL_TS_EPOCH) / 86400))"
      if (( DRILL_AGE_DAYS < 0 )); then
        DRILL_AGE_DAYS=0
      fi

      if (( DRILL_AGE_DAYS > DRILL_MAX_AGE_DAYS )); then
        DRILL_STATE="critical"
        DRILL_REASON="last drill report is ${DRILL_AGE_DAYS}d old (threshold ${DRILL_MAX_AGE_DAYS}d)."
      elif [[ "$DRILL_REPORT_STATUS" == "error" ]]; then
        DRILL_STATE="critical"
        DRILL_REASON="last drill report status is error (${DRILL_RESULT})."
      elif [[ "$DRILL_REPORT_STATUS" == "warn_missing_remote_dump" ]]; then
        DRILL_STATE="critical"
        DRILL_REASON="last drill reported missing remote dump."
      elif [[ "$DRILL_REPORT_STATUS" == "ok" ]]; then
        DRILL_STATE="healthy"
        DRILL_REASON="last drill report is healthy (${DRILL_AGE_DAYS}d old)."
      else
        DRILL_STATE="degraded"
        DRILL_REASON="last drill report status is unknown (${DRILL_REPORT_STATUS})."
      fi
    fi
  fi
fi

if [[ -z "$IAM_USER" ]]; then
  KEY_STATE="degraded"
  KEY_REASON="unable to determine IAM username; set PG_BACKUP_IAM_USER."
else
  KEY_RC=0
  KEY_RAW="$(aws_cmd iam list-access-keys --user-name "$IAM_USER" --query "AccessKeyMetadata[?Status=='Active'].[AccessKeyId,CreateDate]" --output text 2>&1)" || KEY_RC=$?
  KEY_RC="${KEY_RC:-0}"

  if [[ "$KEY_RC" -ne 0 ]]; then
    KEY_STATE="degraded"
    KEY_REASON="failed to list IAM access keys for ${IAM_USER}: ${KEY_RAW}"
  else
    OLDEST_AGE_DAYS=-1
    while read -r ACCESS_KEY_ID CREATE_DATE; do
      if [[ -z "$ACCESS_KEY_ID" || "$ACCESS_KEY_ID" == "None" ]]; then
        continue
      fi
      CREATE_EPOCH="$(to_epoch "$CREATE_DATE" || true)"
      if [[ -z "$CREATE_EPOCH" ]]; then
        continue
      fi
      AGE_DAYS="$(((NOW_EPOCH - CREATE_EPOCH) / 86400))"
      if (( AGE_DAYS > OLDEST_AGE_DAYS )); then
        OLDEST_AGE_DAYS="$AGE_DAYS"
        KEY_OLDEST_ACCESS_KEY_ID="$ACCESS_KEY_ID"
        KEY_OLDEST_CREATED_UTC="$CREATE_DATE"
      fi
    done <<<"$KEY_RAW"

    if [[ -z "$KEY_OLDEST_ACCESS_KEY_ID" ]]; then
      KEY_STATE="degraded"
      KEY_REASON="no active IAM access keys found for ${IAM_USER}."
    else
      KEY_OLDEST_AGE_DAYS="$OLDEST_AGE_DAYS"
      KEY_OLDEST_LAST_USED_UTC="$(aws_cmd iam get-access-key-last-used --access-key-id "$KEY_OLDEST_ACCESS_KEY_ID" --query "AccessKeyLastUsed.LastUsedDate" --output text 2>/dev/null || true)"
      if [[ "$KEY_OLDEST_LAST_USED_UTC" == "None" ]]; then
        KEY_OLDEST_LAST_USED_UTC=""
      fi

      if (( KEY_OLDEST_AGE_DAYS >= KEY_MAX_AGE_DAYS )); then
        KEY_STATE="critical"
        KEY_REASON="oldest active key is ${KEY_OLDEST_AGE_DAYS}d old (threshold ${KEY_MAX_AGE_DAYS}d)."
      else
        KEY_STATE="healthy"
        KEY_REASON="oldest active key age ${KEY_OLDEST_AGE_DAYS}d within threshold."
      fi
    fi
  fi
fi

OVERALL_STATE="healthy"
OVERALL_REASONS=()

for STATE in "$BACKUP_STATE" "$DRILL_STATE" "$KEY_STATE"; do
  if [[ "$STATE" == "critical" ]]; then
    OVERALL_STATE="critical"
    break
  fi
  if [[ "$STATE" == "degraded" && "$OVERALL_STATE" != "critical" ]]; then
    OVERALL_STATE="degraded"
  fi
done

if [[ "$BACKUP_STATE" != "healthy" ]]; then
  OVERALL_REASONS+=("backup: ${BACKUP_REASON}")
fi
if [[ "$DRILL_STATE" != "healthy" ]]; then
  OVERALL_REASONS+=("restoreDrill: ${DRILL_REASON}")
fi
if [[ "$KEY_STATE" != "healthy" ]]; then
  OVERALL_REASONS+=("keyRotation: ${KEY_REASON}")
fi

if [[ "$OUTPUT_MODE" == "json" ]]; then
  printf '{\n'
  printf '  "checkedAtUtc": "%s",\n' "$(json_escape "$CHECKED_AT_UTC")"
  printf '  "overall": {\n'
  printf '    "state": "%s",\n' "$(json_escape "$OVERALL_STATE")"
  printf '    "reasons": ['
  for i in "${!OVERALL_REASONS[@]}"; do
    if (( i > 0 )); then
      printf ', '
    fi
    printf '"%s"' "$(json_escape "${OVERALL_REASONS[$i]}")"
  done
  printf ']\n'
  printf '  },\n'
  printf '  "thresholds": {\n'
  printf '    "backupMaxAgeHours": %s,\n' "$(json_number_or_null "$BACKUP_MAX_AGE_HOURS")"
  printf '    "drillMaxAgeDays": %s,\n' "$(json_number_or_null "$DRILL_MAX_AGE_DAYS")"
  printf '    "keyRotationMaxAgeDays": %s\n' "$(json_number_or_null "$KEY_MAX_AGE_DAYS")"
  printf '  },\n'
  printf '  "backup": {\n'
  printf '    "state": "%s",\n' "$(json_escape "$BACKUP_STATE")"
  printf '    "reason": "%s",\n' "$(json_escape "$BACKUP_REASON")"
  printf '    "latestDumpKey": %s,\n' "$(json_string_or_null "$BACKUP_LATEST_KEY")"
  printf '    "lastModifiedUtc": %s,\n' "$(json_string_or_null "$BACKUP_LAST_MODIFIED_UTC")"
  printf '    "ageHours": %s\n' "$(json_number_or_null "$BACKUP_AGE_HOURS")"
  printf '  },\n'
  printf '  "restoreDrill": {\n'
  printf '    "state": "%s",\n' "$(json_escape "$DRILL_STATE")"
  printf '    "reason": "%s",\n' "$(json_escape "$DRILL_REASON")"
  printf '    "lastReportUtc": %s,\n' "$(json_string_or_null "$DRILL_LAST_REPORT_UTC")"
  printf '    "ageDays": %s,\n' "$(json_number_or_null "$DRILL_AGE_DAYS")"
  printf '    "reportStatus": %s,\n' "$(json_string_or_null "$DRILL_REPORT_STATUS")"
  printf '    "reportMode": %s,\n' "$(json_string_or_null "$DRILL_REPORT_MODE")"
  printf '    "latestRemoteDumpKey": %s,\n' "$(json_string_or_null "$DRILL_LATEST_REMOTE_DUMP_KEY")"
  printf '    "drillResult": %s\n' "$(json_string_or_null "$DRILL_RESULT")"
  printf '  },\n'
  printf '  "keyRotation": {\n'
  printf '    "state": "%s",\n' "$(json_escape "$KEY_STATE")"
  printf '    "reason": "%s",\n' "$(json_escape "$KEY_REASON")"
  printf '    "iamUser": %s,\n' "$(json_string_or_null "$IAM_USER")"
  printf '    "oldestAccessKeyId": %s,\n' "$(json_string_or_null "$KEY_OLDEST_ACCESS_KEY_ID")"
  printf '    "oldestCreatedUtc": %s,\n' "$(json_string_or_null "$KEY_OLDEST_CREATED_UTC")"
  printf '    "oldestAgeDays": %s,\n' "$(json_number_or_null "$KEY_OLDEST_AGE_DAYS")"
  printf '    "oldestLastUsedUtc": %s\n' "$(json_string_or_null "$KEY_OLDEST_LAST_USED_UTC")"
  printf '  }\n'
  printf '}\n'
  exit 0
fi

echo "Postgres Ops Status (${CHECKED_AT_UTC})"
echo "Overall: ${OVERALL_STATE}"
echo
printf '%-14s %-9s %s\n' "Component" "State" "Details"
printf '%-14s %-9s %s\n' "backup" "$BACKUP_STATE" "$BACKUP_REASON"
printf '%-14s %-9s %s\n' "restoreDrill" "$DRILL_STATE" "$DRILL_REASON"
printf '%-14s %-9s %s\n' "keyRotation" "$KEY_STATE" "$KEY_REASON"

if [[ "${#OVERALL_REASONS[@]}" -gt 0 ]]; then
  echo
  echo "Reasons:"
  for REASON in "${OVERALL_REASONS[@]}"; do
    echo "- ${REASON}"
  done
fi
