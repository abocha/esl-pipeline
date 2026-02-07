import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  deleteProfileContent,
  getProfileContent,
  getProfileRevisionForProfile,
  listProfileContents,
  listProfileRevisionsForProfile,
  restoreProfileRevision,
  upsertProfileContent,
} from '../src/application/profile-content.js';
import { loadConfig } from '../src/config/env.js';
import type { ProfileRevisionRecord } from '../src/domain/profile-revision-model.js';

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

function createRevisionStore() {
  const revisions: ProfileRevisionRecord[] = [];

  return {
    revisions,
    deps: {
      getLatestByHash: async (profileId: string, contentHash: string) =>
        revisions
          .filter((revision) => revision.profileId === profileId && revision.contentHash === contentHash)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null,
      insert: async ({
        profileId,
        content,
        contentHash,
        source,
        createdBy,
        restoredFromRevisionId,
      }: {
        profileId: string;
        content: string;
        contentHash: string;
        source?: 'create' | 'update' | 'restore';
        createdBy?: string | null;
        restoredFromRevisionId?: string | null;
      }) => {
        const revision: ProfileRevisionRecord = {
          id: `revision-${revisions.length + 1}`,
          profileId,
          content,
          contentHash,
          source: source ?? 'update',
          createdAt: new Date(Date.UTC(2024, 0, 1, 0, 0, revisions.length)),
          createdBy: createdBy ?? null,
          restoredFromRevisionId: restoredFromRevisionId ?? null,
        };
        revisions.push(revision);
        return revision;
      },
      list: async ({
        profileId,
        limit = 50,
        offset = 0,
        order = 'desc',
      }: {
        profileId: string;
        limit?: number;
        offset?: number;
        order?: 'asc' | 'desc';
      }) => {
        const filtered = revisions.filter((revision) => revision.profileId === profileId);
        const sorted = [...filtered].sort((a, b) =>
          order === 'asc'
            ? a.createdAt.getTime() - b.createdAt.getTime()
            : b.createdAt.getTime() - a.createdAt.getTime(),
        );
        return {
          items: sorted.slice(offset, offset + limit),
          total: filtered.length,
          limit,
          offset,
          order,
        };
      },
      getById: async (profileId: string, revisionId: string) =>
        revisions.find(
          (revision) => revision.profileId === profileId && revision.id === revisionId,
        ) ?? null,
    },
  };
}

describe('profile-content', () => {
  it('lists and reads allowlisted profile content', async () => {
    const { defaultPath } = await createProfileRoot();
    const config = loadConfig();
    const override = { ...config, prompt: { ...config.prompt, defaultProfilePath: defaultPath } };
    const revisionStore = createRevisionStore();

    const list = await listProfileContents({ config: override });
    expect(list.profiles.some((profile) => profile.id === 'default.md')).toBe(true);

    const profile = await getProfileContent('default.md', {
      config: override,
      revisions: revisionStore.deps,
    });
    expect(profile?.content).toContain('Default profile');
    expect(profile?.currentRevisionId).toBeNull();
    expect(profile?.updatedAt).toBeNull();
  });

  it('creates and deletes a profile file', async () => {
    const { defaultPath, profilesDir } = await createProfileRoot();
    const config = loadConfig();
    const override = { ...config, prompt: { ...config.prompt, defaultProfilePath: defaultPath } };
    const revisionStore = createRevisionStore();

    const created = await upsertProfileContent('custom.md', 'Custom profile', {
      config: override,
      revisions: revisionStore.deps,
    });
    expect(created.id).toBe('custom.md');
    expect(created.currentRevisionId).toBe('revision-1');

    const fileContent = await readFile(path.join(profilesDir, 'custom.md'), 'utf8');
    expect(fileContent).toBe('Custom profile');

    const deleted = await deleteProfileContent('custom.md', { config: override });
    expect(deleted).toBe(true);
  });

  it('lists revisions and restores previous content snapshots', async () => {
    const { defaultPath } = await createProfileRoot();
    const config = loadConfig();
    const override = { ...config, prompt: { ...config.prompt, defaultProfilePath: defaultPath } };
    const revisionStore = createRevisionStore();

    await upsertProfileContent('default.md', 'Version 1', {
      config: override,
      revisions: revisionStore.deps,
      createdBy: 'user-1',
    });
    await upsertProfileContent('default.md', 'Version 2', {
      config: override,
      revisions: revisionStore.deps,
      createdBy: 'user-2',
    });

    const revisions = await listProfileRevisionsForProfile(
      'default.md',
      { order: 'desc' },
      {
        config: override,
        revisions: revisionStore.deps,
      },
    );
    expect(revisions?.total).toBe(2);
    expect(revisions?.items[0]?.source).toBe('update');

    const firstRevisionId = revisions?.items[1]?.id;
    expect(firstRevisionId).toBeTruthy();
    if (!firstRevisionId) {
      throw new Error('Expected first revision id');
    }

    const detail = await getProfileRevisionForProfile('default.md', firstRevisionId, {
      config: override,
      revisions: revisionStore.deps,
    });
    expect(detail?.content).toBe('Version 1');

    const restored = await restoreProfileRevision('default.md', firstRevisionId, {
      config: override,
      revisions: revisionStore.deps,
      createdBy: 'user-3',
    });
    expect(restored?.content).toBe('Version 1');
    expect(restored?.currentRevisionId).toBe('revision-3');

    const latest = await getProfileContent('default.md', {
      config: override,
      revisions: revisionStore.deps,
    });
    expect(latest?.content).toBe('Version 1');
    expect(latest?.currentRevisionId).toBe('revision-3');
  });
});
