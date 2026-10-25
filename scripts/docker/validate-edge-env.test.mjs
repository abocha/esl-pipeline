import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { validateEdgeEnv } from './validate-edge-env.mjs';

test('accepts a public hostname and ACME email', () => {
  assert.deepEqual(
    validateEdgeEnv({
      CADDY_PUBLIC_HOSTNAME: 'alpha.example.com',
      CADDY_ACME_EMAIL: 'ops@example.com',
    }),
    {
      hostname: 'alpha.example.com',
      email: 'ops@example.com',
      transitionHostname: '',
      transitionMode: 'disabled',
    },
  );
});

test('accepts one distinct temporary hostname for serving or redirecting', () => {
  for (const transitionMode of ['serve', 'redirect']) {
    assert.equal(
      validateEdgeEnv({
        CADDY_PUBLIC_HOSTNAME: 'app.eslpipeline.com',
        CADDY_ACME_EMAIL: 'ops@example.com',
        CADDY_TRANSITION_HOSTNAME: 'esl-pipeline.run.place',
        CADDY_TRANSITION_MODE: transitionMode,
      }).transitionMode,
      transitionMode,
    );
  }
});

test('rejects ambiguous, duplicate, multiple, or invalid temporary host configuration', () => {
  for (const [mode, hostname] of [
    ['serve', ''],
    ['redirect', 'APP.eslpipeline.com'],
    ['serve', 'https://old.example.com'],
    ['serve', '*.example.com'],
    ['serve', 'old.example.com,new.example.com'],
    ['serve', '127.0.0.1'],
    ['disabled', 'old.example.com'],
    ['../serve', 'old.example.com'],
  ]) {
    assert.throws(
      () =>
        validateEdgeEnv({
          CADDY_PUBLIC_HOSTNAME: 'app.eslpipeline.com',
          CADDY_ACME_EMAIL: 'ops@example.com',
          CADDY_TRANSITION_HOSTNAME: hostname,
          CADDY_TRANSITION_MODE: mode,
        }),
      /CADDY_TRANSITION/,
    );
  }
});

test('rejects missing, local-only, or Caddy site-address hostnames', () => {
  for (const hostname of [
    '',
    '   ',
    'localhost',
    '127.0.0.1',
    'https://alpha.example.com',
    'alpha.example.com:8443',
    'alpha.example.com/path',
    '*.example.com',
  ]) {
    assert.throws(
      () =>
        validateEdgeEnv({
          CADDY_PUBLIC_HOSTNAME: hostname,
          CADDY_ACME_EMAIL: 'ops@example.com',
        }),
      /CADDY_PUBLIC_HOSTNAME/,
    );
  }
});

test('rejects missing or malformed ACME email values', () => {
  for (const email of ['', 'ops', 'ops@', '@example.com']) {
    assert.throws(
      () =>
        validateEdgeEnv({
          CADDY_PUBLIC_HOSTNAME: 'alpha.example.com',
          CADDY_ACME_EMAIL: email,
        }),
      /CADDY_ACME_EMAIL/,
    );
  }
});

test('CLI exits non-zero when required edge env is missing', () => {
  const result = spawnSync(process.execPath, ['scripts/docker/validate-edge-env.mjs'], {
    env: {
      ...process.env,
      CADDY_PUBLIC_HOSTNAME: '',
      CADDY_ACME_EMAIL: '',
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /CADDY_PUBLIC_HOSTNAME/);
});
