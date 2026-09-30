import assert from 'node:assert/strict';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const bashCommand = process.platform === 'win32' ? 'C:\\Windows\\System32\\bash.exe' : 'bash';

function quoteBash(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
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

function prepareHarness() {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'esl-postgres-ops-alert-'));
  const scriptDir = path.join(tempRoot, 'scripts', 'docker');
  const fakeBinDir = path.join(tempRoot, 'bin');
  const opsDir = path.join(tempRoot, 'ops');
  mkdirSync(scriptDir, { recursive: true });
  mkdirSync(fakeBinDir, { recursive: true });

  for (const file of ['run-postgres-ops-alert.sh', 'postgres-ops-common.sh']) {
    copyFileSync(path.join(repoRoot, 'scripts', 'docker', file), path.join(scriptDir, file));
  }

  const statusScript = path.join(scriptDir, 'postgres-ops-status.sh');
  writeFileSync(
    statusScript,
    '#!/usr/bin/env bash\nset -euo pipefail\ncat "$FAKE_STATUS_JSON_FILE"\n',
  );

  const curlStub = path.join(fakeBinDir, 'curl');
  writeFileSync(
    curlStub,
    '#!/usr/bin/env bash\nset -euo pipefail\nprintf "%s\\n" "$*" >>"$FAKE_CURL_LOG"\nexit "${FAKE_CURL_EXIT_CODE:-0}"\n',
  );

  const nodeShim = path.join(fakeBinDir, 'node');
  const windowsNodePath = toBashPath(process.execPath);
  writeFileSync(
    nodeShim,
    `#!/usr/bin/env bash\nset -euo pipefail\nargs=("$@")\nif [[ "\${args[0]:-}" == "-" && "\${args[1]:-}" == /mnt/* ]]; then\n  args[1]="$(wslpath -w "\${args[1]}")"\nfi\nexec "${windowsNodePath}" "\${args[@]}"\n`,
  );

  const chmodTargets = [statusScript, curlStub, nodeShim].map((file) =>
    quoteBash(toBashPath(file)),
  );
  const chmod = spawnSync(bashCommand, ['-lc', `chmod +x ${chmodTargets.join(' ')}`], {
    encoding: 'utf8',
  });
  if (chmod.error || chmod.status !== 0) {
    rmSync(tempRoot, { recursive: true, force: true });
    throw new Error(`Could not prepare Bash alert harness: ${chmod.stderr || chmod.error}`);
  }

  const statusFile = path.join(tempRoot, 'status.json');
  const curlLog = path.join(tempRoot, 'curl.log');
  const stateFile = path.join(opsDir, 'state', 'postgres-ops-alert-state.json');
  const logDir = path.join(opsDir, 'logs');
  const env = {
    PATH: `${toBashPath(fakeBinDir)}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
    PG_BACKUP_HOST_STATE_DIR: toBashPath(opsDir),
    PG_BACKUP_ALERT_STATE_FILE: toBashPath(stateFile),
    PG_BACKUP_LOG_DIR: toBashPath(logDir),
    PG_BACKUP_ALERT_TELEGRAM_BOT_TOKEN: 'offline-test-token',
    PG_BACKUP_ALERT_TELEGRAM_CHAT_ID: 'offline-test-chat',
    PG_BACKUP_ALERT_TELEGRAM_DISABLE: 'false',
    FAKE_STATUS_JSON_FILE: toBashPath(statusFile),
    FAKE_CURL_LOG: toBashPath(curlLog),
    FAKE_CURL_EXIT_CODE: '0',
  };

  const scriptPath = path.join(scriptDir, 'run-postgres-ops-alert.sh');
  const writeStatus = (state) => {
    writeFileSync(
      statusFile,
      JSON.stringify({
        checkedAtUtc: '2026-09-30T12:00:00Z',
        overall: { state, reasons: state === 'healthy' ? [] : ['backup: fixture failure'] },
        backup: { ageHours: state === 'healthy' ? 1 : 27 },
        artifactIntegrity: { ageDays: 1 },
        restoreDrill: { ageDays: 1 },
      }),
    );
  };
  const readState = () => JSON.parse(readFileSync(stateFile, 'utf8'));
  const readCurlLog = () => (existsSync(curlLog) ? readFileSync(curlLog, 'utf8') : '');

  return {
    env,
    readCurlLog,
    readState,
    run: () => runBash(scriptPath, env),
    stateFile,
    tempRoot,
    writeStatus,
  };
}

test('ops alert sends failure and recovery transitions through an offline Telegram stub', (t) => {
  const harness = prepareHarness();
  t.after(() => rmSync(harness.tempRoot, { recursive: true, force: true }));

  harness.writeStatus('critical');
  const failure = harness.run();
  assert.equal(failure.status, 1, failure.stderr);
  assert.match(harness.readCurlLog(), /--fail/u);
  assert.match(harness.readCurlLog(), /--connect-timeout 10/u);
  assert.match(harness.readCurlLog(), /--max-time 30/u);
  assert.match(harness.readCurlLog(), /ESL ops alert: critical \(failure\)/u);
  assert.equal(harness.readState().lastState, 'critical');
  assert.equal(harness.readState().lastSeverity, 2);
  assert.ok(harness.readState().lastSentEpoch > 0);

  harness.writeStatus('healthy');
  const recovery = harness.run();
  assert.equal(recovery.status, 0, recovery.stderr);
  assert.match(harness.readCurlLog(), /ESL ops status recovered to healthy/u);
  assert.equal(harness.readState().lastState, 'healthy');
  assert.equal(harness.readState().lastSeverity, 0);
});

test('ops alert retries a failed recovery without consuming the production-style transition state', (t) => {
  const harness = prepareHarness();
  t.after(() => rmSync(harness.tempRoot, { recursive: true, force: true }));
  mkdirSync(path.dirname(harness.stateFile), { recursive: true });
  writeFileSync(
    harness.stateFile,
    JSON.stringify({
      lastState: 'critical',
      lastSeverity: 2,
      lastSentEpoch: 123,
      checkedAtUtc: '',
    }),
  );
  harness.writeStatus('healthy');
  harness.env.FAKE_CURL_EXIT_CODE = '22';

  const failedRecovery = harness.run();
  assert.equal(failedRecovery.status, 0, failedRecovery.stderr);
  assert.match(failedRecovery.stdout, /failed to send Telegram alert \(recovery/u);
  assert.equal(harness.readState().lastState, 'critical');
  assert.equal(harness.readState().lastSeverity, 2);
  assert.equal(harness.readState().lastSentEpoch, 123);

  harness.env.FAKE_CURL_EXIT_CODE = '0';
  const retriedRecovery = harness.run();
  assert.equal(retriedRecovery.status, 0, retriedRecovery.stderr);
  assert.equal((harness.readCurlLog().match(/recovered to healthy/gu) ?? []).length, 2);
  assert.equal(harness.readState().lastState, 'healthy');
  assert.ok(harness.readState().lastSentEpoch > 123);
});

test('ops alert preserves a failure transition while Telegram is missing or disabled', (t) => {
  const harness = prepareHarness();
  t.after(() => rmSync(harness.tempRoot, { recursive: true, force: true }));

  harness.writeStatus('critical');
  harness.env.PG_BACKUP_ALERT_TELEGRAM_DISABLE = 'true';
  const disabled = harness.run();
  assert.equal(disabled.status, 1, disabled.stderr);
  assert.match(disabled.stdout, /config is missing\/disabled/u);
  assert.equal(harness.readState().lastState, '');
  assert.equal(harness.readCurlLog(), '');

  harness.env.PG_BACKUP_ALERT_TELEGRAM_DISABLE = 'false';
  const configured = harness.run();
  assert.equal(configured.status, 1, configured.stderr);
  assert.match(harness.readCurlLog(), /ESL ops alert: critical \(failure\)/u);
  assert.equal(harness.readState().lastState, 'critical');
});
