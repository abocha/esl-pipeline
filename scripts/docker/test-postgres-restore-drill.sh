#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ $# -ne 2 ]]; then
  echo "Usage: test-postgres-restore-drill.sh <production-format.dump> <matching.sha256>" >&2
  exit 1
fi

dump_file="$(realpath "$1")"
checksum_file="$(realpath "$2")"
if [[ ! -f "$dump_file" || ! -f "$checksum_file" ]]; then
  echo "ERROR: dump and checksum fixtures must both exist." >&2
  exit 1
fi

test_state_dir="$(mktemp -d)"
case "$test_state_dir" in
  /tmp/*) ;;
  *) echo "ERROR: refusing unexpected test state path: $test_state_dir" >&2; exit 1 ;;
esac

cleanup_test_state() {
  rm -rf -- "$test_state_dir"
}
trap cleanup_test_state EXIT

export PG_BACKUP_TEST_DUMP_FILE="$dump_file"
export PG_BACKUP_TEST_CHECKSUM_FILE="$checksum_file"
PG_BACKUP_TEST_REMOTE_KEY="backups/postgres/prod/esl_batch/offline/$(basename "$dump_file")"
export PG_BACKUP_TEST_REMOTE_KEY

aws() {
  local args=" $* "
  if [[ "$args" == *" s3api list-objects-v2 "* ]]; then
    local query=""
    local previous=""
    local argument
    for argument in "$@"; do
      if [[ "$previous" == "--query" ]]; then
        query="$argument"
        break
      fi
      previous="$argument"
    done
    # JMESPath backticks are literal syntax, not shell command substitution.
    # shellcheck disable=SC2016
    if [[ "$query" != 'sort_by((Contents || `[]`)[?ends_with(Key, `.dump`)], &LastModified)[-1].[Key,LastModified]' ]]; then
      echo "ERROR: offline test observed an unsafe latest-backup query: $query" >&2
      return 1
    fi
    printf '%s\t%s\n' "$PG_BACKUP_TEST_REMOTE_KEY" '2026-09-13T00:00:00+00:00'
    return 0
  fi
  if [[ "$args" != *" s3 cp "* ]]; then
    echo "ERROR: offline restore-drill test blocked unexpected AWS call: $*" >&2
    return 1
  fi

  local source_uri=""
  local destination=""
  local previous=""
  local argument
  for argument in "$@"; do
    if [[ "$previous" == "cp" ]]; then
      source_uri="$argument"
    elif [[ -n "$source_uri" && -z "$destination" ]]; then
      destination="$argument"
      break
    fi
    previous="$argument"
  done

  if [[ "$source_uri" == *.dump ]]; then
    cp "$PG_BACKUP_TEST_DUMP_FILE" "$destination"
  elif [[ "$source_uri" == *.sha256 ]]; then
    cp "$PG_BACKUP_TEST_CHECKSUM_FILE" "$destination"
  else
    echo "ERROR: offline restore-drill test blocked unexpected S3 source: $source_uri" >&2
    return 1
  fi
}
export -f aws

export PG_BACKUP_ENV_FILE=/dev/null
export PG_BACKUP_HOST_STATE_DIR="$test_state_dir"
export PG_BACKUP_S3_BUCKET=offline-test-bucket
export PG_BACKUP_S3_REGION=ap-southeast-1
export PG_BACKUP_S3_ENV=prod
export PG_BACKUP_ALERT_TELEGRAM_DISABLE=true

"${ROOT_DIR}/scripts/docker/run-postgres-restore-drill.sh" "$PG_BACKUP_TEST_REMOTE_KEY"

status_json="$("${ROOT_DIR}/scripts/docker/postgres-ops-status.sh" --json)"
# The program is intentionally single-quoted so JavaScript template literals remain untouched.
# shellcheck disable=SC2016
node -e '
const status = JSON.parse(process.argv[1]);
if (status.overall?.state !== "healthy") throw new Error(`overall=${status.overall?.state}`);
if (status.backup?.latestDumpKey !== process.env.PG_BACKUP_TEST_REMOTE_KEY) {
  throw new Error(`latestDumpKey=${status.backup?.latestDumpKey}`);
}
if (status.artifactIntegrity?.checksumVerified !== true) {
  throw new Error("artifact integrity status was not healthy");
}
if (status.restoreDrill?.restoreVerified !== true || status.restoreDrill?.cleanupStatus !== "removed") {
  throw new Error("restore drill status did not report verified cleanup");
}
' "$status_json"

report_file="${test_state_dir}/reports/restore-drill-report-latest.json"
node - "$report_file" <<'NODE'
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const failures = [];
if (report.status !== 'ok') failures.push(`status=${report.status}`);
if (report.checksum_verified !== true) failures.push('checksum_verified=false');
if (report.restore_verified !== true) failures.push('restore_verified=false');
if (report.postgres_version !== '18.6') failures.push(`postgres_version=${report.postgres_version}`);
if (!(report.verification?.public_table_count > 0)) failures.push('public_table_count<=0');
if (!(report.verification?.schema_migration_count > 0)) failures.push('schema_migration_count<=0');
if (report.cleanup_status !== 'removed') failures.push(`cleanup_status=${report.cleanup_status}`);
if (report.isolation?.published_ports !== false) failures.push('published_ports not false');
if (report.isolation?.network !== 'none') failures.push(`network=${report.isolation?.network}`);
if (report.isolation?.production_volume_touched !== false) {
  failures.push('production_volume_touched not false');
}
if (failures.length > 0) throw new Error(failures.join(', '));
console.log(JSON.stringify({
  status: report.status,
  result: report.result,
  postgres_version: report.postgres_version,
  public_table_count: report.verification.public_table_count,
  schema_migration_count: report.verification.schema_migration_count,
  cleanup_status: report.cleanup_status,
  isolation: report.isolation,
}, null, 2));
NODE

if docker ps -a --filter label=esl-pipeline.role=postgres-restore-drill --format '{{.Names}}' | grep -q .; then
  echo "ERROR: disposable restore-drill container remains." >&2
  exit 1
fi
if docker volume ls --filter label=esl-pipeline.role=postgres-restore-drill --format '{{.Name}}' | grep -q .; then
  echo "ERROR: disposable restore-drill volume remains." >&2
  exit 1
fi
