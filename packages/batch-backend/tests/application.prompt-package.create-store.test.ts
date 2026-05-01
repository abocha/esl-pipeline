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
  createBindingResolverStub,
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
  it('creates a prompt package with canonical ordering', async () => {
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-prompt-allowed-'));
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-prompt-outside-'));
    const templatePath = path.join(allowedDir, 'template.md');
    const defaultProfilePath = path.join(allowedDir, 'default-profile.md');
    const profilePath = path.join(outsideDir, 'profile.md');
    const voicesPath = path.join(allowedDir, 'voices.json');

    await fs.writeFile(templatePath, 'Hello\nFooter\n', 'utf8');
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
        expect(text).toContain('[VOICE_CAPABILITIES]\ngenerated_at: 2026-01-05T00:00:00.000Z');
        expect(text).toContain('accent: [american, british]');
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
        expect(text.indexOf('Hello\nFooter')).toBeLessThan(text.indexOf('[VOICE_CAPABILITIES]'));
        expect(text.indexOf('[VOICE_CAPABILITIES]')).toBeLessThan(
          text.indexOf('[FOUNDATIONAL_PROFILE]'),
        );
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
        return { uri: `local://prompt-packages/${promptPackageId}.txt`, bytes: text.length };
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
          bindings: createBindingResolverStub(),
          promptOptions: createPromptOptionsStub(),
          lessonMemory: {
            requestGeneration: async () => null,
          },
        },
      );

      expect(result).not.toBeNull();
      expect(result?.recordingId).toBe(transcript.recordingId);
      expect(result?.transcriptId).toBe(transcript.id);
      expect(result?.studentId).toBe('student-1');
      expect(result?.notes).toBe('Some notes');
      expect(result?.templateVersion).toBe('template.md');
      expect(result?.profilePath).toBe('profile.md');
      expect(result?.profileSnapshot?.resolvedProfileId).toBe('profile.md');
      expect(result?.profileSnapshot?.resolvedProfileRevisionId).toBe('active-profile.md');
    } finally {
      if (previousCanonicalVoicesPath === undefined) {
        delete process.env[CANONICAL_ELEVENLABS_VOICES_ENV];
      } else {
        process.env[CANONICAL_ELEVENLABS_VOICES_ENV] = previousCanonicalVoicesPath;
      }
      vi.restoreAllMocks();
    }
  });

  it('stitches capabilities as a runtime block and persists provenance', async () => {
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-prompt-v10-'));
    const templatePath = path.join(allowedDir, 'hw_prompt_definitive.md');
    const profilePath = path.join(allowedDir, 'profile.md');
    const voicesPath = path.join(allowedDir, 'voices.json');

    await fs.writeFile(
      templatePath,
      ['Header', 'Use exact values from [VOICE_CAPABILITIES] when writing speaker_profiles.'].join(
        '\n',
      ),
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
        style: ['chirp3_hd'],
      },
      voices: [],
    });
    try {
      const transcript = createTranscriptRecord();
      const storage = createStorageStub({
        getText: async () => 'TRANSCRIPT BODY',
        putPromptPackage: async ({ promptPackageId, text }) => {
          expect(text).toContain('[VOICE_CAPABILITIES]\ngenerated_at: 2026-01-06T00:00:00.000Z');
          expect(text).toContain('accent: [american, australian, british]');
          expect(text).toContain('style: [chirp3_hd, conversational, professional]');
          expect(text).not.toContain('# CAPABILITY SNAPSHOT');
          expect(text).not.toContain('<provider-backed values>');
          expect(text.indexOf('Header')).toBeLessThan(text.indexOf('[VOICE_CAPABILITIES]'));
          expect(text.indexOf('[VOICE_CAPABILITIES]')).toBeLessThan(
            text.indexOf('[FOUNDATIONAL_PROFILE]'),
          );
          return { uri: `local://prompt-packages/${promptPackageId}.txt`, bytes: text.length };
        },
      });

      const result = await createPromptPackage(
        {
          recordingId: transcript.recordingId,
          templateId: 'hw_prompt_definitive.md',
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
          profileRevisions: createProfileRevisionRepositoryStub(),
          templateRevisions: createTemplateRevisionRepositoryStub(),
          bindings: createBindingResolverStub(),
          promptOptions: createPromptOptionsStub(),
          lessonMemory: {
            requestGeneration: async () => null,
          },
        },
      );

      expect(result?.voiceCapabilitiesSnapshot?.generatedAt).toBe('2026-01-06T00:00:00.000Z');
      expect(result?.voiceCapabilitiesSnapshot?.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(result?.voiceCapabilitiesSnapshot?.capabilities.accent).toEqual([
        'american',
        'australian',
        'british',
      ]);
      expect(result?.voiceCapabilitiesSnapshot?.capabilities.style).toEqual([
        'chirp3_hd',
        'conversational',
        'professional',
      ]);
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
    const revision =
      await createTemplateRevisionRepositoryStub().getActive('hw_prompt_definitive.md');

    expect(revision?.content).toContain('[VOICE_CAPABILITIES]');
    expect(revision?.content).not.toContain('# CAPABILITY SNAPSHOT');
    expect(revision?.content).not.toContain('<provider-backed values>');
  });

  it('rejects active template revisions that still contain the retired capability snapshot marker', async () => {
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-prompt-retired-marker-'));
    const templatePath = path.join(allowedDir, 'hw_prompt_definitive.md');
    const profilePath = path.join(allowedDir, 'profile.md');
    const voicesPath = path.join(allowedDir, 'voices.json');
    const markerTemplate = [
      'Header',
      '```yaml',
      '# CAPABILITY SNAPSHOT (injected dynamically per voice catalog refresh)',
      'accent: [<provider-backed values>]',
      'style: [<provider-backed values>]',
      '```',
    ].join('\n');

    await fs.writeFile(templatePath, markerTemplate, 'utf8');
    await fs.writeFile(profilePath, 'PROFILE CONTENT', 'utf8');
    await writeVoiceCatalog(voicesPath);

    const previousCanonicalVoicesPath = process.env[CANONICAL_ELEVENLABS_VOICES_ENV];
    process.env[CANONICAL_ELEVENLABS_VOICES_ENV] = voicesPath;
    vi.spyOn(googleProvider, 'loadGoogleVoicesCatalog').mockRejectedValue(new Error('adc missing'));

    try {
      const transcript = createTranscriptRecord();

      await expect(
        createPromptPackage(
          {
            recordingId: transcript.recordingId,
            templateId: 'hw_prompt_definitive.md',
            profileId: 'profile.md',
          },
          {
            config: createConfig(templatePath, profilePath),
            storage: createStorageStub({
              getText: async () => 'TRANSCRIPT BODY',
            }),
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
            profileRevisions: createProfileRevisionRepositoryStub(),
            templateRevisions: createTemplateRevisionRepositoryStub({
              getActive: async () => ({
                id: 'template-revision-retired-marker',
                templateId: 'hw_prompt_definitive.md',
                content: markerTemplate,
                contentHash: 'marker-hash',
                source: 'update',
                status: 'active',
                versionNumber: 9,
                versionLabel: 'v9',
                activatedAt: new Date('2026-04-30T00:00:00.000Z'),
                deprecatedAt: null,
                createdAt: new Date('2026-04-30T00:00:00.000Z'),
                createdBy: null,
                restoredFromRevisionId: null,
              }),
            }),
            bindings: createBindingResolverStub(),
            promptOptions: createPromptOptionsStub(),
            lessonMemory: {
              requestGeneration: async () => null,
            },
          },
        ),
      ).rejects.toMatchObject({
        code: 'template_revision_legacy_voice_capability_marker',
      });
    } finally {
      if (previousCanonicalVoicesPath === undefined) {
        delete process.env[CANONICAL_ELEVENLABS_VOICES_ENV];
      } else {
        process.env[CANONICAL_ELEVENLABS_VOICES_ENV] = previousCanonicalVoicesPath;
      }
      vi.restoreAllMocks();
    }
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
