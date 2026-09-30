#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
EXPECTED_ROOT="/opt/esl-pipeline"
UNIT_SOURCE_DIR="${ROOT_DIR}/deploy/systemd"
UNIT_TARGET_DIR="/etc/systemd/system"

die() {
  echo "ERROR: $*" >&2
  exit 1
}

if [[ "${EUID}" -ne 0 ]]; then
  die "run this installer with sudo from ${EXPECTED_ROOT}"
fi

[[ "${ROOT_DIR}" == "${EXPECTED_ROOT}" ]] \
  || die "expected checkout at ${EXPECTED_ROOT}; found ${ROOT_DIR}"
[[ -d "${UNIT_SOURCE_DIR}" ]] || die "systemd unit source directory is missing: ${UNIT_SOURCE_DIR}"

units=(
  esl-postgres-backup.service
  esl-postgres-backup.timer
  esl-postgres-artifact-integrity.service
  esl-postgres-artifact-integrity.timer
  esl-postgres-restore-drill.service
  esl-postgres-restore-drill.timer
  esl-postgres-ops-alert.service
  esl-postgres-ops-alert.timer
)
for unit in "${units[@]}"; do
  source_path="${UNIT_SOURCE_DIR}/${unit}"
  target_path="${UNIT_TARGET_DIR}/${unit}"
  [[ -f "${source_path}" ]] || die "required unit file is missing: ${source_path}"

  if ! cmp -s "${source_path}" "${target_path}"; then
    install -m 0644 "${source_path}" "${target_path}"
    echo "Installed ${unit}"
  fi
done

systemctl daemon-reload
echo "systemd manager reloaded"
