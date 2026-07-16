import type { AssignmentSessionStage, JobState } from '../../utils/api';
import type { AssignmentStepId } from '../assignments/assignment-workflow';

export type AssignmentEntryView = 'choice' | 'resume' | 'new' | 'summary';

export type RecentAssignmentState =
  | 'unfinished'
  | 'in-progress'
  | 'ready-to-share'
  | 'published'
  | 'needs-attention';

export interface RecentAssignmentItem {
  id: string;
  kind: 'session' | 'job';
  sourceJobId: string | null;
  learnerName: string;
  lessonTitle?: string;
  recoveryAnchor: string | null;
  activityLabel: string;
  outcomeLabel: string;
  timeLabel: string;
  state: RecentAssignmentState;
  statusLabel: string;
  statusTone: 'success' | 'progress' | 'warning' | 'neutral';
  actionLabel:
    | 'Continue assignment'
    | 'Review progress'
    | 'Review assignment'
    | 'Open assignment'
    | 'Review issue';
  destination: AssignmentStepId;
  selected: boolean;
}

export interface RecentAssignmentLineage {
  id: string;
  latest: RecentAssignmentItem;
  olderVersions: RecentAssignmentItem[];
}

type RecentAssignmentPresentation = Omit<
  RecentAssignmentItem,
  | 'id'
  | 'kind'
  | 'sourceJobId'
  | 'learnerName'
  | 'lessonTitle'
  | 'recoveryAnchor'
  | 'timeLabel'
  | 'selected'
>;

export function getJobRecentAssignmentPresentation(
  state: JobState,
  isPublished: boolean,
): RecentAssignmentPresentation {
  if (state === 'queued' || state === 'running') {
    return {
      state: 'in-progress',
      activityLabel: 'Assignment generation in progress',
      outcomeLabel: 'Work is processing',
      statusLabel: 'In progress',
      statusTone: 'progress',
      actionLabel: 'Review progress',
      destination: 'review',
    };
  }
  if (state === 'awaiting_approval' || (state === 'succeeded' && !isPublished)) {
    return {
      state: 'ready-to-share',
      activityLabel: 'Assignment ready for review',
      outcomeLabel: 'Ready to share',
      statusLabel: 'Ready to share',
      statusTone: 'success',
      actionLabel: 'Review assignment',
      destination: 'review',
    };
  }
  if (state === 'succeeded') {
    return {
      state: 'published',
      activityLabel: 'Assignment published',
      outcomeLabel: 'Handout available',
      statusLabel: 'Published',
      statusTone: 'success',
      actionLabel: 'Open assignment',
      destination: 'review',
    };
  }
  return {
    state: 'needs-attention',
    activityLabel: 'Assignment needs review',
    outcomeLabel: 'Generation did not finish',
    statusLabel: 'Needs attention',
    statusTone: 'warning',
    actionLabel: 'Review issue',
    destination: 'review',
  };
}

export function getSessionRecentAssignmentPresentation(
  stage: AssignmentSessionStage,
): RecentAssignmentPresentation {
  const activityLabel =
    stage === 'source'
      ? 'Lesson source in progress'
      : stage === 'context'
        ? 'Learner context in progress'
        : stage === 'assignment'
          ? 'Draft in progress'
          : 'Ready to preview or share';
  return {
    state: 'unfinished',
    activityLabel,
    outcomeLabel: 'Existing work is preserved',
    statusLabel: 'Unfinished',
    statusTone: 'progress',
    actionLabel: 'Continue assignment',
    destination: stage === 'assignment' ? 'create' : stage,
  };
}
