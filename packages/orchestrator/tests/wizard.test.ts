import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConfigProvider, StudentProfile } from '../src/config.js';
import { runInteractiveWizard } from '../src/wizard.js';

type PromptResponse = Record<string, unknown>;

const promptQueue: PromptResponse[] = [];

vi.mock('prompts', () => {
  return {
    default: (question: { name?: string }) => {
      if (!promptQueue.length) {
        throw new Error(`No prompt response queued for question "${question?.name ?? 'unknown'}".`);
      }
      return Promise.resolve(promptQueue.shift());
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

  afterEach(async () => {
    if (cleanupDir) {
      await rm(cleanupDir, { recursive: true, force: true });
      cleanupDir = null;
    }
  });
});
