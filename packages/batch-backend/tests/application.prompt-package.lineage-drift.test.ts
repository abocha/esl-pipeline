import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { getPromptPackage, getPromptPackageLineage } from '../src/application/get-prompt-package.js';
import type { PromptPackageRecord } from '../src/domain/prompt-package-model.js';

import {
  createProfileRevisionRepositoryStub,
  createStorageStub,
  createTemplateRevisionRepositoryStub,
} from './application.prompt-package.test-harness.js';

describe('application/prompt-package', () => {
  it('adds profile drift metadata when profile content changed after snapshot', async () => {
    const snapshotHash = createHash('sha256').update('SNAPSHOT PROFILE', 'utf8').digest('hex');
    const currentHash = createHash('sha256').update('CURRENT PROFILE', 'utf8').digest('hex');

    const storage = createStorageStub({
      getText: async () => 'Prompt package text',
    });

    const promptPackages = {
      getById: async (): Promise<PromptPackageRecord | null> => ({
        id: 'prompt-1',
        recordingId: 'recording-1',
        transcriptId: 'transcript-1',
        studentId: 'student-1',
        profilePath: '/profiles/p1.md',
        resolvedProfileId: 'profile.md',
        resolvedProfileHash: snapshotHash,
        resolvedProfileRevisionId: 'revision-snapshot',
        resolvedProfileUpdatedAt: new Date('2024-01-01T00:00:00Z'),
        templateVersion: 't1.md',
        notes: 'Notes',
        storageUri: 'local://prompt-packages/prompt-1.txt',
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T00:10:00Z'),
      }),
    };

    const result = await getPromptPackage('prompt-1', {
      storage,
      promptPackages,
      profileRevisions: createProfileRevisionRepositoryStub({
        getActive: async (_profileId) => {
          return {
            id: 'revision-current',
            profileId: 'profile.md',
            content: 'CURRENT PROFILE',
            contentHash: currentHash,
            source: 'update',
            status: 'active',
            versionNumber: 2,
            versionLabel: 'v2',
            activatedAt: new Date('2024-01-02T00:00:00Z'),
            deprecatedAt: null,
            createdAt: new Date('2024-01-02T00:00:00Z'),
            createdBy: null,
            restoredFromRevisionId: null,
          };
        },
      }),
      templateRevisions: createTemplateRevisionRepositoryStub(),
    });

    expect(result?.profileDrift).toEqual({
      detected: true,
      reason: 'profile_content_changed',
      currentProfileHash: currentHash,
      currentProfileRevisionId: 'revision-current',
      currentProfileUpdatedAt: '2024-01-02T00:00:00.000Z',
    });
  });

  it('adds template drift metadata when template content changed after snapshot', async () => {
    const snapshotHash = createHash('sha256').update('TEMPLATE SNAPSHOT', 'utf8').digest('hex');
    const currentHash = createHash('sha256').update('TEMPLATE CURRENT', 'utf8').digest('hex');

    const storage = createStorageStub({
      getText: async () => 'Prompt package text',
    });

    const promptPackages = {
      getById: async (): Promise<PromptPackageRecord | null> => ({
        id: 'prompt-1',
        recordingId: 'recording-1',
        transcriptId: 'transcript-1',
        studentId: 'student-1',
        profilePath: '/profiles/p1.md',
        resolvedTemplateId: 'template.md',
        resolvedTemplateHash: snapshotHash,
        resolvedTemplateRevisionId: 'template-revision-snapshot',
        resolvedTemplateUpdatedAt: new Date('2024-01-01T00:00:00Z'),
        templateVersion: 'template.md',
        notes: 'Notes',
        storageUri: 'local://prompt-packages/prompt-1.txt',
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T00:10:00Z'),
      }),
    };

    const result = await getPromptPackage('prompt-1', {
      storage,
      promptPackages,
      profileRevisions: createProfileRevisionRepositoryStub(),
      templateRevisions: createTemplateRevisionRepositoryStub({
        getActive: async (_templateId) => ({
          id: 'template-revision-current',
          templateId: 'template.md',
          content: 'TEMPLATE CURRENT',
          contentHash: currentHash,
          source: 'update',
          status: 'active',
          versionNumber: 2,
          versionLabel: 'v2',
          activatedAt: new Date('2024-01-02T00:00:00Z'),
          deprecatedAt: null,
          createdAt: new Date('2024-01-02T00:00:00Z'),
          createdBy: null,
          restoredFromRevisionId: null,
        }),
      }),
    });

    expect(result?.templateDrift).toEqual({
      detected: true,
      reason: 'template_content_changed',
      currentTemplateHash: currentHash,
      currentTemplateRevisionId: 'template-revision-current',
      currentTemplateUpdatedAt: '2024-01-02T00:00:00.000Z',
    });
  });

  it('returns prompt lineage with snapshot and current revision metadata', async () => {
    const snapshotProfileHash = createHash('sha256').update('SNAPSHOT PROFILE', 'utf8').digest('hex');
    const currentProfileHash = createHash('sha256').update('CURRENT PROFILE', 'utf8').digest('hex');
    const snapshotTemplateHash = createHash('sha256').update('SNAPSHOT TEMPLATE', 'utf8').digest('hex');

    const lineage = await getPromptPackageLineage('prompt-1', {
      promptPackages: {
        getById: async () => ({
          id: 'prompt-1',
          recordingId: 'recording-1',
          transcriptId: 'transcript-1',
          studentId: 'student-1',
          profilePath: '/profiles/p1.md',
          resolvedProfileId: 'profile.md',
          resolvedProfileHash: snapshotProfileHash,
          resolvedProfileRevisionId: 'profile-revision-v1',
          resolvedProfileUpdatedAt: new Date('2024-01-01T00:00:00Z'),
          resolvedProfileVersionLabel: 'v1',
          resolvedProfileStatus: 'active',
          resolvedTemplateId: 'template.md',
          resolvedTemplateHash: snapshotTemplateHash,
          resolvedTemplateRevisionId: 'template-revision-v1',
          resolvedTemplateUpdatedAt: new Date('2024-01-01T00:00:00Z'),
          resolvedTemplateVersionLabel: 'v1',
          resolvedTemplateStatus: 'active',
          templateVersion: 'template.md',
          notes: null,
          storageUri: 'local://prompt-packages/prompt-1.txt',
          createdAt: new Date('2024-01-01T00:00:00Z'),
          updatedAt: new Date('2024-01-01T00:05:00Z'),
        }),
      },
      profileRevisions: createProfileRevisionRepositoryStub({
        getActive: async () => ({
          id: 'profile-revision-v2',
          profileId: 'profile.md',
          content: 'CURRENT PROFILE',
          contentHash: currentProfileHash,
          source: 'update',
          status: 'active',
          versionNumber: 2,
          versionLabel: 'v2',
          activatedAt: new Date('2024-01-02T00:00:00Z'),
          deprecatedAt: null,
          createdAt: new Date('2024-01-02T00:00:00Z'),
          createdBy: null,
          restoredFromRevisionId: null,
        }),
      }),
      templateRevisions: createTemplateRevisionRepositoryStub({
        getActive: async () => ({
          id: 'template-revision-v1',
          templateId: 'template.md',
          content: 'SNAPSHOT TEMPLATE',
          contentHash: snapshotTemplateHash,
          source: 'update',
          status: 'active',
          versionNumber: 1,
          versionLabel: 'v1',
          activatedAt: new Date('2024-01-01T00:00:00Z'),
          deprecatedAt: null,
          createdAt: new Date('2024-01-01T00:00:00Z'),
          createdBy: null,
          restoredFromRevisionId: null,
        }),
      }),
      bindings: {
        getAt: async () => null,
      },
      storage: createStorageStub(),
    });

    expect(lineage?.promptPackageId).toBe('prompt-1');
    expect(lineage?.profile.snapshot.revisionId).toBe('profile-revision-v1');
    expect(lineage?.profile.current.revisionId).toBe('profile-revision-v2');
    expect(lineage?.profile.drift?.reason).toBe('profile_content_changed');
    expect(lineage?.template.snapshot.revisionId).toBe('template-revision-v1');
    expect(lineage?.template.current.revisionId).toBe('template-revision-v1');
    expect(lineage?.template.drift).toBeNull();
    expect(lineage?.bindingAtCreation ?? null).toBeNull();
  });
});
