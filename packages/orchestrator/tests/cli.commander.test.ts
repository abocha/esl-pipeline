import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pipelineMock = {
  defaults: {
    presetsPath: 'packages/orchestrator/configs/presets.json',
    voicesPath: 'packages/orchestrator/configs/voices.yml',
    outDir: 'out',
  },
  configPaths: {
    studentsDir: 'packages/orchestrator/configs/students',
    presetsPath: 'packages/orchestrator/configs/presets.json',
    voicesPath: 'packages/orchestrator/configs/voices.yml',
    wizardDefaultsPath: 'packages/orchestrator/configs/wizard.defaults.json',
  },
  configProvider: {
    loadStudentProfiles: vi.fn().mockResolvedValue([]),
  },
  newAssignment: vi.fn(),
  rerunAssignment: vi.fn(),
  getAssignmentStatus: vi.fn(),
};

const loadEnvFilesWithSummary = vi
  .fn()
  .mockReturnValue({ loadedFiles: [], missingFiles: [], assignedKeys: [], overriddenKeys: [] });
const summarizeVoiceSelections = vi.fn().mockReturnValue('voice-summary');
const computeRerunPlan = vi
  .fn()
  .mockImplementation((request: { steps?: string[]; audio?: boolean; from?: string; to?: string }) => {
    const order = ['tts', 'upload', 'add-audio'];
    let requested: string[];
    if (request.steps && request.steps.length > 0) {
      requested = request.steps;
    } else if (request.audio) {
      requested = [...order];
    } else if (request.from || request.to) {
      const start = order.indexOf(request.from ?? 'tts');
      const end = order.indexOf(request.to ?? 'add-audio');
      requested = start !== -1 && end >= start ? order.slice(start, end + 1) : [];
    } else {
      requested = ['upload', 'add-audio'];
    }
  return {
    requested,
    executable: requested,
    skipped: [],
    requires: { missingManifestFields: [] },
    errors: [],
  };
  });
const runInteractiveWizard = vi.fn();

vi.mock('../src/config.js', () => ({ DEFAULT_STUDENT_NAME: 'Default Student' }));
vi.mock('../src/index.js', () => ({
  createPipeline: vi.fn(() => pipelineMock),
  computeRerunPlan,
  loadEnvFilesWithSummary,
  summarizeVoiceSelections,
}));
vi.mock('../src/wizard.js', () => ({
  runInteractiveWizard,
  WizardAbortedError: class WizardAbortedError extends Error {},
}));

const importCli = async (): Promise<void> => {
  await import('../bin/cli.js');
};

const resetPipelineMocks = () => {
  pipelineMock.configProvider.loadStudentProfiles.mockClear();
  pipelineMock.newAssignment.mockReset();
  pipelineMock.rerunAssignment.mockReset();
  pipelineMock.getAssignmentStatus.mockReset();
  summarizeVoiceSelections.mockClear();
  runInteractiveWizard.mockReset();
  computeRerunPlan.mockClear();
};

describe('cli (commander parsing)', () => {
  const originalArgv = [...process.argv];
  const originalCwd = process.cwd();

  beforeEach(() => {
    vi.resetModules();
    resetPipelineMocks();
    loadEnvFilesWithSummary.mockClear();
    summarizeVoiceSelections.mockReturnValue('voice-summary');
    process.chdir(originalCwd);
    process.argv = [...originalArgv];
  });

  it('parses run flags via Commander and forwards to pipeline.newAssignment', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'cli-run-'));
    const mdPath = join(tmp, 'lesson.md');
    await writeFile(mdPath, '# test');

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.argv = [
      'node',
      'cli',
      '--md',
      mdPath,
      '--with-tts',
      '--upload',
      's3',
      '--presign',
      '600',
      '--public-read',
      '--voices',
      'custom-voices.yml',
      '--out',
      'custom-out',
      '--accent',
      'british',
      '--dry-run',
      '--force',
      '--json',
    ];

    pipelineMock.newAssignment.mockResolvedValue({
      steps: ['validate', 'tts', 'upload', 'add-audio', 'manifest'],
      manifestPath: join(tmp, 'manifest.json'),
    });
    pipelineMock.getAssignmentStatus.mockResolvedValue({
      manifestPath: join(tmp, 'manifest.json'),
      manifest: null,
      mdHashMatches: true,
      audioFileExists: true,
    });

    await importCli();

    expect(pipelineMock.newAssignment).toHaveBeenCalledTimes(1);
    expect(pipelineMock.newAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        md: mdPath,
        withTts: true,
        upload: 's3',
        presign: 600,
        publicRead: true,
        voices: 'custom-voices.yml',
        out: 'custom-out',
        accentPreference: 'british',
        dryRun: true,
        force: true,
        presetsPath: pipelineMock.defaults.presetsPath,
      }),
      expect.any(Object),
    );
    logSpy.mockRestore();
  });

  it('parses status flags via Commander and calls getAssignmentStatus', async () => {
    const mdPath = resolve('status.md');
    process.argv = ['node', 'cli', 'status', '--md', mdPath, '--json'];

    pipelineMock.getAssignmentStatus.mockResolvedValue({
      manifestPath: '/tmp/manifest.json',
      manifest: null,
      mdHashMatches: true,
      audioFileExists: false,
    });

    await importCli();

    expect(pipelineMock.getAssignmentStatus).toHaveBeenCalledWith(mdPath);
    expect(pipelineMock.newAssignment).not.toHaveBeenCalled();
    expect(pipelineMock.rerunAssignment).not.toHaveBeenCalled();
  });

  it('parses rerun flags via Commander and calls rerunAssignment', async () => {
    const mdPath = resolve('lesson.md');
    process.argv = [
      'node',
      'cli',
      'rerun',
      '--md',
      mdPath,
      '--steps',
      'tts,upload',
      '--upload',
      's3',
      '--presign',
      '120',
      '--accent',
      'american',
      '--voice-id',
      'voice-123',
      '--voices',
      'voices.yml',
      '--out',
      'out',
      '--public-read',
      '--json',
      '--tts-strategy',
      'dialogue',
      '--dialogue-language',
      'es',
      '--dialogue-stability',
      '0.42',
      '--dialogue-seed',
      '7',
    ];

    pipelineMock.rerunAssignment.mockResolvedValue({
      steps: ['tts', 'upload'],
      manifestPath: '/tmp/manifest.json',
    });
    pipelineMock.getAssignmentStatus.mockResolvedValue({
      manifestPath: '/tmp/manifest.json',
      manifest: null,
      mdHashMatches: true,
      audioFileExists: true,
    });

    await importCli();

    expect(pipelineMock.rerunAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        md: mdPath,
        steps: ['tts', 'upload'],
        upload: 's3',
        presign: 120,
        accentPreference: 'american',
        voiceId: 'voice-123',
        voices: 'voices.yml',
        out: 'out',
        publicRead: true,
        ttsStrategy: 'dialogue',
        dialogueLanguage: 'es',
        dialogueStability: 0.42,
        dialogueSeed: 7,
      }),
    );
  });

  it('maps --audio to full rerun steps and applies default upload', async () => {
    const mdPath = resolve('lesson.md');
    process.argv = ['node', 'cli', 'rerun', '--md', mdPath, '--audio', '--json'];

    pipelineMock.rerunAssignment.mockResolvedValue({
      steps: ['tts', 'upload', 'add-audio'],
      manifestPath: '/tmp/manifest.json',
    });
    pipelineMock.getAssignmentStatus.mockResolvedValue({
      manifestPath: '/tmp/manifest.json',
      manifest: null,
      mdHashMatches: true,
      audioFileExists: true,
    });

    await importCli();

    expect(pipelineMock.rerunAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        md: mdPath,
        steps: ['tts', 'upload', 'add-audio'],
        upload: 's3',
        voices: pipelineMock.defaults.voicesPath,
        out: pipelineMock.defaults.outDir,
      }),
    );
  });

  it('applies default upload for implicit rerun steps', async () => {
    const mdPath = resolve('lesson.md');
    process.argv = ['node', 'cli', 'rerun', '--md', mdPath, '--json'];

    pipelineMock.rerunAssignment.mockResolvedValue({
      steps: ['upload', 'add-audio'],
      manifestPath: '/tmp/manifest.json',
    });
    pipelineMock.getAssignmentStatus.mockResolvedValue({
      manifestPath: '/tmp/manifest.json',
      manifest: null,
      mdHashMatches: true,
      audioFileExists: true,
    });

    await importCli();

    expect(pipelineMock.rerunAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        md: mdPath,
        steps: ['upload', 'add-audio'],
        upload: 's3',
      }),
    );
  });

  it('supports --from/--to rerun planning range', async () => {
    const mdPath = resolve('lesson.md');
    process.argv = ['node', 'cli', 'rerun', '--md', mdPath, '--from', 'upload', '--to', 'add-audio', '--json'];

    pipelineMock.rerunAssignment.mockResolvedValue({
      steps: ['upload', 'add-audio'],
      manifestPath: '/tmp/manifest.json',
    });
    pipelineMock.getAssignmentStatus.mockResolvedValue({
      manifestPath: '/tmp/manifest.json',
      manifest: { pageId: 'page-1', mdHash: 'hash', timestamp: '2026-01-01T00:00:00.000Z' },
      mdHashMatches: true,
      audioFileExists: true,
    });

    await importCli();

    expect(computeRerunPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        md: mdPath,
        from: 'upload',
        to: 'add-audio',
      }),
    );
    expect(pipelineMock.rerunAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        md: mdPath,
        steps: ['upload', 'add-audio'],
        upload: 's3',
      }),
    );
  });

  it('supports --plan and skips rerun execution', async () => {
    const mdPath = resolve('lesson.md');
    process.argv = ['node', 'cli', 'rerun', '--md', mdPath, '--plan', '--json'];

    pipelineMock.getAssignmentStatus.mockResolvedValue({
      manifestPath: '/tmp/manifest.json',
      manifest: { pageId: 'page-1', mdHash: 'hash', timestamp: '2026-01-01T00:00:00.000Z' },
      mdHashMatches: true,
      audioFileExists: true,
    });

    await importCli();

    expect(computeRerunPlan).toHaveBeenCalledTimes(1);
    expect(pipelineMock.rerunAssignment).not.toHaveBeenCalled();
    expect(pipelineMock.getAssignmentStatus).toHaveBeenCalledTimes(1);
  });

  it('runs interactive wizard and applies defaults', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'cli-wizard-'));
    const mdPath = join(tmp, 'lesson.md');
    await writeFile(mdPath, '# test');

    runInteractiveWizard.mockResolvedValue({
      flags: {
        md: mdPath,
        withTts: true,
        upload: 's3',
        voices: 'wizard-voices.yml',
        preset: 'wizard-preset',
      },
      selections: { md: mdPath, withTts: true },
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.argv = ['node', 'cli', '--interactive', '--json'];

    pipelineMock.newAssignment.mockResolvedValue({
      steps: ['validate', 'tts', 'upload', 'manifest'],
      manifestPath: join(tmp, 'manifest.json'),
    });

    await importCli();

    expect(runInteractiveWizard).toHaveBeenCalledTimes(1);
    expect(pipelineMock.newAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        md: mdPath,
        withTts: true,
        upload: 's3',
        preset: 'wizard-preset',
        voices: 'wizard-voices.yml',
        presetsPath: pipelineMock.defaults.presetsPath,
        out: pipelineMock.defaults.outDir,
      }),
      expect.any(Object),
    );
    logSpy.mockRestore();
  });

  it('parses manifest reuse flags (--skip-*) on run', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'cli-skip-'));
    const mdPath = join(tmp, 'lesson.md');
    await writeFile(mdPath, '# test');

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.argv = [
      'node',
      'cli',
      '--md',
      mdPath,
      '--skip-import',
      '--skip-tts',
      '--skip-upload',
      '--json',
    ];

    pipelineMock.newAssignment.mockResolvedValue({
      steps: ['manifest'],
      manifestPath: join(tmp, 'manifest.json'),
    });

    await importCli();

    expect(pipelineMock.newAssignment).toHaveBeenCalledWith(
      expect.objectContaining({
        md: mdPath,
        skipImport: true,
        skipTts: true,
        skipUpload: true,
      }),
      expect.any(Object),
    );
    logSpy.mockRestore();
  });

  it('supports select command without interactive prompt when path is provided', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'cli-select-'));
    const filePath = join(tmp, 'file.txt');
    await writeFile(filePath, 'content');

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
      logs.push(args.join(' '));
    });

    process.chdir(tmp);
    process.argv = ['node', 'cli', 'select', filePath, '--root', 'cwd', '--json'];

    await importCli();

    expect(logs.some((entry) => entry.includes(resolve(filePath)))).toBe(true);
    logSpy.mockRestore();
  });
});
