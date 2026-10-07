import type { AssignmentSession } from '../../utils/api';
import {
  type AssignmentWorkingArtifacts,
  findResumeStep,
} from '../minimal/MinimalAssignment.confirmation';

export type AssignmentStepId = 'student' | 'source' | 'context' | 'assignment' | 'review';
export type AssignmentStepStatus = 'complete' | 'current' | 'available' | 'locked' | 'skipped';
export type AssignmentArtifact = 'transcript' | 'prompt' | 'draft' | 'preview' | 'publishedJob';
export type AssignmentInputChange =
  | 'student'
  | 'recording'
  | 'transcript'
  | 'teacherNotes'
  | 'draft';

export interface AssignmentWorkflowStep {
  id: AssignmentStepId;
  label: string;
  status: AssignmentStepStatus;
}

const STEP_DEFINITIONS: readonly Pick<AssignmentWorkflowStep, 'id' | 'label'>[] = [
  { id: 'student', label: 'Student' },
  { id: 'source', label: 'Lesson source' },
  { id: 'context', label: 'Teaching context' },
  { id: 'assignment', label: 'Create' },
  { id: 'review', label: 'Review & share' },
];

export function deriveAssignmentWorkflow(
  session: AssignmentSession | null,
  artifacts: AssignmentWorkingArtifacts = {},
): AssignmentWorkflowStep[] {
  if (!session) return mapStatuses(0, -1);
  if (session.homeworkIntent === 'none') {
    const completed = Boolean(session.transcriptCompletedAt);
    return STEP_DEFINITIONS.map((step) => ({
      ...step,
      label: step.id === 'review' ? 'Review & finish' : step.label,
      status:
        step.id === 'context' || step.id === 'assignment'
          ? 'skipped'
          : step.id === 'student' || completed
            ? 'complete'
            : step.id === 'source'
              ? 'current'
              : 'locked',
    }));
  }
  if (session.confirmedStep === 'share') return mapStatuses(-1, STEP_DEFINITIONS.length - 1);

  const dirtyStep = findResumeStep(session, artifacts);
  const current = dirtyStep ?? baseDestination(session.confirmedStep);
  const currentIndex = STEP_DEFINITIONS.findIndex((step) => step.id === current);
  return mapStatuses(currentIndex, currentIndex - 1);
}

export function deriveHistoricalAssignmentOutputWorkflow(): AssignmentWorkflowStep[] {
  return STEP_DEFINITIONS.map((step) => ({
    ...step,
    status: step.id === 'review' ? 'current' : 'locked',
  }));
}

export function getInvalidatedArtifacts(change: AssignmentInputChange): AssignmentArtifact[] {
  if (change === 'student' || change === 'recording') {
    return ['transcript', 'prompt', 'draft', 'preview', 'publishedJob'];
  }
  if (change === 'transcript' || change === 'teacherNotes') {
    return ['prompt', 'draft', 'preview', 'publishedJob'];
  }
  return ['preview', 'publishedJob'];
}

export interface TeacherNotesCommitInput {
  currentNotes: string;
  committedNotes: string;
  hasDownstreamAssignment: boolean;
}

export function getTeacherNotesCommitDecision({
  currentNotes,
  committedNotes,
  hasDownstreamAssignment,
}: TeacherNotesCommitInput): 'unchanged' | 'commit' | 'confirm-and-invalidate' {
  if (currentNotes.trim() === committedNotes.trim()) return 'unchanged';
  return hasDownstreamAssignment ? 'confirm-and-invalidate' : 'commit';
}

function mapStatuses(currentIndex: number, completedThrough: number): AssignmentWorkflowStep[] {
  return STEP_DEFINITIONS.map((step, index) => ({
    ...step,
    status:
      index <= completedThrough
        ? 'complete'
        : index === currentIndex
          ? 'current'
          : currentIndex === -1
            ? 'complete'
            : 'locked',
  }));
}

function baseDestination(
  confirmedStep: Exclude<AssignmentSession['confirmedStep'], 'share'>,
): AssignmentStepId {
  switch (confirmedStep) {
    case 'student':
      return 'source';
    case 'source':
      return 'context';
    case 'context':
      return 'assignment';
    case 'create':
      return 'review';
    default:
      return assertNever(confirmedStep);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported confirmed assignment step: ${String(value)}`);
}
