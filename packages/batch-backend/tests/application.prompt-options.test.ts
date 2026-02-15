import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tempDirs: string[] = [];

async function createFixtureRoots() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-prompt-options-'));
  const templatesDir = path.join(root, 'templates');
  const profilesDir = path.join(root, 'profiles');
  await fs.mkdir(templatesDir, { recursive: true });
  await fs.mkdir(profilesDir, { recursive: true });
  const templatePath = path.join(templatesDir, 'lesson-template.md');
  const profilePath = path.join(profilesDir, 'default-profile.md');
  await fs.writeFile(templatePath, '# Template', 'utf8');
  await fs.writeFile(profilePath, '# Profile', 'utf8');
  tempDirs.push(root);
  return { templatePath, profilePath };
}

describe('application/prompt-options cache', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-01T00:00:00.000Z'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('reuses prompt option scans for 60 seconds and refreshes after TTL', async () => {
    const { templatePath, profilePath } = await createFixtureRoots();
    const { getPromptOptions } = await import('../src/application/prompt-options.js');
    const { loadConfig } = await import('../src/config/env.js');

    const baseConfig = loadConfig();
    const config = {
      ...baseConfig,
      prompt: {
        ...baseConfig.prompt,
        templatePath,
        defaultProfilePath: profilePath,
      },
    };

    const readdirSpy = vi.spyOn(fs, 'readdir');

    const first = await getPromptOptions({ config });
    expect(first.templates).toHaveLength(1);
    expect(first.profiles).toHaveLength(1);
    const firstCallCount = readdirSpy.mock.calls.length;

    const second = await getPromptOptions({ config });
    expect(second.templates).toHaveLength(1);
    expect(second.profiles).toHaveLength(1);
    expect(readdirSpy.mock.calls.length).toBe(firstCallCount);

    vi.setSystemTime(new Date('2026-02-01T00:01:01.000Z'));
    await getPromptOptions({ config });
    expect(readdirSpy.mock.calls.length).toBeGreaterThan(firstCallCount);
  });
});
