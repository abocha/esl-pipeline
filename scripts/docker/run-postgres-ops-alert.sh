#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEFAULT_ENV_FILE="${ROOT_DIR}/.env.batch-backend"
DEFAULT_LOG_DIR="${ROOT_DIR}/tmp/logs/backup"
DEFAULT_STATE_FILE="${ROOT_DIR}/tmp/state/postgres-ops-alert-state.json"
STATUS_SCRIPT="${ROOT_DIR}/scripts/docker/postgres-ops-status.sh"

ENV_FILE="${PG_BACKUP_ENV_FILE:-$DEFAULT_ENV_FILE}"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck source=/dev/null
  set -a
  . "$ENV_FILE"
  set +a
fi

LOG_DIR="${PG_BACKUP_LOG_DIR:-$DEFAULT_LOG_DIR}"
STATE_FILE="${PG_BACKUP_ALERT_STATE_FILE:-$DEFAULT_STATE_FILE}"
COOLDOWN_MINUTES="${PG_BACKUP_ALERT_COOLDOWN_MINUTES:-360}"

TELEGRAM_DISABLE="${PG_BACKUP_ALERT_TELEGRAM_DISABLE:-false}"
TELEGRAM_BOT_TOKEN="${PG_BACKUP_ALERT_TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${PG_BACKUP_ALERT_TELEGRAM_CHAT_ID:-}"
TELEGRAM_THREAD_ID="${PG_BACKUP_ALERT_TELEGRAM_THREAD_ID:-}"

mkdir -p "$LOG_DIR" "$(dirname "$STATE_FILE")"
STAMP="$(date +%Y%m%d_%H%M%S)"
LOG_FILE="${LOG_DIR}/postgres-ops-alert-${STAMP}.log"

log_line() {
  echo "[$(date -Iseconds)] $*" | tee -a "$LOG_FILE"
}

severity_for_state() {
  case "$1" in
    healthy) echo 0 ;;
    degraded) echo 1 ;;
    critical) echo 2 ;;
    *) echo 1 ;;
  esac
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

if [[ ! -x "$STATUS_SCRIPT" ]]; then
  echo "ERROR: missing status script: $STATUS_SCRIPT" >&2
  exit 1
fi

STATUS_JSON="$("$STATUS_SCRIPT" --json)"
CURRENT_STATE="$(printf '%s' "$STATUS_JSON" | node -e "const fs=require('node:fs'); const d=JSON.parse(fs.readFileSync(0,'utf8')); process.stdout.write(d.overall?.state ?? 'degraded');")"
CHECKED_AT_UTC="$(printf '%s' "$STATUS_JSON" | node -e "const fs=require('node:fs'); const d=JSON.parse(fs.readFileSync(0,'utf8')); process.stdout.write(d.checkedAtUtc ?? '');")"
CURRENT_REASONS="$(printf '%s' "$STATUS_JSON" | node -e "const fs=require('node:fs'); const d=JSON.parse(fs.readFileSync(0,'utf8')); const reasons=Array.isArray(d.overall?.reasons)?d.overall.reasons:[]; process.stdout.write(reasons.join('\\n- '));")"
BACKUP_AGE_HOURS="$(printf '%s' "$STATUS_JSON" | node -e "const fs=require('node:fs'); const d=JSON.parse(fs.readFileSync(0,'utf8')); const val=d.backup?.ageHours; process.stdout.write(Number.isInteger(val)?String(val):'');")"
DRILL_AGE_DAYS="$(printf '%s' "$STATUS_JSON" | node -e "const fs=require('node:fs'); const d=JSON.parse(fs.readFileSync(0,'utf8')); const val=d.restoreDrill?.ageDays; process.stdout.write(Number.isInteger(val)?String(val):'');")"
KEY_AGE_DAYS="$(printf '%s' "$STATUS_JSON" | node -e "const fs=require('node:fs'); const d=JSON.parse(fs.readFileSync(0,'utf8')); const val=d.keyRotation?.oldestAgeDays; process.stdout.write(Number.isInteger(val)?String(val):'');")"

NOW_EPOCH="$(date -u +%s)"
CURRENT_SEVERITY="$(severity_for_state "$CURRENT_STATE")"
COOLDOWN_SECONDS="$((COOLDOWN_MINUTES * 60))"

PREV_STATE=""
PREV_SEVERITY=0
PREV_LAST_SENT_EPOCH=0

if [[ -f "$STATE_FILE" ]]; then
  PREV_VALUES="$(
    node - "$STATE_FILE" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
try {
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  const values = [
    state.lastState ?? '',
    Number.isInteger(state.lastSeverity) ? String(state.lastSeverity) : '0',
    Number.isInteger(state.lastSentEpoch) ? String(state.lastSentEpoch) : '0',
  ];
  process.stdout.write(values.join('\t'));
} catch {
  process.stdout.write('\t0\t0');
}
NODE
  )"
  read -r PREV_STATE PREV_SEVERITY PREV_LAST_SENT_EPOCH <<<"$PREV_VALUES"
fi

SHOULD_SEND="false"
ALERT_KIND=""

if [[ "$CURRENT_STATE" == "healthy" ]]; then
  if [[ -n "$PREV_STATE" && "$PREV_STATE" != "healthy" ]]; then
    SHOULD_SEND="true"
    ALERT_KIND="recovery"
  fi
else
  if [[ -z "$PREV_STATE" || "$PREV_STATE" == "healthy" ]]; then
    SHOULD_SEND="true"
    ALERT_KIND="failure"
  elif (( CURRENT_SEVERITY > PREV_SEVERITY )); then
    SHOULD_SEND="true"
    ALERT_KIND="escalation"
  elif (( NOW_EPOCH - PREV_LAST_SENT_EPOCH >= COOLDOWN_SECONDS )); then
    SHOULD_SEND="true"
    ALERT_KIND="cooldown-repeat"
  fi
fi

if [[ "$SHOULD_SEND" == "true" ]]; then
  if can_send_telegram; then
    if [[ "$CURRENT_STATE" == "healthy" ]]; then
      MESSAGE=$(
        cat <<EOF
ESL ops status recovered to healthy.

Checked at: ${CHECKED_AT_UTC}
Backup age: ${BACKUP_AGE_HOURS:-n/a}h
Drill age: ${DRILL_AGE_DAYS:-n/a}d
Key age: ${KEY_AGE_DAYS:-n/a}d
EOF
      )
    else
      MESSAGE=$(
        cat <<EOF
ESL ops alert: ${CURRENT_STATE} (${ALERT_KIND})

Checked at: ${CHECKED_AT_UTC}
Backup age: ${BACKUP_AGE_HOURS:-n/a}h
Drill age: ${DRILL_AGE_DAYS:-n/a}d
Key age: ${KEY_AGE_DAYS:-n/a}d

Reasons:
- ${CURRENT_REASONS}
EOF
      )
    fi

    if send_telegram "$MESSAGE"; then
      log_line "Telegram alert sent (${ALERT_KIND}, state=${CURRENT_STATE})."
      PREV_LAST_SENT_EPOCH="$NOW_EPOCH"
    else
      log_line "WARN: failed to send Telegram alert (${ALERT_KIND}, state=${CURRENT_STATE})."
    fi
  else
    log_line "WARN: alert was triggered but Telegram config is missing/disabled."
  fi
fi

cat >"$STATE_FILE" <<EOF
{
  "lastState": "${CURRENT_STATE}",
  "lastSeverity": ${CURRENT_SEVERITY},
  "lastSentEpoch": ${PREV_LAST_SENT_EPOCH},
  "checkedAtUtc": "${CHECKED_AT_UTC}"
}
EOF

log_line "Current state: ${CURRENT_STATE}"

if [[ "$CURRENT_STATE" == "healthy" ]]; then
  exit 0
fi

exit 1
