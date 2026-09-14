import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProductionImageScope,
  buildProductionImageScopeFromChangedFileRecords,
} from './production-image-scope.mjs';

const workspacePackages = [
  { name: '@esl-pipeline/contracts', dir: 'packages/contracts', dependencies: [] },
  {
    name: '@esl-pipeline/batch-backend',
    dir: 'packages/batch-backend',
    dependencies: ['@esl-pipeline/contracts'],
  },
  {
    name: '@esl-pipeline/batch-frontend',
    dir: 'packages/batch-frontend',
    dependencies: ['@esl-pipeline/contracts'],
  },
  {
    name: '@esl-pipeline/telegram-ops-bot',
    dir: 'packages/telegram-ops-bot',
    dependencies: ['@esl-pipeline/contracts'],
  },
  { name: '@esl-pipeline/html-publisher', dir: 'packages/html-publisher', dependencies: [] },
];

function payload(...files) {
  return { expectedFileCount: files.length, files };
}

function flags(result) {
  return { backend: result.backend, frontend: result.frontend, bot: result.bot };
}

test('frontend-only package changes rebuild only the frontend image', () => {
  const result = buildProductionImageScope({
    changedFilePayload: payload({ filename: 'packages/batch-frontend/src/App.tsx' }),
    workspacePackages,
  });
  assert.deepEqual(flags(result), { backend: false, frontend: true, bot: false });
});

test('shared contract changes rebuild every dependent production image', () => {
  const result = buildProductionImageScope({
    changedFilePayload: payload({ filename: 'packages/contracts/src/index.ts' }),
    workspacePackages,
  });
  assert.deepEqual(flags(result), { backend: true, frontend: true, bot: true });
});

test('batch-backend prompt assets rebuild only the backend', () => {
  const result = buildProductionImageScope({
    changedFilePayload: payload({ filename: 'packages/batch-backend/prompt-assets/example.md' }),
    workspacePackages,
  });
  assert.deepEqual(flags(result), { backend: true, frontend: false, bot: false });
});

test('the retired documentation prompt-gallery path rebuilds no images', () => {
  const result = buildProductionImageScope({
    changedFilePayload: payload({ filename: 'docs/prompt-gallery/retired.md' }),
    workspacePackages,
  });
  assert.deepEqual(flags(result), { backend: false, frontend: false, bot: false });
});

test('deployment, workflow, scripts, and ordinary docs changes rebuild no images', () => {
  const result = buildProductionImageScope({
    changedFilePayload: payload(
      { filename: '.github/workflows/ci.yml' },
      { filename: 'deploy/caddy/Caddyfile' },
      { filename: 'scripts/deploy/deploy-prod-images.sh' },
      { filename: 'docs/backend-frontend/DEPLOYMENT.md' },
    ),
    workspacePackages,
  });
  assert.deepEqual(flags(result), { backend: false, frontend: false, bot: false });
});

test('root dependency inputs rebuild every production image', () => {
  for (const filename of ['pnpm-lock.yaml', 'docker-compose.prod.yml']) {
    const result = buildProductionImageScope({
      changedFilePayload: payload({ filename }),
      workspacePackages,
    });
    assert.deepEqual(flags(result), { backend: true, frontend: true, bot: true });
  }
});

test('rename records account for both the old and new package paths', () => {
  const result = buildProductionImageScope({
    changedFilePayload: payload({
      filename: 'docs/retired.md',
      previous_filename: 'packages/batch-backend/src/retired.ts',
    }),
    workspacePackages,
  });
  assert.deepEqual(flags(result), { backend: true, frontend: false, bot: false });
});

test('git name-status records preserve production image scope for PR CI', () => {
  const result = buildProductionImageScopeFromChangedFileRecords({
    changedFileRecords: [
      { status: 'M', paths: ['package.json'] },
      {
        status: 'R100',
        paths: ['packages/batch-backend/old.ts', 'docs/retired.md'],
      },
    ],
    workspacePackages,
  });
  assert.deepEqual(flags(result), { backend: true, frontend: true, bot: true });
  assert.deepEqual(result.changedFiles, [
    'docs/retired.md',
    'package.json',
    'packages/batch-backend/old.ts',
  ]);
});

test('unknown root paths fail closed to all images', () => {
  const result = buildProductionImageScope({
    changedFilePayload: payload({ filename: 'mystery-runtime.conf' }),
    workspacePackages,
  });
  assert.deepEqual(flags(result), { backend: true, frontend: true, bot: true });
  assert.match(result.reasons.join('\n'), /fail-closed/u);
});

test('empty or malformed changed-file payloads fail closed to all images', () => {
  for (const changedFilePayload of [undefined, { expectedFileCount: 0, files: [] }]) {
    const result = buildProductionImageScope({ changedFilePayload, workspacePackages });
    assert.deepEqual(flags(result), { backend: true, frontend: true, bot: true });
  }
});
