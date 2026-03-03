#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEFAULT_COMPOSE_FILE="${ROOT_DIR}/docker-compose.yml"

PROJECT_NAME="${COMPOSE_PROJECT_NAME:-esl-pipeline}"
COMPOSE_FILE="${COMPOSE_FILE:-$DEFAULT_COMPOSE_FILE}"

compose() {
  docker compose -p "${PROJECT_NAME}" -f "${COMPOSE_FILE}" "$@"
}

echo "Recovering Docker dev stack for project '${PROJECT_NAME}'..."

echo "Stopping existing services..."
compose down --remove-orphans

echo "Removing stale one-off backend containers (if any)..."
ONEOFF_IDS="$(
  docker ps -aq \
    --filter "label=com.docker.compose.project=${PROJECT_NAME}" \
    --filter "label=com.docker.compose.service=batch-backend" \
    --filter "label=com.docker.compose.oneoff=True"
)"
if [[ -n "${ONEOFF_IDS}" ]]; then
  # shellcheck disable=SC2086
  docker rm -f ${ONEOFF_IDS} >/dev/null
fi

echo "Starting services..."
compose up -d

echo "Recovery complete."
compose ps
