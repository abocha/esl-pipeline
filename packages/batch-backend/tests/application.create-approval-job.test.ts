import { describe, expect, it, vi } from 'vitest';

import { createApprovalJobFromDraft } from '../src/application/create-approval-job.js';
import { loadConfig } from '../src/config/env.js';
import type { DraftRecord } from '../src/domain/draft-model.js';
import type { JobRecord } from '../src/domain/job-model.js';
import type { PromptPackageRecord } from '../src/domain/prompt-package-model.js';
import type { UserSettingsRecord } from '../src/domain/settings-model.js';

describe('application/create-approval-job', () => {
  it('creates an awaiting_approval job from a draft and prompt package', async () => {
    const draft: DraftRecord = {
      id: 'draft-1',
      promptPackageId: 'prompt-1',
      studentId: 'student-1',
      storageUri: 'local://drafts/draft-1.md',
      createdBy: 'user-1',
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    };
    const promptPackage: PromptPackageRecord = {
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

    const approvalJob: JobRecord = {
      id: 'job-1',
      state: 'awaiting_approval',
      md: null,
      recordingId: 'recording-1',
      transcriptId: 'transcript-1',
      promptPackageId: 'prompt-1',
      draftId: 'draft-1',
      preset: 'b2-intermediate',
      withTts: true,
      upload: null,
      voiceId: null,
      voiceAccent: 'british',
      forceTts: null,
      notionDatabase: null,
      ttsStrategy: 'dialogue',
      notionUrl: null,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
      startedAt: null,
      finishedAt: null,
      error: null,
      manifestPath: null,
      userId: 'user-1',
    };

    const insertApprovalJob = vi.fn().mockResolvedValue(approvalJob);
    const publishEvent = vi.fn();
    const config = loadConfig();
    const settings: UserSettingsRecord = {
      id: 'settings-1',
      userId: 'user-1',
      elevenLabsKeyEncrypted: 'encrypted',
      notionTokenEncrypted: null,
      ttsProvider: 'elevenlabs',
      defaultPreset: 'b2-intermediate',
      defaultVoiceAccent: 'british',
      defaultTtsStrategy: 'dialogue',
      enableNotifications: true,
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    };

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
      recordingId: 'recording-1',
      transcriptId: 'transcript-1',
      promptPackageId: 'prompt-1',
      draftId: 'draft-1',
      userId: 'user-1',
      preset: 'b2-intermediate',
      withTts: true,
      ttsStrategy: 'dialogue',
      voiceAccent: 'british',
      upload: 'auto',
    });
    expect(publishEvent).toHaveBeenCalledWith({ type: 'job_created', job });
  });
});
