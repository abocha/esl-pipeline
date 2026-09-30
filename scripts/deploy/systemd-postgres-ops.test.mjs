import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const unitDir = `${repoRoot}/deploy/systemd`;
const unitFiles = [
  'esl-postgres-backup.service',
  'esl-postgres-backup.timer',
  'esl-postgres-artifact-integrity.service',
  'esl-postgres-artifact-integrity.timer',
  'esl-postgres-restore-drill.service',
  'esl-postgres-restore-drill.timer',
  'esl-postgres-ops-alert.service',
  'esl-postgres-ops-alert.timer',
];
const readUnit = (name) => readFileSync(`${unitDir}/${name}`, 'utf8');

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
    assert.match(service, /ConditionPathExists=\/opt\/esl-pipeline\/\.env/u, name);
    assert.doesNotMatch(service, /Environment(File)?=.*(TOKEN|SECRET|PASSWORD)/iu, name);
  }
});

test('systemd installer is root-only, checkout-pinned, and reloads only after unit changes', () => {
  const installer = readFileSync(
    `${repoRoot}/scripts/deploy/install-postgres-ops-systemd.sh`,
    'utf8',
  );
  assert.match(installer, /EXPECTED_ROOT="\/opt\/esl-pipeline"/u);
  assert.match(installer, /EUID/u);
  assert.match(installer, /cmp -s/u);
  assert.match(installer, /install -m 0644/u);
  assert.match(installer, /systemctl daemon-reload/u);
  for (const file of unitFiles) assert.match(installer, new RegExp(file.replace('.', '\.'), 'u'));
});
