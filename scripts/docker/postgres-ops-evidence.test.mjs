import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const bash = process.platform === 'win32' ? 'C:\\Windows\\System32\\bash.exe' : 'bash';
const quote = (value) => `'${value.replaceAll("'", `'"'"'`)}'`;
function shellPath(value) {
  if (process.platform !== 'win32') return value;
  const result = spawnSync(bash, ['-lc', `wslpath -u ${quote(value)}`], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

// Exercise the real runner/trap boundary with synthetic artifacts and command fakes. The
// independent oracles are process status, complete report contents and exact cleanup targets.
function harness(t, runner) {
  const root = mkdtempSync(path.join(tmpdir(), 'esl-pg-evidence-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const scripts = path.join(root, 'scripts', 'docker');
  const bin = path.join(root, 'bin');
  const reports = path.join(root, 'ops', 'reports');
  for (const dir of [scripts, bin, reports]) mkdirSync(dir, { recursive: true });
  for (const file of [
    'postgres-ops-common.sh',
    'run-postgres-artifact-integrity-check.sh',
    'run-postgres-restore-drill.sh',
  ]) {
    writeFileSync(
      path.join(scripts, file),
      readFileSync(path.join(repoRoot, 'scripts', 'docker', file), 'utf8').replaceAll('\r\n', '\n'),
    );
  }
  writeFileSync(
    path.join(scripts, 'postgres-backup-s3.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${FAKE_VERIFY_RC:-0}" != 0 ]]; then exit "$FAKE_VERIFY_RC"; fi
mkdir -p "$PG_BACKUP_DIR/remote-restore"
printf 'synthetic dump' >"$PG_BACKUP_DIR/remote-restore/fixture.dump"
`,
  );
  writeFileSync(path.join(bin, 'node'), '#!/usr/bin/env bash\nexit 99\n');
  writeFileSync(
    path.join(bin, 'docker'),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >>"$FAKE_DOCKER_LOG"
case "$1 \${2:-}" in
  'volume create') exit 0 ;;
  'volume rm') exit "\${FAKE_VOLUME_RM_RC:-0}" ;;
  'container ls')
    if [[ "\${FAKE_LIST_RC:-0}" != 0 ]]; then exit "$FAKE_LIST_RC"; fi
    if [[ -f "$FAKE_CONTAINER_FILE" && "\${FAKE_FOREIGN_CONTAINER:-0}" != 1 ]]; then
      read -r name <"$FAKE_CONTAINER_FILE"
      printf '%s\\n' "$name"
    fi
    exit 0 ;;
  'rm -f') exit "\${FAKE_CONTAINER_RM_RC:-0}" ;;
esac
if [[ "$1" == run ]]; then
  previous=''
  for arg in "$@"; do
    if [[ "$previous" == --name && "\${FAKE_CREATE_CONTAINER:-1}" == 1 ]]; then printf '%s\\n' "$arg" >"$FAKE_CONTAINER_FILE"; fi
    previous="$arg"
  done
  exit "\${FAKE_RUN_RC:-0}"
fi
if [[ "$1" == exec ]]; then
  case "$*" in
    *'SHOW server_version;'*) printf '18.6\\n' ;;
    *'pg_catalog.pg_tables'*) printf '5\\n' ;;
    *'public.schema_migrations'*) printf '3\\n' ;;
    *'SELECT (SELECT count'*) printf '1\\t2\\t3\\n' ;;
  esac
  exit 0
fi
echo 'unexpected fake Docker command' >&2
exit 99
`,
  );
  writeFileSync(
    path.join(bin, 'cp'),
    `#!/usr/bin/env bash
if [[ "\${FAKE_REPORT_FAULT:-}" == copy && "$2" == */\${FAKE_REPORT_PREFIX}-report-latest.json.tmp.* ]]; then
  printf 'partial' >"$2"
  exit 41
fi
exec /bin/cp "$@"
`,
  );
  writeFileSync(
    path.join(bin, 'mv'),
    `#!/usr/bin/env bash
if [[ "\${FAKE_REPORT_FAULT:-}" == rename && "\${*: -1}" == */\${FAKE_REPORT_PREFIX}-report-latest.json ]]; then exit 42; fi
exec /bin/mv "$@"
`,
  );
  writeFileSync(
    path.join(bin, 'cat'),
    `#!/usr/bin/env bash
if [[ "\${FAKE_REPORT_FAULT:-}" == write && "$(readlink /proc/$$/fd/1)" == */\${FAKE_REPORT_PREFIX}-report-*.json.tmp.* ]]; then printf 'partial'; exit 43; fi
exec /bin/cat "$@"
`,
  );
  const shellRoot = shellPath(root);
  const chmod = spawnSync(
    bash,
    ['-lc', `chmod +x ${quote(`${shellRoot}/bin`)}/* ${quote(`${shellRoot}/scripts/docker`)}/*`],
    { encoding: 'utf8' },
  );
  assert.equal(chmod.status, 0, chmod.stderr);
  const prefix = runner === 'integrity' ? 'artifact-integrity' : 'restore-drill';
  const latest = path.join(reports, `${prefix}-report-latest.json`);
  const old = JSON.stringify({
    timestamp_utc: '2026-01-01T00:00:00Z',
    status: 'ok',
    result: 'prior_run',
  });
  writeFileSync(latest, old);
  const env = {
    PATH: `${shellRoot}/bin:/usr/bin:/bin`,
    PG_BACKUP_ENV_FILE: '/dev/null',
    PG_BACKUP_HOST_STATE_DIR: `${shellRoot}/ops`,
    PG_BACKUP_DIR: `${shellRoot}/ops/backups/postgres`,
    PG_BACKUP_S3_BUCKET: 'synthetic-bucket',
    PG_BACKUP_S3_REGION: 'synthetic-region',
    PG_COMPOSE_PROJECT: 'synthetic-project',
    PG_COMPOSE_FILE: '/dev/null',
    FAKE_DOCKER_LOG: `${shellRoot}/docker.log`,
    FAKE_CONTAINER_FILE: `${shellRoot}/container`,
    FAKE_REPORT_PREFIX: prefix,
  };
  return {
    env,
    old,
    latest,
    reports,
    report: () => JSON.parse(readFileSync(latest, 'utf8')),
    log: () => {
      try {
        return readFileSync(path.join(root, 'docker.log'), 'utf8');
      } catch {
        return '';
      }
    },
    run: () =>
      spawnSync(
        bash,
        [
          '-lc',
          `${Object.entries(env)
            .map(([key, value]) => `export ${key}=${quote(value)}`)
            .join(
              '; ',
            )}; exec bash ${quote(`${shellRoot}/scripts/docker/run-postgres-${runner === 'integrity' ? 'artifact-integrity-check' : 'restore-drill'}.sh`)} fixture.dump`,
        ],
        { encoding: 'utf8', timeout: 15000 },
      ),
  };
}

for (const runner of ['integrity', 'drill']) {
  test(`${runner} publishes successful complete evidence`, (t) => {
    const h = harness(t, runner);
    const result = h.run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(h.report().status, 'ok');
    assert.equal(h.report().checksum_verified, true);
    assert.equal(h.report().restore_verified, runner === 'drill' ? true : undefined);
    assert.equal(h.report().cleanup_status, runner === 'drill' ? 'removed' : undefined);
  });
  for (const fault of ['write', 'copy', 'rename']) {
    test(`${runner} fails on report ${fault} and preserves prior latest`, (t) => {
      const h = harness(t, runner);
      h.env.FAKE_REPORT_FAULT = fault;
      const result = h.run();
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /evidence publication failed \(operation exit=0/u);
      assert.match(result.stderr, /latest report was not replaced.*this run/u);
      assert.equal(readFileSync(h.latest, 'utf8'), h.old);
      assert.equal(
        readdirSync(h.reports).some((name) => name.includes('.tmp.')),
        false,
      );
      for (const name of readdirSync(h.reports))
        JSON.parse(readFileSync(path.join(h.reports, name), 'utf8'));
    });
  }
  test(`${runner} preserves the primary operation failure if publication also fails`, (t) => {
    const h = harness(t, runner);
    h.env.FAKE_VERIFY_RC = '23';
    h.env.FAKE_REPORT_FAULT = 'copy';
    const result = h.run();
    assert.equal(result.status, 23, result.stderr);
    assert.match(result.stderr, /operation exit=23/u);
    assert.equal(readFileSync(h.latest, 'utf8'), h.old);
  });
  test(`${runner} publishes operation-failure evidence`, (t) => {
    const h = harness(t, runner);
    h.env.FAKE_VERIFY_RC = '23';
    const result = h.run();
    assert.equal(result.status, 23, result.stderr);
    assert.equal(h.report().status, 'error');
    assert.equal(h.report().checksum_verified, false);
  });
}

test('drill removes only its exact invocation-owned container after create-then-start failure', (t) => {
  const h = harness(t, 'drill');
  h.env.FAKE_RUN_RC = '17';
  const result = h.run();
  assert.equal(result.status, 17, result.stderr);
  const name = h.log().match(/run -d --name (esl-pg-restore-drill-\S+)/u)?.[1];
  assert.ok(name);
  assert.match(
    h.log(),
    new RegExp(
      `container ls --all --filter name=\\^/${name}\\$ --filter label=esl-pipeline.restore-drill-run=`,
    ),
  );
  assert.ok(h.log().includes(`rm -f ${name}\n`));
  assert.ok(h.log().includes(`volume rm ${name}\n`));
  assert.equal(h.report().result, 'start_disposable_postgres');
  assert.equal(h.report().cleanup_status, 'removed');
});

for (const mode of ['absent', 'foreign']) {
  test(`drill does not remove a container that is ${mode} after failed run`, (t) => {
    const h = harness(t, 'drill');
    h.env.FAKE_RUN_RC = '17';
    if (mode === 'absent') h.env.FAKE_CREATE_CONTAINER = '0';
    else h.env.FAKE_FOREIGN_CONTAINER = '1';
    const result = h.run();
    assert.equal(result.status, 17, result.stderr);
    assert.doesNotMatch(h.log(), /^rm -f /mu);
    assert.equal(h.report().cleanup_status, 'removed');
  });
}

for (const primaryFailure of [false, true]) {
  test(`drill reports cleanup failure and preserves ${primaryFailure ? 'failed' : 'successful'} operation truth`, (t) => {
    const h = harness(t, 'drill');
    h.env.FAKE_CONTAINER_RM_RC = '9';
    h.env.FAKE_VOLUME_RM_RC = '9';
    if (primaryFailure) h.env.FAKE_RUN_RC = '17';
    const result = h.run();
    assert.equal(result.status, primaryFailure ? 17 : 1, result.stderr);
    assert.match(result.stderr, /could not remove disposable container/u);
    assert.match(result.stderr, /could not remove disposable volume/u);
    assert.equal(h.report().cleanup_status, 'failed');
    assert.equal(h.report().restore_verified, !primaryFailure);
    assert.equal(
      h.report().result,
      primaryFailure ? 'start_disposable_postgres' : 'disposable_cleanup_failed',
    );
  });
}

test('drill does not claim cleanup when failed-start ownership lookup fails', (t) => {
  const h = harness(t, 'drill');
  h.env.FAKE_RUN_RC = '17';
  h.env.FAKE_LIST_RC = '8';
  const result = h.run();
  assert.equal(result.status, 17, result.stderr);
  assert.match(result.stderr, /could not determine failed-start container cleanup state/u);
  assert.doesNotMatch(h.log(), /^rm -f /mu);
  assert.equal(h.report().cleanup_status, 'failed');
});
