#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
DEFAULT_ENV_FILE="${ROOT_DIR}/.env"
ENV_FILE="${ESL_HOST_HEALTH_ENV_FILE:-${PG_BACKUP_ENV_FILE:-$DEFAULT_ENV_FILE}}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: required host/runtime health environment file is missing: $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
. "$ENV_FILE"
set +a

HOST_STATE_DIR="${ESL_HOST_HEALTH_STATE_DIR:-${PG_BACKUP_HOST_STATE_DIR:-/var/lib/esl-pipeline/ops}}"
if [[ "$HOST_STATE_DIR" != /* ]]; then
  echo "ERROR: ESL_HOST_HEALTH_STATE_DIR must be an absolute host path: $HOST_STATE_DIR" >&2
  exit 1
fi
case "$HOST_STATE_DIR" in
  "$ROOT_DIR" | "$ROOT_DIR"/*)
    echo "ERROR: host/runtime health state must be outside the application checkout: $HOST_STATE_DIR" >&2
    exit 1
    ;;
esac

STATE_DIR="${HOST_STATE_DIR%/}/state"
LOG_DIR="${HOST_STATE_DIR%/}/logs"
mkdir -p "$STATE_DIR" "$LOG_DIR"
export ESL_HOST_HEALTH_STATE_DIR="$HOST_STATE_DIR"
export ESL_HOST_HEALTH_ALERT_STATE_FILE="${ESL_HOST_HEALTH_ALERT_STATE_FILE:-${STATE_DIR}/host-runtime-health-alert-state.json}"

RETENTION_DAYS="${ESL_HOST_HEALTH_LOG_RETENTION_DAYS:-30}"
if [[ ! "$RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]]; then
  echo "ERROR: ESL_HOST_HEALTH_LOG_RETENTION_DAYS must be a positive integer." >&2
  exit 1
fi
find "$LOG_DIR" -maxdepth 1 -type f -name 'host-runtime-health-????????.log' -mtime "+${RETENTION_DAYS}" -delete

STAMP="$(date -u +%Y%m%d)"
LOG_FILE="${LOG_DIR%/}/host-runtime-health-${STAMP}.log"

node "${ROOT_DIR}/scripts/docker/host-runtime-health-alert.mjs" | tee -a "$LOG_FILE"
