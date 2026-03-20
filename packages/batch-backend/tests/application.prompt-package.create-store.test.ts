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
  });

  it('injects capabilities into voice-aligned prompt templates and persists provenance', async () => {
    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-prompt-v44-'));
    const templatePath = path.join(allowedDir, 'hw_prompt_v4-4_voice-aligned.md');
    const profilePath = path.join(allowedDir, 'profile.md');
    const voicesPath = path.join(allowedDir, 'voices.json');

    await fs.writeFile(
      templatePath,
      [
        'Header',
        'INSERT PROFILE HERE',
        '```yaml',
        '# CAPABILITY SNAPSHOT (injected dynamically per voice catalog refresh)',
        'role: [narrator, teacher, student, system]',
        'gender: [male, female, neutral, child]',
        'age: [child, teen, young, adult, middle_aged, senior, universal]',
        'accent: [<provider-backed values>]',
        'style: [<provider-backed values>]',
        '```',
      ].join('\n'),
      'utf8',
    );
    await fs.writeFile(profilePath, 'PROFILE CONTENT', 'utf8');
    await fs.writeFile(
      voicesPath,
      JSON.stringify({
        generatedAt: '2026-01-05T00:00:00.000Z',
        capabilities: {
          generatedAt: '2026-01-05T00:00:00.000Z',
          role: ['narrator', 'teacher', 'student', 'system'],
          gender: ['male', 'female', 'neutral', 'child'],
          age: ['child', 'teen', 'young', 'adult', 'middle_aged', 'senior', 'universal'],
          accent: ['american', 'british'],
          style: ['conversational', 'professional'],
        },
        voices: [],
      }),
      'utf8',
    );

    const previousVoicesPath = process.env.ELEVENLABS_VOICES_PATH;
    process.env.ELEVENLABS_VOICES_PATH = voicesPath;
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
          expect(text).toContain('accent: [american, australian, british]');
          expect(text).toContain('style: [chirp3_hd, conversational, professional]');
          expect(text).not.toContain('<provider-backed values>');
          return { uri: `local://prompt-packages/${promptPackageId}.txt`, bytes: text.length };
        },
      });

      const result = await createPromptPackage(
        {
          recordingId: transcript.recordingId,
          templateId: 'hw_prompt_v4-4_voice-aligned.md',
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
      if (previousVoicesPath === undefined) {
        delete process.env.ELEVENLABS_VOICES_PATH;
      } else {
        process.env.ELEVENLABS_VOICES_PATH = previousVoicesPath;
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
      },
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:10:00.000Z',
    });
  });
});
