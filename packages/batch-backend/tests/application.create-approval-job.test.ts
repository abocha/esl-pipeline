import { describe, expect, it, vi } from 'vitest';

import { createApprovalJobFromDraft } from '../src/application/create-approval-job.js';
import { loadConfig } from '../src/config/env.js';
import type { DraftRecord } from '../src/domain/draft-model.js';
import type { JobRecord } from '../src/domain/job-model.js';
import type { PromptPackageRecord } from '../src/domain/prompt-package-model.js';
import type { UserSettingsRecord } from '../src/domain/settings-model.js';

function buildDraft(): DraftRecord {
  return {
    id: 'draft-1',
    promptPackageId: 'prompt-1',
    studentId: 'student-1',
    format: 'assignment_v1',
    storageUri: `local://drafts/content/${'a'.repeat(64)}.json`,
    workingVersion: 1,
    contentHash: 'a'.repeat(64),
    createdBy: 'user-1',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  };
}

function buildPromptPackage(): PromptPackageRecord {
  return {
    id: 'prompt-1',
    recordingId: 'recording-1',
    transcriptId: 'transcript-1',
    studentId: 'student-1',
    profilePath: '/profiles/p1.md',
    templateVersion: '/templates/t1.md',
    notes: 'Notes',
    storageUri: 'local://prompt-packages/prompt-1.txt',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  };
}

function buildApprovalJob(withTts: boolean): JobRecord {
  return {
    id: 'job-1',
    state: 'awaiting_approval',
    md: null,
    recordingId: 'recording-1',
    transcriptId: 'transcript-1',
    promptPackageId: 'prompt-1',
    draftId: 'draft-1',
    preset: 'b2-intermediate',
    withTts,
    upload: null,
    voiceId: null,
    voiceAccent: 'british',
    forceTts: null,
    ttsStrategy: 'dialogue',
    ttsModel: null,
    publishTarget: 'html',
    htmlUrl: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    startedAt: null,
    finishedAt: null,
    error: null,
    manifestPath: null,
    userId: 'user-1',
  };
}

function buildSettings(): UserSettingsRecord {
  return {
    userId: 'user-1',
    elevenLabsKeyEncrypted: 'encrypted',
    ttsProvider: 'elevenlabs',
    defaultPreset: 'b2-intermediate',
    defaultVoiceAccent: 'british',
    defaultTtsStrategy: 'dialogue',
    enableNotifications: true,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
  };
}

describe('application/create-approval-job', () => {
  it('creates an awaiting_approval job from a draft and prompt package', async () => {
    const draft = buildDraft();
    const promptPackage = buildPromptPackage();
    const approvalJob = buildApprovalJob(true);

    const insertApprovalJob = vi.fn().mockResolvedValue(approvalJob);
    const publishEvent = vi.fn();
    const config = loadConfig();
    const settings = buildSettings();

    const job = await createApprovalJobFromDraft(
      { draft, promptPackage },
      {
        jobs: { insertApprovalJob },
        settings: {
          getByUserId: vi.fn().mockResolvedValue(settings),
          createDefault: vi.fn(),
        },
        config: {
          ...config,
          orchestrator: {
            ...config.orchestrator,
            elevenLabsApiKey: 'test-key',
          },
        },
        publishEvent,
      },
    );

    expect(insertApprovalJob).toHaveBeenCalledWith({
      assignmentArtifact: {
        format: 'assignment_v1',
        schemaVersion: 1,
        serializationVersion: 1,
        workingVersion: 1,
        contentHash: draft.contentHash,
        storageUri: draft.storageUri,
      },
      assignmentRendererVersion: 2,
      recordingId: 'recording-1',
      transcriptId: 'transcript-1',
      promptPackageId: 'prompt-1',
      draftId: 'draft-1',
      studentId: 'student-1',
      lessonId: null,
      userId: 'user-1',
      preset: 'b2-intermediate',
      learningPresetId: 'general-english',
      learningPresetVersion: 'v2',
      promptSnapshotVersion: 'hw_prompt_assignment_v1',
      promptAlias: 'current',
      withTts: true,
      autoPublish: undefined,
      publishTarget: 'html',
      ttsStrategy: 'dialogue',
      ttsProvider: undefined,
      ttsModel: undefined,
      voiceAccent: 'british',
      voiceId: undefined,
      forceTts: undefined,
      upload: 'auto',
    });
    expect(publishEvent).toHaveBeenCalledWith({ type: 'job_created', job });
  });

  it('defaults withTts=true when google provider is selected without ElevenLabs key availability', async () => {
    const draft = buildDraft();
    const promptPackage = buildPromptPackage();
    const approvalJob = buildApprovalJob(true);
    const insertApprovalJob = vi.fn().mockResolvedValue(approvalJob);
    const publishEvent = vi.fn();
    const config = loadConfig();

    await createApprovalJobFromDraft(
      {
        draft,
        promptPackage,
        jobOverrides: {
          ttsProvider: 'google',
          ttsModel: 'chirp3_hd',
        },
      },
      {
        jobs: { insertApprovalJob },
        settings: {
          getByUserId: vi.fn().mockResolvedValue({
            ...buildSettings(),
            elevenLabsKeyEncrypted: null,
          }),
          createDefault: vi.fn(),
        },
        config: {
          ...config,
          orchestrator: {
            ...config.orchestrator,
            elevenLabsApiKey: undefined,
          },
        },
        publishEvent,
      },
    );

    expect(insertApprovalJob).toHaveBeenCalledWith(
      expect.objectContaining({
        withTts: true,
        ttsProvider: 'google',
        ttsModel: 'chirp3_hd',
      }),
    );
  });

  it('honors explicit withTts override even when google provider is selected', async () => {
    const draft = buildDraft();
    const promptPackage = buildPromptPackage();
    const approvalJob = buildApprovalJob(false);
    const insertApprovalJob = vi.fn().mockResolvedValue(approvalJob);
    const publishEvent = vi.fn();
    const config = loadConfig();

    await createApprovalJobFromDraft(
      {
        draft,
        promptPackage,
        jobOverrides: {
          withTts: false,
          ttsProvider: 'google',
          ttsModel: 'studio',
        },
      },
      {
        jobs: { insertApprovalJob },
        settings: {
          getByUserId: vi.fn().mockResolvedValue({
            ...buildSettings(),
            elevenLabsKeyEncrypted: null,
          }),
          createDefault: vi.fn(),
        },
        config: {
          ...config,
          orchestrator: {
            ...config.orchestrator,
            elevenLabsApiKey: undefined,
          },
        },
        publishEvent,
      },
    );

    expect(insertApprovalJob).toHaveBeenCalledWith(
      expect.objectContaining({
        withTts: false,
        ttsProvider: 'google',
        ttsModel: 'studio',
      }),
    );
  });

  it('persists explicit elevenlabs publish model overrides', async () => {
    const draft = buildDraft();
    const promptPackage = buildPromptPackage();
    const approvalJob = buildApprovalJob(true);
    const insertApprovalJob = vi.fn().mockResolvedValue(approvalJob);
    const publishEvent = vi.fn();
    const config = loadConfig();

    await createApprovalJobFromDraft(
      {
        draft,
        promptPackage,
        jobOverrides: {
          ttsProvider: 'elevenlabs',
          ttsStrategy: 'dialogue',
          ttsModel: 'eleven_v3',
        },
      },
      {
        jobs: { insertApprovalJob },
        settings: {
          getByUserId: vi.fn().mockResolvedValue(buildSettings()),
          createDefault: vi.fn(),
        },
        config,
        publishEvent,
      },
    );

    expect(insertApprovalJob).toHaveBeenCalledWith(
      expect.objectContaining({
        ttsProvider: 'elevenlabs',
        ttsStrategy: 'dialogue',
        ttsModel: 'eleven_v3',
      }),
    );
  });
});
