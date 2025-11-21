import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigProvider, StudentProfile } from '../src/config.js';
import { runInteractiveWizard } from '../src/wizard.js';

type PromptResponse = Record<string, unknown>;

const promptQueue: PromptResponse[] = [];

vi.mock('enquirer', () => {
  // Create mock prompt class inside the factory
  class MockPrompt {
    constructor(private options: any) { }

    async run() {
      if (!promptQueue.length) {
        throw new Error(`No prompt response queued for question.`);
      }
      const next: any = promptQueue.shift();
      if (typeof next === 'function') {
        return next(this.options);
      }
      // Return the value from promptQueue keyed by the prompt name
      return next[this.options.name];
    }
  }

  return {
    default: {
      Select: MockPrompt,
      Input: MockPrompt,
      Toggle: MockPrompt,
      NumberPrompt: MockPrompt,
    },
  };
});

const configProvider: ConfigProvider = {
  async loadPresets() {
    return {};
  },
  async loadStudentProfiles() {
    const defaultProfile: StudentProfile = {
      student: 'Default',
      dbId: null,
      pageParentId: null,
      colorPreset: 'b1-default',
    };
    return [defaultProfile];
  },
  async resolveVoicesPath() {
    return undefined;
  },
};

describe('interactive wizard persistence', () => {
  let cwd: string;
  let defaultsPath: string;
  let mdPath: string;
  let cleanupDir: string | null;

  beforeEach(async () => {
    promptQueue.length = 0;
    cwd = await mkdtemp(join(tmpdir(), 'wizard-'));
    defaultsPath = join(cwd, 'configs', 'wizard.defaults.json');
    mdPath = join(cwd, 'lesson.md');
    cleanupDir = cwd;
    await writeFile(
      mdPath,
      `
# Sample Lesson

Content
    `.trim()
    );
  });

  it('auto-saves manual settings after a run and reloads them next time', async () => {
    promptQueue.push(
      { main: 'settings' },
      { setting: 'upload' },
      { upload: 's3' },
      { prefix: 'audio/custom' },
      { publicRead: true },
      { setting: 'back' },
      { main: 'start' },
      { md: mdPath }
    );

    const firstRun = await runInteractiveWizard(
      {},
      {
        cwd,
        defaultsPath,
        configProvider,
      }
    );

    expect(firstRun.flags.upload).toBe('s3');
    expect(firstRun.flags.prefix).toBe('audio/custom');
    expect(firstRun.flags.publicRead).toBe(true);

    const saved = JSON.parse(await readFile(defaultsPath, 'utf8'));
    expect(saved).toEqual({
      upload: 's3',
      prefix: 'audio/custom',
      publicRead: true,
    });

    promptQueue.push({ main: 'start' }, { md: mdPath });

    const secondRun = await runInteractiveWizard(
      {},
      {
        cwd,
        defaultsPath,
        configProvider,
      }
    );

    expect(secondRun.flags.upload).toBe('s3');
    expect(secondRun.flags.prefix).toBe('audio/custom');
    expect(secondRun.flags.publicRead).toBe(true);
  });

  it('persists and reloads TTS preference', async () => {
    promptQueue.push(
      { main: 'settings' },
      { setting: 'tts' },
      { withTts: false },
      { setting: 'back' },
      { main: 'start' },
      { md: mdPath }
    );

    await runInteractiveWizard(
      {},
      {
        cwd,
        defaultsPath,
        configProvider,
      }
    );

    const saved = JSON.parse(await readFile(defaultsPath, 'utf8'));
    expect(saved).toMatchObject({
      withTts: false,
    });

    // When no initial.withTts override is provided, the saved false is respected.
    promptQueue.push({ main: 'start' }, { md: mdPath });

    const secondRun = await runInteractiveWizard(
      {},
      {
        cwd,
        defaultsPath,
        configProvider,
      }
    );

    expect(secondRun.flags.withTts).toBe(false);
  });

  it('restores saved withTts: true when no CLI override is provided', async () => {
    // Seed saved defaults directly to avoid exercising the interactive settings menu here.
    await mkdir(join(cwd, 'configs'), { recursive: true });
    await writeFile(
      defaultsPath,
      JSON.stringify(
        {
          withTts: true,
        },
        null,
        2
      ),
      'utf8'
    );

    // Second run without initial.withTts: saved true should be applied.
    // Simulate the minimal "start run" flow: start -> md.
    promptQueue.push({ main: 'start' }, { md: mdPath });

    const secondRun = await runInteractiveWizard(
      {},
      {
        cwd,
        defaultsPath,
        configProvider,
      }
    );

    expect(secondRun.flags.withTts).toBe(true);
  });

  it('allows explicit CLI withTts override to win over saved default', async () => {
    // Ensure the defaults directory exists before writing (mirrors saveWizardDefaults behavior).
    await mkdir(join(cwd, 'configs'), { recursive: true });

    // Seed defaults with withTts: false
    await writeFile(
      defaultsPath,
      JSON.stringify(
        {
          withTts: false,
        },
        null,
        2
      ),
      'utf8'
    );

    // Provide an explicit initial override (simulating --with-tts).
    promptQueue.push({ main: 'start' }, { md: mdPath });

    const run = await runInteractiveWizard(
      { withTts: true },
      {
        cwd,
        defaultsPath,
        configProvider,
      }
    );

    // Explicit CLI choice takes precedence over saved default.
    expect(run.flags.withTts).toBe(true);
  });

  afterEach(async () => {
    if (cleanupDir) {
      await rm(cleanupDir, { recursive: true, force: true });
      cleanupDir = null;
    }
  });
});
