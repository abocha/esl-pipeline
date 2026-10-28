import { describe, expect, it } from 'vitest';

import type { AssignmentSession, JobStatus } from '../../utils/api';
import type { RecentAssignmentItem } from './MinimalAssignment.entry-state';
import {
  buildRecentAssignmentItems,
  buildRecentAssignmentLineages,
} from './MinimalAssignment.resume-presentation';
import { assignmentArtifact } from './MinimalAssignment.typed-test-fixtures';

function createJob(overrides: Partial<JobStatus> = {}): JobStatus {
  return {
    assignmentArtifact,
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
    homeworkIntent: 'create',
    transcriptCompletedAt: null,
    completionKind: null,
    transcriptCompletionHistory: [],
    id: 'session-raw-identifier',
    userId: 'user-1',
    studentId: 'student-cora',
    lessonId: null,
    recordingId: 'recording-confirmed',
    transcriptId: 'transcript-confirmed',
    promptPackageId: null,
    draftId: null,
    revision: 2,
    confirmedStep: 'source',
    confirmed: {
      student: { studentId: 'student-cora' },
      source: {
        lessonId: null,
        recordingId: 'recording-confirmed',
        transcriptId: 'transcript-confirmed',
        transcriptWorkingVersion: 1,
        transcriptStorageUri: 'local://transcript-confirmed',
        transcriptHash: 'a'.repeat(64),
      },
      context: null,
      create: null,
    },
    publishTarget: null,
    selectedTtsProvider: null,
    selectedTtsStrategy: null,
    selectedTtsModel: null,
    selectedPreset: null,
    selectedGenerationProvider: null,
    selectedGenerationModel: null,
    teacherNotes: null,
    selectedProfileId: null,
    selectedProfileRevisionId: null,
    selectedProfileRevisionHash: null,
    shareJobId: null,
    createdAt: '2026-07-11T10:00:00.000Z',
    updatedAt: '2026-07-11T10:00:00.000Z',
    ...overrides,
  };
}

function createSessionAt(destination: 'source' | 'context' | 'assignment' | 'review') {
  const base = createSession();
  if (destination === 'source') {
    return createSession({
      confirmedStep: 'student',
      confirmed: { ...base.confirmed, source: null },
    });
  }
  if (destination === 'context') {
    return createSession({
      recordingId: 'recording-confirmed',
      transcriptId: 'transcript-confirmed',
    });
  }
  const context = {
    teacherNotes: null,
    profileId: null,
    profileRevisionId: null,
    profileRevisionHash: null,
  };
  if (destination === 'assignment') {
    return createSession({
      recordingId: 'recording-confirmed',
      transcriptId: 'transcript-confirmed',
      confirmedStep: 'context',
      confirmed: { ...base.confirmed, context },
    });
  }
  return createSession({
    recordingId: 'recording-confirmed',
    transcriptId: 'transcript-confirmed',
    promptPackageId: 'prompt-confirmed',
    draftId: 'draft-confirmed',
    confirmedStep: 'create',
    confirmed: {
      ...base.confirmed,
      context,
      create: {
        promptPackageId: 'prompt-confirmed',
        draftId: 'draft-confirmed',
        draftWorkingVersion: 1,
        draftStorageUri: 'local://draft-confirmed',
        draftHash: 'b'.repeat(64),
      },
    },
  });
}

function createPresentedJob(
  overrides: Partial<RecentAssignmentItem> & Pick<RecentAssignmentItem, 'id'>,
): RecentAssignmentItem {
  const { id, ...rest } = overrides;
  return {
    id,
    kind: 'job',
    sourceJobId: null,
    learnerName: 'Cora',
    lessonTitle: undefined,
    recoveryAnchor: 'Guidance & assignment draft',
    activityLabel: 'Assignment published',
    outcomeLabel: 'Handout available',
    timeLabel: 'Today at 10:00 AM',
    state: 'published',
    statusLabel: 'Published',
    statusTone: 'success',
    actionLabel: 'Open assignment',
    destination: 'review',
    selected: false,
    ...rest,
  };
}

describe('buildRecentAssignmentItems', () => {
  it('keeps older timestamps compact enough for the fixed status rail', () => {
    const [item] = buildRecentAssignmentItems(
      [],
      [createJob({ updatedAt: '2026-07-10T10:00:00.000Z' })],
      '',
      new Map([['student-cora', 'Cora']]),
      'UTC',
    );

    expect(item?.timeLabel).toMatch(/^\d{2}\D\d{2}\D\d{2} · /);
    expect(item?.timeLabel.length).toBeLessThanOrEqual(20);
  });

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

  it.each([
    ['source', 'Step 2 · Lesson source'],
    ['context', 'Step 3 · Teaching context'],
    ['assignment', 'Step 4 · Create'],
    ['review', 'Step 5 · Review & share'],
  ] as const)('derives the %s recovery anchor from confirmed state', (destination, anchor) => {
    const [item] = buildRecentAssignmentItems(
      [createSessionAt(destination)],
      [],
      '',
      new Map([['student-cora', 'Cora']]),
    );

    expect(item).toMatchObject({ kind: 'session', sourceJobId: null, recoveryAnchor: anchor });
  });

  it.each([
    [{ promptPackageId: 'prompt-1', draftId: 'draft-1' }, 'Guidance & assignment draft'],
    [{ draftId: 'draft-1' }, 'Assignment draft'],
    [{ promptPackageId: 'prompt-1' }, 'Lesson guidance'],
    [{ transcriptId: 'transcript-1' }, 'Lesson source'],
    [{ recordingId: 'recording-1' }, 'Lesson source'],
    [{}, null],
  ] as const)('derives a job recovery anchor from existing artifact IDs', (overrides, anchor) => {
    const [item] = buildRecentAssignmentItems(
      [],
      [createJob(overrides)],
      '',
      new Map([['student-cora', 'Cora']]),
    );

    expect(item).toMatchObject({ kind: 'job', sourceJobId: null, recoveryAnchor: anchor });
  });

  it('collapses a loaded rerun chain into one newest-first lineage', () => {
    const items = [
      createPresentedJob({ id: 'job-3', sourceJobId: 'job-2' }),
      createPresentedJob({ id: 'job-2', sourceJobId: 'job-1' }),
      createPresentedJob({ id: 'job-1', sourceJobId: null }),
    ];

    const lineages = buildRecentAssignmentLineages(items);

    expect(lineages).toHaveLength(1);
    expect(lineages[0]?.latest.id).toBe('job-3');
    expect(lineages[0]?.olderVersions.map((item) => item.id)).toEqual(['job-2', 'job-1']);
  });

  it('keeps similar unlinked jobs separate', () => {
    const lineages = buildRecentAssignmentLineages([
      createPresentedJob({ id: 'job-2' }),
      createPresentedJob({ id: 'job-1' }),
    ]);

    expect(lineages.map((lineage) => lineage.latest.id)).toEqual(['job-2', 'job-1']);
  });

  it('groups loaded descendants but never invents an original when the source is missing', () => {
    const lineages = buildRecentAssignmentLineages([
      createPresentedJob({ id: 'job-3', sourceJobId: 'job-2' }),
      createPresentedJob({ id: 'job-2', sourceJobId: 'job-missing' }),
      createPresentedJob({ id: 'job-standalone', sourceJobId: 'another-missing-job' }),
    ]);

    expect(lineages).toHaveLength(2);
    expect(lineages[0]?.olderVersions.map((item) => item.id)).toEqual(['job-2']);
    expect(lineages[0]?.olderVersions[0]?.sourceJobId).toBe('job-missing');
    expect(lineages[1]?.latest.id).toBe('job-standalone');
  });
});
