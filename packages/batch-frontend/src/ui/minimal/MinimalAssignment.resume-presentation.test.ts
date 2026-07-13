import { describe, expect, it } from 'vitest';

import type { AssignmentSession, JobStatus } from '../../utils/api';
import { buildRecentAssignmentItems } from './MinimalAssignment.resume-presentation';

function createJob(overrides: Partial<JobStatus> = {}): JobStatus {
  return {
    jobId: 'job-raw-identifier',
    studentId: 'student-cora',
    md: null,
    recordingId: null,
    transcriptId: null,
    promptPackageId: null,
    draftId: null,
    preset: null,
    withTts: false,
    voiceId: null,
    upload: null,
    voiceAccent: null,
    forceTts: null,
    publishTarget: null,
    ttsStrategy: null,
    autoPublish: false,
    htmlUrl: null,
    state: 'queued',
    createdAt: '2026-07-10T10:00:00.000Z',
    updatedAt: '2026-07-10T10:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    error: null,
    manifestPath: null,
    ...overrides,
  };
}

function createSession(overrides: Partial<AssignmentSession> = {}): AssignmentSession {
  return {
    id: 'session-raw-identifier',
    userId: 'user-1',
    studentId: 'student-cora',
    lessonId: null,
    recordingId: null,
    transcriptId: null,
    promptPackageId: null,
    draftId: null,
    currentStage: 'context',
    publishTarget: null,
    selectedTtsProvider: null,
    selectedTtsStrategy: null,
    selectedTtsModel: null,
    selectedPreset: null,
    selectedGenerationProvider: null,
    selectedGenerationModel: null,
    teacherNotes: null,
    createdAt: '2026-07-11T10:00:00.000Z',
    updatedAt: '2026-07-11T10:00:00.000Z',
    archivedAt: null,
    ...overrides,
  };
}

describe('buildRecentAssignmentItems', () => {
  it('sorts recent work newest first, preserves selection, and keeps raw IDs out of visible labels', () => {
    const job = createJob({
      state: 'succeeded',
      htmlUrl: 'https://example.test/assignment.html',
      updatedAt: '2026-07-12T10:00:00.000Z',
    });
    const session = createSession();

    const items = buildRecentAssignmentItems(
      [session],
      [job],
      job.jobId,
      new Map([['student-cora', 'Cora']]),
    );

    expect(items.map((item) => item.id)).toEqual([job.jobId, `session:${session.id}`]);
    expect(items[0]).toMatchObject({
      learnerName: 'Cora',
      lessonTitle: undefined,
      state: 'published',
      statusLabel: 'Published',
      actionLabel: 'Open assignment',
      destination: 'review',
      selected: true,
    });
    expect(items[1]).toMatchObject({
      state: 'unfinished',
      actionLabel: 'Continue assignment',
      destination: 'context',
      selected: false,
    });

    for (const item of items) {
      expect(
        [
          item.learnerName,
          item.lessonTitle,
          item.activityLabel,
          item.outcomeLabel,
          item.statusLabel,
        ].join(' '),
      ).not.toContain('raw-identifier');
    }
  });
});
