import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dockerfile = readFileSync(
  new URL('../../packages/batch-backend/Dockerfile', import.meta.url),
  'utf8',
);

const runtimeStage = dockerfile.slice(dockerfile.indexOf('FROM node:24-alpine AS runtime'));

test('backend runtime image creates writable tmp and uploads before dropping privileges', () => {
  const mkdirIndex = dockerfile.indexOf('mkdir -p /app/tmp /app/uploads');
  const chownIndex = dockerfile.indexOf('chown -R node:node /app/tmp /app/uploads');
  const userNodeIndex = dockerfile.indexOf('USER node');

  assert.notEqual(mkdirIndex, -1, 'Dockerfile should create /app/tmp and /app/uploads');
  assert.notEqual(chownIndex, -1, 'Dockerfile should chown /app/tmp and /app/uploads to node');
  assert.notEqual(userNodeIndex, -1, 'Dockerfile should drop privileges with USER node');
  assert.ok(mkdirIndex < userNodeIndex, 'runtime dirs must be created before USER node');
  assert.ok(chownIndex < userNodeIndex, 'runtime dirs must be chowned before USER node');
});

test('backend production runtime image keeps only supported audio runtime dependencies', () => {
  assert.notEqual(runtimeStage.length, 0, 'Dockerfile should include a runtime stage');
  assert.doesNotMatch(runtimeStage, /py3-pip/);
  assert.doesNotMatch(runtimeStage, /python3 -m venv/);
  assert.match(runtimeStage, /ffmpeg/);
});
