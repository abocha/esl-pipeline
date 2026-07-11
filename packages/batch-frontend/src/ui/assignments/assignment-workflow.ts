import type { AssignmentSessionStage } from '../../utils/api';

export type AssignmentStepId = 'student' | 'source' | 'context' | 'create' | 'review';
export type AssignmentStepStatus = 'complete' | 'current' | 'available' | 'locked';
export type AssignmentArtifact = 'transcript' | 'prompt' | 'draft' | 'preview' | 'publishedJob';
export type AssignmentInputChange =
  | 'student'
  | 'recording'
  | 'transcript'
  | 'teacherNotes'
  | 'draft';

export interface AssignmentWorkflowInput {
  selectedStudent: boolean;
  transcriptReady: boolean;
  promptReady: boolean;
  draftReady: boolean;
  previewReady: boolean;
  published: boolean;
}

export interface AssignmentWorkflowStep {
  id: AssignmentStepId;
  label: string;
  status: AssignmentStepStatus;
}

const STEP_DEFINITIONS: readonly Pick<AssignmentWorkflowStep, 'id' | 'label'>[] = [
  { id: 'student', label: 'Student' },
  { id: 'source', label: 'Lesson source' },
  { id: 'context', label: 'Teaching context' },
  { id: 'create', label: 'Create' },
  { id: 'review', label: 'Review & share' },
];

export function deriveAssignmentWorkflow(input: AssignmentWorkflowInput): AssignmentWorkflowStep[] {
  const completed = [
    input.selectedStudent,
    input.transcriptReady,
    input.promptReady,
    input.draftReady,
    false,
  ];
  const currentIndex = completed.findIndex((value) => !value);

  return STEP_DEFINITIONS.map((step, index) => ({
    ...step,
    status: index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'locked',
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

export function resolveInitialAssignmentStep(
  stage: AssignmentSessionStage,
  input: AssignmentWorkflowInput,
): AssignmentStepId {
  if (stage === 'source') return input.selectedStudent ? 'source' : 'student';
  if (stage === 'context') return 'context';
  if (stage === 'assignment') return 'create';
  return 'review';
}

export const mapSessionStageToStep = resolveInitialAssignmentStep;

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
