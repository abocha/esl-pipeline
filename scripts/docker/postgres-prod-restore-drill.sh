#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${ROOT_DIR}/scripts/docker/postgres-ops-common.sh"

pg_backup_set_production_defaults "$ROOT_DIR"

exec bash "${ROOT_DIR}/scripts/docker/run-postgres-restore-drill.sh" "$@"
