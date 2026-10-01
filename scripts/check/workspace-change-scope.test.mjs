import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { BACKEND_TEST_PROJECT_FILES } from '../../packages/batch-backend/vitest.projects.mjs';
import { buildProductionImageScopeFromChangedFileRecords } from '../release/production-image-scope.mjs';
import {
  buildCiScopeDecision,
  expandTransitiveDependents,
  flattenChangedFileRecords,
  formatCiScopeGithubOutputs,
  parseNameStatusZ,
  readWorkspacePackages,
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
    [true, false, false, false, false],
  ],
  [
    'deleted migration',
    records('D', 'packages/batch-backend/migrations/0042.sql'),
    [true, false, true, false, false],
  ],
  [
    'backend repository test',
    records('M', 'packages/batch-backend/tests/domain.job-repository.test.ts'),
    [true, false, true, false, false],
  ],
  [
    'worker fixture',
    records('M', 'packages/batch-backend/tests/transport.worker-runner.integration.test.ts'),
    [true, false, true, false, false],
  ],
  ['contracts', records('M', 'packages/contracts/src/index.ts'), [true, true, false, true, false]],
  [
    'shared infrastructure bootstrap exports',
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
    'scripts/release/production-image-scope.mjs',
    'scripts/release/production-image-scope.test.mjs',
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

test('packaging scope inputs do not select application lanes alone or widen a frontend change', () => {
  for (const file of [
    '.dockerignore',
    'scripts/release/production-image-scope.mjs',
    'scripts/release/production-image-scope.test.mjs',
  ]) {
    for (const mixed of [false, true]) {
      const decision = buildCiScopeDecision({
        changedFileRecords: [
          ...records('M', file),
          ...(mixed ? records('M', 'packages/batch-frontend/src/App.tsx') : []),
        ],
        workspacePackages,
      });
      assert.equal(decision.build_unit, mixed, file);
      for (const scope of ['integration', 'backend_db_worker', 'media', 'telegram'])
        assert.equal(decision[scope], false, `${file}: ${scope}`);
      assert.equal(
        decision.reasons.some((reason) => reason.code === 'unknown-path'),
        false,
        file,
      );
    }
  }
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
    'scripts/release/unknown-image-builder.mjs',
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

test('hosted scope treats maintenance plus build_unit changes like the build_unit change', () => {
  const build_unit = buildCiScopeDecision({
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
  assert.deepEqual(scopeFlags(mixed), scopeFlags(build_unit));
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
      changedFileRecords: records('M', 'packages/unowned-build_unit/src/index.ts'),
      workspacePackages: [...workspacePackages, pkg(name, 'packages/unowned-build_unit', [])],
    });
    assert.deepEqual(scopeFlags(decision), [true, true, true, true, false]);
    assert.equal(
      formatCiScopeGithubOutputs(decision),
      'build_unit=true\nmedia=true\nintegration=true\nbackend_db_worker=true\ntelegram=true\ndocs_only=false\nmaintenance_only=false\n',
    );
    assert.equal(
      decision.reasons.some((reason) => reason.code === 'untrusted-workspace-metadata'),
      true,
    );
  }
});

test('hosted scope treats every path of a rename as relevant', () => {
  const build_unitToDocs = buildCiScopeDecision({
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
  assert.deepEqual(scopeFlags(build_unitToDocs), [true, false, false, false, false]);
  assert.deepEqual(scopeFlags(docsToRuntime), [true, false, false, false, false]);
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
  for (const scope of ['build_unit', 'integration', 'backend_db_worker', 'telegram']) {
    assert.ok(!base[scope] || mixed[scope], `${scope} must remain enabled`);
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

test('durable application execution selects service evidence without generic integration', () => {
  for (const file of [
    'transcription-execution',
    'reconcile-transcription-delivery',
    'confirm-assignment-session-step',
  ]) {
    const decision = buildCiScopeDecision({
      changedFileRecords: records('M', `packages/batch-backend/src/application/${file}.ts`),
      workspacePackages,
    });
    assert.equal(decision.build_unit, true);
    assert.equal(decision.backend_db_worker, true);
    assert.equal(decision.integration, false);
    assert.equal(decision.telegram, false);
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
    decision.build_unit,
    decision.integration,
    decision.backend_db_worker,
    decision.telegram,
    decision.docs_only,
  ];
}

function pkg(name, dir, dependencies) {
  return { name, dir, dependencies };
}

// Full lane vectors protect the risk boundaries (including production packaging)
// against the actual discovered graph, rather than a hand-maintained mock graph.
const liveWorkspacePackages = readWorkspacePackages(
  fileURLToPath(new URL('../..', import.meta.url)),
);
const lanes = ['build_unit', 'integration', 'backend_db_worker', 'telegram', 'media'];
for (const [name, files, selected, packaging] of [
  [
    'docs tooling',
    ['scripts/docs/docs-check-lib.mjs', 'docs/reference/DOCS_GOVERNANCE.md'],
    [],
    false,
  ],
  ['frontend source', ['packages/batch-frontend/src/main.tsx'], ['build_unit'], false],
  [
    'backend generation policy',
    ['packages/batch-backend/src/application/generation-policy.ts'],
    ['build_unit'],
    true,
  ],
  [
    'backend prompt',
    ['packages/batch-backend/src/application/speech-performance-prompt.ts'],
    ['build_unit'],
    true,
  ],
  [
    'repository',
    ['packages/batch-backend/src/domain/job-repository.ts'],
    ['build_unit', 'backend_db_worker'],
    true,
  ],
  [
    'worker',
    ['packages/batch-backend/src/transport/worker-runner.ts'],
    ['build_unit', 'backend_db_worker'],
    true,
  ],
  ['Telegram', ['packages/telegram-ops-bot/src/index.ts'], ['build_unit', 'telegram'], false],
  [
    'contracts barrel',
    ['packages/contracts/src/index.ts'],
    ['build_unit', 'integration', 'telegram', 'media'],
    true,
  ],
  [
    'shared storage',
    ['packages/shared-infrastructure/src/storage/config.ts'],
    ['build_unit', 'integration', 'telegram'],
    true,
  ],
  [
    'recording preparation',
    ['packages/batch-backend/src/infrastructure/recording-media.ts'],
    ['build_unit', 'media'],
    true,
  ],
  [
    'STT provider',
    ['packages/stt-provider-elevenlabs/src/index.ts'],
    ['build_unit', 'media'],
    true,
  ],
  [
    'HTTP boundary',
    ['packages/batch-backend/src/transport/extended-routes/business-routes.ts'],
    ['build_unit', 'integration'],
    true,
  ],
  ['unknown runtime', ['unexpected-new-runtime-system/foo.ts'], lanes, true],
  ['classifier bootstrap', ['scripts/check/workspace-change-scope.mjs'], lanes, false],
  [
    'mixed',
    [
      'scripts/docs/docs-check-lib.mjs',
      'packages/batch-frontend/src/main.tsx',
      'packages/batch-backend/migrations/0042.sql',
      'packages/batch-backend/src/infrastructure/recording-media.ts',
    ],
    ['build_unit', 'backend_db_worker', 'media'],
    true,
  ],
]) {
  test(`affected risk boundary: ${name}`, () => {
    const changedFileRecords = files.map((file) => ({ status: 'M', paths: [file] }));
    const decision = buildCiScopeDecision({
      changedFileRecords,
      workspacePackages: liveWorkspacePackages,
    });
    assert.deepEqual(
      lanes.filter((lane) => decision[lane]),
      selected,
    );
    assert.equal(
      buildProductionImageScopeFromChangedFileRecords({
        changedFileRecords,
        workspacePackages: liveWorkspacePackages,
      }).backend,
      packaging,
    );
    for (const lane of selected) {
      assert.ok(
        decision.reasons.some((reason) => reason.scope === lane || reason.scope === 'all'),
        `${name}: ${lane} needs an explanation`,
      );
    }
  });
}

test('mixed diffs are a monotonic union of independent lane ownership', () => {
  const files = [
    'packages/batch-frontend/src/main.tsx',
    'packages/batch-backend/src/domain/job-repository.ts',
    'packages/batch-backend/src/infrastructure/recording-media.ts',
    'packages/telegram-ops-bot/src/index.ts',
    'scripts/docs/docs-check-lib.mjs',
  ];
  const project = (paths) =>
    buildCiScopeDecision({
      changedFileRecords: paths.map((file) => ({ status: 'M', paths: [file] })),
      workspacePackages: liveWorkspacePackages,
    });
  const combined = project(files);
  for (const lane of lanes)
    assert.equal(
      combined[lane],
      files.some((file) => project([file])[lane]),
    );
});

test('copy into an unknown surface retains both paths and full fallback', () => {
  const changedFileRecords = parseNameStatusZ(
    'C100\0docs/guide.md\0unexpected-new-runtime-system/foo.ts\0',
  );
  const decision = buildCiScopeDecision({ changedFileRecords, workspacePackages });
  assert.ok(lanes.every((lane) => decision[lane]));
  assert.ok(
    decision.reasons.some(
      (reason) =>
        reason.code === 'unknown-path' && reason.subject === 'unexpected-new-runtime-system/foo.ts',
    ),
  );
});

test('schema inputs and persisted OAuth behavior require their owning DB evidence', () => {
  for (const file of [
    'schema.sql',
    'tests/fixtures/pg-legacy-schema.sql',
    'src/infrastructure/mcp-oauth-adapter.ts',
    'src/domain/mcp-oauth-grants.ts',
    'src/domain/job-model.ts',
    'src/application/teacher-business-dashboard.ts',
  ]) {
    const decision = buildCiScopeDecision({
      changedFileRecords: records('M', `packages/batch-backend/${file}`),
      workspacePackages: liveWorkspacePackages,
    });
    assert.equal(decision.backend_db_worker, true, file);
    assert.equal(decision.telegram, false, file);
  }
});

test('owned backend HTTP and media tests select only their independent prerequisite lanes', () => {
  for (const [project, lane] of [
    ['http', 'integration'],
    ['media', 'media'],
  ]) {
    for (const file of BACKEND_TEST_PROJECT_FILES[project]) {
      const decision = buildCiScopeDecision({
        changedFileRecords: records('M', `packages/batch-backend/tests/${file}`),
        workspacePackages: liveWorkspacePackages,
      });
      assert.equal(decision[lane], true, file);
      assert.equal(decision.backend_db_worker, false, file);
      assert.equal(decision.telegram, false, file);
    }
  }
});
