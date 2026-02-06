import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  deleteProfileContent,
  getProfileContent,
  listProfileContents,
  upsertProfileContent,
} from '../src/application/profile-content.js';
import { loadConfig } from '../src/config/env.js';

const tempDirs: string[] = [];

async function createProfileRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'esl-profiles-'));
  const profilesDir = path.join(root, 'profiles');
  await mkdir(profilesDir, { recursive: true });
  const defaultPath = path.join(profilesDir, 'default.md');
  await writeFile(defaultPath, '# Default profile\n', 'utf8');
  tempDirs.push(root);
  return { root, profilesDir, defaultPath };
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe('profile-content', () => {
  it('lists and reads allowlisted profile content', async () => {
    const { defaultPath } = await createProfileRoot();
    const config = loadConfig();
    const override = { ...config, prompt: { ...config.prompt, defaultProfilePath: defaultPath } };

    const list = await listProfileContents({ config: override });
    expect(list.profiles.some((profile) => profile.id === 'default.md')).toBe(true);

    const profile = await getProfileContent('default.md', { config: override });
    expect(profile?.content).toContain('Default profile');
  });

  it('creates and deletes a profile file', async () => {
    const { defaultPath, profilesDir } = await createProfileRoot();
    const config = loadConfig();
    const override = { ...config, prompt: { ...config.prompt, defaultProfilePath: defaultPath } };

    const created = await upsertProfileContent('custom.md', 'Custom profile', { config: override });
    expect(created.id).toBe('custom.md');

    const fileContent = await readFile(path.join(profilesDir, 'custom.md'), 'utf8');
    expect(fileContent).toBe('Custom profile');

    const deleted = await deleteProfileContent('custom.md', { config: override });
    expect(deleted).toBe(true);
  });
});
