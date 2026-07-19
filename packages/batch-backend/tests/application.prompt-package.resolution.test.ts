import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { createPromptPackage } from '../src/application/create-prompt-package.js';
import { resolvePromptTemplateSelection } from '../src/application/prompt-options.js';
import type { PromptPackageRecord } from '../src/domain/prompt-package-model.js';
import type { InsertPromptPackageParams } from '../src/domain/prompt-package-repository.js';
import type { RecordingRecord } from '../src/domain/recording-model.js';
import {
  createBindingResolverStub,
  createConfig,
  createProfileRevisionRepositoryStub,
  createPromptOptionsStub,
  createPromptPackageRepositoryStub,
  createStorageStub,
  createTemplateRevisionRepositoryStub,
  createTranscriptRecord,
} from './application.prompt-package.test-harness.js';

function createConfirmedAssignmentSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    userId: 'user-1',
    studentId: 'student-1',
    lessonId: '11111111-1111-4111-8111-111111111111',
    recordingId: 'recording-1',
    transcriptId: 'transcript-1',
    promptPackageId: null,
    draftId: null,
    revision: 3,
    confirmedStep: 'context',
    confirmed: {
      student: { studentId: 'student-1' },
      source: {
        lessonId: '11111111-1111-4111-8111-111111111111',
        recordingId: 'recording-1',
        transcriptId: 'transcript-1',
        transcriptWorkingVersion: 1,
        transcriptStorageUri: 'local://confirmed/transcript-a.txt',
        transcriptHash: createHash('sha256').update('CONFIRMED TRANSCRIPT A', 'utf8').digest('hex'),
      },
      context: {
        teacherNotes: 'CONFIRMED NOTES A',
        profileId: 'profile.md',
        profileRevisionId: 'profile-revision-a',
        profileRevisionHash: createHash('sha256')
          .update('CONFIRMED PROFILE A', 'utf8')
          .digest('hex'),
      },
      create: null,
    },
    creationRequestId: null,
    publishTarget: null,
    selectedTtsProvider: null,
    selectedTtsStrategy: null,
    selectedTtsModel: null,
    selectedPreset: null,
    selectedGenerationProvider: null,
    selectedGenerationModel: null,
    teacherNotes: 'NEWER RECOVERY NOTES B',
    selectedProfileId: 'profile.md',
    selectedProfileRevisionId: 'profile-revision-b',
    selectedProfileRevisionHash: 'newer-profile-hash',
    shareJobId: null,
    createdAt: new Date('2026-07-19T00:00:00Z'),
    updatedAt: new Date('2026-07-19T00:01:00Z'),
    ...overrides,
  } as never;
}

describe('application/prompt-package', () => {
  it('uses exact confirmed transcript and profile inputs after mutable state advances', async () => {
    const confirmedProfileContent = 'CONFIRMED PROFILE A';
    const confirmedProfileHash = createHash('sha256')
      .update(confirmedProfileContent, 'utf8')
      .digest('hex');
    const activeProfileContent = 'NEW ACTIVE PROFILE B';
    const activeProfileHash = createHash('sha256')
      .update(activeProfileContent, 'utf8')
      .digest('hex');
    const profileRevisions = createProfileRevisionRepositoryStub({
      getById: async () => ({
        id: 'profile-revision-a',
        profileId: 'profile.md',
        content: confirmedProfileContent,
        contentHash: confirmedProfileHash,
        source: 'create',
        status: 'deprecated',
        versionNumber: 1,
        versionLabel: 'v1',
        activatedAt: new Date('2026-07-18T00:00:00Z'),
        deprecatedAt: new Date('2026-07-19T00:00:00Z'),
        createdAt: new Date('2026-07-18T00:00:00Z'),
        createdBy: null,
        restoredFromRevisionId: null,
        structuredContent: {
          schemaVersion: 'foundational_profile_v1',
          overallLevel: 'B2',
          primaryGoals: ['CONFIRMED STRUCTURED GOAL A'],
          communicationContexts: [],
          interestsAndUsefulThemes: [],
          stableStrengths: [],
          persistentChallenges: [],
          studyPreferences: [],
          durableConstraints: [],
          teacherNotes: null,
        },
      }),
      getActive: async () => ({
        id: 'profile-revision-b',
        profileId: 'profile.md',
        content: activeProfileContent,
        contentHash: activeProfileHash,
        source: 'update',
        status: 'active',
        versionNumber: 2,
        versionLabel: 'v2',
        activatedAt: new Date('2026-07-19T00:00:00Z'),
        deprecatedAt: null,
        createdAt: new Date('2026-07-19T00:00:00Z'),
        createdBy: null,
        restoredFromRevisionId: null,
      }),
    });

    const result = await createPromptPackage(
      {
        recordingId: 'recording-1',
        assignmentSessionId: 'session-1',
        userId: 'user-1',
        templateId: 'template.md',
      },
      {
        config: createConfig('template.md', 'profile.md'),
        storage: createStorageStub({
          getText: async (uri) =>
            uri === 'local://confirmed/transcript-a.txt'
              ? 'CONFIRMED TRANSCRIPT A'
              : 'NEW WORKING TRANSCRIPT B',
        }),
        sessions: { getByIdForUser: async () => createConfirmedAssignmentSession() },
        transcripts: {
          getByRecordingId: async () => {
            throw new Error('mutable transcript lookup must not run');
          },
        },
        recordings: {
          getById: async () => ({
            id: 'recording-1',
            source: 'upload',
            studentId: 'student-1',
            sourcePath: null,
            storageUri: 'local://recordings/a.opus',
            sha256: null,
            bytes: 1,
            durationSec: null,
            channels: null,
            status: 'transcribed',
            error: null,
            createdAt: new Date('2026-07-18T00:00:00Z'),
            updatedAt: new Date('2026-07-18T00:00:00Z'),
          }),
        },
        students: {
          getById: async () => ({
            id: 'student-1',
            student: 'Student One',
            profileId: 'profile.md',
          }),
        },
        profileRevisions,
        templateRevisions: createTemplateRevisionRepositoryStub(),
        bindings: createBindingResolverStub(),
        promptOptions: createPromptOptionsStub(),
        promptPackages: createPromptPackageRepositoryStub(),
      },
    );

    expect(result?.text).toContain('CONFIRMED TRANSCRIPT A');
    expect(result?.text).not.toContain('NEW WORKING TRANSCRIPT B');
    expect(result?.text).toContain('CONFIRMED STRUCTURED GOAL A');
    expect(result?.text).not.toContain('NEW ACTIVE PROFILE B');
    expect(result?.text).toContain('CONFIRMED NOTES A');
    expect(result?.text).not.toContain('NEWER RECOVERY NOTES B');
    expect(result?.profileSnapshot?.resolvedProfileRevisionId).toBe('profile-revision-a');
    expect(result?.profileSnapshot?.resolvedProfileHash).not.toBe(confirmedProfileHash);
  });

  it('keeps an explicitly confirmed null profile deterministic', async () => {
    const config = createConfig('template.md', 'missing-default-profile.md');
    const session = createConfirmedAssignmentSession({
      teacherNotes: null,
      selectedProfileId: null,
      selectedProfileRevisionId: null,
      selectedProfileRevisionHash: null,
      confirmed: {
        student: { studentId: 'student-1' },
        source: {
          lessonId: '11111111-1111-4111-8111-111111111111',
          recordingId: 'recording-1',
          transcriptId: 'transcript-1',
          transcriptWorkingVersion: 1,
          transcriptStorageUri: 'local://confirmed/transcript-a.txt',
          transcriptHash: createHash('sha256')
            .update('CONFIRMED TRANSCRIPT A', 'utf8')
            .digest('hex'),
        },
        context: {
          teacherNotes: null,
          profileId: null,
          profileRevisionId: null,
          profileRevisionHash: null,
        },
        create: null,
      },
    });
    const inserted: InsertPromptPackageParams[] = [];

    const result = await createPromptPackage(
      {
        recordingId: 'recording-1',
        assignmentSessionId: 'session-1',
        userId: 'user-1',
        templateId: 'template.md',
      },
      {
        config,
        storage: createStorageStub({
          getText: async () => 'CONFIRMED TRANSCRIPT A',
        }),
        sessions: { getByIdForUser: async () => session },
        transcripts: {
          getByRecordingId: async () => {
            throw new Error('mutable transcript lookup must not run');
          },
        },
        recordings: {
          getById: async () => ({
            id: 'recording-1',
            source: 'upload',
            studentId: 'student-1',
            sourcePath: null,
            storageUri: 'local://recordings/a.opus',
            sha256: null,
            bytes: 1,
            durationSec: null,
            channels: null,
            status: 'transcribed',
            error: null,
            createdAt: new Date('2026-07-18T00:00:00Z'),
            updatedAt: new Date('2026-07-18T00:00:00Z'),
          }),
        },
        students: {
          getById: async () => ({
            id: 'student-1',
            student: 'Student One',
            profileId: 'mutable-active-profile.md',
          }),
        },
        profileRevisions: createProfileRevisionRepositoryStub({
          getActive: async () => {
            throw new Error('confirmed null Context must not resolve an active profile');
          },
        }),
        templateRevisions: createTemplateRevisionRepositoryStub(),
        bindings: createBindingResolverStub(),
        promptOptions: {
          resolveSelection: createPromptOptionsStub().resolveSelection,
          resolveTemplateSelection: (params) =>
            resolvePromptTemplateSelection(params, {
              config,
              templateRevisions: {
                listIdsWithActiveRevision: async () => new Set(['template.md']),
              },
              templates: {
                list: async () => ({
                  items: [
                    {
                      id: 'template.md',
                      label: 'Template',
                      activeRevisionId: 'template-revision-active',
                      isDefault: true,
                      createdAt: new Date('2026-07-18T00:00:00Z'),
                      updatedAt: new Date('2026-07-18T00:00:00Z'),
                    },
                  ],
                  total: 1,
                  limit: 500,
                  offset: 0,
                  order: 'asc',
                }),
                getById: async () => null,
              },
              profileRevisions: {
                listIdsWithActiveRevision: async () => {
                  throw new Error('template-only resolution must not inspect profile revisions');
                },
              },
              profiles: {
                list: async () => {
                  throw new Error('template-only resolution must not inspect profiles');
                },
                getById: async () => null,
              },
            }),
        },
        promptPackages: {
          insert: async (params) => {
            inserted.push(params);
            return {
              ...(await createPromptPackageRepositoryStub().insert(params)),
              resolvedProfileId: params.resolvedProfileId ?? null,
              resolvedProfileHash: params.resolvedProfileHash ?? null,
              resolvedProfileRevisionId: params.resolvedProfileRevisionId ?? null,
            };
          },
        },
      },
    );

    expect(result?.text).toContain('[FOUNDATIONAL_PROFILE]\nNot available.');
    expect(result?.profileSnapshot).toBeUndefined();
    expect(inserted[0]).toMatchObject({
      profilePath: null,
      resolvedProfileId: null,
      resolvedProfileHash: null,
      resolvedProfileRevisionId: null,
    });
  });

  it('rejects an unowned assignment session', async () => {
    await expect(
      createPromptPackage(
        {
          recordingId: 'recording-1',
          assignmentSessionId: 'session-1',
          userId: 'other-user',
        },
        { sessions: { getByIdForUser: async () => null } },
      ),
    ).rejects.toMatchObject({ code: 'PROMPT_PACKAGE_ASSIGNMENT_SESSION_NOT_FOUND' });
  });

  it('rejects missing confirmed prerequisites and broken confirmed lineage', async () => {
    await expect(
      createPromptPackage(
        { recordingId: 'recording-1', assignmentSessionId: 'session-1', userId: 'user-1' },
        {
          sessions: {
            getByIdForUser: async () =>
              createConfirmedAssignmentSession({
                confirmed: {
                  student: { studentId: 'student-1' },
                  source: null,
                  context: null,
                  create: null,
                },
              }),
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'PROMPT_PACKAGE_CONFIRMED_PREREQUISITE_MISSING' });

    await expect(
      createPromptPackage(
        { recordingId: 'recording-1', assignmentSessionId: 'session-1', userId: 'user-1' },
        {
          sessions: {
            getByIdForUser: async () =>
              createConfirmedAssignmentSession({ recordingId: 'different-recording' }),
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'PROMPT_PACKAGE_CONFIRMED_LINEAGE_INVALID' });
  });

  it('renders the foundational profile block from structured content when the active revision has canonical JSON', async () => {
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-prompt-structured-'));
    const templatePath = path.join(allowedDir, 'template.md');
    const profilePath = path.join(allowedDir, 'profile.md');
    await fs.writeFile(templatePath, 'DB TEMPLATE\nEND\n', 'utf8');
    await fs.writeFile(profilePath, 'LEGACY PROFILE\n', 'utf8');

    const transcript = createTranscriptRecord();
    const storage = createStorageStub({
      getText: async () => 'TRANSCRIPT BODY',
      putPromptPackage: async ({ promptPackageId, text }) => {
        expect(text).toContain('[FOUNDATIONAL_PROFILE]\n# Foundational Profile');
        expect(text).toContain('**Current Level:** B2');
        expect(text).toContain('- Lead product demos with more confidence.');
        expect(text).not.toContain('LEGACY PROFILE');
        return {
          uri: `local://prompt-packages/${promptPackageId}.txt`,
          bytes: text.length,
          sha256: 'hash',
        };
      },
    });

    await createPromptPackage(
      {
        recordingId: transcript.recordingId,
        templateId: 'template.md',
        profileId: 'profile.md',
      },
      {
        config: createConfig(templatePath, profilePath),
        storage,
        transcripts: {
          getByRecordingId: async () => transcript,
        },
        recordings: {
          getById: async () => null,
        },
        students: {
          getById: async () => null,
        },
        promptPackages: createPromptPackageRepositoryStub(),
        profileRevisions: createProfileRevisionRepositoryStub({
          getActive: async () => ({
            id: 'profile-revision-active',
            profileId: 'profile.md',
            content: 'LEGACY PROFILE',
            contentHash: createHash('sha256').update('LEGACY PROFILE', 'utf8').digest('hex'),
            source: 'update',
            status: 'active',
            versionNumber: 2,
            versionLabel: 'v2',
            activatedAt: new Date('2024-01-02T00:00:00Z'),
            deprecatedAt: null,
            createdAt: new Date('2024-01-02T00:00:00Z'),
            createdBy: null,
            restoredFromRevisionId: null,
            structuredContent: {
              schemaVersion: 'foundational_profile_v1',
              overallLevel: 'B2',
              primaryGoals: ['Lead product demos with more confidence.'],
              communicationContexts: ['Works across product and engineering.'],
              interestsAndUsefulThemes: [],
              stableStrengths: [],
              persistentChallenges: [],
              studyPreferences: [],
              durableConstraints: [],
              teacherNotes: null,
            },
          }),
        }),
        templateRevisions: createTemplateRevisionRepositoryStub(),
        bindings: createBindingResolverStub(),
        promptOptions: createPromptOptionsStub(),
      },
    );
  });

  it('prefers active profile/template revisions over filesystem files when available', async () => {
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-prompt-allowed-'));
    const templatePath = path.join(allowedDir, 'template.md');
    const profilePath = path.join(allowedDir, 'profile.md');
    await fs.writeFile(templatePath, 'FS TEMPLATE\nEND\n', 'utf8');
    await fs.writeFile(profilePath, 'FS PROFILE\n', 'utf8');

    const transcript = createTranscriptRecord();
    const activeTemplateContent = 'DB TEMPLATE\nEND\n';
    const activeProfileContent = 'DB PROFILE\n';
    const activeTemplateHash = createHash('sha256')
      .update(activeTemplateContent, 'utf8')
      .digest('hex');
    const activeProfileHash = createHash('sha256')
      .update(activeProfileContent, 'utf8')
      .digest('hex');
    const storage = createStorageStub({
      getText: async () => 'TRANSCRIPT BODY',
      putPromptPackage: async ({ promptPackageId, text }) => {
        expect(text).toContain('DB TEMPLATE');
        expect(text).toContain('DB PROFILE');
        expect(text).not.toContain('FS TEMPLATE');
        expect(text).not.toContain('FS PROFILE');
        return {
          uri: `local://prompt-packages/${promptPackageId}.txt`,
          bytes: text.length,
          sha256: 'hash',
        };
      },
    });

    const result = await createPromptPackage(
      {
        recordingId: transcript.recordingId,
        templateId: 'template.md',
        profileId: 'profile.md',
      },
      {
        config: createConfig(templatePath, profilePath),
        storage,
        transcripts: {
          getByRecordingId: async () => transcript,
        },
        recordings: {
          getById: async () => null,
        },
        students: {
          getById: async () => null,
        },
        promptPackages: createPromptPackageRepositoryStub(),
        profileRevisions: createProfileRevisionRepositoryStub({
          getActive: async () => ({
            id: 'profile-revision-active',
            profileId: 'profile.md',
            content: activeProfileContent,
            contentHash: activeProfileHash,
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
            id: 'template-revision-active',
            templateId: 'template.md',
            content: activeTemplateContent,
            contentHash: activeTemplateHash,
            source: 'update',
            status: 'active',
            versionNumber: 3,
            versionLabel: 'v3',
            activatedAt: new Date('2024-01-03T00:00:00Z'),
            deprecatedAt: null,
            createdAt: new Date('2024-01-03T00:00:00Z'),
            createdBy: null,
            restoredFromRevisionId: null,
          }),
        }),
        bindings: createBindingResolverStub(),
        promptOptions: createPromptOptionsStub(),
      },
    );

    expect(result?.profileSnapshot?.resolvedProfileHash).toBe(activeProfileHash);
    expect(result?.templateSnapshot?.resolvedTemplateHash).toBe(activeTemplateHash);
    expect(result?.profileSnapshot?.resolvedProfileRevisionId).toBe('profile-revision-active');
    expect(result?.templateSnapshot?.resolvedTemplateRevisionId).toBe('template-revision-active');
  });

  it('pins newer active revisions on rerun while preserving previous package lineage', async () => {
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-prompt-allowed-'));
    const templatePath = path.join(allowedDir, 'template.md');
    const profilePath = path.join(allowedDir, 'profile.md');
    await fs.writeFile(templatePath, 'TEMPLATE FS\nEND\n', 'utf8');
    await fs.writeFile(profilePath, 'PROFILE FS\n', 'utf8');

    const transcript = createTranscriptRecord();
    const storage = createStorageStub({
      getText: async () => 'TRANSCRIPT BODY',
    });

    const profileV1 = {
      id: 'profile-revision-v1',
      profileId: 'profile.md',
      content: 'PROFILE V1',
      contentHash: createHash('sha256').update('PROFILE V1', 'utf8').digest('hex'),
      source: 'update' as const,
      status: 'active' as const,
      versionNumber: 1,
      versionLabel: 'v1',
      activatedAt: new Date('2024-01-01T00:00:00Z'),
      deprecatedAt: null,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      createdBy: null,
      restoredFromRevisionId: null,
    };
    const profileV2 = {
      ...profileV1,
      id: 'profile-revision-v2',
      content: 'PROFILE V2',
      contentHash: createHash('sha256').update('PROFILE V2', 'utf8').digest('hex'),
      versionNumber: 2,
      versionLabel: 'v2',
      activatedAt: new Date('2024-01-02T00:00:00Z'),
      createdAt: new Date('2024-01-02T00:00:00Z'),
    };
    const templateV1 = {
      id: 'template-revision-v1',
      templateId: 'template.md',
      content: 'TEMPLATE V1\nEND\n',
      contentHash: createHash('sha256').update('TEMPLATE V1\nEND\n', 'utf8').digest('hex'),
      source: 'update' as const,
      status: 'active' as const,
      versionNumber: 1,
      versionLabel: 'v1',
      activatedAt: new Date('2024-01-01T00:00:00Z'),
      deprecatedAt: null,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      createdBy: null,
      restoredFromRevisionId: null,
    };

    const insertedParams: InsertPromptPackageParams[] = [];
    const promptPackages = {
      insert: async (params: InsertPromptPackageParams): Promise<PromptPackageRecord> => {
        insertedParams.push({ ...params });
        return {
          id: params.id ?? `prompt-${insertedParams.length}`,
          recordingId: params.recordingId,
          transcriptId: params.transcriptId,
          studentId: params.studentId ?? null,
          profilePath: params.profilePath ?? null,
          resolvedProfileId: params.resolvedProfileId ?? null,
          resolvedProfileHash: params.resolvedProfileHash ?? null,
          resolvedProfileRevisionId: params.resolvedProfileRevisionId ?? null,
          resolvedProfileUpdatedAt: params.resolvedProfileUpdatedAt ?? null,
          resolvedProfileVersionLabel: params.resolvedProfileVersionLabel ?? null,
          resolvedProfileStatus: params.resolvedProfileStatus ?? null,
          resolvedTemplateId: params.resolvedTemplateId ?? null,
          resolvedTemplateHash: params.resolvedTemplateHash ?? null,
          resolvedTemplateRevisionId: params.resolvedTemplateRevisionId ?? null,
          resolvedTemplateUpdatedAt: params.resolvedTemplateUpdatedAt ?? null,
          resolvedTemplateVersionLabel: params.resolvedTemplateVersionLabel ?? null,
          resolvedTemplateStatus: params.resolvedTemplateStatus ?? null,
          templateVersion: params.templateVersion,
          notes: params.notes ?? null,
          storageUri: params.storageUri,
          createdAt: new Date('2024-01-01T00:00:00Z'),
          updatedAt: new Date('2024-01-01T00:00:00Z'),
        };
      },
    };

    let run = 1;
    const profileRevisions = createProfileRevisionRepositoryStub({
      getActive: async () => (run === 1 ? profileV1 : profileV2),
    });
    const templateRevisions = createTemplateRevisionRepositoryStub({
      getActive: async () => templateV1,
    });

    await createPromptPackage(
      {
        recordingId: transcript.recordingId,
        templateId: 'template.md',
        profileId: 'profile.md',
      },
      {
        config: createConfig(templatePath, profilePath),
        storage,
        transcripts: { getByRecordingId: async () => transcript },
        recordings: { getById: async () => null },
        students: { getById: async () => null },
        promptPackages,
        profileRevisions,
        templateRevisions,
        bindings: createBindingResolverStub(),
        promptOptions: createPromptOptionsStub(),
      },
    );
    run = 2;
    await createPromptPackage(
      {
        recordingId: transcript.recordingId,
        templateId: 'template.md',
        profileId: 'profile.md',
      },
      {
        config: createConfig(templatePath, profilePath),
        storage,
        transcripts: { getByRecordingId: async () => transcript },
        recordings: { getById: async () => null },
        students: { getById: async () => null },
        promptPackages,
        profileRevisions,
        templateRevisions,
        bindings: createBindingResolverStub(),
        promptOptions: createPromptOptionsStub(),
      },
    );

    expect(insertedParams).toHaveLength(2);
    expect(insertedParams[0]?.resolvedProfileRevisionId).toBe('profile-revision-v1');
    expect(insertedParams[1]?.resolvedProfileRevisionId).toBe('profile-revision-v2');
    expect(insertedParams[0]?.resolvedTemplateRevisionId).toBe('template-revision-v1');
    expect(insertedParams[1]?.resolvedTemplateRevisionId).toBe('template-revision-v1');
  });

  it('rejects unknown profileId selections', async () => {
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-prompt-allowed-'));
    const templatePath = path.join(allowedDir, 'template.md');
    const profilePath = path.join(allowedDir, 'profile.md');

    await fs.writeFile(templatePath, 'Hello\nFooter\n', 'utf8');
    await fs.writeFile(profilePath, 'PROFILE CONTENT\n', 'utf8');

    const transcript = createTranscriptRecord();
    const storage = createStorageStub({
      getText: async () => 'TRANSCRIPT BODY',
      putPromptPackage: async ({ promptPackageId, text }) => {
        return {
          uri: `local://prompt-packages/${promptPackageId}.txt`,
          bytes: text.length,
          sha256: 'hash',
        };
      },
    });

    await expect(
      createPromptPackage(
        {
          recordingId: transcript.recordingId,
          notes: 'Some notes',
          templateId: 'template.md',
          profileId: 'missing.md',
        },
        {
          config: createConfig(templatePath, profilePath),
          storage,
          transcripts: {
            getByRecordingId: async () => transcript,
          },
          recordings: {
            getById: async () => ({
              id: transcript.recordingId,
              source: 'upload',
              studentId: 'student-1',
              sourcePath: null,
              storageUri: 'local://recordings/recording-1.opus',
              sha256: null,
              bytes: 1,
              durationSec: null,
              channels: null,
              status: 'transcribed',
              error: null,
              createdAt: new Date('2024-01-01T00:00:00Z'),
              updatedAt: new Date('2024-01-01T00:00:00Z'),
            }),
          },
          students: {
            getById: async () => null,
          },
          promptPackages: {
            insert: async () => {
              throw new Error('insert should not be called');
            },
          },
          profileRevisions: createProfileRevisionRepositoryStub(),
          templateRevisions: createTemplateRevisionRepositoryStub(),
          bindings: createBindingResolverStub(),
          promptOptions: createPromptOptionsStub({ strictAllowlist: true }),
        },
      ),
    ).rejects.toThrow('profileId is not allowlisted');
  });

  it('rejects profilePath outside the repository root', async () => {
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-prompt-allowed-'));
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-prompt-outside-'));
    const templatePath = path.join(allowedDir, 'template.md');
    const defaultProfilePath = path.join(allowedDir, 'default-profile.md');
    const profilePath = path.join(outsideDir, 'profile.md');

    await fs.writeFile(templatePath, 'Hello\nFooter\n', 'utf8');
    await fs.writeFile(defaultProfilePath, 'DEFAULT PROFILE\n', 'utf8');
    await fs.writeFile(profilePath, 'PROFILE CONTENT\n', 'utf8');

    const transcript = createTranscriptRecord();
    const storage = createStorageStub({
      getText: async () => 'TRANSCRIPT BODY',
    });

    await expect(
      createPromptPackage(
        {
          recordingId: transcript.recordingId,
          profilePath,
        },
        {
          config: createConfig(templatePath, defaultProfilePath),
          storage,
          transcripts: {
            getByRecordingId: async () => transcript,
          },
          recordings: {
            getById: async () => null,
          },
          students: {
            getById: async () => null,
          },
          promptPackages: {
            insert: async () => {
              throw new Error('unexpected insert');
            },
          },
          profileRevisions: createProfileRevisionRepositoryStub(),
          templateRevisions: createTemplateRevisionRepositoryStub(),
          bindings: createBindingResolverStub(),
          promptOptions: createPromptOptionsStub(),
        },
      ),
    ).rejects.toThrow('profilePath must resolve within the configured profile root');
  });

  it('uses student-linked profileId when request does not specify profile selection', async () => {
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-prompt-allowed-'));
    const templatePath = path.join(allowedDir, 'template.md');
    const defaultProfilePath = path.join(allowedDir, 'default-profile.md');
    const studentProfilePath = path.join(allowedDir, 'profiles', 'student-a.md');

    await fs.mkdir(path.dirname(studentProfilePath), { recursive: true });
    await fs.writeFile(templatePath, 'Hello\nFooter\n', 'utf8');
    await fs.writeFile(defaultProfilePath, 'DEFAULT PROFILE\n', 'utf8');
    await fs.writeFile(studentProfilePath, 'STUDENT PROFILE CONTENT\n', 'utf8');

    const transcript = createTranscriptRecord();
    const storage = createStorageStub({
      getText: async () => 'TRANSCRIPT BODY',
    });
    const promptPackages = createPromptPackageRepositoryStub();
    const profileRevisions = createProfileRevisionRepositoryStub();

    const result = await createPromptPackage(
      {
        recordingId: transcript.recordingId,
        templateId: 'template.md',
      },
      {
        config: createConfig(templatePath, defaultProfilePath),
        storage,
        transcripts: {
          getByRecordingId: async () => transcript,
        },
        recordings: {
          getById: async () => ({
            id: transcript.recordingId,
            source: 'upload',
            studentId: 'student-1',
            sourcePath: null,
            storageUri: 'local://recordings/recording-1.opus',
            sha256: null,
            bytes: 1,
            durationSec: null,
            channels: null,
            status: 'transcribed',
            error: null,
            createdAt: new Date('2024-01-01T00:00:00Z'),
            updatedAt: new Date('2024-01-01T00:00:00Z'),
          }),
        },
        students: {
          getById: async () => ({
            id: 'student-1',
            student: 'Student One',
            profileId: 'profiles/student-a.md',
          }),
        },
        promptPackages,
        profileRevisions,
        templateRevisions: createTemplateRevisionRepositoryStub(),
        bindings: createBindingResolverStub(),
        promptOptions: createPromptOptionsStub(),
      },
    );

    expect(result?.profilePath).toBe('profiles/student-a.md');
  });

  it('includes the selected student canonical name in assignment prompt packages', async () => {
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-prompt-student-name-'));
    const templatePath = path.join(allowedDir, 'template.md');
    const defaultProfilePath = path.join(allowedDir, 'default-profile.md');
    const studentProfilePath = path.join(allowedDir, 'profiles', 'student-a.md');

    await fs.mkdir(path.dirname(studentProfilePath), { recursive: true });
    await fs.writeFile(
      templatePath,
      'Write the assignment header for the selected learner.\nEND\n',
      'utf8',
    );
    await fs.writeFile(defaultProfilePath, 'DEFAULT PROFILE\n', 'utf8');
    await fs.writeFile(studentProfilePath, 'STUDENT PROFILE CONTENT\n', 'utf8');

    const transcript = createTranscriptRecord();
    const insertedParams: InsertPromptPackageParams[] = [];
    const storage = createStorageStub({
      getText: async () => 'Teacher: Let us practice travel situations today.',
      putPromptPackage: async ({ promptPackageId, text }) => {
        expect(text).toContain('[CANONICAL_STUDENT_NAME]\nStudent One');
        return {
          uri: `local://prompt-packages/${promptPackageId}.txt`,
          bytes: text.length,
          sha256: 'hash',
        };
      },
    });

    const result = await createPromptPackage(
      {
        recordingId: transcript.recordingId,
        templateId: 'template.md',
      },
      {
        config: createConfig(templatePath, defaultProfilePath),
        storage,
        transcripts: {
          getByRecordingId: async () => transcript,
        },
        recordings: {
          getById: async () => ({
            id: transcript.recordingId,
            source: 'upload',
            studentId: 'student-1',
            sourcePath: null,
            storageUri: 'local://recordings/recording-1.opus',
            sha256: null,
            bytes: 1,
            durationSec: null,
            channels: null,
            status: 'transcribed',
            error: null,
            createdAt: new Date('2024-01-01T00:00:00Z'),
            updatedAt: new Date('2024-01-01T00:00:00Z'),
          }),
        },
        students: {
          getById: async () => ({
            id: 'student-1',
            student: 'Student One',
            profileId: 'profiles/student-a.md',
          }),
        },
        promptPackages: {
          insert: async (params: InsertPromptPackageParams): Promise<PromptPackageRecord> => {
            insertedParams.push({ ...params });
            return {
              id: params.id ?? 'prompt-1',
              recordingId: params.recordingId,
              transcriptId: params.transcriptId,
              studentId: params.studentId ?? null,
              lessonId: params.lessonId ?? null,
              studentMemorySnapshotId: params.studentMemorySnapshotId ?? null,
              studentMemorySnapshotHash: params.studentMemorySnapshotHash ?? null,
              selectedLessonMemoryIds: params.selectedLessonMemoryIds ?? [],
              selectedHomeworkMemoryIds: params.selectedHomeworkMemoryIds ?? [],
              retrievalPolicyVersion: params.retrievalPolicyVersion ?? null,
              profilePath: params.profilePath ?? null,
              resolvedProfileId: params.resolvedProfileId ?? null,
              resolvedProfileHash: params.resolvedProfileHash ?? null,
              resolvedProfileRevisionId: params.resolvedProfileRevisionId ?? null,
              resolvedProfileUpdatedAt: params.resolvedProfileUpdatedAt ?? null,
              resolvedProfileVersionLabel: params.resolvedProfileVersionLabel ?? null,
              resolvedProfileStatus: params.resolvedProfileStatus ?? null,
              resolvedTemplateId: params.resolvedTemplateId ?? null,
              resolvedTemplateHash: params.resolvedTemplateHash ?? null,
              resolvedTemplateRevisionId: params.resolvedTemplateRevisionId ?? null,
              resolvedTemplateUpdatedAt: params.resolvedTemplateUpdatedAt ?? null,
              resolvedTemplateVersionLabel: params.resolvedTemplateVersionLabel ?? null,
              resolvedTemplateStatus: params.resolvedTemplateStatus ?? null,
              templateVersion: params.templateVersion,
              notes: params.notes ?? null,
              storageUri: params.storageUri,
              requestEnvelope: params.requestEnvelope ?? null,
              createdAt: new Date('2024-01-01T00:00:00Z'),
              updatedAt: new Date('2024-01-01T00:00:00Z'),
            };
          },
        },
        profileRevisions: createProfileRevisionRepositoryStub(),
        templateRevisions: createTemplateRevisionRepositoryStub(),
        bindings: createBindingResolverStub(),
        promptOptions: createPromptOptionsStub(),
      },
    );

    expect(result?.text).toContain('[CANONICAL_STUDENT_NAME]\nStudent One');
    expect(insertedParams[0]?.requestEnvelope).toEqual(
      expect.objectContaining({
        workload: 'assignment_draft',
        sourceManifest: expect.arrayContaining([
          expect.objectContaining({
            id: 'canonical-student-name',
            label: 'CANONICAL_STUDENT_NAME',
          }),
        ]),
      }),
    );
    expect(JSON.stringify(insertedParams[0]?.requestEnvelope)).toContain(
      '"label":"CANONICAL_STUDENT_NAME"',
    );
    expect(JSON.stringify(insertedParams[0]?.requestEnvelope)).not.toContain(
      'Use CANONICAL_STUDENT_NAME as the authoritative learner name',
    );
  });

  it('keeps explicit profileId and profilePath overrides ahead of student-linked defaults', async () => {
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-prompt-allowed-'));
    const templatePath = path.join(allowedDir, 'template.md');
    const defaultProfilePath = path.join(allowedDir, 'default-profile.md');
    const studentProfilePath = path.join(allowedDir, 'profiles', 'student-a.md');
    const explicitProfilePath = path.join(allowedDir, 'profiles', 'explicit.md');

    await fs.mkdir(path.dirname(studentProfilePath), { recursive: true });
    await fs.writeFile(templatePath, 'Hello\nFooter\n', 'utf8');
    await fs.writeFile(defaultProfilePath, 'DEFAULT PROFILE\n', 'utf8');
    await fs.writeFile(studentProfilePath, 'STUDENT PROFILE CONTENT\n', 'utf8');
    await fs.writeFile(explicitProfilePath, 'EXPLICIT PROFILE CONTENT\n', 'utf8');

    const transcript = createTranscriptRecord();
    const storage = createStorageStub({
      getText: async () => 'TRANSCRIPT BODY',
    });
    const promptPackages = createPromptPackageRepositoryStub();
    const profileRevisions = createProfileRevisionRepositoryStub();
    const recordingLookup = {
      getById: async (): Promise<RecordingRecord> => ({
        id: transcript.recordingId,
        source: 'upload',
        studentId: 'student-1',
        sourcePath: null,
        storageUri: 'local://recordings/recording-1.opus',
        sha256: null,
        bytes: 1,
        durationSec: null,
        channels: null,
        status: 'transcribed',
        error: null,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T00:00:00Z'),
      }),
    };
    const studentLookup = {
      getById: async () => ({
        id: 'student-1',
        student: 'Student One',
        profileId: 'profiles/student-a.md',
      }),
    };

    const explicitIdResult = await createPromptPackage(
      {
        recordingId: transcript.recordingId,
        templateId: 'template.md',
        profileId: 'profiles/explicit.md',
      },
      {
        config: createConfig(templatePath, defaultProfilePath),
        storage,
        transcripts: {
          getByRecordingId: async () => transcript,
        },
        recordings: recordingLookup,
        students: studentLookup,
        promptPackages,
        profileRevisions,
        templateRevisions: createTemplateRevisionRepositoryStub(),
        bindings: createBindingResolverStub(),
        promptOptions: createPromptOptionsStub(),
      },
    );
    expect(explicitIdResult?.profilePath).toBe('profiles/explicit.md');

    const explicitPathResult = await createPromptPackage(
      {
        recordingId: transcript.recordingId,
        templateId: 'template.md',
        profilePath: explicitProfilePath,
      },
      {
        config: createConfig(templatePath, defaultProfilePath),
        storage,
        transcripts: {
          getByRecordingId: async () => transcript,
        },
        recordings: recordingLookup,
        students: studentLookup,
        promptPackages,
        profileRevisions,
        templateRevisions: createTemplateRevisionRepositoryStub(),
        bindings: createBindingResolverStub(),
        promptOptions: createPromptOptionsStub(),
      },
    );
    expect(explicitPathResult?.profilePath).toBe('profiles/explicit.md');
  });

  it('ignores an implicit student profile fallback when the bound profile has no active revision', async () => {
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-prompt-draft-bound-'));
    const templatePath = path.join(allowedDir, 'template.md');
    const defaultProfilePath = path.join(allowedDir, 'default-profile.md');
    const draftOnlyProfileId = 'profiles/draft-only.md';

    await fs.writeFile(templatePath, 'Hello\nFooter\n', 'utf8');
    await fs.writeFile(defaultProfilePath, 'DEFAULT PROFILE\n', 'utf8');

    const transcript = createTranscriptRecord();
    const storage = createStorageStub({
      getText: async () => 'TRANSCRIPT BODY',
    });

    const result = await createPromptPackage(
      {
        recordingId: transcript.recordingId,
        templateId: 'template.md',
      },
      {
        config: createConfig(templatePath, defaultProfilePath),
        storage,
        transcripts: {
          getByRecordingId: async () => transcript,
        },
        recordings: {
          getById: async () => ({
            id: transcript.recordingId,
            source: 'upload',
            studentId: 'student-1',
            sourcePath: null,
            storageUri: 'local://recordings/recording-1.opus',
            sha256: null,
            bytes: 1,
            durationSec: null,
            channels: null,
            status: 'transcribed',
            error: null,
            createdAt: new Date('2024-01-01T00:00:00Z'),
            updatedAt: new Date('2024-01-01T00:00:00Z'),
          }),
        },
        students: {
          getById: async () => ({
            id: 'student-1',
            student: 'Student One',
            profileId: draftOnlyProfileId,
          }),
        },
        promptPackages: createPromptPackageRepositoryStub(),
        profileRevisions: createProfileRevisionRepositoryStub({
          getActive: async (profileId) => {
            if (profileId === draftOnlyProfileId) return null;
            return createProfileRevisionRepositoryStub().getActive(profileId);
          },
        }),
        templateRevisions: createTemplateRevisionRepositoryStub(),
        bindings: createBindingResolverStub(),
        promptOptions: createPromptOptionsStub({
          strictAllowlist: true,
          allowedProfileIds: [],
        }),
      },
    );

    expect(result?.profilePath).toBe('default-profile.md');
  });

  it('propagates an active-revision lookup failure for an implicit student profile', async () => {
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-prompt-profile-lookup-'));
    const templatePath = path.join(allowedDir, 'template.md');
    const defaultProfilePath = path.join(allowedDir, 'default-profile.md');
    const boundProfileId = 'profiles/bound.md';
    await fs.writeFile(templatePath, 'Hello\nFooter\n', 'utf8');
    await fs.writeFile(defaultProfilePath, 'DEFAULT PROFILE\n', 'utf8');

    const transcript = createTranscriptRecord();
    await expect(
      createPromptPackage(
        { recordingId: transcript.recordingId, templateId: 'template.md' },
        {
          config: createConfig(templatePath, defaultProfilePath),
          storage: createStorageStub({ getText: async () => 'TRANSCRIPT BODY' }),
          transcripts: { getByRecordingId: async () => transcript },
          recordings: {
            getById: async () => ({
              id: transcript.recordingId,
              source: 'upload',
              studentId: 'student-1',
              sourcePath: null,
              storageUri: 'local://recordings/recording-1.opus',
              sha256: null,
              bytes: 1,
              durationSec: null,
              channels: null,
              status: 'transcribed',
              error: null,
              createdAt: new Date('2024-01-01T00:00:00Z'),
              updatedAt: new Date('2024-01-01T00:00:00Z'),
            }),
          },
          students: {
            getById: async () => ({
              id: 'student-1',
              student: 'Student One',
              profileId: boundProfileId,
            }),
          },
          promptPackages: createPromptPackageRepositoryStub(),
          profileRevisions: createProfileRevisionRepositoryStub({
            getActive: async (profileId) => {
              if (profileId === boundProfileId) {
                throw new Error('profile revisions database unavailable');
              }
              return createProfileRevisionRepositoryStub().getActive(profileId);
            },
          }),
          templateRevisions: createTemplateRevisionRepositoryStub(),
          bindings: createBindingResolverStub(),
          promptOptions: createPromptOptionsStub({
            strictAllowlist: true,
            allowedProfileIds: [],
          }),
        },
      ),
    ).rejects.toThrow('profile revisions database unavailable');
  });
});
