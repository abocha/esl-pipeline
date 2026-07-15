import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const dockerfiles = new Map([
  ['backend', read('packages/batch-backend/Dockerfile')],
  ['frontend', read('packages/batch-frontend/Dockerfile')],
  ['bot', read('packages/telegram-ops-bot/Dockerfile')],
]);

test('production application Node stages use Debian 13 slim and committed pnpm', () => {
  for (const [name, dockerfile] of dockerfiles) {
    assert.match(dockerfile, /FROM node:24-trixie-slim AS build/u, name);
    assert.doesNotMatch(dockerfile, /FROM node:[^\n]*alpine/u, name);
    assert.doesNotMatch(dockerfile, /corepack prepare|pnpm@10/u, name);
    assert.match(dockerfile, /corepack enable/u, name);
  }

  assert.match(dockerfiles.get('backend'), /FROM node:24-trixie-slim AS runtime/u);
  assert.match(dockerfiles.get('bot'), /FROM node:24-trixie-slim AS runtime/u);
});

test('production builders fetch from the lockfile before copying package sources', () => {
  for (const [name, dockerfile] of dockerfiles) {
    const fetchIndex = dockerfile.indexOf('pnpm fetch --frozen-lockfile');
    const packageCopyIndex = dockerfile.indexOf('COPY packages ./packages');
    assert.notEqual(fetchIndex, -1, `${name}: fetch`);
    assert.notEqual(packageCopyIndex, -1, `${name}: package copy`);
    assert.ok(fetchIndex < packageCopyIndex, `${name}: fetch precedes package source copy`);
    assert.match(
      dockerfile,
      /--mount=type=cache,id=pnpm-store,target=\/app\/\.pnpm-store\/v11/u,
      name,
    );
    assert.match(dockerfile, /install --offline --frozen-lockfile/u, name);
  }
});

test('runtime-specific system dependencies remain explicit', () => {
  const backend = dockerfiles.get('backend');
  const bot = dockerfiles.get('bot');
  assert.match(backend, /apt-get install -y --no-install-recommends/u);
  for (const dependency of ['ca-certificates', 'curl', 'ffmpeg']) {
    assert.match(backend, new RegExp(`\\b${dependency}\\b`, 'u'));
  }
  assert.match(bot, /ca-certificates/u);
  assert.doesNotMatch(backend, /\bapk add\b/u);
  assert.doesNotMatch(bot, /\bapk add\b/u);
});
