import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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
  for (const filename of [
    '.dockerignore',
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'tsconfig.base.json',
  ]) {
    const result = buildProductionImageScope({
      changedFilePayload: payload({ filename }),
      workspacePackages,
    });
    assert.deepEqual(flags(result), { backend: true, frontend: true, bot: true });
  }
});

test('known non-image inputs and maintenance tools rebuild no images', () => {
  for (const filename of [
    '.env.example',
    '.nvmrc',
    'docker-compose.prod.yml',
    'turbo.json',
    'scripts/docs/check-core-docs.mjs',
    'scripts/git/pr-style-summary.sh',
    'scripts/release/production-image-scope.mjs',
    'scripts/release/production-image-scope.test.mjs',
    'scripts/release/resolve-production-image-scope.mjs',
    'scripts/release/compute-next-version.mjs',
    'scripts/check/workspace-change-scope.mjs',
  ]) {
    const result = buildProductionImageScope({
      changedFilePayload: payload({ filename }),
      workspacePackages,
    });
    assert.deepEqual(flags(result), { backend: false, frontend: false, bot: false }, filename);
    assert.ok(
      result.reasons.some((reason) => reason.includes(filename)),
      filename,
    );
  }
});

test('target-specific Dockerfiles, nginx configuration and Telegram source retain package ownership', () => {
  for (const [filename, target] of [
    ['packages/batch-backend/Dockerfile', 'backend'],
    ['packages/batch-frontend/Dockerfile', 'frontend'],
    ['packages/telegram-ops-bot/Dockerfile', 'bot'],
    ['packages/batch-frontend/nginx.conf', 'frontend'],
    ['packages/batch-frontend/nginx-rootless.conf', 'frontend'],
    ['packages/telegram-ops-bot/src/main.ts', 'bot'],
  ]) {
    const result = buildProductionImageScope({
      changedFilePayload: payload({ filename }),
      workspacePackages,
    });
    assert.deepEqual(
      flags(result),
      { backend: target === 'backend', frontend: target === 'frontend', bot: target === 'bot' },
      filename,
    );
    assert.ok(result.reasons.some((reason) => reason.includes(target)));
  }
});

test('workspace dependencies select only transitive production consumers', () => {
  const packages = workspacePackages.map((pkg) =>
    pkg.name === '@esl-pipeline/contracts'
      ? { ...pkg, dependencies: ['@esl-pipeline/html-publisher'] }
      : pkg,
  );
  const result = buildProductionImageScope({
    changedFilePayload: payload({ filename: 'packages/html-publisher/src/index.ts' }),
    workspacePackages: packages,
  });
  assert.deepEqual(flags(result), { backend: true, frontend: true, bot: true });
  assert.ok(
    result.reasons.some(
      (reason) =>
        reason.includes('html-publisher') &&
        reason.includes('backend') &&
        reason.includes('frontend') &&
        reason.includes('bot'),
    ),
  );
  const unrelated = buildProductionImageScope({
    changedFilePayload: payload({ filename: 'packages/html-publisher/src/index.ts' }),
    workspacePackages,
  });
  assert.deepEqual(flags(unrelated), { backend: false, frontend: false, bot: false });
});

test('mixed paths union ownership and preserve explanations even when all images are selected', () => {
  for (const [otherPath, expected] of [
    ['docs/example.md', { backend: true, frontend: false, bot: false }],
    ['packages/batch-frontend/src/App.tsx', { backend: true, frontend: true, bot: false }],
    ['.dockerignore', { backend: true, frontend: true, bot: true }],
    ['mystery-build-input.xyz', { backend: true, frontend: true, bot: true }],
  ]) {
    const result = buildProductionImageScope({
      changedFilePayload: payload(
        { filename: 'packages/batch-backend/src/main.ts' },
        { filename: otherPath },
      ),
      workspacePackages,
    });
    assert.deepEqual(flags(result), expected);
    assert.ok(result.reasons.some((reason) => reason.includes('@esl-pipeline/batch-backend')));
    assert.ok(
      result.reasons.some(
        (reason) => reason.includes(otherPath) || reason.includes('@esl-pipeline/batch-frontend'),
      ),
    );
    assert.ok(result.affectedPackages.includes('@esl-pipeline/batch-backend'));
  }
});

test('copy records select both old and new package ownership', () => {
  const result = buildProductionImageScopeFromChangedFileRecords({
    changedFileRecords: [
      {
        status: 'C100',
        paths: ['packages/batch-backend/src/old.ts', 'packages/batch-frontend/src/new.ts'],
      },
    ],
    workspacePackages,
  });
  assert.deepEqual(flags(result), { backend: true, frontend: true, bot: false });
});

test('incomplete or untrusted workspace metadata fails closed', () => {
  for (const packages of [
    [],
    undefined,
    [null],
    workspacePackages.slice(0, 2),
    [...workspacePackages, workspacePackages[0]],
    workspacePackages.map((pkg, index) =>
      index === 0 ? { ...pkg, dependencies: ['missing'] } : pkg,
    ),
    workspacePackages.map((pkg, index) => (index === 0 ? { ...pkg, name: undefined } : pkg)),
    workspacePackages.map((pkg, index) => (index === 0 ? { ...pkg, dir: 'packages/..' } : pkg)),
  ]) {
    const result = buildProductionImageScope({
      changedFilePayload: payload({ filename: 'docs/example.md' }),
      workspacePackages: packages,
    });
    assert.deepEqual(flags(result), { backend: true, frontend: true, bot: true });
    assert.match(result.reasons.join('\n'), /fail-closed/u);
  }
});

test('nested workspace packages retain the longest owning directory', () => {
  const packages = [
    ...workspacePackages,
    {
      name: '@esl-pipeline/backend-example',
      dir: 'packages/batch-backend/examples/service',
      dependencies: [],
    },
  ];
  const result = buildProductionImageScope({
    changedFilePayload: payload({ filename: 'packages/batch-backend/examples/service/main.ts' }),
    workspacePackages: packages,
  });
  assert.deepEqual(flags(result), { backend: false, frontend: false, bot: false });
  assert.deepEqual(result.affectedPackages, ['@esl-pipeline/backend-example']);
});

test('release CLI preserves boolean outputs and explains build/reuse with the live graph', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'image-scope-'));
  try {
    const input = path.join(directory, 'files.json');
    const output = path.join(directory, 'output.txt');
    const summary = path.join(directory, 'summary.md');
    writeFileSync(
      input,
      JSON.stringify(
        payload(
          { filename: 'packages/batch-backend/src/main.ts' },
          { filename: 'docs/example.md' },
        ),
      ),
    );
    const run = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('./resolve-production-image-scope.mjs', import.meta.url)),
        '--changed-files',
        input,
        '--github-output',
        output,
        '--summary',
        summary,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(run.status, 0, run.stderr);
    assert.equal(
      readFileSync(output, 'utf8'),
      'build_backend=true\nbuild_frontend=false\nbuild_bot=false\n',
    );
    const text = readFileSync(summary, 'utf8');
    assert.match(text, /Backend: build/u);
    assert.match(text, /Frontend: reuse/u);
    assert.match(text, /Telegram bot: reuse/u);
    assert.match(text, /workspace-package \[backend\]: @esl-pipeline\/batch-backend/u);
    assert.match(text, /known-non-image: docs\/example.md/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('malformed git records fail closed rather than dropping paths', () => {
  for (const changedFileRecords of [
    undefined,
    [],
    [{ status: 'R100', paths: ['docs/a.md'] }],
    [{ status: 'M', paths: ['docs/a.md', 'packages/batch-backend/src/main.ts'] }],
    [{ status: 'C101', paths: ['docs/a.md', 'docs/b.md'] }],
    [{ status: 'M', paths: [null] }],
  ]) {
    const result = buildProductionImageScopeFromChangedFileRecords({
      changedFileRecords,
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
    'scripts/mystery/build.mjs',
    'scripts/release/new-image-builder.mjs',
    'scripts/docker/new-image-builder.mjs',
    'tsconfig.new-build.json',
    'packages/new-package/src/main.ts',
    'docs/../mystery-build-input.xyz',
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
  for (const changedFilePayload of [
    undefined,
    { expectedFileCount: 0, files: [] },
    { expectedFileCount: 2, files: [{ filename: 'docs/a.md' }] },
    payload({ filename: '' }),
    payload({ filename: 'docs/a.md', previous_filename: '' }),
  ]) {
    const result = buildProductionImageScope({ changedFilePayload, workspacePackages });
    assert.deepEqual(flags(result), { backend: true, frontend: true, bot: true });
  }
});
