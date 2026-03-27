import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { createPromptPackage } from '../src/application/create-prompt-package.js';
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

describe('application/prompt-package', () => {
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
        return { uri: `local://prompt-packages/${promptPackageId}.txt`, bytes: text.length };
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
      contentHash: createHash('sha256')
        .update('TEMPLATE V1\nEND\n', 'utf8')
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
        return { uri: `local://prompt-packages/${promptPackageId}.txt`, bytes: text.length };
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
});
