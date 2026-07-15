import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildGitDiscoveryInvocation,
  buildHadolintInvocation,
  HADOLINT_IMAGE,
  parseNullDelimitedPaths,
  runHadolint,
} from './run-hadolint.mjs';

test('tracked Dockerfile parsing removes leading dot segments, deduplicates, and sorts paths', () => {
  assert.deepEqual(
    parseNullDelimitedPaths(
      './packages/batch-frontend/Dockerfile\0packages/batch-backend/Dockerfile.dev\0packages/batch-frontend/Dockerfile\0',
    ),
    ['packages/batch-backend/Dockerfile.dev', 'packages/batch-frontend/Dockerfile'],
  );
});

test('tracked Dockerfile parsing preserves legal backslashes in Git paths', () => {
  assert.deepEqual(parseNullDelimitedPaths('packages/odd\\name/Dockerfile\0'), [
    'packages/odd\\name/Dockerfile',
  ]);
});

test('tracked Dockerfile parsing rejects malformed output', () => {
  assert.throws(() => parseNullDelimitedPaths('Dockerfile'), /null-delimited/u);
  assert.throws(() => parseNullDelimitedPaths('Dockerfile\0\0nested/Dockerfile\0'), /empty path/u);
});

test('discovery runs Git from the repository root without a shell', () => {
  assert.deepEqual(buildGitDiscoveryInvocation({ repoRoot: 'D:\\code\\esl-pipeline' }), {
    command: 'git',
    args: ['ls-files', '-z', '--', ':(glob)**/Dockerfile*'],
    options: {
      cwd: 'D:\\code\\esl-pipeline',
      encoding: 'utf8',
      shell: false,
    },
  });
});

test('invocation uses the pinned image and a read-only repository mount', () => {
  assert.equal(
    HADOLINT_IMAGE,
    'ghcr.io/hadolint/hadolint:v2.14.0@sha256:27086352fd5e1907ea2b934eb1023f217c5ae087992eb59fde121dce9c9ff21e',
  );
  const invocation = buildHadolintInvocation({
    repoRoot: 'D:\\code\\esl-pipeline',
    dockerfiles: ['packages/batch-frontend/Dockerfile'],
  });

  assert.equal(invocation.command, 'docker');
  assert.deepEqual(invocation.args, [
    'run',
    '--rm',
    '--mount',
    'type=bind,source=D:\\code\\esl-pipeline,target=/workspace,readonly',
    '--workdir',
    '/workspace',
    HADOLINT_IMAGE,
    '/bin/hadolint',
    '--config',
    '.hadolint.yaml',
    '--no-color',
    'packages/batch-frontend/Dockerfile',
  ]);
});

test('runner forwards discovery and Docker invocations without a shell', () => {
  const gitCalls = [];
  const dockerCalls = [];
  const logs = [];
  const status = runHadolint({
    repoRoot: '/repo',
    executeGit: (...args) => {
      gitCalls.push(args);
      return {
        status: 0,
        stdout: 'packages/batch-frontend/Dockerfile\0packages/batch-backend/Dockerfile.dev\0',
        stderr: '',
      };
    },
    spawn: (...args) => {
      dockerCalls.push(args);
      return { status: 0 };
    },
    log: (message) => logs.push(message),
  });

  assert.equal(status, 0);
  assert.deepEqual(gitCalls, [
    [
      'git',
      ['ls-files', '-z', '--', ':(glob)**/Dockerfile*'],
      { cwd: '/repo', encoding: 'utf8', shell: false },
    ],
  ]);
  assert.equal(dockerCalls.length, 1);
  assert.equal(dockerCalls[0][0], 'docker');
  assert.deepEqual(dockerCalls[0][2], { shell: false, stdio: 'inherit' });
  assert.deepEqual(dockerCalls[0][1].slice(-2), [
    'packages/batch-backend/Dockerfile.dev',
    'packages/batch-frontend/Dockerfile',
  ]);
  assert.deepEqual(logs, [
    '[hadolint] linting 2 tracked Dockerfiles: packages/batch-backend/Dockerfile.dev, packages/batch-frontend/Dockerfile',
  ]);
});

test('runner rejects empty discovery and propagates lint status', () => {
  assert.throws(
    () =>
      runHadolint({
        repoRoot: '/repo',
        executeGit: () => ({ status: 0, stdout: '', stderr: '' }),
        spawn: () => ({ status: 0 }),
        log: () => {},
      }),
    /No tracked Dockerfiles/u,
  );
  assert.equal(
    runHadolint({
      repoRoot: '/repo',
      executeGit: () => ({ status: 0, stdout: 'Dockerfile\0', stderr: '' }),
      spawn: () => ({ status: 7 }),
      log: () => {},
    }),
    7,
  );
});

test('runner reports Git and Docker startup failures', () => {
  assert.throws(
    () =>
      runHadolint({
        repoRoot: '/repo',
        executeGit: () => ({ error: new Error('git missing'), status: null, stdout: '' }),
        spawn: () => ({ status: 0 }),
        log: () => {},
      }),
    /Git discovery failed: git missing/u,
  );
  assert.throws(
    () =>
      runHadolint({
        repoRoot: '/repo',
        executeGit: () => ({ status: 0, stdout: 'Dockerfile\0', stderr: '' }),
        spawn: () => ({ error: new Error('docker missing'), status: null }),
        log: () => {},
      }),
    /Docker failed to start: docker missing/u,
  );
});

test('CLI turns startup failure into one controlled error line', () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('./run-hadolint.mjs', import.meta.url))],
    {
      encoding: 'utf8',
      env: { ...process.env, PATH: '' },
    },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /^\[hadolint\] error: Git discovery failed:/u);
  assert.equal(result.stderr.trim().split(/\r?\n/u).length, 1);
  assert.doesNotMatch(result.stderr, /\n\s+at /u);
});
