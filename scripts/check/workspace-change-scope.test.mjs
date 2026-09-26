import assert from 'node:assert/strict';
import test from 'node:test';

import { BACKEND_TEST_PROJECT_FILES } from '../../packages/batch-backend/vitest.projects.mjs';
import {
  buildCiScopeDecision,
  expandTransitiveDependents,
  flattenChangedFileRecords,
  formatCiScopeGithubOutputs,
  parseNameStatusZ,
} from './workspace-change-scope.mjs';

const workspacePackages = [
  pkg('@esl-pipeline/contracts', 'packages/contracts', []),
  pkg('@esl-pipeline/shared-infrastructure', 'packages/shared-infrastructure', [
    '@esl-pipeline/contracts',
  ]),
  pkg('@esl-pipeline/batch-backend', 'packages/batch-backend', [
    '@esl-pipeline/contracts',
    '@esl-pipeline/shared-infrastructure',
  ]),
  pkg('@esl-pipeline/batch-frontend', 'packages/batch-frontend', ['@esl-pipeline/contracts']),
  pkg('@esl-pipeline/telegram-ops-bot', 'packages/telegram-ops-bot', [
    '@esl-pipeline/contracts',
    '@esl-pipeline/shared-infrastructure',
  ]),
];

const ciScopeCases = [
  [
    'docs only',
    records('M', 'docs/reference/TESTING_GUIDELINES.md'),
    [false, false, false, false, true],
  ],
  [
    'Codex maintainer guidance only',
    records('M', '.codex/ORCHESTRATION.md'),
    [false, false, false, false, true],
  ],
  [
    'frontend',
    records('M', 'packages/batch-frontend/src/main.tsx'),
    [true, true, true, false, false],
  ],
  [
    'deleted migration',
    records('D', 'packages/batch-backend/migrations/0042.sql'),
    [true, true, true, false, false],
  ],
  [
    'backend repository test',
    records('M', 'packages/batch-backend/tests/domain.job-repository.test.ts'),
    [true, true, true, false, false],
  ],
  [
    'worker fixture',
    records('M', 'packages/batch-backend/tests/transport.worker-runner.integration.test.ts'),
    [true, true, true, false, false],
  ],
  ['contracts', records('M', 'packages/contracts/src/index.ts'), [true, true, true, true, false]],
  [
    'shared infrastructure',
    records('M', 'packages/shared-infrastructure/src/index.ts'),
    [true, true, true, true, false],
  ],
  ['workflow', records('M', '.github/workflows/ci.yml'), [true, true, true, true, false]],
  ['unknown GitHub metadata', records('M', '.github/CODEOWNERS'), [true, true, true, true, false]],
  [
    'local GitHub action',
    records('M', '.github/actions/example/action.yml'),
    [true, true, true, true, false],
  ],
  [
    'scope classifier tooling',
    records('M', 'scripts/check/workspace-change-scope.mjs'),
    [true, true, true, true, false],
  ],
  ['unknown', records('A', 'unexpected-root.file'), [true, true, true, true, false]],
];

for (const [name, changedFileRecords, expected] of ciScopeCases) {
  test(`hosted CI scope: ${name}`, () => {
    const decision = buildCiScopeDecision({ changedFileRecords, workspacePackages });
    assert.deepEqual(scopeFlags(decision), expected);
  });
}

test('hosted scope classifies only explicit repository-maintenance paths', () => {
  for (const file of [
    '.gitignore',
    '.agents/skills/esl-pipeline-validation-evidence/SKILL.md',
    '.agents/skills/telegram-ops/SKILL.md',
    'scripts/git/pr-style-summary.sh',
    'scripts/release/release-label-policy.mjs',
    'scripts/release/release-label-policy.test.mjs',
  ]) {
    const decision = buildCiScopeDecision({
      changedFileRecords: records('M', file),
      workspacePackages,
    });
    assert.equal(decision.maintenance_only, true, file);
    assert.deepEqual(scopeFlags(decision), [false, false, false, false, false], file);
    assert.equal(
      decision.reasons.some((reason) => reason.code === 'repository-maintenance-only'),
      true,
      file,
    );
  }

  const docsOnly = buildCiScopeDecision({
    changedFileRecords: records('M', 'docs/reference/TESTING_GUIDELINES.md'),
    workspacePackages,
  });
  assert.equal(docsOnly.docs_only, true);
  assert.equal(docsOnly.maintenance_only, false);
});

test('PR #274 workflow maintenance paths, including both sides of role renames, select no application lanes', () => {
  const changedFileRecords = [
    ...records('M', '.codex/ORCHESTRATION.md'),
    ...records('M', '.codex/PLANNING_HANDOFF.md'),
    ...records('M', '.codex/WORKFLOW_MODES.md'),
    {
      status: 'R093',
      paths: ['.codex/agents/luna_implementer.toml', '.codex/agents/bounded_implementer.toml'],
    },
    {
      status: 'R096',
      paths: ['.codex/agents/sol_reviewer.toml', '.codex/agents/exceptional_risk_reviewer.toml'],
    },
    { status: 'R095', paths: ['.codex/agents/terra_explorer.toml', '.codex/agents/explorer.toml'] },
    {
      status: 'R097',
      paths: ['.codex/agents/terra_workhorse.toml', '.codex/agents/integration_workhorse.toml'],
    },
    {
      status: 'R088',
      paths: ['.codex/agents/terra_reviewer.toml', '.codex/agents/ordinary_reviewer.toml'],
    },
    ...records('M', '.gitignore'),
    ...records('M', 'scripts/release/release-label-policy.test.mjs'),
  ];
  const decision = buildCiScopeDecision({ changedFileRecords, workspacePackages });
  assert.equal(decision.maintenance_only, true);
  assert.equal(decision.docs_only, false);
  assert.deepEqual(scopeFlags(decision), [false, false, false, false, false]);
  assert.equal(decision.changedFiles.length, 15);
  assert.ok(decision.changedFiles.includes('.codex/agents/luna_implementer.toml'));
  assert.ok(decision.changedFiles.includes('.codex/agents/bounded_implementer.toml'));
});

test('.gitignore alone is maintenance, while root toolchain inputs still select every application lane', () => {
  const gitignore = buildCiScopeDecision({
    changedFileRecords: records('M', '.gitignore'),
    workspacePackages,
  });
  assert.equal(gitignore.maintenance_only, true);
  assert.deepEqual(scopeFlags(gitignore), [false, false, false, false, false]);
  for (const file of [
    '.nvmrc',
    'package.json',
    'pnpm-lock.yaml',
    'tsconfig.base.json',
    '.github/workflows/ci.yml',
    'scripts/check/run-ci-scope.mjs',
  ]) {
    const decision = buildCiScopeDecision({
      changedFileRecords: records('M', file),
      workspacePackages,
    });
    assert.equal(decision.maintenance_only, false, file);
    assert.deepEqual(scopeFlags(decision), [true, true, true, true, false], file);
  }
});

test('hosted scope keeps maintenance classification narrow and fail-closed', () => {
  for (const file of [
    '.agents/README.md',
    'scripts/release/production-image-scope.mjs',
    'scripts/release/production-image-scope.test.mjs',
    'package.json',
  ]) {
    const decision = buildCiScopeDecision({
      changedFileRecords: records('M', file),
      workspacePackages,
    });
    assert.equal(decision.maintenance_only, false, file);
    assert.deepEqual(scopeFlags(decision), [true, true, true, true, false], file);
  }
});

test('hosted scope treats maintenance plus runtime changes like the runtime change', () => {
  const runtime = buildCiScopeDecision({
    changedFileRecords: records('M', 'packages/batch-frontend/src/main.tsx'),
    workspacePackages,
  });
  const mixed = buildCiScopeDecision({
    changedFileRecords: [
      ...records('M', '.gitignore'),
      ...records('M', '.agents/skills/esl-pipeline-validation-evidence/SKILL.md'),
      ...records('M', 'packages/batch-frontend/src/main.tsx'),
    ],
    workspacePackages,
  });
  assert.deepEqual(scopeFlags(mixed), scopeFlags(runtime));
  assert.equal(mixed.maintenance_only, false);
});

test('hosted scope treats both sides of a maintenance rename as known maintenance', () => {
  const decision = buildCiScopeDecision({
    changedFileRecords: [
      {
        status: 'R100',
        paths: ['scripts/git/old-summary.sh', 'docs/reference/new-summary.md'],
      },
    ],
    workspacePackages,
  });
  assert.equal(decision.maintenance_only, true);
  assert.deepEqual(scopeFlags(decision), [false, false, false, false, false]);
});

test('hosted scope fails open for empty records', () => {
  const decision = buildCiScopeDecision({ changedFileRecords: [], workspacePackages });
  assert.deepEqual(scopeFlags(decision), [true, true, true, true, false]);
  assert.equal(
    decision.reasons.some((reason) => reason.code === 'empty-diff'),
    true,
  );
});

test('hosted scope fails closed for discovered workspaces without trustworthy names', () => {
  for (const name of [undefined, '']) {
    const decision = buildCiScopeDecision({
      changedFileRecords: records('M', 'packages/unowned-runtime/src/index.ts'),
      workspacePackages: [...workspacePackages, pkg(name, 'packages/unowned-runtime', [])],
    });
    assert.deepEqual(scopeFlags(decision), [true, true, true, true, false]);
    assert.equal(
      formatCiScopeGithubOutputs(decision),
      'runtime=true\nintegration=true\nbackend_db_worker=true\ntelegram=true\ndocs_only=false\nmaintenance_only=false\n',
    );
    assert.equal(
      decision.reasons.some((reason) => reason.code === 'untrusted-workspace-metadata'),
      true,
    );
  }
});

test('hosted scope treats every path of a rename as relevant', () => {
  const runtimeToDocs = buildCiScopeDecision({
    changedFileRecords: [
      { status: 'R100', paths: ['packages/batch-frontend/src/old.tsx', 'docs/new.md'] },
    ],
    workspacePackages,
  });
  const docsToRuntime = buildCiScopeDecision({
    changedFileRecords: [
      { status: 'R100', paths: ['docs/old.md', 'packages/batch-frontend/src/new.tsx'] },
    ],
    workspacePackages,
  });
  assert.deepEqual(scopeFlags(runtimeToDocs), [true, true, true, false, false]);
  assert.deepEqual(scopeFlags(docsToRuntime), [true, true, true, false, false]);
});

test('hosted scope normalizes separators, duplicates, and input order', () => {
  const left = buildCiScopeDecision({
    changedFileRecords: [
      records('M', 'docs\\guide.md')[0],
      records('M', 'packages\\telegram-ops-bot\\src\\index.ts')[0],
      records('M', 'docs/guide.md')[0],
    ],
    workspacePackages,
  });
  const right = buildCiScopeDecision({
    changedFileRecords: [
      records('M', 'packages/telegram-ops-bot/src/index.ts')[0],
      records('M', 'docs/guide.md')[0],
    ],
    workspacePackages,
  });
  assert.deepEqual(left, right);
});

test('hosted scope keeps docs-only exclusive and blocking scopes monotonic', () => {
  const baseRecords = records('M', 'packages/batch-backend/migrations/0042.sql');
  const base = buildCiScopeDecision({ changedFileRecords: baseRecords, workspacePackages });
  const mixed = buildCiScopeDecision({
    changedFileRecords: [...baseRecords, ...records('M', 'docs/guide.md')],
    workspacePackages,
  });
  assert.equal(mixed.docs_only, false);
  for (const scope of ['runtime', 'integration', 'backend_db_worker', 'telegram']) {
    if (base[scope]) assert.equal(mixed[scope], true, `${scope} must remain enabled`);
  }
});

test('hosted scope routes every explicit backend DB and worker file plus shared support', () => {
  const backendDbWorkerFiles = [
    ...[
      ...BACKEND_TEST_PROJECT_FILES.migrations,
      ...BACKEND_TEST_PROJECT_FILES.postgres,
      ...BACKEND_TEST_PROJECT_FILES.worker,
    ].map((file) => `packages/batch-backend/tests/${file}`),
    'packages/batch-backend/tests/support/bootstrap-pg-test-env.ts',
    'packages/batch-backend/tests/support/test-env.ts',
  ];

  for (const file of backendDbWorkerFiles) {
    const decision = buildCiScopeDecision({
      changedFileRecords: records('M', file),
      workspacePackages,
    });
    assert.equal(decision.backend_db_worker, true, `${file} must select backend DB/worker CI`);
  }
});

test('hosted scope selects service evidence for backend repository implementations', () => {
  for (const file of [
    'packages/batch-backend/src/domain/job-repository.ts',
    'packages/batch-backend/src/domain/student-memory-snapshot-repository.ts',
  ]) {
    const decision = buildCiScopeDecision({
      changedFileRecords: records('M', file),
      workspacePackages,
    });
    assert.equal(decision.backend_db_worker, true, `${file} must select backend DB/worker CI`);
  }
});

test('hosted scope requires core service evidence for ordinary application runtime changes', () => {
  for (const file of [
    'packages/batch-backend/src/application/transcription-execution.ts',
    'packages/batch-backend/src/application/reconcile-transcription-delivery.ts',
    'packages/batch-backend/src/application/confirm-assignment-session-step.ts',
  ]) {
    const decision = buildCiScopeDecision({
      changedFileRecords: records('M', file),
      workspacePackages,
    });
    assert.deepEqual(scopeFlags(decision), [true, true, true, false, false]);
    assert.equal(
      formatCiScopeGithubOutputs(decision),
      'runtime=true\nintegration=true\nbackend_db_worker=true\ntelegram=false\ndocs_only=false\nmaintenance_only=false\n',
    );
  }
});

test('hosted scope preserves significant path whitespace and widens lookalike root files', () => {
  for (const file of [' AGENTS.md', 'AGENTS.md ']) {
    const decision = buildCiScopeDecision({
      changedFileRecords: records('M', file),
      workspacePackages,
    });
    assert.deepEqual(decision.changedFiles, [file]);
    assert.deepEqual(scopeFlags(decision), [true, true, true, true, false]);
  }
});

test('name-status parsing preserves deletions and both rename paths', () => {
  const records = parseNameStatusZ(
    'D\0packages/batch-backend/src/old.ts\0R100\0docs/old.md\0packages/batch-frontend/src/new.tsx\0',
  );

  assert.deepEqual(records, [
    { status: 'D', paths: ['packages/batch-backend/src/old.ts'] },
    { status: 'R100', paths: ['docs/old.md', 'packages/batch-frontend/src/new.tsx'] },
  ]);
  assert.deepEqual(flattenChangedFileRecords(records), [
    'docs/old.md',
    'packages/batch-backend/src/old.ts',
    'packages/batch-frontend/src/new.tsx',
  ]);
});

test('name-status parsing rejects invalid status grammar', () => {
  for (const value of [
    'BOGUS\0docs/guide.md\0',
    'R\0docs/old.md\0docs/new.md\0',
    'C101\0docs/old.md\0docs/new.md\0',
  ]) {
    assert.throws(() => parseNameStatusZ(value), /invalid changed-file status/u);
  }
});

test('dependent expansion walks the full reverse workspace graph', () => {
  assert.deepEqual(
    expandTransitiveDependents({
      packageNames: ['@esl-pipeline/contracts'],
      workspacePackages,
    }),
    [
      '@esl-pipeline/batch-backend',
      '@esl-pipeline/batch-frontend',
      '@esl-pipeline/contracts',
      '@esl-pipeline/shared-infrastructure',
      '@esl-pipeline/telegram-ops-bot',
    ],
  );
});

function records(status, ...paths) {
  return [{ status, paths }];
}

function scopeFlags(decision) {
  return [
    decision.runtime,
    decision.integration,
    decision.backend_db_worker,
    decision.telegram,
    decision.docs_only,
  ];
}

function pkg(name, dir, dependencies) {
  return { name, dir, dependencies };
}
