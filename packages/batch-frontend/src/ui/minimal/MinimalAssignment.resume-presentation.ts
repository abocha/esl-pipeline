import type { AssignmentSession, JobStatus } from '../../utils/api';
import {
  getJobRecentAssignmentPresentation,
  getSessionRecentAssignmentPresentation,
  type RecentAssignmentItem,
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
  return timestamp.toLocaleString([], {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
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

export function buildRecentAssignmentItems(
  sessions: readonly AssignmentSession[],
  jobs: readonly JobStatus[],
  selectedResumeJobId: string,
  studentNameById: ReadonlyMap<string, string>,
): RecentAssignmentItem[] {
  const sessionItems = sessions.map((session) => ({
    item: {
      id: `session:${session.id}`,
      learnerName: buildSessionLearnerName(session, studentNameById),
      lessonTitle: undefined,
      ...getSessionRecentAssignmentPresentation(session.currentStage),
      timeLabel: formatResumeTimeLabel(session.updatedAt),
      selected: selectedResumeJobId === `session:${session.id}`,
    },
    timestamp: Date.parse(session.updatedAt),
  }));
  const jobItems = jobs.map((job) => ({
    item: {
      id: job.jobId,
      learnerName: buildResumeLearnerName(job, studentNameById),
      lessonTitle: undefined,
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
