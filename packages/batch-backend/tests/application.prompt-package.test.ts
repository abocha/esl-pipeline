import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { createPromptPackage } from '../src/application/create-prompt-package.js';
import { getPromptPackage } from '../src/application/get-prompt-package.js';
import { ProfilePathError } from '../src/application/profile-path.js';
import type { ProfileRevisionRecord } from '../src/domain/profile-revision-model.js';
import type { ProfileRecord } from '../src/domain/profile-model.js';
import type { TemplateRevisionRecord } from '../src/domain/template-revision-model.js';
import type { TemplateRecord } from '../src/domain/template-model.js';
import type { BatchBackendConfig } from '../src/config/env.js';
import type { PromptPackageRecord } from '../src/domain/prompt-package-model.js';
import type { RecordingRecord } from '../src/domain/recording-model.js';
import type { TranscriptRecord } from '../src/domain/transcript-model.js';
import type { TranscriptionStorage } from '../src/infrastructure/transcription-storage.js';

describe('application/prompt-package', () => {
  it('creates a prompt package with canonical ordering', async () => {
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-prompt-allowed-'));
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-prompt-outside-'));
    const templatePath = path.join(allowedDir, 'template.md');
    const defaultProfilePath = path.join(allowedDir, 'default-profile.md');
    const profilePath = path.join(outsideDir, 'profile.md');

    await fs.writeFile(templatePath, 'Hello\nINSERT PROFILE HERE\nFooter\n', 'utf8');
    await fs.writeFile(defaultProfilePath, 'DEFAULT PROFILE\n', 'utf8');
    await fs.writeFile(profilePath, 'PROFILE CONTENT\n', 'utf8');

    const transcript = createTranscriptRecord();
    const storage = createStorageStub({
      getText: async () => 'TRANSCRIPT BODY',
      putPromptPackage: async ({ promptPackageId, text }) => {
        expect(text).toContain('PROFILE CONTENT');
        expect(text).toContain('[NOTES]\nSome notes');
        expect(text).toContain('[TRANSCRIPT]\nTRANSCRIPT BODY');
        return { uri: `local://prompt-packages/${promptPackageId}.txt`, bytes: text.length };
      },
    });

    const promptPackages = {
      insert: async (params: {
        id?: string;
        recordingId: string;
        transcriptId: string;
        studentId?: string | null;
        profilePath?: string | null;
        resolvedProfileId?: string | null;
        resolvedProfileHash?: string | null;
        resolvedProfileRevisionId?: string | null;
        resolvedProfileUpdatedAt?: Date | null;
        resolvedTemplateId?: string | null;
        resolvedTemplateHash?: string | null;
        resolvedTemplateRevisionId?: string | null;
        resolvedTemplateUpdatedAt?: Date | null;
        templateVersion: string;
        notes?: string | null;
        storageUri: string;
      }): Promise<PromptPackageRecord> => {
        return {
          id: params.id ?? 'prompt-1',
          recordingId: params.recordingId,
          transcriptId: params.transcriptId,
          studentId: params.studentId ?? null,
          profilePath: params.profilePath ?? null,
          resolvedProfileId: params.resolvedProfileId ?? null,
          resolvedProfileHash: params.resolvedProfileHash ?? null,
          resolvedProfileRevisionId: params.resolvedProfileRevisionId ?? null,
          resolvedProfileUpdatedAt: params.resolvedProfileUpdatedAt ?? null,
          resolvedTemplateId: params.resolvedTemplateId ?? null,
          resolvedTemplateHash: params.resolvedTemplateHash ?? null,
          resolvedTemplateRevisionId: params.resolvedTemplateRevisionId ?? null,
          resolvedTemplateUpdatedAt: params.resolvedTemplateUpdatedAt ?? null,
          templateVersion: params.templateVersion,
          notes: params.notes ?? null,
          storageUri: params.storageUri,
          createdAt: new Date('2024-01-01T00:00:00Z'),
          updatedAt: new Date('2024-01-01T00:00:00Z'),
        };
      },
    };
    const profileRevisions = createProfileRevisionRepositoryStub();

    const result = await createPromptPackage(
      {
        recordingId: transcript.recordingId,
        notes: 'Some notes',
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
        promptPackages,
        profileRevisions,
        templateRevisions: createTemplateRevisionRepositoryStub(),
        profiles: createProfileRepositoryStub(),
        templates: createTemplateRepositoryStub(),
      },
    );

    expect(result).not.toBeNull();
    expect(result?.recordingId).toBe(transcript.recordingId);
    expect(result?.transcriptId).toBe(transcript.id);
    expect(result?.studentId).toBe('student-1');
    expect(result?.notes).toBe('Some notes');
    expect(result?.templateVersion).toBe('template.md');
    expect(result?.profilePath).toBe(profilePath);
    expect(result?.profileSnapshot?.resolvedProfileId).toBe('profile.md');
    expect(result?.profileSnapshot?.resolvedProfileRevisionId).toBe('revision-1');
  });

  it('loads prompt package text from storage', async () => {
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
      profileRevisions: createProfileRevisionRepositoryStub(),
      templateRevisions: createTemplateRevisionRepositoryStub(),
    });

    expect(result).toEqual({
      id: 'prompt-1',
      recordingId: 'recording-1',
      transcriptId: 'transcript-1',
      studentId: 'student-1',
      profilePath: '/profiles/p1.md',
      templateVersion: 't1.md',
      notes: 'Notes',
      storageUri: 'local://prompt-packages/prompt-1.txt',
      text: 'Prompt package text',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:10:00.000Z',
    });
  });

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

  it('rejects unknown profileId selections', async () => {
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-prompt-allowed-'));
    const templatePath = path.join(allowedDir, 'template.md');
    const profilePath = path.join(allowedDir, 'profile.md');

    await fs.writeFile(templatePath, 'Hello\nINSERT PROFILE HERE\nFooter\n', 'utf8');
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
          profiles: createProfileRepositoryStub(),
          templates: createTemplateRepositoryStub(),
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

    await fs.writeFile(templatePath, 'Hello\nINSERT PROFILE HERE\nFooter\n', 'utf8');
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
          profiles: createProfileRepositoryStub(),
          templates: createTemplateRepositoryStub(),
        },
      ),
    ).rejects.toBeInstanceOf(ProfilePathError);
  });

  it('uses student-linked profileId when request does not specify profile selection', async () => {
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-prompt-allowed-'));
    const templatePath = path.join(allowedDir, 'template.md');
    const defaultProfilePath = path.join(allowedDir, 'default-profile.md');
    const studentProfilePath = path.join(allowedDir, 'profiles', 'student-a.md');

    await fs.mkdir(path.dirname(studentProfilePath), { recursive: true });
    await fs.writeFile(templatePath, 'Hello\nINSERT PROFILE HERE\nFooter\n', 'utf8');
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
        profiles: createProfileRepositoryStub(),
        templates: createTemplateRepositoryStub(),
      },
    );

    expect(result?.profilePath).toBe(studentProfilePath);
  });

  it('keeps explicit profileId and profilePath overrides ahead of student-linked defaults', async () => {
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-prompt-allowed-'));
    const templatePath = path.join(allowedDir, 'template.md');
    const defaultProfilePath = path.join(allowedDir, 'default-profile.md');
    const studentProfilePath = path.join(allowedDir, 'profiles', 'student-a.md');
    const explicitProfilePath = path.join(allowedDir, 'profiles', 'explicit.md');

    await fs.mkdir(path.dirname(studentProfilePath), { recursive: true });
    await fs.writeFile(templatePath, 'Hello\nINSERT PROFILE HERE\nFooter\n', 'utf8');
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
        profiles: createProfileRepositoryStub(),
        templates: createTemplateRepositoryStub(),
      },
    );
    expect(explicitIdResult?.profilePath).toBe(explicitProfilePath);

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
        profiles: createProfileRepositoryStub(),
        templates: createTemplateRepositoryStub(),
      },
    );
    expect(explicitPathResult?.profilePath).toBe(explicitProfilePath);
  });
});

function createTranscriptRecord(): TranscriptRecord {
  return {
    id: 'transcript-1',
    recordingId: 'recording-1',
    storageUri: 'local://transcripts/transcript-1.txt',
    rawResponseUri: null,
    mode: 'timeline',
    model: 'nova-3',
    language: 'en',
    fallbackUsed: false,
    summaryJson: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  };
}

function createStorageStub(overrides: Partial<TranscriptionStorage> = {}): TranscriptionStorage {
  return {
    putAudio: async () => ({ uri: 'local://recordings/recording.opus', bytes: 1 }),
    putTranscript: async () => ({ uri: 'local://transcripts/transcript-1.txt', bytes: 1 }),
    putRawResponse: async () => ({ uri: 'local://transcripts/transcript-1.json', bytes: 1 }),
    putPromptPackage: async () => ({ uri: 'local://prompt-packages/prompt-1.txt', bytes: 1 }),
    putDraft: async () => ({ uri: 'local://drafts/draft-1.md', bytes: 1 }),
    getText: async () => '',
    getStream: async () => Readable.from(['']),
    delete: async () => {},
    ...overrides,
  };
}

function createPromptPackageRepositoryStub() {
  return {
    insert: async (params: {
      id?: string;
      recordingId: string;
      transcriptId: string;
      studentId?: string | null;
      profilePath?: string | null;
      resolvedProfileId?: string | null;
      resolvedProfileHash?: string | null;
      resolvedProfileRevisionId?: string | null;
      resolvedProfileUpdatedAt?: Date | null;
      resolvedTemplateId?: string | null;
      resolvedTemplateHash?: string | null;
      resolvedTemplateRevisionId?: string | null;
      resolvedTemplateUpdatedAt?: Date | null;
      templateVersion: string;
      notes?: string | null;
      storageUri: string;
    }): Promise<PromptPackageRecord> => ({
      id: params.id ?? 'prompt-1',
      recordingId: params.recordingId,
      transcriptId: params.transcriptId,
      studentId: params.studentId ?? null,
      profilePath: params.profilePath ?? null,
      resolvedProfileId: params.resolvedProfileId ?? null,
      resolvedProfileHash: params.resolvedProfileHash ?? null,
      resolvedProfileRevisionId: params.resolvedProfileRevisionId ?? null,
      resolvedProfileUpdatedAt: params.resolvedProfileUpdatedAt ?? null,
      resolvedTemplateId: params.resolvedTemplateId ?? null,
      resolvedTemplateHash: params.resolvedTemplateHash ?? null,
      resolvedTemplateRevisionId: params.resolvedTemplateRevisionId ?? null,
      resolvedTemplateUpdatedAt: params.resolvedTemplateUpdatedAt ?? null,
      templateVersion: params.templateVersion,
      notes: params.notes ?? null,
      storageUri: params.storageUri,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    }),
  };
}

function createProfileRevisionRepositoryStub(overrides: {
  getActive?: (profileId: string) => Promise<ProfileRevisionRecord | null>;
  getLatestByHash?: (
    profileId: string,
    contentHash: string,
  ) => Promise<ProfileRevisionRecord | null>;
} = {}) {
  return {
    getActive:
      overrides.getActive ??
      (async () => null),
    getLatestByHash:
      overrides.getLatestByHash ??
      (async () => null),
    activate: async (
      _profileId: string,
      _revisionId: string,
    ): Promise<ProfileRevisionRecord | null> => null,
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
        id: 'revision-1',
        profileId,
        content,
        contentHash,
        source: source ?? 'update',
        status: 'active',
        versionNumber: 1,
        versionLabel: 'v1',
        activatedAt: new Date('2024-01-01T00:00:00Z'),
        deprecatedAt: null,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        createdBy: createdBy ?? null,
        restoredFromRevisionId: restoredFromRevisionId ?? null,
      };
      return revision;
    },
  };
}

function createTemplateRevisionRepositoryStub(overrides: {
  getActive?: (templateId: string) => Promise<TemplateRevisionRecord | null>;
  getLatestByHash?: (
    templateId: string,
    contentHash: string,
  ) => Promise<TemplateRevisionRecord | null>;
} = {}) {
  return {
    getActive:
      overrides.getActive ??
      (async () => null),
    getLatestByHash:
      overrides.getLatestByHash ??
      (async () => null),
    activate: async (
      _templateId: string,
      _revisionId: string,
    ): Promise<TemplateRevisionRecord | null> => null,
    insert: async ({
      templateId,
      content,
      contentHash,
      source,
      createdBy,
      restoredFromRevisionId,
    }: {
      templateId: string;
      content: string;
      contentHash: string;
      source?: 'create' | 'update' | 'restore';
      createdBy?: string | null;
      restoredFromRevisionId?: string | null;
    }) => {
      const revision: TemplateRevisionRecord = {
        id: 'template-revision-1',
        templateId,
        content,
        contentHash,
        source: source ?? 'update',
        status: 'active',
        versionNumber: 1,
        versionLabel: 'v1',
        activatedAt: new Date('2024-01-01T00:00:00Z'),
        deprecatedAt: null,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        createdBy: createdBy ?? null,
        restoredFromRevisionId: restoredFromRevisionId ?? null,
      };
      return revision;
    },
  };
}

function createProfileRepositoryStub() {
  return {
    upsert: async ({
      id,
      label,
      activeRevisionId,
    }: {
      id: string;
      label: string;
      activeRevisionId?: string | null;
    }): Promise<ProfileRecord> => ({
      id,
      label,
      activeRevisionId: activeRevisionId ?? null,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    }),
    setActive: async (): Promise<ProfileRecord | null> => null,
  };
}

function createTemplateRepositoryStub() {
  return {
    upsert: async ({
      id,
      label,
      activeRevisionId,
    }: {
      id: string;
      label: string;
      activeRevisionId?: string | null;
    }): Promise<TemplateRecord> => ({
      id,
      label,
      activeRevisionId: activeRevisionId ?? null,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    }),
    setActive: async (): Promise<TemplateRecord | null> => null,
  };
}

function createConfig(templatePath: string, profilePath: string): BatchBackendConfig {
  return {
    prompt: {
      templatePath,
      defaultProfilePath: profilePath,
    },
  } as BatchBackendConfig;
}
