import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ConfigurationError } from '@esl-pipeline/contracts';

import { resolveConfigPaths } from '../src/pipeline.js';

describe('resolveConfigPaths memoization', () => {
  it('returns cached paths when unchanged and invalidates when files disappear', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'config-cache-'));
    const configDir = join(dir, 'configs');
    const studentsDir = join(configDir, 'students');
    await mkdir(studentsDir, { recursive: true });

    const presetsPath = join(configDir, 'presets.json');
    const voicesPath = join(configDir, 'voices.yml');
    await writeFile(presetsPath, '{"preset":"value"}');
    await writeFile(voicesPath, 'default: voice');

    const first = resolveConfigPaths({
      cwd: dir,
      configDir,
      memoizeConfigPaths: true,
    });
    const second = resolveConfigPaths({
      cwd: dir,
      configDir,
      memoizeConfigPaths: true,
    });

    expect(second).toBe(first);

    await writeFile(presetsPath, '{"preset":"updated"}');
    await writeFile(voicesPath, 'default: voice-updated');
    await writeFile(join(studentsDir, 'stub.json'), '{}');

    const third = resolveConfigPaths({
      cwd: dir,
      configDir,
      memoizeConfigPaths: true,
    });
    expect(third.presetsPath).toBe(presetsPath);

    // Remove presets to trigger invalidation and failure
    await rm(presetsPath);
    const fallback = resolveConfigPaths({
      cwd: dir,
      configDir,
      memoizeConfigPaths: true,
    });
    expect(fallback.presetsPath).not.toBe(presetsPath);
  });
});
