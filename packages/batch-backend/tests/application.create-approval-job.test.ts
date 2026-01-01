import { describe, expect, it, vi } from 'vitest';

import { createApprovalJobFromDraft } from '../src/application/create-approval-job.js';
import type { DraftRecord } from '../src/domain/draft-model.js';
import type { JobRecord } from '../src/domain/job-model.js';
import type { PromptPackageRecord } from '../src/domain/prompt-package-model.js';

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
      transcribeWorkdir: null,
      transcriptPath: null,
      promptPayload: null,
      promptNotes: null,
      profilePath: null,
      recordingId: 'recording-1',
      transcriptId: 'transcript-1',
      promptPackageId: 'prompt-1',
      draftId: 'draft-1',
      preset: null,
      withTts: null,
      upload: null,
      voiceId: null,
      voiceAccent: null,
      forceTts: null,
      notionDatabase: null,
      ttsStrategy: null,
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

    const job = await createApprovalJobFromDraft(
      { draft, promptPackage },
      {
        jobs: { insertApprovalJob },
        publishEvent,
      },
    );

    expect(insertApprovalJob).toHaveBeenCalledWith({
      recordingId: 'recording-1',
      transcriptId: 'transcript-1',
      promptPackageId: 'prompt-1',
      draftId: 'draft-1',
      promptNotes: 'Notes',
      profilePath: '/profiles/p1.md',
      userId: 'user-1',
    });
    expect(publishEvent).toHaveBeenCalledWith({ type: 'job_created', job });
  });
});
