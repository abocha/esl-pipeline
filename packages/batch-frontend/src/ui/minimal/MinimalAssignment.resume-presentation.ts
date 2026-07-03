import type { AssignmentSession, JobStatus } from '../../utils/api';
import type { CurrentAssignmentCard, ResumeJobListItem } from './MinimalAssignment.stages';

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
): Pick<ResumeJobListItem, 'statusLabel' | 'statusTone'> {
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

function buildResumeStudentLabel(
  job: JobStatus,
  studentNameById: ReadonlyMap<string, string>,
): string {
  const baseName = job.studentId
    ? (studentNameById.get(job.studentId) ?? `Student ${job.studentId.slice(0, 8)}`)
    : 'Saved assignment';
  if (job.sourceJobId && job.withTts) {
    return `${baseName} (Audio refresh)`;
  }
  return baseName;
}

function getAssignmentSessionStageLabel(stage: AssignmentSession['currentStage']): string {
  if (stage === 'source') return 'Lesson source in progress';
  if (stage === 'context') return 'Learner context in progress';
  if (stage === 'assignment') return 'Draft in progress';
  return 'Ready to preview or share';
}

function buildSessionStudentLabel(
  session: AssignmentSession,
  studentNameById: ReadonlyMap<string, string>,
): string {
  return session.studentId
    ? (studentNameById.get(session.studentId) ?? `Student ${session.studentId.slice(0, 8)}`)
    : 'Unfinished assignment';
}

export function buildResumeJobItems(
  jobs: readonly JobStatus[],
  selectedResumeJobId: string,
  studentNameById: ReadonlyMap<string, string>,
): ResumeJobListItem[] {
  return jobs.map((job) => {
    const status = getResumeStatusPresentation(job.state);
    return {
      jobId: job.jobId,
      title: buildResumeStudentLabel(job, studentNameById),
      subtitle: job.sourceJobId ? 'Audio refresh' : 'Saved assignment',
      statusLabel: status.statusLabel,
      statusTone: status.statusTone,
      timeLabel: formatResumeTimeLabel(job.finishedAt ?? job.updatedAt ?? job.createdAt),
      publishLabel: getPublishSurfaceLabel(job),
      supportLabel: `ID ${job.jobId.slice(0, 8)}`,
      selected: job.jobId === selectedResumeJobId,
    };
  });
}

export function buildRecentAssignmentItems(
  sessions: readonly AssignmentSession[],
  jobs: readonly JobStatus[],
  selectedResumeJobId: string,
  studentNameById: ReadonlyMap<string, string>,
): ResumeJobListItem[] {
  const sessionItems = sessions.map((session) => ({
    item: {
      jobId: `session:${session.id}`,
      title: buildSessionStudentLabel(session, studentNameById),
      subtitle: getAssignmentSessionStageLabel(session.currentStage),
      statusLabel: 'Unfinished',
      statusTone: 'progress' as const,
      timeLabel: formatResumeTimeLabel(session.updatedAt),
      publishLabel: 'Not published yet',
      supportLabel: `Session ${session.id.slice(0, 8)}`,
      selected: selectedResumeJobId === `session:${session.id}`,
    },
    timestamp: Date.parse(session.updatedAt),
  }));
  const jobItems = buildResumeJobItems(jobs, selectedResumeJobId, studentNameById).map(
    (item, index) => ({
      item,
      timestamp: Date.parse(
        jobs[index]?.finishedAt ?? jobs[index]?.updatedAt ?? jobs[index]?.createdAt ?? '',
      ),
    }),
  );
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
    title: buildResumeStudentLabel(job, studentNameById),
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
