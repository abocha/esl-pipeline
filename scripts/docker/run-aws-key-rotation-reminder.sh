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

LOG_DIR="${PG_BACKUP_LOG_DIR:-$DEFAULT_LOG_DIR}"
KEY_MAX_AGE_DAYS="${PG_BACKUP_KEY_ROTATION_MAX_AGE_DAYS:-80}"
IAM_USER="${PG_BACKUP_IAM_USER:-}"
S3_PROFILE="${PG_BACKUP_S3_PROFILE:-}"

TELEGRAM_DISABLE="${PG_BACKUP_ALERT_TELEGRAM_DISABLE:-false}"
TELEGRAM_BOT_TOKEN="${PG_BACKUP_ALERT_TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${PG_BACKUP_ALERT_TELEGRAM_CHAT_ID:-}"
TELEGRAM_THREAD_ID="${PG_BACKUP_ALERT_TELEGRAM_THREAD_ID:-}"

mkdir -p "$LOG_DIR"
STAMP="$(date +%Y%m%d_%H%M%S)"
LOG_FILE="${LOG_DIR}/aws-key-rotation-reminder-${STAMP}.log"

log_line() {
  echo "[$(date -Iseconds)] $*" | tee -a "$LOG_FILE"
}

can_send_telegram() {
  [[ "$TELEGRAM_DISABLE" != "true" && -n "$TELEGRAM_BOT_TOKEN" && -n "$TELEGRAM_CHAT_ID" ]]
}

send_telegram() {
  local text="$1"
  local url="https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage"
  local args=(-sS -X POST "$url" -d "chat_id=${TELEGRAM_CHAT_ID}" --data-urlencode "text=${text}" -d "disable_web_page_preview=true")
  if [[ -n "$TELEGRAM_THREAD_ID" ]]; then
    args+=(-d "message_thread_id=${TELEGRAM_THREAD_ID}")
  fi
  curl "${args[@]}" >/dev/null
}

send_error_alert_if_possible() {
  local text="$1"
  if can_send_telegram; then
    send_telegram "$text" || true
  fi
}

aws_cmd() {
  local args=()
  if [[ -n "$S3_PROFILE" ]]; then
    args+=(--profile "$S3_PROFILE")
  fi
  aws "${args[@]}" "$@"
}

to_epoch() {
  local ts="$1"
  date -u -d "$ts" +%s 2>/dev/null
}

if [[ -z "$IAM_USER" ]]; then
  ARN="$(aws_cmd sts get-caller-identity --query Arn --output text 2>/dev/null || true)"
  if [[ "$ARN" == arn:aws:iam::*:user/* ]]; then
    IAM_USER="${ARN##*/}"
  fi
fi

if [[ -z "$IAM_USER" ]]; then
  log_line "ERROR: unable to determine IAM user; set PG_BACKUP_IAM_USER."
  send_error_alert_if_possible "ESL key-rotation reminder failed: unable to determine IAM user. Set PG_BACKUP_IAM_USER."
  exit 1
fi

RAW_KEYS="$(aws_cmd iam list-access-keys --user-name "$IAM_USER" --query "AccessKeyMetadata[?Status=='Active'].[AccessKeyId,CreateDate]" --output text 2>&1)" || LIST_RC=$?
LIST_RC="${LIST_RC:-0}"
if [[ "$LIST_RC" -ne 0 ]]; then
  log_line "ERROR: iam list-access-keys failed for ${IAM_USER}: ${RAW_KEYS}"
  send_error_alert_if_possible "ESL key-rotation reminder failed for ${IAM_USER}: iam list-access-keys denied or errored."
  exit 1
fi

NOW_EPOCH="$(date -u +%s)"
OLDEST_AGE_DAYS=-1
OLDEST_KEY=""
OLDEST_CREATED=""

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
    OLDEST_KEY="$ACCESS_KEY_ID"
    OLDEST_CREATED="$CREATE_DATE"
  fi
done <<<"$RAW_KEYS"

if [[ -z "$OLDEST_KEY" ]]; then
  log_line "ERROR: no active IAM access keys found for ${IAM_USER}."
  send_error_alert_if_possible "ESL key-rotation reminder failed for ${IAM_USER}: no active IAM access keys found."
  exit 1
fi

LAST_USED="$(aws_cmd iam get-access-key-last-used --access-key-id "$OLDEST_KEY" --query "AccessKeyLastUsed.LastUsedDate" --output text 2>/dev/null || true)"
if [[ "$LAST_USED" == "None" ]]; then
  LAST_USED=""
fi

if (( OLDEST_AGE_DAYS >= KEY_MAX_AGE_DAYS )); then
  MESSAGE=$(
    cat <<EOF
ESL key-rotation reminder: threshold exceeded.

IAM user: ${IAM_USER}
Oldest active key: ${OLDEST_KEY}
Key created: ${OLDEST_CREATED}
Last used: ${LAST_USED:-unknown}
Age: ${OLDEST_AGE_DAYS}d (threshold ${KEY_MAX_AGE_DAYS}d)
EOF
  )

  if can_send_telegram; then
    if send_telegram "$MESSAGE"; then
      log_line "Telegram key-rotation alert sent (age=${OLDEST_AGE_DAYS}d)."
    else
      log_line "WARN: failed to send Telegram key-rotation alert."
    fi
  else
    log_line "WARN: threshold exceeded but Telegram is missing/disabled."
  fi

  log_line "ERROR: key age threshold exceeded (${OLDEST_AGE_DAYS}d >= ${KEY_MAX_AGE_DAYS}d)."
  exit 1
fi

log_line "OK: oldest active key age ${OLDEST_AGE_DAYS}d (< ${KEY_MAX_AGE_DAYS}d)."
exit 0
