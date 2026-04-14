import type { JobStatus } from '../../utils/api';
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
    return job.publishTarget === 'html' || job.htmlUrl ? 'Publish failed' : 'Processing failed';
  }
  if (job.publishTarget === 'anytype' && (job.anytypeUrl || job.htmlUrl)) {
    return 'Published to Anytype';
  }
  if (job.publishTarget === 'html' && job.htmlUrl) {
    return 'Published to HTML';
  }
  if (job.publishTarget === 'notion' && job.notionUrl) {
    return 'Published to Notion';
  }
  if (job.anytypeUrl || job.htmlUrl) {
    return 'Published';
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
    subtitle:
      job.state === 'failed'
        ? 'This assignment needs attention before you share or continue editing.'
        : job.state === 'queued' || job.state === 'running'
          ? 'This assignment is still processing. You can keep an eye on it here.'
          : 'Latest shared assignment ready to reopen, review, or republish.',
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
