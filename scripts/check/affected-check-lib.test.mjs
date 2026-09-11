import assert from 'node:assert/strict';
import test from 'node:test';

import { BACKEND_TEST_PROJECT_FILES } from '../../packages/batch-backend/vitest.projects.mjs';
import {
  buildAffectedCheckPlan,
  buildBroadCheckPlan,
  buildCiScopeDecision,
  collectChangedFileScopes,
  collectChangedFiles,
  expandTransitiveDependents,
  flattenChangedFileRecords,
  formatCiScopeGithubOutputs,
  formatPlanSummary,
  parseNameStatusZ,
  resolveComparisonBase,
} from './affected-check-lib.mjs';

const workspacePackages = [
  pkg('@esl-pipeline/contracts', 'packages/contracts', [], ['build', 'typecheck']),
  pkg(
    '@esl-pipeline/batch-frontend',
    'packages/batch-frontend',
    ['@esl-pipeline/contracts'],
    ['build', 'typecheck', 'lint', 'test:unit:prebuilt'],
  ),
  pkg(
    '@esl-pipeline/batch-backend',
    'packages/batch-backend',
    ['@esl-pipeline/contracts'],
    ['build', 'typecheck', 'lint', 'test:unit:prebuilt'],
  ),
  pkg('@esl-pipeline/tts-provider-google', 'packages/tts-provider-google', []),
  pkg('@esl-pipeline/orchestrator', 'packages/orchestrator', [
    '@esl-pipeline/contracts',
    '@esl-pipeline/tts-provider-google',
  ]),
];

const ciWorkspacePackages = [
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
  [
    'telegram',
    records('M', 'packages/telegram-ops-bot/src/index.ts'),
    [true, true, true, true, false],
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
  ['unknown', records('A', 'unexpected-root.file'), [true, true, true, true, false]],
];

for (const [name, changedFileRecords, expected] of ciScopeCases) {
  test(`CI scope: ${name}`, () => {
    const decision = buildCiScopeDecision({
      changedFileRecords,
      workspacePackages: ciWorkspacePackages,
    });
    assert.deepEqual(scopeFlags(decision), expected);
  });
}

test('CI scope fails open for empty records', () => {
  const decision = buildCiScopeDecision({
    changedFileRecords: [],
    workspacePackages: ciWorkspacePackages,
  });
  assert.deepEqual(scopeFlags(decision), [true, true, true, true, false]);
  assert.equal(
    decision.reasons.some((reason) => reason.code === 'empty-diff'),
    true,
  );
});

test('CI scope fails closed for discovered workspaces without trustworthy names', () => {
  for (const name of [undefined, '']) {
    const decision = buildCiScopeDecision({
      changedFileRecords: records('M', 'packages/unowned-runtime/src/index.ts'),
      workspacePackages: [...ciWorkspacePackages, pkg(name, 'packages/unowned-runtime', [])],
    });
    assert.deepEqual(scopeFlags(decision), [true, true, true, true, false]);
    assert.equal(
      formatCiScopeGithubOutputs(decision),
      'runtime=true\nintegration=true\nbackend_db_worker=true\ntelegram=true\ndocs_only=false\n',
    );
    assert.equal(
      decision.reasons.some((reason) => reason.code === 'untrusted-workspace-metadata'),
      true,
    );
  }
});

test('CI scope treats every path of a rename as relevant', () => {
  const runtimeToDocs = buildCiScopeDecision({
    changedFileRecords: [
      { status: 'R100', paths: ['packages/batch-frontend/src/old.tsx', 'docs/new.md'] },
    ],
    workspacePackages: ciWorkspacePackages,
  });
  const docsToRuntime = buildCiScopeDecision({
    changedFileRecords: [
      { status: 'R100', paths: ['docs/old.md', 'packages/batch-frontend/src/new.tsx'] },
    ],
    workspacePackages: ciWorkspacePackages,
  });
  assert.deepEqual(scopeFlags(runtimeToDocs), [true, true, true, false, false]);
  assert.deepEqual(scopeFlags(docsToRuntime), [true, true, true, false, false]);
});

test('CI scope normalizes separators, duplicates, and input order', () => {
  const left = buildCiScopeDecision({
    changedFileRecords: [
      records('M', 'docs\\guide.md')[0],
      records('M', 'packages\\telegram-ops-bot\\src\\index.ts')[0],
      records('M', 'docs/guide.md')[0],
    ],
    workspacePackages: ciWorkspacePackages,
  });
  const right = buildCiScopeDecision({
    changedFileRecords: [
      records('M', 'packages/telegram-ops-bot/src/index.ts')[0],
      records('M', 'docs/guide.md')[0],
    ],
    workspacePackages: ciWorkspacePackages,
  });
  assert.deepEqual(left, right);
});

test('CI scope keeps docs-only exclusive and blocking scopes monotonic', () => {
  const baseRecords = records('M', 'packages/batch-backend/migrations/0042.sql');
  const base = buildCiScopeDecision({
    changedFileRecords: baseRecords,
    workspacePackages: ciWorkspacePackages,
  });
  const mixed = buildCiScopeDecision({
    changedFileRecords: [...baseRecords, ...records('M', 'docs/guide.md')],
    workspacePackages: ciWorkspacePackages,
  });
  assert.equal(mixed.docs_only, false);
  for (const scope of ['runtime', 'integration', 'backend_db_worker', 'telegram']) {
    if (base[scope]) assert.equal(mixed[scope], true, `${scope} must remain enabled`);
  }
});

test('CI scope routes every explicit backend DB and worker file plus shared support', () => {
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
      workspacePackages: ciWorkspacePackages,
    });
    assert.equal(decision.backend_db_worker, true, `${file} must select backend DB/worker CI`);
  }
});

test('CI scope selects service evidence for backend repository implementations', () => {
  for (const file of [
    'packages/batch-backend/src/domain/job-repository.ts',
    'packages/batch-backend/src/domain/student-memory-snapshot-repository.ts',
  ]) {
    const decision = buildCiScopeDecision({
      changedFileRecords: records('M', file),
      workspacePackages: ciWorkspacePackages,
    });
    assert.equal(decision.backend_db_worker, true, `${file} must select backend DB/worker CI`);
  }
});

test('CI scope requires core service evidence for ordinary application runtime changes', () => {
  for (const file of [
    'packages/batch-backend/src/application/transcription-execution.ts',
    'packages/batch-backend/src/application/reconcile-transcription-delivery.ts',
    'packages/batch-backend/src/application/confirm-assignment-session-step.ts',
  ]) {
    const decision = buildCiScopeDecision({
      changedFileRecords: records('M', file),
      workspacePackages: ciWorkspacePackages,
    });
    assert.deepEqual(scopeFlags(decision), [true, true, true, false, false]);
    assert.equal(
      formatCiScopeGithubOutputs(decision),
      'runtime=true\nintegration=true\nbackend_db_worker=true\ntelegram=false\ndocs_only=false\n',
    );
  }
});

test('CI scope preserves significant path whitespace and widens lookalike root files', () => {
  for (const file of [' AGENTS.md', 'AGENTS.md ']) {
    const decision = buildCiScopeDecision({
      changedFileRecords: records('M', file),
      workspacePackages: ciWorkspacePackages,
    });
    assert.deepEqual(decision.changedFiles, [file]);
    assert.deepEqual(scopeFlags(decision), [true, true, true, true, false]);
  }
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

test('changed file scopes separate committed hosted paths from local-only paths', async () => {
  const calls = [];
  const scopes = await collectChangedFileScopes({
    mergeBase: 'abc123',
    runGit: async (args) => {
      calls.push(args);
      if (args.includes('abc123...HEAD')) return 'M\0docs/committed.md\0';
      if (args.includes('--cached')) return 'A\0packages/contracts/src/staged.ts\0';
      if (args.includes('--others')) return 'scratch.txt\0';
      return 'D\0packages/batch-backend/src/deleted.ts\0';
    },
  });

  assert.deepEqual(scopes.hostedFiles, ['docs/committed.md']);
  assert.deepEqual(scopes.localFiles, [
    'docs/committed.md',
    'packages/batch-backend/src/deleted.ts',
    'packages/contracts/src/staged.ts',
    'scratch.txt',
  ]);
  assert.deepEqual(scopes.uncommittedFiles, [
    'packages/batch-backend/src/deleted.ts',
    'packages/contracts/src/staged.ts',
    'scratch.txt',
  ]);
  assert.equal(calls.length, 4);
});

test('changed file compatibility collection returns the complete local scope', async () => {
  const changedFiles = await collectChangedFiles({
    mergeBase: 'abc123',
    runGit: async (args) => {
      if (args.includes('abc123...HEAD')) return 'M\0packages/batch-frontend/src/App.tsx\0';
      if (args.includes('--cached')) return 'A\0packages/contracts/src/dto.ts\0';
      if (args.includes('--others')) return 'docs/reference/TESTING_GUIDELINES.md\0';
      return 'M\0packages/batch-backend/src/application/submit-job.ts\0';
    },
  });

  assert.deepEqual(changedFiles, [
    'docs/reference/TESTING_GUIDELINES.md',
    'packages/batch-backend/src/application/submit-job.ts',
    'packages/batch-frontend/src/App.tsx',
    'packages/contracts/src/dto.ts',
  ]);
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
      '@esl-pipeline/orchestrator',
    ],
  );
});

test('frontend-only changes select frontend Turbo work without backend tests', () => {
  const plan = buildAffectedCheckPlan({
    baseRef: 'origin/main',
    mergeBase: 'abc123',
    changedFiles: ['packages/batch-frontend/src/App.tsx'],
    workspacePackages,
  });

  assert.equal(plan.fallback, null);
  assert.deepEqual(plan.changedPackages, ['@esl-pipeline/batch-frontend']);
  assert.deepEqual(plan.affectedPackages, ['@esl-pipeline/batch-frontend']);
  assert.deepEqual(plan.turbo.filters, ['@esl-pipeline/batch-frontend']);
  assert.deepEqual(
    plan.turbo.taskGroups.map((group) => group.task),
    ['build', 'typecheck', 'test:unit:prebuilt'],
  );
  assert.equal(
    plan.triggeredLanes.some((lane) => lane.id === 'biome:changed-files'),
    true,
  );
  assert.equal(
    plan.turbo.taskGroups.some((group) => group.task === 'lint'),
    false,
  );
  assert.equal(
    plan.triggeredLanes.some((lane) => lane.id === 'test:integration:worker'),
    false,
  );
  assert.equal(
    plan.triggeredLanes.every((lane) => lane.owner === 'local'),
    true,
  );
  assert.deepEqual(plan.ciRequirements, []);
});

test('package manifests use a Biome formatting and assist guard instead of Prettier', () => {
  const rootPlan = buildAffectedCheckPlan({
    baseRef: 'origin/main',
    mergeBase: 'abc123',
    changedFiles: ['package.json'],
    workspacePackages,
  });
  const manifestLane = rootPlan.triggeredLanes.find((lane) => lane.id === 'format:biome:changed');

  assert.deepEqual(manifestLane?.pnpmArgs, [
    'exec',
    'biome',
    'check',
    '--formatter-enabled=true',
    '--linter-enabled=false',
    '--assist-enabled=true',
    'package.json',
  ]);
  assert.equal(
    rootPlan.triggeredLanes.some((lane) => lane.id === 'format:prettier:changed'),
    false,
  );
});

test('frontend and test source changes use the general Biome lane without specialized ESLint', () => {
  for (const changedFile of [
    'packages/batch-frontend/src/App.tsx',
    'packages/batch-frontend/src/styles.css',
    'packages/batch-backend/tests/example.test.ts',
  ]) {
    const plan = buildAffectedCheckPlan({
      baseRef: 'origin/main',
      mergeBase: 'abc123',
      changedFiles: [changedFile],
      workspacePackages,
    });

    assert.equal(
      plan.triggeredLanes.some((lane) => lane.id === 'biome:changed-files'),
      true,
    );
    assert.equal(
      plan.turbo?.taskGroups.some((group) => group.task === 'lint'),
      false,
    );
    assert.equal(
      plan.triggeredLanes.some((lane) => lane.id === 'lint:eslint:specialized'),
      false,
    );
  }
});

test('contracts changes expand to consumers and keep contract verification explicit', () => {
  const plan = buildAffectedCheckPlan({
    baseRef: 'origin/main',
    mergeBase: 'abc123',
    changedFiles: ['packages/contracts/src/contract-versions.ts'],
    workspacePackages,
  });

  assert.equal(plan.fallback, null);
  assert.deepEqual(plan.affectedPackages, [
    '@esl-pipeline/batch-backend',
    '@esl-pipeline/batch-frontend',
    '@esl-pipeline/contracts',
    '@esl-pipeline/orchestrator',
  ]);
  assert.equal(
    plan.triggeredLanes.some((lane) => lane.id === 'release:verify:contracts'),
    true,
  );
  assert.deepEqual(
    plan.turbo.taskGroups.find((group) => group.task === 'test:unit:prebuilt')?.filters,
    ['@esl-pipeline/batch-backend', '@esl-pipeline/batch-frontend', '@esl-pipeline/orchestrator'],
  );
  assert.deepEqual(plan.ciRequirements, [
    {
      id: 'backend-db-integration',
      reason: 'shared contracts changed',
    },
  ]);
});

test('service ownership selection is independent of ambient service variables', () => {
  const changedFiles = ['packages/batch-backend/tests/domain.job-repository.test.ts'];
  const before = buildAffectedCheckPlan({
    baseRef: 'origin/main',
    mergeBase: 'abc123',
    changedFiles,
    workspacePackages,
  });
  const previousPg = process.env.PG_CONNECTION_STRING;
  const previousRedis = process.env.REDIS_URL;
  process.env.PG_CONNECTION_STRING = 'postgresql://ambient.invalid/example';
  process.env.REDIS_URL = 'redis://ambient.invalid:6379';
  try {
    const after = buildAffectedCheckPlan({
      baseRef: 'origin/main',
      mergeBase: 'abc123',
      changedFiles,
      workspacePackages,
    });
    assert.deepEqual(after, before);
    assert.deepEqual(
      after.triggeredLanes
        .filter((lane) => lane.id === 'backend:test:db:postgres')
        .map((lane) => lane.owner),
      ['ci'],
    );
  } finally {
    restoreEnv('PG_CONNECTION_STRING', previousPg);
    restoreEnv('REDIS_URL', previousRedis);
  }
});

test('recording-media changes select the explicit media project outside pure unit', () => {
  for (const changedFile of [
    'packages/batch-backend/tests/infrastructure.recording-media.test.ts',
    'packages/batch-backend/src/infrastructure/recording-media.ts',
  ]) {
    const plan = buildAffectedCheckPlan({
      baseRef: 'origin/main',
      mergeBase: 'abc123',
      changedFiles: [changedFile],
      workspacePackages,
    });
    assert.deepEqual(
      plan.triggeredLanes.find((lane) => lane.id === 'backend:test:media')?.pnpmArgs,
      ['--filter', '@esl-pipeline/batch-backend', 'run', 'test:media'],
    );
  }
});

test('docs-only changes run docs checks without package Turbo work', () => {
  const plan = buildAffectedCheckPlan({
    baseRef: 'origin/main',
    mergeBase: 'abc123',
    changedFiles: ['docs/reference/TESTING_GUIDELINES.md'],
    workspacePackages,
  });

  assert.equal(plan.fallback, null);
  assert.deepEqual(plan.changedPackages, []);
  assert.deepEqual(plan.affectedPackages, []);
  assert.equal(plan.turbo, null);
  assert.equal(
    plan.triggeredLanes.some((lane) => lane.id === 'docs:check'),
    true,
  );
  assert.equal(
    plan.triggeredLanes.some((lane) => lane.id === 'format:prettier:changed'),
    true,
  );
});

test('generated docs are not formatted by changed-file lanes', () => {
  const plan = buildAffectedCheckPlan({
    baseRef: 'origin/main',
    mergeBase: 'abc123',
    changedFiles: ['docs/generated/plans-index.md'],
    workspacePackages,
  });

  assert.equal(plan.fallback, null);
  assert.deepEqual(plan.changedPackages, []);
  assert.deepEqual(plan.affectedPackages, []);
  assert.equal(plan.turbo, null);
  assert.equal(
    plan.triggeredLanes.some((lane) => lane.id === 'docs:check'),
    true,
  );
  assert.equal(
    plan.triggeredLanes.some((lane) => lane.id === 'docs:generate:indexes'),
    true,
  );
  assert.equal(
    plan.triggeredLanes.some((lane) => lane.id === 'format:prettier:changed'),
    false,
  );
  assert.equal(
    plan.triggeredLanes.some((lane) => lane.id === 'biome:changed-files'),
    false,
  );
});

test('migration changes trigger backend graph, DB baseline, migration, and postgres lanes', () => {
  const plan = buildAffectedCheckPlan({
    baseRef: 'origin/main',
    mergeBase: 'abc123',
    changedFiles: ['packages/batch-backend/migrations/20260615000000_example.sql'],
    workspacePackages,
  });

  assert.equal(plan.fallback, null);
  assert.deepEqual(plan.affectedPackages, ['@esl-pipeline/batch-backend']);
  assert.deepEqual(
    plan.triggeredLanes.map((lane) => lane.id).filter((id) => id.startsWith('backend:')),
    ['backend:db:verify-baseline', 'backend:test:db:migrations', 'backend:test:db:postgres'],
  );
  assert.deepEqual(
    plan.triggeredLanes
      .filter((lane) => lane.id.startsWith('backend:'))
      .map((lane) => [lane.id, lane.owner]),
    [
      ['backend:db:verify-baseline', 'local'],
      ['backend:test:db:migrations', 'ci'],
      ['backend:test:db:postgres', 'ci'],
    ],
  );
  assert.deepEqual(plan.ciRequirements, [
    {
      id: 'backend-db-integration',
      reason: 'backend migrations or schema changed',
    },
  ]);
});

test('worker changes retain the service lane as one CI evidence requirement', () => {
  const plan = buildAffectedCheckPlan({
    baseRef: 'origin/main',
    mergeBase: 'abc123',
    changedFiles: ['packages/batch-backend/src/application/process-student-memory-snapshot-job.ts'],
    workspacePackages,
  });

  assert.deepEqual(
    plan.triggeredLanes
      .filter((lane) => lane.id === 'backend:test:integration:worker')
      .map((lane) => lane.owner),
    ['ci'],
  );
  assert.deepEqual(plan.ciRequirements, [
    {
      id: 'backend-db-integration',
      reason: 'backend worker or queue behavior changed',
    },
  ]);
});

test('unclassified root changes fall back to broad pre-PR validation', () => {
  const plan = buildAffectedCheckPlan({
    baseRef: 'origin/main',
    mergeBase: 'abc123',
    changedFiles: ['unclassified-root-file.txt'],
    workspacePackages,
  });

  assert.equal(plan.fallback?.lane, 'check:pre-pr');
  assert.match(plan.fallback?.reason ?? '', /unclassified root file/u);
  assert.deepEqual(
    plan.triggeredLanes.map((lane) => lane.id),
    [
      'guard:orchestrator:boundary',
      'release:verify:contracts',
      'test:check-routing',
      'test:tooling',
      'build',
      'typecheck',
      'lint',
      'test:unit:prebuilt:fast',
    ],
  );
  assert.equal(plan.turbo, null);
  assert.deepEqual(plan.ciRequirements, [
    {
      id: 'backend-db-integration',
      reason: 'changed scope requires conservative hosted service evidence',
    },
  ]);
  assert.match(formatPlanSummary(plan), /CI required:\n  - backend-db-integration:/u);
});

test('gitignore changes are classified as root validation fallback', () => {
  const plan = buildAffectedCheckPlan({
    baseRef: 'origin/main',
    mergeBase: 'abc123',
    changedFiles: ['.gitignore'],
    workspacePackages,
  });

  assert.equal(plan.fallback?.lane, 'check:pre-pr');
  assert.match(plan.fallback?.reason ?? '', /root validation/u);
});

test('broad pre-PR plan exposes every command as an independent lane', () => {
  const plan = buildBroadCheckPlan({
    reason: 'explicit broad validation requested',
  });

  assert.deepEqual(
    plan.triggeredLanes.map((lane) => [lane.id, lane.pnpmArgs]),
    [
      ['guard:orchestrator:boundary', ['run', 'guard:orchestrator:boundary']],
      ['release:verify:contracts', ['run', 'release:verify:contracts']],
      ['test:check-routing', ['run', 'test:check-routing']],
      ['test:tooling', ['run', 'test:tooling']],
      ['build', ['run', 'build']],
      ['typecheck', ['run', 'typecheck']],
      ['lint', ['run', 'lint']],
      ['test:unit:prebuilt:fast', ['run', 'test:unit:prebuilt:fast']],
    ],
  );
  assert.equal(plan.fallback, null);
  assert.equal(plan.turbo, null);
  assert.equal(
    plan.triggeredLanes.every((lane) => lane.owner === 'local'),
    true,
  );
  assert.deepEqual(plan.ciRequirements, [
    {
      id: 'backend-db-integration',
      reason: 'explicit broad validation requires hosted service evidence',
    },
  ]);
});

test('comparison base fails conservatively when origin main is missing', async () => {
  await assert.rejects(
    resolveComparisonBase({
      baseRef: 'origin/main',
      runGit: async (args) => {
        if (args[0] === 'rev-parse') {
          const error = new Error('unknown revision');
          error.exitCode = 128;
          throw error;
        }
        return '';
      },
    }),
    /origin\/main is unavailable/u,
  );
});

test('comparison base fails conservatively when remote main is newer than local origin main', async () => {
  await assert.rejects(
    resolveComparisonBase({
      baseRef: 'origin/main',
      runGit: async (args) => {
        if (args[0] === 'rev-parse') return 'local-sha\n';
        if (args[0] === 'merge-base') return 'merge-base-sha\n';
        if (args[0] === 'ls-remote') return 'remote-sha\trefs/heads/main\n';
        return '';
      },
    }),
    /origin\/main is stale/u,
  );
});

test('comparison base reports merge base when local origin main is fresh', async () => {
  const base = await resolveComparisonBase({
    baseRef: 'origin/main',
    runGit: async (args) => {
      if (args[0] === 'rev-parse') return 'same-sha\n';
      if (args[0] === 'merge-base') return 'merge-base-sha\n';
      if (args[0] === 'ls-remote') return 'same-sha\trefs/heads/main\n';
      return '';
    },
  });

  assert.deepEqual(base, {
    baseRef: 'origin/main',
    mergeBase: 'merge-base-sha',
    baseSha: 'same-sha',
    remoteSha: 'same-sha',
  });
});

function pkg(name, dir, dependencies, scripts = ['build', 'typecheck', 'test:unit:prebuilt']) {
  return {
    name,
    dir,
    dependencies,
    scripts,
  };
}

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
