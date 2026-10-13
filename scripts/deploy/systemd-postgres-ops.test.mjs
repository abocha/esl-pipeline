import assert from 'node:assert/strict';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const unitDir = `${repoRoot}/deploy/systemd`;
const bashCommand = process.platform === 'win32' ? 'C:\\Windows\\System32\\bash.exe' : 'bash';
const unitFiles = [
  'esl-postgres-backup.service',
  'esl-postgres-backup.timer',
  'esl-postgres-artifact-integrity.service',
  'esl-postgres-artifact-integrity.timer',
  'esl-postgres-restore-drill.service',
  'esl-postgres-restore-drill.timer',
  'esl-postgres-ops-alert.service',
  'esl-postgres-ops-alert.timer',
  'esl-host-runtime-health.service',
  'esl-host-runtime-health.timer',
];
const readUnit = (name) => readFileSync(`${unitDir}/${name}`, 'utf8');

function quoteBash(value) {
  return "'" + value.replaceAll("'", "'\"'\"'") + "'";
}

function toBashPath(value) {
  if (process.platform !== 'win32') return value;
  const result = spawnSync(bashCommand, ['-lc', `wslpath -u ${quoteBash(value)}`], {
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Could not convert path for Bash: ${result.stderr || result.error}`);
  }
  return result.stdout.trim();
}

function runBash(scriptPath, env) {
  if (process.platform === 'win32') {
    const exports = Object.entries(env)
      .map(([name, value]) => `export ${name}=${quoteBash(value)}`)
      .join('; ');
    return spawnSync(
      bashCommand,
      ['-lc', `${exports}; exec ${quoteBash(toBashPath(scriptPath))}`],
      { cwd: repoRoot, encoding: 'utf8' },
    );
  }

  return spawnSync(bashCommand, [toBashPath(scriptPath)], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

test('production operations unit inventory captures live jobs and adds the six-hour alert', () => {
  assert.deepEqual(readdirSync(unitDir).sort(), [...unitFiles].sort());

  const expectedSchedules = new Map([
    ['esl-postgres-backup.timer', /OnCalendar=\*-\*-\* 00:00:00 UTC/u],
    ['esl-postgres-artifact-integrity.timer', /OnCalendar=Sun \*-\*-\* 02:00:00 UTC/u],
    ['esl-postgres-restore-drill.timer', /OnCalendar=\*-\*-01 03:00:00 UTC/u],
    ['esl-postgres-ops-alert.timer', /OnCalendar=\*-\*-\* 00\/6:00:00 UTC/u],
  ]);

  for (const [name, schedule] of expectedSchedules) {
    const timer = readUnit(name);
    assert.match(timer, schedule, name);
    assert.match(timer, /Persistent=true/u, name);
    assert.match(timer, /WantedBy=timers\.target/u, name);
  }

  for (const [name, script] of [
    ['esl-postgres-backup.service', 'run-postgres-backup-s3.sh'],
    ['esl-postgres-artifact-integrity.service', 'postgres-prod-artifact-integrity.sh'],
    ['esl-postgres-restore-drill.service', 'postgres-prod-restore-drill.sh'],
    ['esl-postgres-ops-alert.service', 'run-postgres-ops-alert.sh'],
  ]) {
    const service = readUnit(name);
    assert.match(service, /Type=oneshot/u, name);
    assert.match(service, /WorkingDirectory=\/opt\/esl-pipeline/u, name);
    assert.match(
      service,
      new RegExp(
        `ExecStart=\\/usr\\/bin\\/bash \\/opt\\/esl-pipeline\\/scripts\\/docker\\/${script}`,
        'u',
      ),
      name,
    );
    if (name === 'esl-postgres-ops-alert.service') {
      assert.match(
        service,
        /ExecStartPre=\/usr\/bin\/test -f \/etc\/esl-pipeline\/production\.env/u,
      );
      assert.doesNotMatch(service, /ConditionPathExists=/u);
    } else {
      assert.match(service, /ConditionPathExists=\/etc\/esl-pipeline\/production\.env/u, name);
    }
    assert.doesNotMatch(service, /Environment(File)?=.*(TOKEN|SECRET|PASSWORD)/iu, name);
  }
});

test('systemd installer is root-only, checkout-pinned, and keeps activation separate', () => {
  const installer = readFileSync(
    `${repoRoot}/scripts/deploy/install-postgres-ops-systemd.sh`,
    'utf8',
  );
  assert.match(installer, /EXPECTED_ROOT="\/opt\/esl-pipeline"/u);
  assert.match(installer, /EUID/u);
  assert.match(installer, /cmp -s/u);
  assert.match(installer, /install -m 0644/u);
  assert.match(installer, /systemctl daemon-reload/u);
  assert.doesNotMatch(installer, /systemctl enable|systemctl start/u);
  for (const file of unitFiles) assert.match(installer, new RegExp(file.replace('.', '\.'), 'u'));
});

test('host runtime unit is docker-ordered, credential-free, and scheduled every five minutes', () => {
  const service = readUnit('esl-host-runtime-health.service');
  const timer = readUnit('esl-host-runtime-health.timer');
  assert.match(service, /Type=oneshot/u);
  assert.match(service, /After=network-online\.target docker\.service/u);
  assert.doesNotMatch(service, /Requires=docker\.service/u);
  assert.match(service, /ExecStartPre=\/usr\/bin\/test -f \/etc\/esl-pipeline\/production\.env/u);
  assert.match(
    service,
    /ExecStart=\/usr\/bin\/bash \/opt\/esl-pipeline\/scripts\/docker\/run-host-runtime-health-alert\.sh/u,
  );
  assert.doesNotMatch(service, /Environment(File)?=.*(TOKEN|SECRET|PASSWORD)/iu);
  assert.match(timer, /OnCalendar=\*-\*-\* \*:0\/5:00 UTC/u);
  assert.match(timer, /Persistent=true/u);
  assert.match(timer, /Unit=esl-host-runtime-health\.service/u);
});

test('installer retries daemon-reload after a failed first reload with unchanged unit files', (t) => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'esl-postgres-systemd-installer-'));
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));

  const checkoutRoot = path.join(tempRoot, 'checkout');
  const checkoutRootBash = toBashPath(checkoutRoot);
  const unitSourceDir = path.join(checkoutRoot, 'deploy', 'systemd');
  const installerDir = path.join(checkoutRoot, 'scripts', 'deploy');
  const systemdTargetDir = path.join(tempRoot, 'systemd');
  const fakeBinDir = path.join(tempRoot, 'bin');
  mkdirSync(unitSourceDir, { recursive: true });
  mkdirSync(installerDir, { recursive: true });
  mkdirSync(systemdTargetDir, { recursive: true });
  mkdirSync(fakeBinDir, { recursive: true });

  for (const file of unitFiles) {
    copyFileSync(path.join(unitDir, file), path.join(unitSourceDir, file));
  }

  const source = readFileSync(`${repoRoot}/scripts/deploy/install-postgres-ops-systemd.sh`, 'utf8');
  const rootGuard =
    'if [[ "${EUID}" -ne 0 ]]; then\n  die "run this installer with sudo from ${EXPECTED_ROOT}"\nfi';
  assert.ok(source.includes(rootGuard), 'expected the production installer root guard');
  const isolatedInstaller = source
    .replace('EXPECTED_ROOT="/opt/esl-pipeline"', `EXPECTED_ROOT="${checkoutRootBash}"`)
    .replace(
      'UNIT_TARGET_DIR="/etc/systemd/system"',
      `UNIT_TARGET_DIR="${toBashPath(systemdTargetDir)}"`,
    )
    .replace(rootGuard, ': # isolated behavior test bypasses the production root guard');
  const installerPath = path.join(installerDir, 'install-postgres-ops-systemd.sh');
  writeFileSync(installerPath, isolatedInstaller);

  const systemctlLog = path.join(tempRoot, 'systemctl.log');
  const failOnceFile = path.join(tempRoot, 'systemctl-failed-once');
  const systemctlStub = path.join(fakeBinDir, 'systemctl');
  writeFileSync(
    systemctlStub,
    '#!/usr/bin/env bash\nset -euo pipefail\nprintf "%s\\n" "$*" >>"$SYSTEMCTL_LOG"\nif [[ ! -e "$SYSTEMCTL_FAIL_ONCE_FILE" ]]; then\n  : >"$SYSTEMCTL_FAIL_ONCE_FILE"\n  exit 1\nfi\n',
  );
  const chmod = spawnSync(
    bashCommand,
    ['-lc', `chmod +x ${quoteBash(toBashPath(systemctlStub))}`],
    {
      encoding: 'utf8',
    },
  );
  if (chmod.error || chmod.status !== 0) {
    throw new Error(`Could not prepare systemctl stub: ${chmod.stderr || chmod.error}`);
  }

  const env = {
    PATH: `${toBashPath(fakeBinDir)}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
    SYSTEMCTL_LOG: toBashPath(systemctlLog),
    SYSTEMCTL_FAIL_ONCE_FILE: toBashPath(failOnceFile),
  };
  const first = runBash(installerPath, env);
  assert.notEqual(first.status, 0, 'first pass should expose the daemon-reload failure');
  for (const file of unitFiles) {
    assert.equal(
      readFileSync(path.join(systemdTargetDir, file), 'utf8'),
      readFileSync(path.join(unitSourceDir, file), 'utf8'),
    );
  }

  const retry = runBash(installerPath, env);
  assert.equal(retry.status, 0, retry.stderr);
  assert.doesNotMatch(retry.stdout, /Installed /u);
  assert.match(retry.stdout, /systemd manager reloaded/u);
  assert.deepEqual(readFileSync(systemctlLog, 'utf8').trim().split('\n'), [
    'daemon-reload',
    'daemon-reload',
  ]);
});
