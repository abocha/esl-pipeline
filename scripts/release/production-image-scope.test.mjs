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

test('portable maintainer workflow paths do not select production images', () => {
  for (const filename of [
    '.codex/ORCHESTRATION.md',
    '.codex/agents/explorer.toml',
    '.agents/skills/esl-pipeline-validation-evidence/SKILL.md',
  ]) {
    const result = buildProductionImageScope({
      changedFilePayload: payload({ filename }),
      workspacePackages,
    });
    assert.deepEqual(flags(result), { backend: false, frontend: false, bot: false }, filename);
  }
});

test('PR #274 workflow maintenance diff, including role renames, selects no production images', () => {
  const result = buildProductionImageScopeFromChangedFileRecords({
    changedFileRecords: [
      { status: 'M', paths: ['.codex/ORCHESTRATION.md'] },
      { status: 'M', paths: ['.codex/PLANNING_HANDOFF.md'] },
      { status: 'M', paths: ['.codex/WORKFLOW_MODES.md'] },
      {
        status: 'R093',
        paths: ['.codex/agents/luna_implementer.toml', '.codex/agents/bounded_implementer.toml'],
      },
      {
        status: 'R096',
        paths: ['.codex/agents/sol_reviewer.toml', '.codex/agents/exceptional_risk_reviewer.toml'],
      },
      {
        status: 'R095',
        paths: ['.codex/agents/terra_explorer.toml', '.codex/agents/explorer.toml'],
      },
      {
        status: 'R097',
        paths: ['.codex/agents/terra_workhorse.toml', '.codex/agents/integration_workhorse.toml'],
      },
      {
        status: 'R088',
        paths: ['.codex/agents/terra_reviewer.toml', '.codex/agents/ordinary_reviewer.toml'],
      },
      { status: 'M', paths: ['.gitignore'] },
      { status: 'M', paths: ['scripts/release/release-label-policy.test.mjs'] },
    ],
    workspacePackages,
  });
  assert.deepEqual(flags(result), { backend: false, frontend: false, bot: false });
  assert.equal(result.changedFiles.length, 15);
  assert.ok(result.changedFiles.includes('.codex/agents/terra_explorer.toml'));
  assert.ok(result.changedFiles.includes('.codex/agents/explorer.toml'));
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
  for (const filename of [
    'mystery-runtime.conf',
    '.agents/runtime-config.json',
    '.unknown/config.json',
  ]) {
    const result = buildProductionImageScope({
      changedFilePayload: payload({ filename }),
      workspacePackages,
    });
    assert.deepEqual(flags(result), { backend: true, frontend: true, bot: true }, filename);
    assert.match(result.reasons.join('\n'), /fail-closed/u, filename);
  }
});

test('empty or malformed changed-file payloads fail closed to all images', () => {
  for (const changedFilePayload of [undefined, { expectedFileCount: 0, files: [] }]) {
    const result = buildProductionImageScope({ changedFilePayload, workspacePackages });
    assert.deepEqual(flags(result), { backend: true, frontend: true, bot: true });
  }
});
