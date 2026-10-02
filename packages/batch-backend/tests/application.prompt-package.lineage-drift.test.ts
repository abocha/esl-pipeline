import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { hashPromptProfileContent } from '../src/application/create-prompt-package.js';
import { renderFoundationalProfileContent } from '../src/application/foundational-profile.js';
import {
  getPromptPackage,
  getPromptPackageLineage,
} from '../src/application/get-prompt-package.js';
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
        profilePath: null,
        resolvedProfileId: null,
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
        getActive: async (studentId) => {
          expect(studentId).toBe('student-1');
          return {
            id: 'revision-current',
            studentId: 'student-1',
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

    expect(result?.profileSnapshot?.resolvedProfileId).toBeNull();
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
        resolvedTemplateId: 'hw_prompt_assignment_v1.md',
        resolvedTemplateHash: snapshotHash,
        resolvedTemplateRevisionId: 'template-revision-snapshot',
        resolvedTemplateUpdatedAt: new Date('2024-01-01T00:00:00Z'),
        templateVersion: 'hw_prompt_assignment_v1.md',
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
          templateId: 'hw_prompt_assignment_v1.md',
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

  it('does not flag profile drift when the stored revision re-renders to the same canonical profile text', async () => {
    const structuredProfile = {
      schemaVersion: 'foundational_profile_v1' as const,
      overallLevel: 'B1',
      primaryGoals: ['Lead updates clearly.'],
      communicationContexts: ['Standups'],
      interestsAndUsefulThemes: [],
      stableStrengths: ['Strong listening'],
      persistentChallenges: ['Articles'],
      studyPreferences: [],
      durableConstraints: [],
      teacherNotes: 'Keep examples practical.',
    };
    const renderedProfile = renderFoundationalProfileContent(structuredProfile);
    const snapshotHash = createHash('sha256').update(renderedProfile, 'utf8').digest('hex');

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
        getActive: async (_profileId) => ({
          id: 'revision-current',
          studentId: 'student-1',
          content: '# Legacy markdown that re-renders to the same structured profile',
          contentHash: createHash('sha256')
            .update('# Legacy markdown that re-renders to the same structured profile', 'utf8')
            .digest('hex'),
          structuredContent: structuredProfile,
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
      templateRevisions: createTemplateRevisionRepositoryStub(),
    });

    expect(result?.profileDrift).toBeUndefined();
  });

  it('returns prompt lineage with snapshot and current revision metadata', async () => {
    const snapshotProfileHash = createHash('sha256')
      .update('SNAPSHOT PROFILE', 'utf8')
      .digest('hex');
    const currentProfileHash = createHash('sha256').update('CURRENT PROFILE', 'utf8').digest('hex');
    const snapshotTemplateHash = createHash('sha256')
      .update('SNAPSHOT TEMPLATE', 'utf8')
      .digest('hex');

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
          resolvedTemplateId: 'hw_prompt_assignment_v1.md',
          resolvedTemplateHash: snapshotTemplateHash,
          resolvedTemplateRevisionId: 'template-revision-v1',
          resolvedTemplateUpdatedAt: new Date('2024-01-01T00:00:00Z'),
          resolvedTemplateVersionLabel: 'v1',
          resolvedTemplateStatus: 'active',
          templateVersion: 'hw_prompt_assignment_v1.md',
          notes: null,
          storageUri: 'local://prompt-packages/prompt-1.txt',
          createdAt: new Date('2024-01-01T00:00:00Z'),
          updatedAt: new Date('2024-01-01T00:05:00Z'),
        }),
      },
      profileRevisions: createProfileRevisionRepositoryStub({
        getActive: async () => ({
          id: 'profile-revision-v2',
          studentId: 'student-1',
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
          templateId: 'hw_prompt_assignment_v1.md',
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

  it('uses canonical rendered profile hashes in lineage current metadata', async () => {
    const structuredProfile = {
      schemaVersion: 'foundational_profile_v1' as const,
      overallLevel: 'B1',
      primaryGoals: ['Lead updates clearly.'],
      communicationContexts: ['Standups'],
      interestsAndUsefulThemes: [],
      stableStrengths: ['Strong listening'],
      persistentChallenges: ['Articles'],
      studyPreferences: [],
      durableConstraints: [],
      teacherNotes: 'Keep examples practical.',
    };
    const currentProfile = {
      id: 'profile-revision-v2',
      studentId: 'student-1',
      content: '# Legacy markdown payload',
      contentHash: createHash('sha256').update('# Legacy markdown payload', 'utf8').digest('hex'),
      structuredContent: structuredProfile,
      source: 'update' as const,
      status: 'active' as const,
      versionNumber: 2,
      versionLabel: 'v2',
      activatedAt: new Date('2024-01-02T00:00:00Z'),
      deprecatedAt: null,
      createdAt: new Date('2024-01-02T00:00:00Z'),
      createdBy: null,
      restoredFromRevisionId: null,
    };

    const lineage = await getPromptPackageLineage('prompt-1', {
      promptPackages: {
        getById: async () => ({
          id: 'prompt-1',
          recordingId: 'recording-1',
          transcriptId: 'transcript-1',
          studentId: 'student-1',
          profilePath: '/profiles/p1.md',
          resolvedProfileId: 'profile.md',
          resolvedProfileHash: hashPromptProfileContent(currentProfile),
          resolvedProfileRevisionId: 'profile-revision-v1',
          resolvedProfileUpdatedAt: new Date('2024-01-01T00:00:00Z'),
          resolvedProfileVersionLabel: 'v1',
          resolvedProfileStatus: 'active',
          resolvedTemplateId: null,
          resolvedTemplateHash: null,
          resolvedTemplateRevisionId: null,
          resolvedTemplateUpdatedAt: null,
          resolvedTemplateVersionLabel: null,
          resolvedTemplateStatus: null,
          templateVersion: 'hw_prompt_assignment_v1.md',
          notes: null,
          storageUri: 'local://prompt-packages/prompt-1.txt',
          createdAt: new Date('2024-01-01T00:00:00Z'),
          updatedAt: new Date('2024-01-01T00:05:00Z'),
        }),
      },
      profileRevisions: createProfileRevisionRepositoryStub({
        getActive: async () => currentProfile,
      }),
      templateRevisions: createTemplateRevisionRepositoryStub(),
      storage: createStorageStub(),
    });

    expect(lineage?.profile.current.hash).toBe(hashPromptProfileContent(currentProfile));
    expect(lineage?.profile.current.hash).not.toBe(currentProfile.contentHash);
  });
});
