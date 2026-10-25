import { EventEmitter } from 'node:events';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { closePgPool, spawn } = vi.hoisted(() => ({
  closePgPool: vi.fn(),
  spawn: vi.fn(),
}));

const studentId = '11111111-1111-4111-8111-111111111111';
const privateContents = 'SENTINEL_LEARNER_NAME SENTINEL_TOPIC SENTINEL_SUMMARY';

vi.mock('node:child_process', () => ({ spawn }));
vi.mock('../src/bootstrap/env.js', () => ({ loadBatchBackendEnv: vi.fn() }));
vi.mock('../src/bootstrap/pg-host-run-env.js', () => ({ configureHostRunPgRuntimeEnv: vi.fn() }));
vi.mock('../src/config/env.js', () => ({ loadConfig: () => ({ pg: { enabled: true } }) }));
vi.mock('../src/infrastructure/db.js', () => ({ closePgPool }));
vi.mock('../src/application/student-lesson-artifact-export.js', () => ({
  loadStudentLessonArtifactExportPlan: async () => ({
    student: { id: studentId },
    lessons: [
      {
        folderName: 'synthetic-lesson',
        transcriptText: privateContents,
        lessonMemory: null,
        homeworkMemories: [],
      },
    ],
    unmatchedHomeworkMemories: [],
  }),
  renderReadmeText: () => privateContents,
  renderLessonIndexText: () => privateContents,
  renderLessonSummaryText: () => privateContents,
  renderLessonMemoryText: vi.fn(),
  renderHomeworkMemoryText: vi.fn(),
}));

describe('student artifact export CLI execution', () => {
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;
  let tempDir: string | undefined;

  afterEach(async () => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
    vi.resetAllMocks();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  async function execute(zipFails: boolean) {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'student-export-test-'));
    const zipPath = path.join(tempDir, 'synthetic.zip');
    vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let stagedIndex = '';
    let stagingDir = '';
    spawn.mockImplementation((_command, args, options) => {
      stagingDir = options.cwd;
      const child = new EventEmitter() as EventEmitter & { stderr: PassThrough };
      child.stderr = new PassThrough();
      void (async () => {
        stagedIndex = await readFile(path.join(stagingDir, 'LESSON_INDEX.txt'), 'utf8');
        if (zipFails) child.stderr.write('synthetic zip failure');
        else await writeFile(args[1], 'synthetic archive');
        child.emit('close', zipFails ? 2 : 0);
      })();
      return child;
    });
    process.exitCode = undefined;
    process.argv = [
      process.execPath,
      fileURLToPath(new URL('../src/tools/export-student-lesson-artifacts.ts', import.meta.url)),
      '--student-id',
      studentId,
      '--out',
      zipPath,
    ];
    vi.resetModules();
    await import('../src/tools/export-student-lesson-artifacts.js');
    await vi.waitFor(() => expect(closePgPool).toHaveBeenCalledOnce());
    return { stdout, stderr, stagedIndex, stagingDir, zipPath };
  }

  it('retains private staging after zip failure without copying its contents into logs', async () => {
    const result = await execute(true);
    expect(result.stagedIndex).toContain(privateContents);
    expect(process.exitCode).toBe(1);
    expect(result.stdout).not.toHaveBeenCalled();
    const diagnostics = result.stderr.mock.calls.flat().join('\n');
    for (const sentinel of privateContents.split(' ')) expect(diagnostics).not.toContain(sentinel);
    expect(diagnostics).toContain('failed: synthetic zip failure');
    expect(diagnostics).toContain(`stagingDir=${result.stagingDir}`);
    expect(diagnostics).toContain(`output=${result.zipPath}`);
    expect(diagnostics).toContain(
      'private learner artifacts remain for operator-controlled recovery or cleanup',
    );
    expect(await readFile(path.join(result.stagingDir, 'LESSON_INDEX.txt'), 'utf8')).toContain(
      privateContents,
    );
  });

  it('preserves success output and removes successful staging', async () => {
    const result = await execute(false);
    expect(process.exitCode).toBeUndefined();
    expect(result.stderr).not.toHaveBeenCalled();
    expect(result.stdout.mock.calls).toEqual([
      [`[student-artifacts-export] student=${studentId}`],
      ['[student-artifacts-export] lessons=1'],
      ['[student-artifacts-export] unmatchedHomework=0'],
      [`[student-artifacts-export] zip=${result.zipPath}`],
    ]);
    expect(await readFile(result.zipPath, 'utf8')).toBe('synthetic archive');
    expect(await readdir(path.dirname(result.stagingDir))).toEqual([]);
    expect(spawn).toHaveBeenCalledWith('zip', ['-rq', result.zipPath, '.'], {
      cwd: result.stagingDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  });
});
