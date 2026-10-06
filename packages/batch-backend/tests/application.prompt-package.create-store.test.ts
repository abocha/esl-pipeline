import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import * as googleProvider from '@esl-pipeline/tts-provider-google';

import { createPromptPackage } from '../src/application/create-prompt-package.js';
import { getPromptPackage } from '../src/application/get-prompt-package.js';
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

const CANONICAL_ELEVENLABS_VOICES_ENV = 'ESL_TTS_PROVIDER_ELEVENLABS_VOICES_PATH';
const RETIRED_ELEVENLABS_VOICES_ENV = ['ELEVENLABS', 'VOICES', 'PATH'].join('_');
const GOOGLE_CREDENTIALS_ENV = 'GOOGLE_APPLICATION_CREDENTIALS';

async function writeVoiceCatalog(
  filePath: string,
  capabilities: {
    generatedAt?: string;
    accent?: string[];
    style?: string[];
  } = {},
) {
  const generatedAt = capabilities.generatedAt ?? '2026-01-05T00:00:00.000Z';
  await fs.writeFile(
    filePath,
    JSON.stringify({
      generatedAt,
      capabilities: {
        generatedAt,
        role: ['narrator', 'teacher', 'student', 'system'],
        gender: ['male', 'female', 'neutral', 'child'],
        age: ['child', 'teen', 'young', 'adult', 'middle_aged', 'senior', 'universal'],
        accent: capabilities.accent ?? ['american', 'british'],
        style: capabilities.style ?? ['conversational', 'professional'],
      },
      voices: [],
    }),
    'utf8',
  );
}

describe('application/prompt-package', () => {
  it.each(['assignment_v1', 'assignment_v1_rationale_v2'])(
    'rejects fresh package creation against old active template %s without writing a package',
    async (identity) => {
      const transcript = createTranscriptRecord();
      const templateRevisions = createTemplateRevisionRepositoryStub();
      const old = (await templateRevisions.getActive('hw_prompt_assignment_v1.md'))!;
      old.content = `Assignment output contract: ${identity}\nOutput task: a practical learner response.`;
      const before = JSON.stringify(old);
      const insert = vi.fn();
      const putPromptPackage = vi.fn();
      const provider = vi.fn(() => {
        throw new Error('Unexpected provider invocation');
      });
      vi.stubGlobal('fetch', provider);
      try {
        await expect(
          createPromptPackage(
            {
              recordingId: transcript.recordingId,
              workspaceId: 'workspace-1',
              templateId: 'hw_prompt_assignment_v1.md',
            },
            {
              config: createConfig('hw_prompt_assignment_v1.md', 'profile.md'),
              storage: createStorageStub({
                getText: async () => 'TRANSCRIPT BODY',
                putPromptPackage,
              }),
              transcripts: { getByRecordingId: async () => transcript },
              recordings: {
                getById: async () =>
                  ({
                    id: transcript.recordingId,
                    workspaceId: 'workspace-1',
                    studentId: 'student-1',
                  }) as never,
              },
              students: { getById: async () => ({ id: 'student-1', student: 'Student One' }) },
              promptPackages: { ...createPromptPackageRepositoryStub(), insert },
              profileRevisions: createProfileRevisionRepositoryStub(),
              templateRevisions: createTemplateRevisionRepositoryStub({
                getActive: async () => old,
              }),
              promptOptions: createPromptOptionsStub(),
            },
          ),
        ).rejects.toMatchObject({ code: 'PROMPT_PACKAGE_OUTPUT_CONTRACT_UNSUPPORTED' });
        expect(insert).not.toHaveBeenCalled();
        expect(putPromptPackage).not.toHaveBeenCalled();
        expect(provider).not.toHaveBeenCalled();
        expect(JSON.stringify(old)).toBe(before);
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it('creates a prompt package with canonical ordering', async () => {
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-prompt-allowed-'));
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-prompt-outside-'));
    const templatePath = path.join(allowedDir, 'hw_prompt_assignment_v1.md');
    const defaultProfilePath = path.join(allowedDir, 'default-profile.md');
    const profilePath = path.join(outsideDir, 'profile.md');
    const voicesPath = path.join(allowedDir, 'voices.json');

    await fs.writeFile(
      templatePath,
      'Assignment output contract: assignment_v1_mission_v3\nHello\nFooter\n',
      'utf8',
    );
    await fs.writeFile(defaultProfilePath, 'DEFAULT PROFILE\n', 'utf8');
    await fs.writeFile(profilePath, 'PROFILE CONTENT\n', 'utf8');
    await writeVoiceCatalog(voicesPath);

    const previousCanonicalVoicesPath = process.env[CANONICAL_ELEVENLABS_VOICES_ENV];
    process.env[CANONICAL_ELEVENLABS_VOICES_ENV] = voicesPath;
    vi.spyOn(googleProvider, 'loadGoogleVoicesCatalog').mockRejectedValue(new Error('adc missing'));

    const transcript = createTranscriptRecord();
    const storage = createStorageStub({
      getText: async () => 'TRANSCRIPT BODY',
      putPromptPackage: async ({ promptPackageId, text }) => {
        expect(text).not.toContain('[VOICE_CAPABILITIES]');
        expect(text).toContain('[FOUNDATIONAL_PROFILE]\nPROFILE CONTENT');
        expect(text).toContain(
          '[STUDENT_MEMORY_SNAPSHOT]\nNot available for this prompt package because canonical student-memory retrieval is disabled.',
        );
        expect(text).toContain(
          '[RECENT_LESSON_MEMORY]\nNot available for this prompt package because canonical student-memory retrieval is disabled.',
        );
        expect(text).toContain(
          '[RECENT_HOMEWORK_MEMORY]\nNot available for this prompt package because canonical student-memory retrieval is disabled.',
        );
        expect(text).toContain(
          '[UNRESOLVED_ISSUES]\nNot available for this prompt package because canonical student-memory retrieval is disabled.',
        );
        expect(text).toContain('[TEACHER_NOTES]\nSome notes');
        expect(text).toContain('[LATEST_TRANSCRIPT]\nTRANSCRIPT BODY');
        expect(text).not.toContain('[LESSON_HISTORY]');
        expect(text.indexOf('Hello\nFooter')).toBeLessThan(text.indexOf('[FOUNDATIONAL_PROFILE]'));
        expect(text.indexOf('[FOUNDATIONAL_PROFILE]')).toBeLessThan(
          text.indexOf('[STUDENT_MEMORY_SNAPSHOT]'),
        );
        expect(
          text.indexOf('[STUDENT_MEMORY_SNAPSHOT]') < text.indexOf('[RECENT_LESSON_MEMORY]'),
        ).toBe(true);
        expect(
          text.indexOf('[RECENT_LESSON_MEMORY]') < text.indexOf('[RECENT_HOMEWORK_MEMORY]'),
        ).toBe(true);
        expect(text.indexOf('[RECENT_HOMEWORK_MEMORY]') < text.indexOf('[UNRESOLVED_ISSUES]')).toBe(
          true,
        );
        expect(text.indexOf('[UNRESOLVED_ISSUES]') < text.indexOf('[TEACHER_NOTES]')).toBe(true);
        expect(text.indexOf('[TEACHER_NOTES]') < text.indexOf('[LATEST_TRANSCRIPT]')).toBe(true);
        return {
          uri: `local://prompt-packages/${promptPackageId}.txt`,
          bytes: text.length,
          sha256: 'hash',
        };
      },
    });

    const promptPackages = {
      insert: async (params: InsertPromptPackageParams): Promise<PromptPackageRecord> => {
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

    try {
      const result = await createPromptPackage(
        {
          recordingId: transcript.recordingId,
          workspaceId: 'workspace-1',
          notes: 'Some notes',
          templateId: 'hw_prompt_assignment_v1.md',
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
            getById: async () => ({ id: 'student-1', student: 'Student One' }),
          },
          promptPackages,
          profileRevisions,
          templateRevisions: createTemplateRevisionRepositoryStub(),
          promptOptions: createPromptOptionsStub(),
        },
      );

      expect(result).not.toBeNull();
      expect(result?.recordingId).toBe(transcript.recordingId);
      expect(result?.transcriptId).toBe(transcript.id);
      expect(result?.studentId).toBe('student-1');
      expect(result?.notes).toBe('Some notes');
      expect(result?.templateVersion).toBe('hw_prompt_assignment_v1.md');
      expect(result?.profilePath).toBeNull();
      expect(result?.profileSnapshot?.resolvedProfileId).toBeNull();
      expect(result?.profileSnapshot?.resolvedProfileRevisionId).toBe('active-student-1');
    } finally {
      if (previousCanonicalVoicesPath === undefined) {
        delete process.env[CANONICAL_ELEVENLABS_VOICES_ENV];
      } else {
        process.env[CANONICAL_ELEVENLABS_VOICES_ENV] = previousCanonicalVoicesPath;
      }
      vi.restoreAllMocks();
    }
  });

  it('does not stitch provider voice catalogs into authored prompt context', async () => {
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-prompt-v10-'));
    const templatePath = path.join(allowedDir, 'hw_prompt_assignment_v1.md');
    const profilePath = path.join(allowedDir, 'profile.md');
    const voicesPath = path.join(allowedDir, 'voices.json');

    await fs.writeFile(
      templatePath,
      ['Header', 'Use descriptive role and persona text when writing speaker_profiles.'].join('\n'),
      'utf8',
    );
    await fs.writeFile(profilePath, 'PROFILE CONTENT', 'utf8');
    await writeVoiceCatalog(voicesPath);

    const previousCanonicalVoicesPath = process.env[CANONICAL_ELEVENLABS_VOICES_ENV];
    const previousRetiredVoicesPath = process.env[RETIRED_ELEVENLABS_VOICES_ENV];
    const previousGoogleCredentials = process.env[GOOGLE_CREDENTIALS_ENV];
    process.env[CANONICAL_ELEVENLABS_VOICES_ENV] = voicesPath;
    process.env[RETIRED_ELEVENLABS_VOICES_ENV] = path.join(
      allowedDir,
      'retired-legacy-voices.json',
    );
    process.env[GOOGLE_CREDENTIALS_ENV] = path.join(allowedDir, 'mock-google-credentials.json');
    vi.spyOn(googleProvider, 'loadGoogleVoicesCatalog').mockResolvedValue({
      generatedAt: '2026-01-06T00:00:00.000Z',
      capabilities: {
        generatedAt: '2026-01-06T00:00:00.000Z',
        role: ['narrator', 'teacher', 'student', 'system'],
        gender: ['male', 'female', 'neutral', 'child'],
        age: ['child', 'teen', 'young', 'adult', 'middle_aged', 'senior', 'universal'],
        accent: ['australian'],
        style: ['chirp3_hd', 'calm', 'studio', 'casual', 'wavenet', 'neural2'],
      },
      voices: [],
    });
    try {
      const transcript = createTranscriptRecord();
      const storage = createStorageStub({
        getText: async () => 'TRANSCRIPT BODY',
        putPromptPackage: async ({ promptPackageId, text }) => {
          expect(text).not.toContain('[VOICE_CAPABILITIES]');
          expect(text).not.toContain('accent: [american, australian, british]');
          expect(text).not.toContain('style: [calm, casual, conversational, professional]');
          expect(text).not.toContain('chirp3_hd');
          expect(text).not.toContain('studio');
          expect(text).not.toContain('wavenet');
          expect(text).not.toContain('neural2');
          expect(text).not.toContain('# CAPABILITY SNAPSHOT');
          expect(text).not.toContain('<provider-backed values>');
          expect(text.indexOf('Header')).toBeLessThan(text.indexOf('[FOUNDATIONAL_PROFILE]'));
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
          profileRevisions: createProfileRevisionRepositoryStub(),
          templateRevisions: createTemplateRevisionRepositoryStub(),
          promptOptions: createPromptOptionsStub(),
        },
      );
    } finally {
      if (previousCanonicalVoicesPath === undefined) {
        delete process.env[CANONICAL_ELEVENLABS_VOICES_ENV];
      } else {
        process.env[CANONICAL_ELEVENLABS_VOICES_ENV] = previousCanonicalVoicesPath;
      }
      if (previousRetiredVoicesPath === undefined) {
        delete process.env[RETIRED_ELEVENLABS_VOICES_ENV];
      } else {
        process.env[RETIRED_ELEVENLABS_VOICES_ENV] = previousRetiredVoicesPath;
      }
      if (previousGoogleCredentials === undefined) {
        delete process.env[GOOGLE_CREDENTIALS_ENV];
      } else {
        process.env[GOOGLE_CREDENTIALS_ENV] = previousGoogleCredentials;
      }
      vi.restoreAllMocks();
    }
  });

  it('default active definitive template does not include a capability marker', async () => {
    const revision = await createTemplateRevisionRepositoryStub().getActive(
      'hw_prompt_assignment_v1.md',
    );

    expect(revision?.content).not.toContain('[VOICE_CAPABILITIES]');
    expect(revision?.content).not.toContain('# CAPABILITY SNAPSHOT');
    expect(revision?.content).not.toContain('<provider-backed values>');
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
      lessonId: null,
      recordingId: 'recording-1',
      transcriptId: 'transcript-1',
      studentId: 'student-1',
      profilePath: '/profiles/p1.md',
      templateVersion: 't1.md',
      notes: 'Notes',
      storageUri: 'local://prompt-packages/prompt-1.txt',
      text: 'Prompt package text',
      memory: {
        studentMemorySnapshotId: null,
        studentMemorySnapshotHash: null,
        selectedLessonMemoryIds: [],
        selectedHomeworkMemoryIds: [],
        retrievalPolicyVersion: null,
        layerAvailability: {
          studentMemorySnapshot: 'missing',
          recentLessonMemory: 'missing',
          recentHomeworkMemory: 'missing',
          retrievalPolicy: 'missing',
        },
      },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:10:00.000Z',
    });
  });
});
