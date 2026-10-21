import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  closePgPool: vi.fn(),
  closeStudentMemoryQueue: vi.fn(),
  requestHomework: vi.fn(),
  requestSnapshot: vi.fn(),
  requestLesson: vi.fn(),
  importTemplateAsset: vi.fn(),
  getTemplateById: vi.fn(),
  getLatestTemplateRevisionByHash: vi.fn(),
  activateTemplateRevision: vi.fn(),
  setTemplateActiveRevision: vi.fn(),
  listTemplates: vi.fn(),
  deprecateActiveTemplateRevision: vi.fn(),
}));

vi.mock('../src/bootstrap/env.js', () => ({ loadBatchBackendEnv: vi.fn() }));
vi.mock('../src/bootstrap/pg-host-run-env.js', () => ({ configureHostRunPgRuntimeEnv: vi.fn() }));
vi.mock('../src/config/env.js', () => ({
  loadConfig: () => ({
    pg: { enabled: true },
    orchestrator: { configProvider: 'local' },
    prompt: { templatePath: 'synthetic/default.md' },
    generation: { targets: { lesson_memory: { provider: 'openai' } } },
  }),
}));
vi.mock('../src/infrastructure/db.js', () => ({
  withPgClient: (callback: (client: { query: typeof mocks.query }) => unknown) =>
    callback({ query: mocks.query }),
  closePgPool: mocks.closePgPool,
}));
vi.mock('../src/infrastructure/student-memory-queue.js', () => ({
  closeStudentMemoryQueue: mocks.closeStudentMemoryQueue,
}));
vi.mock('../src/application/generation-policy.js', () => ({
  resolveGenerationTarget: () => ({ provider: 'openai', model: 'synthetic-model' }),
}));
vi.mock('../src/application/request-homework-memory-generation.js', () => ({
  requestHomeworkMemoryGeneration: mocks.requestHomework,
}));
vi.mock('../src/application/request-student-memory-snapshot-refresh.js', () => ({
  requestStudentMemorySnapshotRefresh: mocks.requestSnapshot,
}));
vi.mock('../src/application/request-lesson-memory-generation.js', () => ({
  requestLessonMemoryGeneration: mocks.requestLesson,
}));
vi.mock('../src/domain/memory-replay-delivery.js', () => ({ cancelMemoryReplayIntent: vi.fn() }));
vi.mock('../src/domain/student-memory-snapshot-repository.js', () => ({
  buildEligibleStudentMemorySnapshotLineageSqlPredicate: () => 'TRUE',
}));
vi.mock('../src/application/import-template-asset.js', () => ({
  importTemplateAsset: mocks.importTemplateAsset,
}));
vi.mock('../src/application/prompt-assembly.js', () => ({
  resolveRepoPath: (value: string) => value,
}));
vi.mock('../src/application/prompt-options.js', () => ({
  getPromptOptions: async () => ({ defaults: { templateId: 'default.md' } }),
}));
vi.mock('../src/application/template-assets.js', () => ({
  scanTemplateAssets: async () => [
    {
      id: 'default.md',
      absolutePath: '/synthetic/default.md',
      content: 'PRIVATE_TEXT',
      hash: 'one',
    },
    { id: 'second.md', absolutePath: '/synthetic/second.md', content: 'PRIVATE_TEXT', hash: 'two' },
  ],
}));
vi.mock('../src/domain/template-repository.js', () => ({
  getTemplateById: mocks.getTemplateById,
  setTemplateActiveRevision: mocks.setTemplateActiveRevision,
  listTemplates: mocks.listTemplates,
}));
vi.mock('../src/domain/template-revision-repository.js', () => ({
  getLatestTemplateRevisionByHash: mocks.getLatestTemplateRevisionByHash,
  activateTemplateRevision: mocks.activateTemplateRevision,
  deprecateActiveTemplateRevision: mocks.deprecateActiveTemplateRevision,
}));

const replayKey = 'PRIVATE_REPLAY_KEY';
const sensitiveError = `PRIVATE_TEXT PRIVATE_CREDENTIAL ${replayKey}`;
const originalArgv = process.argv;
const originalExitCode = process.exitCode;

beforeEach(() => {
  vi.resetAllMocks();
  vi.resetModules();
  process.exitCode = undefined;
});

afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

const entrypoints = {
  'refresh-homework-memory': () => import('../src/tools/refresh-homework-memory.js'),
  'refresh-student-memory-snapshots': () =>
    import('../src/tools/refresh-student-memory-snapshots.js'),
  'refresh-student-lesson-history': () => import('../src/tools/refresh-student-lesson-history.js'),
  'bootstrap-prompt-assets': () => import('../src/tools/bootstrap-prompt-assets.js'),
};

async function invoke(name: keyof typeof entrypoints, args: readonly string[], fails: boolean) {
  const stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.argv = [
    process.execPath,
    fileURLToPath(new URL(`../src/tools/${name}.ts`, import.meta.url)),
    ...args,
  ];
  await entrypoints[name]();
  await vi.waitFor(() => {
    expect(
      fails
        ? process.exitCode === 1
        : /dryRun=false|readiness=ok/.test(stdout.mock.calls.flat().join('\n')),
    ).toBe(true);
  });
  return {
    stdout: stdout.mock.calls.flat().join('\n'),
    stderr: stderr.mock.calls.flat().join('\n'),
  };
}

describe('memory replay failure summaries', () => {
  const cases = [
    {
      name: 'refresh-homework-memory',
      prefix: 'homework-memory-refresh',
      request: mocks.requestHomework,
      args: ['--replay-key', replayKey],
      rows: [1, 2].map((number) => ({
        job_id: `job-${number}`,
        student_id: `student-${number}`,
        finished_at: new Date('2026-10-01T00:00:00Z'),
      })),
      successLines: ['selection=missing processed=2 requested=2'],
    },
    {
      name: 'refresh-student-memory-snapshots',
      prefix: 'student-memory-snapshot-refresh',
      request: mocks.requestSnapshot,
      args: ['--replay-key', replayKey, '--reason', 'synthetic test'],
      rows: [1, 2].map((number) => ({
        student_id: `student-${number}`,
        latest_memory_at: new Date('2026-10-01T00:00:00Z'),
        has_ready_snapshot: false,
        latest_ready_snapshot_at: null,
      })),
      successLines: [
        'strategy=manual_rebuild_v1_1 reason=synthetic test',
        'candidateRefresh=false',
        'selection=missing processed=2 requested=2',
      ],
    },
    {
      name: 'refresh-student-lesson-history',
      prefix: 'lesson-memory-refresh',
      request: mocks.requestLesson,
      args: [],
      rows: [1, 2].map((number) => ({
        student_id: `student-${number}`,
        transcript_id: `transcript-${number}`,
        recording_id: `recording-${number}`,
        assignment_session_id: `assignment-${number}`,
        source_storage_uri: `local://transcript-${number}`,
        source_content_hash: `hash-${number}`,
      })),
      successLines: ['selection=missing processed=2 requested=2 readyExists=0 pendingExists=0'],
    },
  ] as const;

  for (const scenario of cases) {
    it(`${scenario.name} reports target-1 confirmation and target-2 uncertainty without sensitive exception text`, async () => {
      mocks.query.mockResolvedValue({ rows: scenario.rows });
      scenario.request
        .mockResolvedValueOnce({ outcome: 'created' })
        .mockRejectedValueOnce(new Error(sensitiveError));
      const result = await invoke(scenario.name, scenario.args, true);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain(`[${scenario.prefix}] failed: request_failed:`);
      expect(result.stderr).toContain('confirmedTargets=1/2 confirmedRequested=1');
      expect(result.stderr).toContain('failing target outcome is unknown');
      expect(result.stderr).toContain('persisted intent or queued work');
      expect(result.stderr).toContain('do not establish asynchronous worker completion');
      expect(result.stderr).toContain('Inspect persisted');
      expect(result.stderr).toContain(
        scenario.name === 'refresh-student-lesson-history'
          ? 'resume the same confirmed-source intent'
          : 'reuse the same replay key for the same intent',
      );
      for (const sentinel of sensitiveError.split(' '))
        expect(result.stderr).not.toContain(sentinel);
      expect(scenario.request).toHaveBeenCalledTimes(2);
      expect(scenario.request.mock.calls.map(([arg]) => arg.params.studentId)).toEqual([
        'student-1',
        'student-2',
      ]);
      expect(scenario.request.mock.calls.map(([arg]) => arg.params.replayKey)).toEqual(
        scenario.name === 'refresh-student-lesson-history'
          ? [undefined, undefined]
          : [replayKey, replayKey],
      );
    });

    it(`${scenario.name} preserves successful summary stdout`, async () => {
      mocks.query.mockResolvedValue({ rows: scenario.rows });
      scenario.request.mockResolvedValue({ outcome: 'created' });
      const result = await invoke(scenario.name, scenario.args, false);
      expect(process.exitCode).toBeUndefined();
      expect(result.stderr).toBe('');
      expect(result.stdout.split('\n')).toEqual([
        `[${scenario.prefix}] provider=openai model=synthetic-model`,
        ...scenario.successLines.map((line) => `[${scenario.prefix}] ${line}`),
        `[${scenario.prefix}] dryRun=false`,
      ]);
    });
  }
});

describe('prompt bootstrap confirmed progress', () => {
  beforeEach(() => {
    mocks.getTemplateById.mockResolvedValue(null);
    mocks.getLatestTemplateRevisionByHash.mockResolvedValue(null);
    mocks.importTemplateAsset.mockResolvedValue({ id: 'synthetic-revision' });
    mocks.listTemplates.mockResolvedValue({ items: [], total: 0 });
  });

  it('reports confirmed counts after a later import fails, with supported persisted-state recovery', async () => {
    mocks.importTemplateAsset
      .mockResolvedValueOnce({ id: 'first-revision' })
      .mockRejectedValueOnce(new Error(sensitiveError));
    const result = await invoke('bootstrap-prompt-assets', [], true);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('failed: operation_failed: stage=import-or-activation');
    expect(result.stderr).toContain(
      'confirmed createdRevisions=1 reusedRevisions=0 activatedRevisions=1 retiredTemplates=0',
    );
    expect(result.stderr).toContain('failing operation outcome is unknown');
    expect(result.stderr).toContain(
      'Read persisted template/revision state and rerun the same bootstrap',
    );
    for (const sentinel of sensitiveError.split(' ')) expect(result.stderr).not.toContain(sentinel);
    expect(mocks.importTemplateAsset.mock.calls.map(([asset]) => asset.id)).toEqual([
      'default.md',
      'second.md',
    ]);
    expect(mocks.activateTemplateRevision).toHaveBeenCalledOnce();
    expect(mocks.setTemplateActiveRevision).toHaveBeenCalledOnce();
    expect(mocks.closePgPool).toHaveBeenCalledOnce();
  });

  it('does not count an activation whose pointer write has an uncertain outcome', async () => {
    mocks.setTemplateActiveRevision.mockRejectedValueOnce(new Error(sensitiveError));
    const result = await invoke('bootstrap-prompt-assets', [], true);
    expect(result.stderr).toContain(
      'confirmed createdRevisions=1 reusedRevisions=0 activatedRevisions=0 retiredTemplates=0',
    );
    expect(result.stderr).toContain('may include persisted changes');
  });

  it('does not count a retirement whose deprecation has an uncertain outcome', async () => {
    mocks.listTemplates.mockResolvedValue({
      items: [{ id: 'retired.md', activeRevisionId: 'old-revision' }],
      total: 1,
    });
    mocks.deprecateActiveTemplateRevision.mockRejectedValueOnce(new Error(sensitiveError));
    const result = await invoke('bootstrap-prompt-assets', [], true);
    expect(result.stderr).toContain('stage=retirement');
    expect(result.stderr).toContain(
      'confirmed createdRevisions=2 reusedRevisions=0 activatedRevisions=2 retiredTemplates=0',
    );
    expect(result.stderr).toContain('may include persisted changes');
  });

  it('preserves successful summary stdout', async () => {
    const result = await invoke('bootstrap-prompt-assets', [], false);
    expect(process.exitCode).toBeUndefined();
    expect(result.stderr).toBe('');
    expect(result.stdout.split('\n')).toEqual([
      '[prompt-assets-bootstrap] mode=apply',
      '[prompt-assets-bootstrap] templateRoot=synthetic',
      '[prompt-assets-bootstrap] defaultTemplateId=default.md',
      '[prompt-assets-bootstrap] scannedFiles=2',
      '[prompt-assets-bootstrap] templatesDiscovered=2',
      '[prompt-assets-bootstrap] createdRevisions=2',
      '[prompt-assets-bootstrap] reusedRevisions=0',
      '[prompt-assets-bootstrap] activatedRevisions=2',
      '[prompt-assets-bootstrap] retiredTemplates=0',
      '[prompt-assets-bootstrap] readiness=ok templateDefault=default.md',
    ]);
  });
});
