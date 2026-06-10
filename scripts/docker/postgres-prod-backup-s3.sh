#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

export PG_COMPOSE_PROJECT="${PG_COMPOSE_PROJECT:-esl-pipeline-prod}"
export PG_COMPOSE_FILE="${PG_COMPOSE_FILE:-${ROOT_DIR}/docker-compose.prod.yml}"
export PG_CONTAINER_NAME="${PG_CONTAINER_NAME:-${PG_COMPOSE_PROJECT}-postgres-1}"

exec "${ROOT_DIR}/scripts/docker/postgres-backup-s3.sh" "$@"
