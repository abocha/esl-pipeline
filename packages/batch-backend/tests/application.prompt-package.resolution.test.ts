import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createPromptPackage } from '../src/application/create-prompt-package.js';
import { resolvePromptTemplateSelection } from '../src/application/prompt-options.js';
import type { PromptPackageRecord } from '../src/domain/prompt-package-model.js';
import type { InsertPromptPackageParams } from '../src/domain/prompt-package-repository.js';
import {
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
  it('blocks a historical nonowner before creating prompt-package lineage', async () => {
    const session = createConfirmedAssignmentSession({
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
    const insert = vi.fn();
    await expect(
      createPromptPackage(
        {
          recordingId: 'recording-1',
          workspaceId: 'workspace-1',
          assignmentSessionId: 'session-1',
          userId: 'user-1',
        },
        {
          sessions: {
            getByIdForUser: async () => session,
            isConfirmedSourceCanonical: async () => false,
          },
          recordings: {
            getById: async () => ({ id: 'recording-1', studentId: 'student-1' }) as never,
          },
          promptPackages: { insert },
        },
      ),
    ).rejects.toMatchObject({ code: 'PROMPT_PACKAGE_SOURCE_NOT_CANONICAL' });
    expect(insert).not.toHaveBeenCalled();
  });
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
        studentId: 'student-1',
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
        studentId: 'student-1',
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
        workspaceId: 'workspace-1',
        assignmentSessionId: 'session-1',
        userId: 'user-1',
        templateId: 'hw_prompt_assignment_v1.md',
      },
      {
        config: createConfig('hw_prompt_assignment_v1.md', 'profile.md'),
        storage: createStorageStub({
          getText: async (uri) =>
            uri === 'local://confirmed/transcript-a.txt'
              ? 'CONFIRMED TRANSCRIPT A'
              : 'NEW WORKING TRANSCRIPT B',
        }),
        sessions: {
          isConfirmedSourceCanonical: async () => true,
          getByIdForUser: async () => createConfirmedAssignmentSession(),
        },
        transcripts: {
          getByRecordingId: async () => {
            throw new Error('mutable transcript lookup must not run');
          },
        },
        recordings: {
          getById: async () => ({
            id: 'recording-1',
            workspaceId: 'workspace-1',
            source: 'upload',
            audioLifecycle: 'retained',
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
          }),
        },
        profileRevisions,
        templateRevisions: createTemplateRevisionRepositoryStub(),
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
    const config = createConfig('hw_prompt_assignment_v1.md', 'missing-default-profile.md');
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
        workspaceId: 'workspace-1',
        assignmentSessionId: 'session-1',
        userId: 'user-1',
        templateId: 'hw_prompt_assignment_v1.md',
      },
      {
        config,
        storage: createStorageStub({
          getText: async () => 'CONFIRMED TRANSCRIPT A',
        }),
        sessions: {
          isConfirmedSourceCanonical: async () => true,
          getByIdForUser: async () => session,
        },
        transcripts: {
          getByRecordingId: async () => {
            throw new Error('mutable transcript lookup must not run');
          },
        },
        recordings: {
          getById: async () => ({
            id: 'recording-1',
            workspaceId: 'workspace-1',
            source: 'upload',
            audioLifecycle: 'retained',
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
          }),
        },
        profileRevisions: createProfileRevisionRepositoryStub({
          getActive: async () => {
            throw new Error('confirmed null Context must not resolve an active profile');
          },
        }),
        templateRevisions: createTemplateRevisionRepositoryStub(),
        promptOptions: {
          resolveTemplateSelection: (params) =>
            resolvePromptTemplateSelection(params, {
              config,
              templateRevisions: {
                listIdsWithActiveRevision: async () => new Set(['hw_prompt_assignment_v1.md']),
              },
              templates: {
                list: async () => ({
                  items: [
                    {
                      id: 'hw_prompt_assignment_v1.md',
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
      assignmentSessionId: 'session-1',
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
          workspaceId: 'workspace-1',
          assignmentSessionId: 'session-1',
          userId: 'other-user',
        },
        {
          sessions: {
            isConfirmedSourceCanonical: async () => true,
            getByIdForUser: async () => null,
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'PROMPT_PACKAGE_ASSIGNMENT_SESSION_NOT_FOUND' });
  });

  it('rejects missing confirmed prerequisites and broken confirmed lineage', async () => {
    await expect(
      createPromptPackage(
        {
          recordingId: 'recording-1',
          workspaceId: 'workspace-1',
          assignmentSessionId: 'session-1',
          userId: 'user-1',
        },
        {
          sessions: {
            isConfirmedSourceCanonical: async () => true,
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
        {
          recordingId: 'recording-1',
          workspaceId: 'workspace-1',
          assignmentSessionId: 'session-1',
          userId: 'user-1',
        },
        {
          sessions: {
            isConfirmedSourceCanonical: async () => true,
            getByIdForUser: async () =>
              createConfirmedAssignmentSession({ recordingId: 'different-recording' }),
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'PROMPT_PACKAGE_CONFIRMED_LINEAGE_INVALID' });
  });

  it('renders the foundational profile block from structured content when the active revision has canonical JSON', async () => {
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-prompt-structured-'));
    const templatePath = path.join(allowedDir, 'hw_prompt_assignment_v1.md');
    const profilePath = path.join(allowedDir, 'profile.md');
    await fs.writeFile(
      templatePath,
      'Assignment output contract: assignment_v1_grammar_v4\nDB TEMPLATE\nEND\n',
      'utf8',
    );
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
        workspaceId: 'workspace-1',
        templateId: 'hw_prompt_assignment_v1.md',
      },
      {
        config: createConfig(templatePath, profilePath),
        storage,
        transcripts: {
          getByRecordingId: async () => transcript,
        },
        recordings: {
          getById: async () => ({ id: 'recording-1', studentId: 'student-1' }) as never,
        },
        students: {
          getById: async () => ({ id: 'student-1', student: 'Student One' }),
        },
        promptPackages: createPromptPackageRepositoryStub(),
        profileRevisions: createProfileRevisionRepositoryStub({
          getActive: async () => ({
            id: 'profile-revision-active',
            studentId: 'student-1',
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
        promptOptions: createPromptOptionsStub(),
      },
    );
  });

  it('prefers active profile/template revisions over filesystem files when available', async () => {
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-prompt-allowed-'));
    const templatePath = path.join(allowedDir, 'hw_prompt_assignment_v1.md');
    const profilePath = path.join(allowedDir, 'profile.md');
    await fs.writeFile(templatePath, 'FS TEMPLATE\nEND\n', 'utf8');
    await fs.writeFile(profilePath, 'FS PROFILE\n', 'utf8');

    const transcript = createTranscriptRecord();
    const activeTemplateContent =
      'Assignment output contract: assignment_v1_grammar_v4\nDB TEMPLATE\nEND\n';
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
        workspaceId: 'workspace-1',
        templateId: 'hw_prompt_assignment_v1.md',
      },
      {
        config: createConfig(templatePath, profilePath),
        storage,
        transcripts: {
          getByRecordingId: async () => transcript,
        },
        recordings: {
          getById: async () => ({ id: 'recording-1', studentId: 'student-1' }) as never,
        },
        students: {
          getById: async () => ({ id: 'student-1', student: 'Student One' }),
        },
        promptPackages: createPromptPackageRepositoryStub(),
        profileRevisions: createProfileRevisionRepositoryStub({
          getActive: async () => ({
            id: 'profile-revision-active',
            studentId: 'student-1',
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
            templateId: 'hw_prompt_assignment_v1.md',
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
    const templatePath = path.join(allowedDir, 'hw_prompt_assignment_v1.md');
    const profilePath = path.join(allowedDir, 'profile.md');
    await fs.writeFile(templatePath, 'TEMPLATE FS\nEND\n', 'utf8');
    await fs.writeFile(profilePath, 'PROFILE FS\n', 'utf8');

    const transcript = createTranscriptRecord();
    const storage = createStorageStub({
      getText: async () => 'TRANSCRIPT BODY',
    });

    const profileV1 = {
      id: 'profile-revision-v1',
      studentId: 'student-1',
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
      templateId: 'hw_prompt_assignment_v1.md',
      content: 'Assignment output contract: assignment_v1_grammar_v4\nTEMPLATE V1\nEND\n',
      contentHash: createHash('sha256')
        .update('Assignment output contract: assignment_v1_grammar_v4\nTEMPLATE V1\nEND\n', 'utf8')
        .digest('hex'),
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
        workspaceId: 'workspace-1',
        templateId: 'hw_prompt_assignment_v1.md',
      },
      {
        config: createConfig(templatePath, profilePath),
        storage,
        transcripts: { getByRecordingId: async () => transcript },
        recordings: {
          getById: async () => ({ id: 'recording-1', studentId: 'student-1' }) as never,
        },
        students: { getById: async () => ({ id: 'student-1', student: 'Student One' }) },
        promptPackages,
        profileRevisions,
        templateRevisions,
        promptOptions: createPromptOptionsStub(),
      },
    );
    run = 2;
    await createPromptPackage(
      {
        recordingId: transcript.recordingId,
        workspaceId: 'workspace-1',
        templateId: 'hw_prompt_assignment_v1.md',
      },
      {
        config: createConfig(templatePath, profilePath),
        storage,
        transcripts: { getByRecordingId: async () => transcript },
        recordings: {
          getById: async () => ({ id: 'recording-1', studentId: 'student-1' }) as never,
        },
        students: { getById: async () => ({ id: 'student-1', student: 'Student One' }) },
        promptPackages,
        profileRevisions,
        templateRevisions,
        promptOptions: createPromptOptionsStub(),
      },
    );

    expect(insertedParams).toHaveLength(2);
    expect(insertedParams[0]?.resolvedProfileRevisionId).toBe('profile-revision-v1');
    expect(insertedParams[1]?.resolvedProfileRevisionId).toBe('profile-revision-v2');
    expect(insertedParams[0]?.resolvedTemplateRevisionId).toBe('template-revision-v1');
    expect(insertedParams[1]?.resolvedTemplateRevisionId).toBe('template-revision-v1');
  });

  it('includes the selected student canonical name in assignment prompt packages', async () => {
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-prompt-student-name-'));
    const templatePath = path.join(allowedDir, 'hw_prompt_assignment_v1.md');
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
        workspaceId: 'workspace-1',
        templateId: 'hw_prompt_assignment_v1.md',
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
            workspaceId: 'workspace-1',
            source: 'upload',
            audioLifecycle: 'retained',
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

  it('omits the profile when the student has no active revision', async () => {
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-prompt-draft-bound-'));
    const templatePath = path.join(allowedDir, 'hw_prompt_assignment_v1.md');
    const defaultProfilePath = path.join(allowedDir, 'default-profile.md');
    const draftOnlyStudentId = 'student-1';

    await fs.writeFile(
      templatePath,
      'Assignment output contract: assignment_v1_grammar_v4\nHello\nFooter\n',
      'utf8',
    );
    await fs.writeFile(defaultProfilePath, 'DEFAULT PROFILE\n', 'utf8');

    const transcript = createTranscriptRecord();
    const storage = createStorageStub({
      getText: async () => 'TRANSCRIPT BODY',
    });

    const result = await createPromptPackage(
      {
        recordingId: transcript.recordingId,
        workspaceId: 'workspace-1',
        templateId: 'hw_prompt_assignment_v1.md',
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
            workspaceId: 'workspace-1',
            source: 'upload',
            audioLifecycle: 'retained',
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
          }),
        },
        promptPackages: createPromptPackageRepositoryStub(),
        profileRevisions: createProfileRevisionRepositoryStub({
          getActive: async (profileId) => {
            if (profileId === draftOnlyStudentId) return null;
            return createProfileRevisionRepositoryStub().getActive(profileId);
          },
        }),
        templateRevisions: createTemplateRevisionRepositoryStub(),
        promptOptions: createPromptOptionsStub({
          strictAllowlist: true,
        }),
      },
    );

    expect(result?.profilePath).toBeNull();
    expect(result?.profileSnapshot).toBeUndefined();
    expect(result?.text).not.toContain('DEFAULT PROFILE');
  });

  it('propagates a student active-revision lookup failure', async () => {
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-prompt-profile-lookup-'));
    const templatePath = path.join(allowedDir, 'hw_prompt_assignment_v1.md');
    const defaultProfilePath = path.join(allowedDir, 'default-profile.md');
    const boundStudentId = 'student-1';
    await fs.writeFile(
      templatePath,
      'Assignment output contract: assignment_v1_grammar_v4\nHello\nFooter\n',
      'utf8',
    );
    await fs.writeFile(defaultProfilePath, 'DEFAULT PROFILE\n', 'utf8');

    const transcript = createTranscriptRecord();
    await expect(
      createPromptPackage(
        {
          recordingId: transcript.recordingId,
          workspaceId: 'workspace-1',
          templateId: 'hw_prompt_assignment_v1.md',
        },
        {
          config: createConfig(templatePath, defaultProfilePath),
          storage: createStorageStub({ getText: async () => 'TRANSCRIPT BODY' }),
          transcripts: { getByRecordingId: async () => transcript },
          recordings: {
            getById: async () => ({
              id: transcript.recordingId,
              workspaceId: 'workspace-1',
              source: 'upload',
              audioLifecycle: 'retained',
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
            }),
          },
          promptPackages: createPromptPackageRepositoryStub(),
          profileRevisions: createProfileRevisionRepositoryStub({
            getActive: async (profileId) => {
              if (profileId === boundStudentId) {
                throw new Error('profile revisions database unavailable');
              }
              return createProfileRevisionRepositoryStub().getActive(profileId);
            },
          }),
          templateRevisions: createTemplateRevisionRepositoryStub(),
          promptOptions: createPromptOptionsStub({
            strictAllowlist: true,
          }),
        },
      ),
    ).rejects.toThrow('profile revisions database unavailable');
  });
  it.each(['foreign-student', 'wrong-hash'])(
    'rejects confirmed revision with %s provenance before writing',
    async (violation) => {
      const expectedHash = createHash('sha256').update('CONFIRMED PROFILE A', 'utf8').digest('hex');
      const revision = await createProfileRevisionRepositoryStub().getById(
        'student-1',
        'profile-revision-a',
      );
      const getRecorded = vi.fn(async () => ({
        ...revision!,
        studentId: violation === 'foreign-student' ? 'student-2' : 'student-1',
        contentHash: violation === 'wrong-hash' ? 'different-hash' : expectedHash,
      }));
      const insert = vi.fn();
      await expect(
        createPromptPackage(
          {
            recordingId: 'recording-1',
            workspaceId: 'workspace-1',
            assignmentSessionId: 'session-1',
            userId: 'user-1',
          },
          {
            config: createConfig('hw_prompt_assignment_v1.md', 'profile.md'),
            sessions: {
              getByIdForUser: async () => createConfirmedAssignmentSession(),
              isConfirmedSourceCanonical: async () => true,
            },
            recordings: {
              getById: async () => ({ id: 'recording-1', studentId: 'student-1' }) as never,
            },
            profileRevisions: { ...createProfileRevisionRepositoryStub(), getRecorded },
            promptPackages: { insert },
          },
        ),
      ).rejects.toMatchObject({ code: 'PROMPT_PACKAGE_CONFIRMED_LINEAGE_INVALID' });
      expect(getRecorded).toHaveBeenCalledWith('student-1', 'profile-revision-a', expectedHash);
      expect(insert).not.toHaveBeenCalled();
    },
  );

  it('rejects a recording student unavailable in the authenticated workspace before profile lookup', async () => {
    const getStudent = vi.fn(async () => null);
    const getActive = vi.fn();
    const insert = vi.fn();
    const result = await createPromptPackage(
      { recordingId: 'recording-1', workspaceId: 'workspace-1' },
      {
        config: createConfig('hw_prompt_assignment_v1.md', 'profile.md'),
        transcripts: { getByRecordingId: async () => createTranscriptRecord() },
        recordings: {
          getById: async () => ({ id: 'recording-1', studentId: 'student-1' }) as never,
        },
        students: { getById: getStudent },
        profileRevisions: { ...createProfileRevisionRepositoryStub(), getActive },
        promptPackages: { insert },
      },
    );
    expect(result).toBeNull();
    expect(getStudent).toHaveBeenCalledWith(
      'student-1',
      expect.objectContaining({ workspaceId: 'workspace-1' }),
    );
    expect(getActive).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });
});
