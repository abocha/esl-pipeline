import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { createPromptPackage } from '../src/application/create-prompt-package.js';
import { getPromptPackage } from '../src/application/get-prompt-package.js';
import { ProfilePathError } from '../src/application/profile-path.js';
import type { BatchBackendConfig } from '../src/config/env.js';
import type { PromptPackageRecord } from '../src/domain/prompt-package-model.js';
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
          templateVersion: params.templateVersion,
          notes: params.notes ?? null,
          storageUri: params.storageUri,
          createdAt: new Date('2024-01-01T00:00:00Z'),
          updatedAt: new Date('2024-01-01T00:00:00Z'),
        };
      },
    };

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
      },
    );

    expect(result).not.toBeNull();
    expect(result?.recordingId).toBe(transcript.recordingId);
    expect(result?.transcriptId).toBe(transcript.id);
    expect(result?.studentId).toBe('student-1');
    expect(result?.notes).toBe('Some notes');
    expect(result?.templateVersion).toBe('template.md');
    expect(result?.profilePath).toBe(profilePath);
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
        },
      ),
    ).rejects.toBeInstanceOf(ProfilePathError);
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

function createConfig(templatePath: string, profilePath: string): BatchBackendConfig {
  return {
    prompt: {
      templatePath,
      defaultProfilePath: profilePath,
    },
  } as BatchBackendConfig;
}
