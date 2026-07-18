import type { AssignmentSession, JobStatus } from '../../utils/api';
import { deriveResumeDestination } from './MinimalAssignment.confirmation';
import {
  getJobRecentAssignmentPresentation,
  getSessionRecentAssignmentPresentation,
  type RecentAssignmentItem,
  type RecentAssignmentLineage,
} from './MinimalAssignment.entry-state';
import type { CurrentAssignmentCard } from './MinimalAssignment.stages';

function formatResumeTimeLabel(value: string): string {
  const timestamp = new Date(value);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTarget = new Date(
    timestamp.getFullYear(),
    timestamp.getMonth(),
    timestamp.getDate(),
  );
  const dayDiff = Math.round(
    (startOfToday.getTime() - startOfTarget.getTime()) / (24 * 60 * 60 * 1000),
  );
  const timeLabel = timestamp.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (dayDiff === 0) {
    return `Today at ${timeLabel}`;
  }
  if (dayDiff === 1) {
    return `Yesterday at ${timeLabel}`;
  }
  const dateLabel = timestamp.toLocaleDateString([], {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
  return `${dateLabel} · ${timeLabel}`;
}

function getResumeStatusPresentation(
  state: JobStatus['state'],
): Pick<CurrentAssignmentCard, 'statusLabel' | 'statusTone'> {
  if (state === 'succeeded') {
    return { statusLabel: 'Ready', statusTone: 'success' };
  }
  if (state === 'failed') {
    return { statusLabel: 'Needs attention', statusTone: 'warning' };
  }
  if (state === 'awaiting_approval') {
    return { statusLabel: 'Awaiting approval', statusTone: 'neutral' };
  }
  return { statusLabel: 'In progress', statusTone: 'progress' };
}

function getPublishSurfaceLabel(job: JobStatus): string {
  if (job.state === 'failed') {
    return job.htmlUrl ? 'Publish failed' : 'Processing failed';
  }
  if (job.htmlUrl) {
    return 'Assignment Handout';
  }
  return 'Not published yet';
}

function buildResumeLearnerName(
  job: JobStatus,
  studentNameById: ReadonlyMap<string, string>,
): string {
  return job.studentId
    ? (studentNameById.get(job.studentId) ?? 'Saved assignment')
    : 'Saved assignment';
}

function buildSessionLearnerName(
  session: AssignmentSession,
  studentNameById: ReadonlyMap<string, string>,
): string {
  return session.studentId
    ? (studentNameById.get(session.studentId) ?? 'Unfinished assignment')
    : 'Unfinished assignment';
}

const SESSION_RECOVERY_ANCHORS = {
  student: 'Step 1 · Student',
  source: 'Step 2 · Lesson source',
  context: 'Step 3 · Teaching context',
  assignment: 'Step 4 · Create',
  review: 'Step 5 · Review & share',
} as const;

function getJobRecoveryAnchor(job: JobStatus): string | null {
  if (job.promptPackageId && job.draftId) return 'Guidance & assignment draft';
  if (job.draftId) return 'Assignment draft';
  if (job.promptPackageId) return 'Lesson guidance';
  if (job.transcriptId || job.recordingId) return 'Lesson source';
  return null;
}

export function buildRecentAssignmentItems(
  sessions: readonly AssignmentSession[],
  jobs: readonly JobStatus[],
  selectedResumeJobId: string,
  studentNameById: ReadonlyMap<string, string>,
): RecentAssignmentItem[] {
  const sessionItems = sessions.map((session) => {
    const destination = deriveResumeDestination(session);
    if (typeof destination !== 'string') {
      throw new Error('Completed Share sessions must be presented through their linked job');
    }
    return {
      item: {
        id: `session:${session.id}`,
        kind: 'session' as const,
        sourceJobId: null,
        learnerName: buildSessionLearnerName(session, studentNameById),
        lessonTitle: undefined,
        recoveryAnchor: SESSION_RECOVERY_ANCHORS[destination],
        ...getSessionRecentAssignmentPresentation(session),
        timeLabel: formatResumeTimeLabel(session.updatedAt),
        selected: selectedResumeJobId === `session:${session.id}`,
      },
      timestamp: Date.parse(session.updatedAt),
    };
  });
  const jobItems = jobs.map((job) => ({
    item: {
      id: job.jobId,
      kind: 'job' as const,
      sourceJobId: job.sourceJobId ?? null,
      learnerName: buildResumeLearnerName(job, studentNameById),
      lessonTitle: undefined,
      recoveryAnchor: getJobRecoveryAnchor(job),
      ...getJobRecentAssignmentPresentation(job.state, Boolean(job.htmlUrl)),
      timeLabel: formatResumeTimeLabel(job.finishedAt ?? job.updatedAt ?? job.createdAt),
      selected: job.jobId === selectedResumeJobId,
    },
    timestamp: Date.parse(job.finishedAt ?? job.updatedAt ?? job.createdAt),
  }));
  return [...sessionItems, ...jobItems]
    .sort((left, right) => right.timestamp - left.timestamp)
    .map(({ item }) => item);
}

export function buildRecentAssignmentLineages(
  items: readonly RecentAssignmentItem[],
): RecentAssignmentLineage[] {
  const jobsById = new Map(
    items.filter((item) => item.kind === 'job').map((item) => [item.id, item]),
  );
  const groups = new Map<string, RecentAssignmentItem[]>();

  for (const item of items) {
    let key = item.id;
    if (item.kind === 'job') {
      const visited = new Set<string>([item.id]);
      let cursor = item;
      while (
        cursor.sourceJobId &&
        jobsById.has(cursor.sourceJobId) &&
        !visited.has(cursor.sourceJobId)
      ) {
        key = cursor.sourceJobId;
        visited.add(cursor.sourceJobId);
        cursor = jobsById.get(cursor.sourceJobId)!;
      }
    }

    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  return [...groups.values()].flatMap((group) => {
    const referencedIds = new Set(
      group.flatMap((item) => (item.sourceJobId ? [item.sourceJobId] : [])),
    );
    const latest = group.find((item) => !referencedIds.has(item.id)) ?? group[0];
    if (!latest) return [];

    const byId = new Map(group.map((item) => [item.id, item]));
    const olderVersions: RecentAssignmentItem[] = [];
    const used = new Set([latest.id]);
    let sourceJobId = latest.sourceJobId;
    while (sourceJobId && byId.has(sourceJobId) && !used.has(sourceJobId)) {
      const version = byId.get(sourceJobId)!;
      olderVersions.push(version);
      used.add(version.id);
      sourceJobId = version.sourceJobId;
    }
    olderVersions.push(...group.filter((item) => !used.has(item.id)));
    return [{ id: latest.id, latest, olderVersions }];
  });
}

export function buildCurrentAssignmentCard(
  job: JobStatus | null,
  studentNameById: ReadonlyMap<string, string>,
): CurrentAssignmentCard | null {
  if (!job?.jobId) {
    return null;
  }
  const status = getResumeStatusPresentation(job.state);
  return {
    title: buildResumeLearnerName(job, studentNameById),
    statusLabel: status.statusLabel,
    statusTone: status.statusTone,
    meta: [
      formatResumeTimeLabel(job.finishedAt ?? job.updatedAt ?? job.createdAt),
      getPublishSurfaceLabel(job),
      ...(job.sourceJobId ? ['Audio refresh'] : []),
    ],
    supportLabel: `ID ${job.jobId.slice(0, 8)}`,
  };
}
