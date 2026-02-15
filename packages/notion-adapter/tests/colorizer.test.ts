import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tempDirs: string[] = [];

async function createPresetsFile(content: Record<string, unknown>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-colorizer-'));
  const filePath = path.join(root, 'presets.json');
  await fs.writeFile(filePath, JSON.stringify(content, null, 2), 'utf8');
  tempDirs.push(root);
  return filePath;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('colorizer/loadPreset cache', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('reuses cached presets file when mtime and size are unchanged', async () => {
    const presetsPath = await createPresetsFile({
      'b1-default': { h2: 'blue' },
    });
    const { loadPreset } = await import('../src/colorizer.js');

    const first = await loadPreset('b1-default', presetsPath);
    await fs.chmod(presetsPath, 0o000);
    const second = await loadPreset('b1-default', presetsPath);

    expect(first.h2).toBe('blue');
    expect(second.h2).toBe('blue');
  });

  it('invalidates cache after presets file content changes', async () => {
    const presetsPath = await createPresetsFile({
      'b1-default': { h2: 'blue' },
    });
    const { loadPreset } = await import('../src/colorizer.js');

    const first = await loadPreset('b1-default', presetsPath);
    expect(first.h2).toBe('blue');

    await sleep(10);
    await fs.writeFile(
      presetsPath,
      JSON.stringify(
        {
          'b1-default': { h2: 'green' },
        },
        null,
        2,
      ),
      'utf8',
    );

    const second = await loadPreset('b1-default', presetsPath);
    expect(second.h2).toBe('green');
  });
});
