#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEFAULT_BACKUP_DIR="${ROOT_DIR}/tmp/backups/postgres"
DEFAULT_RESTORE_SCRIPT="${ROOT_DIR}/scripts/docker/postgres-backup-restore.sh"
DEFAULT_ENV_FILE="${ROOT_DIR}/.env.batch-backend"

ENV_FILE="${PG_BACKUP_ENV_FILE:-$DEFAULT_ENV_FILE}"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck source=/dev/null
  . "$ENV_FILE"
  set +a
fi

BACKUP_DIR="${PG_BACKUP_DIR:-$DEFAULT_BACKUP_DIR}"
RESTORE_SCRIPT="${PG_BACKUP_LOCAL_SCRIPT:-$DEFAULT_RESTORE_SCRIPT}"
DB_NAME="${PG_DATABASE:-esl_batch}"

S3_BUCKET="${PG_BACKUP_S3_BUCKET:-${S3_BUCKET:-}}"
S3_PREFIX_BASE="${PG_BACKUP_S3_PREFIX:-backups/postgres}"
S3_REGION="${PG_BACKUP_S3_REGION:-${AWS_REGION:-}}"
S3_SSE="${PG_BACKUP_S3_SSE:-aws:kms}"
S3_KMS_KEY_ID="${PG_BACKUP_S3_KMS_KEY_ID:-}"
S3_ENV="${PG_BACKUP_S3_ENV:-dev}"
S3_PROFILE="${PG_BACKUP_S3_PROFILE:-}"
PG_BACKUP_NOTIFY_SUPPRESS="${PG_BACKUP_NOTIFY_SUPPRESS:-false}"
PG_BACKUP_ALERT_TELEGRAM_DISABLE="${PG_BACKUP_ALERT_TELEGRAM_DISABLE:-false}"
PG_BACKUP_ALERT_TELEGRAM_BOT_TOKEN="${PG_BACKUP_ALERT_TELEGRAM_BOT_TOKEN:-}"
PG_BACKUP_ALERT_TELEGRAM_CHAT_ID="${PG_BACKUP_ALERT_TELEGRAM_CHAT_ID:-}"
PG_BACKUP_ALERT_TELEGRAM_THREAD_ID="${PG_BACKUP_ALERT_TELEGRAM_THREAD_ID:-}"

NOTIFY_ACTION=""
NOTIFY_STEP="startup"
NOTIFY_START_EPOCH=0
NOTIFY_SOURCE=""
NOTIFY_TARGET=""
NOTIFY_FAILURE_HINT=""
NOTIFY_RESTORE_MODE="apply_restore"
S3_BACKUP_GUARD_SUMMARY="n/a"
RESOLVED_DUMP_FILE=""

print_usage() {
  cat <<'USAGE'
Usage:
  postgres-backup-s3.sh backup-upload [label] [--from-latest]
  postgres-backup-s3.sh upload-latest
  postgres-backup-s3.sh list-remote
  postgres-backup-s3.sh restore-remote <s3://bucket/key.dump|key.dump> [--clean] [--download-only]

Environment overrides:
  PG_BACKUP_DIR            (default: <repo>/tmp/backups/postgres)
  PG_BACKUP_LOCAL_SCRIPT   (default: <repo>/scripts/docker/postgres-backup-restore.sh)
  PG_BACKUP_ENV_FILE       (default: <repo>/.env.batch-backend when present)
  PG_DATABASE              (default: esl_batch)

  PG_BACKUP_S3_BUCKET      (required)
  PG_BACKUP_S3_PREFIX      (default: backups/postgres)
  PG_BACKUP_S3_REGION      (default: AWS_REGION)
  PG_BACKUP_S3_SSE         (default: aws:kms)
  PG_BACKUP_S3_KMS_KEY_ID  (required when SSE=aws:kms)
  PG_BACKUP_S3_ENV         (default: dev)
  PG_BACKUP_S3_PROFILE     (optional aws profile)

Notes:
  - backup-upload creates a new local backup by default, then uploads all four backup artifacts.
  - --from-latest reuses the latest local .dump set without creating a new backup.
  - restore-remote downloads a .dump + .sha256, verifies digest, then delegates to postgres-backup-restore.sh.
  - completion Telegram notifications reuse PG_BACKUP_ALERT_TELEGRAM_* config.
USAGE
}

require_commands() {
  local cmd
  for cmd in aws sha256sum date find awk; do
    if ! command -v "$cmd" >/dev/null 2>&1; then
      echo "ERROR: required command not found: $cmd" >&2
      exit 1
    fi
  done
  if [[ ! -x "$RESTORE_SCRIPT" ]]; then
    echo "ERROR: local backup script not executable: $RESTORE_SCRIPT" >&2
    exit 1
  fi
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
  if [[ "$value" == s3://* || "$value" == backups/* ]]; then
    printf '%s' "$value"
    return 0
  fi
  basename "$value"
}

extract_guard_decision() {
  local summary="${1:-}"
  local decision
  decision="$(printf '%s' "$summary" | sed -n 's/.*decision=\([^;]*\).*/\1/p')"
  if [[ -z "$decision" ]]; then
    printf 'n/a'
  else
    printf '%s' "$decision"
  fi
}

extract_guard_override_used() {
  local summary="${1:-}"
  local override_used
  override_used="$(printf '%s' "$summary" | sed -n 's/.*override_used=\([^;]*\).*/\1/p')"
  if [[ -z "$override_used" ]]; then
    printf 'n/a'
  else
    printf '%s' "$override_used"
  fi
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
  local guard_decision guard_emoji guard_override_used
  local esc_guard_decision esc_guard_summary
  local esc_step esc_hint esc_restore_mode
  end_epoch="$(date -u +%s)"
  if (( NOTIFY_START_EPOCH > 0 && end_epoch >= NOTIFY_START_EPOCH )); then
    elapsed_seconds="$((end_epoch - NOTIFY_START_EPOCH))"
  else
    elapsed_seconds=0
  fi
  now_utc="$(date -u '+%Y-%m-%d %H:%M:%S UTC')"

  if [[ "$NOTIFY_ACTION" != "backup-upload" && "$NOTIFY_ACTION" != "restore-remote" ]]; then
    return 0
  fi
  if is_notification_suppressed; then
    return 0
  fi

  case "$NOTIFY_ACTION" in
    backup-upload) action_title="Backup Upload" ;;
    restore-remote) action_title="Remote Restore" ;;
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

  if [[ "$NOTIFY_ACTION" == "backup-upload" ]]; then
    guard_decision="$(extract_guard_decision "$S3_BACKUP_GUARD_SUMMARY")"
    case "$guard_decision" in
      allow_non_empty) guard_emoji="🟢" ;;
      allow_override) guard_emoji="🟡" ;;
      block_empty) guard_emoji="🔴" ;;
      *) guard_emoji="⚪" ;;
    esac
    guard_override_used="$(extract_guard_override_used "$S3_BACKUP_GUARD_SUMMARY")"
    esc_guard_decision="$(html_escape "$guard_decision")"
    esc_guard_summary="$(html_escape "${S3_BACKUP_GUARD_SUMMARY:-n/a}")"
    message+=$'\n\n'"<b>Guard</b> ${guard_emoji} <code>${esc_guard_decision}</code>"
    message+=$'\n'"<code>${esc_guard_summary}</code>"
    if [[ "$guard_override_used" == "true" ]]; then
      message+=$'\n'"<b>Override</b> ⚠️ <code>PG_BACKUP_ALLOW_EMPTY_SOURCE=true</code>"
    fi
  fi
  if [[ "$NOTIFY_ACTION" == "restore-remote" ]]; then
    esc_restore_mode="$(html_escape "${NOTIFY_RESTORE_MODE:-unknown}")"
    message+=$'\n\n'"<b>Mode</b> <code>${esc_restore_mode}</code>"
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
  if [[ "$NOTIFY_ACTION" == "backup-upload" || "$NOTIFY_ACTION" == "restore-remote" ]]; then
    if [[ "$rc" -eq 0 ]]; then
      emit_completion_notification "success" "$rc"
    else
      emit_completion_notification "failure" "$rc"
    fi
  fi
  return 0
}

trap 'on_exit "$?"' EXIT

aws_cmd() {
  local args=(--region "$S3_REGION")
  if [[ -n "$S3_PROFILE" ]]; then
    args+=(--profile "$S3_PROFILE")
  fi
  aws "${args[@]}" "$@"
}

require_s3_base_config() {
  if [[ -z "$S3_BUCKET" ]]; then
    NOTIFY_FAILURE_HINT="PG_BACKUP_S3_BUCKET is required"
    echo "ERROR: PG_BACKUP_S3_BUCKET is required." >&2
    exit 1
  fi
  if [[ -z "$S3_REGION" ]]; then
    NOTIFY_FAILURE_HINT="PG_BACKUP_S3_REGION or AWS_REGION is required"
    echo "ERROR: PG_BACKUP_S3_REGION or AWS_REGION is required." >&2
    exit 1
  fi
}

require_upload_encryption_config() {
  if [[ "$S3_SSE" == "aws:kms" && -z "$S3_KMS_KEY_ID" ]]; then
    NOTIFY_FAILURE_HINT="PG_BACKUP_S3_KMS_KEY_ID is required when PG_BACKUP_S3_SSE=aws:kms"
    echo "ERROR: PG_BACKUP_S3_KMS_KEY_ID is required when PG_BACKUP_S3_SSE=aws:kms." >&2
    exit 1
  fi
}

latest_local_dump() {
  find "$BACKUP_DIR" -maxdepth 1 -type f -name '*.dump' -printf '%T@ %p\n' 2>/dev/null \
    | sort -nr \
    | head -n 1 \
    | awk '{print $2}'
}

resolve_set_files_from_dump() {
  local dump_file="$1"
  local prefix="${dump_file%.dump}"
  local plain_gz="${prefix}.sql.gz"
  local schema_sql="${prefix}_schema.sql"
  local checksum_file="${prefix}.sha256"

  local missing=()
  [[ -f "$dump_file" ]] || missing+=("$dump_file")
  [[ -f "$plain_gz" ]] || missing+=("$plain_gz")
  [[ -f "$schema_sql" ]] || missing+=("$schema_sql")
  [[ -f "$checksum_file" ]] || missing+=("$checksum_file")

  if [[ ${#missing[@]} -gt 0 ]]; then
    echo "ERROR: incomplete backup set for dump: $dump_file" >&2
    printf 'Missing files:\n' >&2
    printf '  - %s\n' "${missing[@]}" >&2
    exit 1
  fi

  printf '%s\n%s\n%s\n%s\n' "$dump_file" "$plain_gz" "$schema_sql" "$checksum_file"
}

extract_ymd_from_prefix() {
  local prefix_basename="$1"
  local year month day
  if [[ "$prefix_basename" =~ ^${DB_NAME}_([0-9]{4})([0-9]{2})([0-9]{2})_ ]]; then
    year="${BASH_REMATCH[1]}"
    month="${BASH_REMATCH[2]}"
    day="${BASH_REMATCH[3]}"
  else
    year="$(date +%Y)"
    month="$(date +%m)"
    day="$(date +%d)"
  fi
  printf '%s\n%s\n%s\n' "$year" "$month" "$day"
}

build_key_root() {
  local dump_file="$1"
  local prefix_basename
  prefix_basename="$(basename "${dump_file%.dump}")"

  local ymd
  ymd="$(extract_ymd_from_prefix "$prefix_basename")"
  local year month day
  year="$(echo "$ymd" | sed -n '1p')"
  month="$(echo "$ymd" | sed -n '2p')"
  day="$(echo "$ymd" | sed -n '3p')"

  printf '%s/%s/%s/%s/%s/%s' \
    "${S3_PREFIX_BASE%/}" "$S3_ENV" "$DB_NAME" "$year" "$month" "$day/$prefix_basename"
}

upload_one_file() {
  local file_path="$1"
  local key_path="$2"

  local metadata="project=esl-pipeline,env=${S3_ENV},db=${DB_NAME},source=postgres-backup-restore"

  local args=(s3 cp "$file_path" "s3://${S3_BUCKET}/${key_path}" --only-show-errors --sse "$S3_SSE" --metadata "$metadata")
  if [[ "$S3_SSE" == "aws:kms" ]]; then
    args+=(--sse-kms-key-id "$S3_KMS_KEY_ID")
  fi

  aws_cmd "${args[@]}"
  if ! aws_cmd s3api put-object-tagging \
    --bucket "$S3_BUCKET" \
    --key "$key_path" \
    --tagging "TagSet=[{Key=project,Value=esl-pipeline},{Key=env,Value=${S3_ENV}},{Key=db,Value=${DB_NAME}},{Key=source,Value=postgres-backup-restore}]" \
    >/dev/null 2>&1; then
    echo "WARN: could not set object tags on s3://${S3_BUCKET}/${key_path}; continuing."
  fi
  echo "Uploaded: s3://${S3_BUCKET}/${key_path}"
}

upload_set_from_dump() {
  local dump_file="$1"

  local files
  files="$(resolve_set_files_from_dump "$dump_file")"
  local custom_dump plain_gz schema_sql checksum_file
  custom_dump="$(echo "$files" | sed -n '1p')"
  plain_gz="$(echo "$files" | sed -n '2p')"
  schema_sql="$(echo "$files" | sed -n '3p')"
  checksum_file="$(echo "$files" | sed -n '4p')"

  local key_root
  key_root="$(build_key_root "$custom_dump")"

  NOTIFY_STEP="upload_custom_dump"
  upload_one_file "$custom_dump" "${key_root}/$(basename "$custom_dump")"
  NOTIFY_STEP="upload_plain_sql_gz"
  upload_one_file "$plain_gz" "${key_root}/$(basename "$plain_gz")"
  NOTIFY_STEP="upload_schema_sql"
  upload_one_file "$schema_sql" "${key_root}/$(basename "$schema_sql")"
  NOTIFY_STEP="upload_checksum"
  upload_one_file "$checksum_file" "${key_root}/$(basename "$checksum_file")"
  NOTIFY_TARGET="s3://${S3_BUCKET}/${key_root}/"
  NOTIFY_STEP="upload_complete"

  echo "Upload complete for set: $(basename "${custom_dump%.dump}")"
}

create_or_reuse_dump() {
  local label="$1"
  local from_latest="$2"

  mkdir -p "$BACKUP_DIR"

  if [[ "$from_latest" == "true" ]]; then
    local existing
    existing="$(latest_local_dump || true)"
    if [[ -z "$existing" ]]; then
      NOTIFY_FAILURE_HINT="--from-latest requested but no local .dump files found"
      echo "ERROR: --from-latest requested but no local .dump files found in $BACKUP_DIR" >&2
      exit 1
    fi
    S3_BACKUP_GUARD_SUMMARY="n/a (from_latest=true; empty-source guard applies to backup creation paths)"
    RESOLVED_DUMP_FILE="$existing"
    return
  fi

  NOTIFY_STEP="create_local_backup"
  local restore_log_file
  restore_log_file="$(mktemp)"
  set +e
  if [[ -n "$label" ]]; then
    PG_BACKUP_NOTIFY_SUPPRESS=true "$RESTORE_SCRIPT" backup "$label" 2>&1 | tee "$restore_log_file" >&2
  else
    PG_BACKUP_NOTIFY_SUPPRESS=true "$RESTORE_SCRIPT" backup 2>&1 | tee "$restore_log_file" >&2
  fi
  local restore_rc="${PIPESTATUS[0]}"
  set -e
  if [[ "$restore_rc" -ne 0 ]]; then
    NOTIFY_FAILURE_HINT="local backup phase failed before S3 upload"
    rm -f "$restore_log_file"
    exit "$restore_rc"
  fi

  local guard_line
  guard_line="$(grep -F "Backup guard summary:" "$restore_log_file" | tail -n 1 || true)"
  if [[ -n "$guard_line" ]]; then
    S3_BACKUP_GUARD_SUMMARY="${guard_line#Backup guard summary: }"
  else
    S3_BACKUP_GUARD_SUMMARY="not_reported_by_local_backup"
  fi
  rm -f "$restore_log_file"

  local created
  created="$(latest_local_dump || true)"
  if [[ -z "$created" ]]; then
    NOTIFY_FAILURE_HINT="backup finished but no .dump file found"
    echo "ERROR: backup completed but no .dump file was found in $BACKUP_DIR" >&2
    exit 1
  fi

  RESOLVED_DUMP_FILE="$created"
}

split_s3_input() {
  local input="$1"
  if [[ "$input" == s3://* ]]; then
    local rest="${input#s3://}"
    local bucket="${rest%%/*}"
    local key="${rest#*/}"
    if [[ -z "$bucket" || -z "$key" || "$bucket" == "$rest" ]]; then
      NOTIFY_FAILURE_HINT="invalid S3 URI provided to restore-remote"
      echo "ERROR: invalid S3 URI: $input" >&2
      exit 1
    fi
    printf '%s\n%s\n' "$bucket" "$key"
    return
  fi

  printf '%s\n%s\n' "$S3_BUCKET" "$input"
}

download_and_verify_dump() {
  local s3_input="$1"
  local staging_dir="$2"

  local split
  split="$(split_s3_input "$s3_input")"
  local bucket key
  bucket="$(echo "$split" | sed -n '1p')"
  key="$(echo "$split" | sed -n '2p')"

  if [[ "$key" != *.dump ]]; then
    NOTIFY_FAILURE_HINT="restore-remote requires a .dump key/uri"
    echo "ERROR: restore-remote requires a .dump key/uri, got: $key" >&2
    exit 1
  fi

  mkdir -p "$staging_dir"

  local local_dump
  local sha_key
  local local_sha
  local_dump="${staging_dir}/$(basename "$key")"
  sha_key="${key%.dump}.sha256"
  local_sha="${staging_dir}/$(basename "$sha_key")"

  NOTIFY_STEP="download_remote_dump"
  if ! aws_cmd s3 cp "s3://${bucket}/${key}" "$local_dump" --only-show-errors; then
    NOTIFY_FAILURE_HINT="failed to download remote dump object"
    echo "ERROR: failed to download remote dump: s3://${bucket}/${key}" >&2
    exit 1
  fi
  NOTIFY_STEP="download_remote_checksum"
  if ! aws_cmd s3 cp "s3://${bucket}/${sha_key}" "$local_sha" --only-show-errors; then
    NOTIFY_FAILURE_HINT="failed to download remote checksum object"
    echo "ERROR: failed to download remote checksum: s3://${bucket}/${sha_key}" >&2
    exit 1
  fi

  NOTIFY_STEP="verify_downloaded_checksum"
  local expected_hash
  expected_hash="$(awk '/\.dump$/ {print $1}' "$local_sha" | head -n 1)"
  if [[ -z "$expected_hash" ]]; then
    NOTIFY_FAILURE_HINT="downloaded checksum file did not contain a .dump hash"
    echo "ERROR: could not find .dump hash entry in checksum file: $local_sha" >&2
    exit 1
  fi

  local actual_hash
  actual_hash="$(sha256sum "$local_dump" | awk '{print $1}')"
  if [[ "$expected_hash" != "$actual_hash" ]]; then
    NOTIFY_FAILURE_HINT="checksum mismatch for downloaded dump"
    echo "ERROR: checksum mismatch for downloaded dump." >&2
    echo "  expected: $expected_hash" >&2
    echo "  actual:   $actual_hash" >&2
    exit 1
  fi

  echo "$local_dump"
}

do_backup_upload() {
  local label="$1"
  local from_latest="$2"

  NOTIFY_STEP="validate_s3_config"
  require_s3_base_config
  require_upload_encryption_config
  NOTIFY_STEP="prepare_local_dump"
  create_or_reuse_dump "$label" "$from_latest"
  local dump_file="$RESOLVED_DUMP_FILE"
  if [[ -z "$dump_file" ]]; then
    NOTIFY_FAILURE_HINT="backup phase did not produce resolved dump path"
    echo "ERROR: backup phase completed without resolved dump path." >&2
    exit 1
  fi
  NOTIFY_SOURCE="$dump_file"

  NOTIFY_STEP="upload_backup_set"
  upload_set_from_dump "$dump_file"
}

do_upload_latest() {
  require_s3_base_config
  require_upload_encryption_config
  local dump_file
  dump_file="$(latest_local_dump || true)"
  if [[ -z "$dump_file" ]]; then
    echo "ERROR: no local .dump file found in $BACKUP_DIR" >&2
    exit 1
  fi
  echo "INFO: upload-latest does not run empty-source guard (guard applies to backup creation flows)."
  upload_set_from_dump "$dump_file"
}

do_list_remote() {
  require_s3_base_config
  local prefix="${S3_PREFIX_BASE%/}/${S3_ENV}/${DB_NAME}/"
  echo "Listing remote backups under s3://${S3_BUCKET}/${prefix}"
  local key_count
  key_count="$(aws_cmd s3api list-objects-v2 --bucket "$S3_BUCKET" --prefix "$prefix" --max-keys 1 --query 'KeyCount' --output text)"
  if [[ "$key_count" == "0" || "$key_count" == "None" ]]; then
    echo "No remote backups found under that prefix."
    return
  fi
  aws_cmd s3 ls "s3://${S3_BUCKET}/${prefix}" --recursive
}

do_restore_remote() {
  local input="$1"
  local clean_mode="$2"
  local download_only="$3"

  NOTIFY_STEP="validate_s3_config"
  require_s3_base_config

  local staging_dir="${BACKUP_DIR}/remote-restore"
  local local_dump
  NOTIFY_STEP="download_and_verify_remote_dump"
  local_dump="$(download_and_verify_dump "$input" "$staging_dir")"
  NOTIFY_SOURCE="$input"
  NOTIFY_TARGET="$local_dump"

  if [[ "$download_only" == "true" ]]; then
    NOTIFY_RESTORE_MODE="download_only"
    NOTIFY_STEP="download_only_complete"
    echo "Download + checksum verification complete: $local_dump"
    return
  fi

  NOTIFY_RESTORE_MODE="apply_restore"
  NOTIFY_STEP="restore_local_database"
  if [[ "$clean_mode" == "true" ]]; then
    PG_BACKUP_NOTIFY_SUPPRESS=true "$RESTORE_SCRIPT" restore "$local_dump" --clean
  else
    PG_BACKUP_NOTIFY_SUPPRESS=true "$RESTORE_SCRIPT" restore "$local_dump"
  fi
  NOTIFY_STEP="restore_remote_complete"
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
    backup-upload)
      NOTIFY_ACTION="backup-upload"
      NOTIFY_START_EPOCH="$(date -u +%s)"
      NOTIFY_STEP="parse_backup_upload_args"
      local label=""
      local from_latest="false"

      while [[ $# -gt 0 ]]; do
        case "$1" in
          --)
            shift
            ;;
          --from-latest)
            from_latest="true"
            shift
            ;;
          --*)
            echo "ERROR: unknown option: $1" >&2
            print_usage
            exit 1
            ;;
          *)
            if [[ -n "$label" ]]; then
              echo "ERROR: multiple labels provided: '$label' and '$1'" >&2
              exit 1
            fi
            label="$1"
            shift
            ;;
        esac
      done

      do_backup_upload "$label" "$from_latest"
      ;;
    upload-latest)
      do_upload_latest
      ;;
    list-remote)
      do_list_remote
      ;;
    restore-remote)
      NOTIFY_ACTION="restore-remote"
      NOTIFY_START_EPOCH="$(date -u +%s)"
      NOTIFY_STEP="parse_restore_remote_args"
      if [[ "${1:-}" == "--" ]]; then
        shift
      fi
      if [[ $# -lt 1 ]]; then
        NOTIFY_FAILURE_HINT="restore-remote requires input dump key/uri"
        echo "ERROR: restore-remote requires <s3://bucket/key.dump|key.dump>" >&2
        print_usage
        exit 1
      fi

      local input="$1"
      shift
      local clean_mode="false"
      local download_only="false"

      while [[ $# -gt 0 ]]; do
        case "$1" in
          --clean)
            clean_mode="true"
            shift
            ;;
          --download-only)
            download_only="true"
            shift
            ;;
          *)
            echo "ERROR: unknown option: $1" >&2
            print_usage
            exit 1
            ;;
        esac
      done

      do_restore_remote "$input" "$clean_mode" "$download_only"
      ;;
    *)
      echo "ERROR: unknown action: $action" >&2
      print_usage
      exit 1
      ;;
  esac
}

main "$@"
