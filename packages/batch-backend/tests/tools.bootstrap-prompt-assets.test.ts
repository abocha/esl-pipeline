import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { scanAssets } from '../src/tools/bootstrap-prompt-assets.js';

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('tools/bootstrap-prompt-assets', () => {
  it('scans template and profile roots independently', async () => {
    const baseDir = await createTempDir('prompt-assets-');
    const templateRoot = path.join(baseDir, 'templates');
    const profileRoot = path.join(baseDir, 'profiles');
    await mkdir(templateRoot, { recursive: true });
    await mkdir(profileRoot, { recursive: true });

    await writeFile(path.join(templateRoot, 'hw_prompt_definitive.md'), 'System prompt', 'utf8');
    await writeFile(path.join(profileRoot, 'alice.md'), 'Profile body', 'utf8');

    const scanned = await scanAssets({ templateRoot, profileRoot });

    expect(scanned.templates.map((item) => item.id)).toEqual(['hw_prompt_definitive.md']);
    expect(scanned.profiles.map((item) => item.id)).toEqual(['alice.md']);
    expect(scanned.scannedFiles).toBe(2);
  });

  it('fails fast when template and profile roots overlap', async () => {
    const baseDir = await createTempDir('prompt-assets-overlap-');
    const templateRoot = path.join(baseDir, 'docs');
    const profileRoot = path.join(baseDir, 'docs', 'profiles');
    await mkdir(profileRoot, { recursive: true });
    await writeFile(path.join(templateRoot, 'hw_prompt_definitive.md'), 'System prompt', 'utf8');
    await writeFile(path.join(profileRoot, 'alice.md'), 'Profile body', 'utf8');

    await expect(scanAssets({ templateRoot, profileRoot })).rejects.toThrow(
      /must be distinct and non-overlapping/i,
    );
  });

  it('rejects template assets that still contain the retired profile marker', async () => {
    const baseDir = await createTempDir('prompt-assets-marker-');
    const templateRoot = path.join(baseDir, 'templates');
    const profileRoot = path.join(baseDir, 'profiles');
    await mkdir(templateRoot, { recursive: true });
    await mkdir(profileRoot, { recursive: true });

    await writeFile(
      path.join(templateRoot, 'legacy-template.md'),
      'Header\nINSERT PROFILE HERE\nFooter\n',
      'utf8',
    );
    await writeFile(path.join(profileRoot, 'alice.md'), 'Profile body', 'utf8');

    await expect(scanAssets({ templateRoot, profileRoot })).rejects.toThrow(
      /retired legacy marker/i,
    );
  });
});
