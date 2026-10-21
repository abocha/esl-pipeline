import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { runVerification } from './telegram-ops-go-live-verify.mjs';

// Exercise report persistence at the public verifier boundary; no network or credentials.
for (const scenario of ['login', 'status', 'abort', 'response-read']) {
  test(`transport failure produces a current safe artifact: ${scenario}`, async (t) => {
    const dir = await mkdtemp(path.join(tmpdir(), 'verify-transport-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const jsonOutPath = path.join(dir, 'verify.json');
    await writeFile(jsonOutPath, '{"stale":true}');
    const secret = 'SENTINEL-PRIVATE-CREDENTIAL';
    const result = await runVerification({
      env: {},
      backendUrl: 'http://synthetic.invalid',
      email: 'fake@example.invalid',
      password: secret,
      jsonOutPath,
      fetchFn: async (url) => {
        if (scenario === 'abort') throw new DOMException(secret, 'AbortError');
        if (scenario === 'login') throw new Error(secret);
        if (String(url).endsWith('/auth/login')) return Response.json({ accessToken: secret });
        if (scenario === 'response-read') {
          return {
            text: async () => {
              throw new Error(secret);
            },
          };
        }
        throw new Error(secret);
      },
    });
    assert.equal(result.exitCode, 1);
    const text = await readFile(jsonOutPath, 'utf8');
    const report = JSON.parse(text);
    assert.equal(report.kind, 'telegram_ops_go_live_verify');
    assert.equal(report.version, 1);
    assert.equal(report.summary.passed, false);
    assert.equal(report.stale, undefined);
    assert.ok(!text.includes(secret));
    const check = report.checks.find((item) => item.id === 'request_transport_success');
    assert.equal(check.passed, false);
    assert.equal(
      check.details.request,
      ['login', 'abort'].includes(scenario) ? 'auth_login' : 'ops_status',
    );
    assert.match(check.message, /Check backend reachability/);
    assert.equal(
      check.details.diagnosis,
      scenario === 'abort' ? 'timeout_or_abort' : 'request_or_response_read_failure',
    );
  });
}

test('HTTP login rejection retains its check and artifact without a transport diagnosis', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'verify-http-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const result = await runVerification({
    env: {},
    backendUrl: 'http://synthetic.invalid',
    email: 'fake@example.invalid',
    password: 'fake',
    jsonOutPath: path.join(dir, 'verify.json'),
    fetchFn: async () => Response.json({ error: 'unauthorized' }, { status: 401 }),
  });
  assert.equal(result.exitCode, 1);
  assert.ok(result.report.checks.some((item) => item.id === 'auth_login_success' && !item.passed));
  assert.ok(!result.report.checks.some((item) => item.id === 'request_transport_success'));
});

test('later transport failure omits sensitive bodies from earlier confirmed responses', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'verify-late-transport-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const jsonOutPath = path.join(dir, 'verify.json');
  const secret = 'SENTINEL-PRIVATE-RESPONSE-BODY';
  const result = await runVerification({
    env: {},
    backendUrl: 'http://synthetic.invalid',
    email: 'fake@example.invalid',
    password: 'fake',
    jsonOutPath,
    fetchFn: async (url) => {
      if (String(url).endsWith('/auth/login')) return Response.json({ accessToken: 'fake-token' });
      if (String(url).endsWith('/ops/status')) {
        return Response.json({
          checkedAtUtc: '2026-10-22T00:00:00Z',
          overall: { state: 'healthy' },
          diagnostic: secret,
        });
      }
      throw new Error('later request failed');
    },
  });
  assert.equal(result.exitCode, 1);
  const text = await readFile(jsonOutPath, 'utf8');
  const report = JSON.parse(text);
  assert.ok(!text.includes(secret));
  assert.ok(report.checks.some((check) => check.id === 'ops_status_success_shape' && check.passed));
  assert.equal(report.traces.opsStatus.status, 200);
  assert.match(report.traces.opsStatus.body, /omitted after transport failure/);
  assert.equal(
    report.checks.find((check) => check.id === 'request_transport_success').details.request,
    'unknown_operation',
  );
});

test('failed artifact persistence rejects without a current-success result', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'verify-write-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(
    runVerification({
      env: {},
      backendUrl: 'http://synthetic.invalid',
      email: 'fake@example.invalid',
      password: 'fake',
      jsonOutPath: dir,
      fetchFn: async () => {
        throw new Error('transport failed');
      },
    }),
    /EISDIR|EPERM/,
  );
});

test('CLI exits one and prints failed summary after mocked transport rejection', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'verify-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const scriptDir = path.join(dir, 'scripts', 'release');
  await mkdir(scriptDir, { recursive: true });
  for (const name of ['telegram-ops-go-live-verify.mjs', 'telegram-ops-go-live-utils.mjs']) {
    await copyFile(new URL(name, import.meta.url), path.join(scriptDir, name));
  }
  const preload = path.join(dir, 'fake-fetch.mjs');
  await writeFile(
    preload,
    "globalThis.fetch = async () => { throw new Error('SECRET-SENTINEL'); };\n",
  );
  const jsonOutPath = path.join(dir, 'verify.json');
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      pathToFileURL(preload).href,
      path.join(scriptDir, 'telegram-ops-go-live-verify.mjs'),
      '--backend-url',
      'http://synthetic.invalid',
      '--email',
      'fake@example.invalid',
      '--password',
      'fake',
      '--json-out',
      jsonOutPath,
    ],
    {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env },
    },
  );
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /FAIL request_transport_success/, result.stderr);
  assert.match(result.stdout, /summary: passed=false/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes('SECRET-SENTINEL'));
  assert.equal(JSON.parse(await readFile(jsonOutPath, 'utf8')).summary.passed, false);
});
