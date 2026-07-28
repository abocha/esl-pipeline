import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));

const retiredFiles = [
  'scripts/deps/safe-upgrade.mjs',
  'scripts/deps/pin-shared-deps.mjs',
  'scripts/deps/README.md',
  'scripts/check/run-agent-check-fast.mjs',
  'scripts/test/run-agent-vitest.mjs',
  'scripts/docker/prepare-host-paths.sh',
  'scripts/setup-agent-env.sh',
  'scripts/git/gh-auth-from-env.sh',
];

const retiredScripts = [
  'deps:check',
  'deps:pin',
  'deps:upgrade:safe',
  'docker:backup',
  'docker:dev',
  'docker:dev:build',
  'docs:gardening',
  'hadolint',
  'smoke',
  'test:env',
  'test:timings:frontend',
  'test:topo',
];

test('retired tooling files and aliases stay absent', () => {
  for (const file of retiredFiles) {
    assert.equal(existsSync(new URL(file, root)), false, file);
  }
  for (const script of retiredScripts) {
    assert.equal(pkg.scripts[script], undefined, script);
  }
});

test('canonical replacements remain available', () => {
  for (const script of [
    'deps:audit',
    'deps:audit:strict',
    'docker:db:backup',
    'docker:up',
    'docker:up:build',
    'docs:garden',
    'test:check-routing',
    'test:timings:unit',
  ]) {
    assert.equal(typeof pkg.scripts[script], 'string', script);
  }
});

test('the complete tooling suite remains available through broad local guards', () => {
  assert.equal(pkg.scripts['test:tooling'], 'node --test "scripts/**/*.test.mjs"');
  assert.match(pkg.scripts.check, /pnpm test:tooling/u);
  assert.equal(pkg.scripts['check:pre-pr'], 'node scripts/check/run-affected-check.mjs --broad');
});

test('docker lint composes the canonical compose and Dockerfile lanes', () => {
  assert.equal(
    pkg.scripts['docker:lint'],
    'pnpm docker:lint:compose && pnpm docker:lint:dockerfiles',
  );
  assert.equal(
    pkg.scripts['docker:lint:compose'],
    'dclint docker-compose.yml docker-compose.prod.yml --max-warnings 0',
  );
  assert.equal(
    pkg.scripts['docker:lint:compose:fix'],
    'dclint docker-compose.yml docker-compose.prod.yml --fix',
  );
  assert.equal(pkg.scripts['docker:lint:dockerfiles'], 'node scripts/docker/run-hadolint.mjs');
});
