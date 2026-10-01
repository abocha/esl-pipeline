import type { ArtifactWorkingContentDto } from '@esl-pipeline/contracts';

import type { AssignmentSession, ConfirmAssignmentSessionStepRequest } from '../../utils/api';

export type AssignmentWorkflowStep = 'student' | 'source' | 'context' | 'assignment' | 'review';

export interface AssignmentWorkingArtifacts {
  transcript?: ArtifactWorkingContentDto | null;
  draft?: ArtifactWorkingContentDto | null;
}

export interface AssignmentDirtyState {
  source: boolean;
  context: boolean;
  create: boolean;
}

export type ConfirmationSaveState =
  | { kind: 'idle' }
  | { kind: 'saving'; step: AssignmentSession['confirmedStep'] }
  | { kind: 'saved'; step: AssignmentSession['confirmedStep'] }
  | { kind: 'error'; step: AssignmentSession['confirmedStep']; message: string }
  | { kind: 'conflict'; step: AssignmentSession['confirmedStep']; message: string };

export interface AssignmentPersistenceSafety {
  recovery: 'saved' | 'pending' | 'failed';
  mutation: 'settled' | 'ambiguous';
}

export function deriveAssignmentDirtyState(
  session: AssignmentSession,
  artifacts: AssignmentWorkingArtifacts = {},
): AssignmentDirtyState {
  const source = session.confirmed.source;
  const context = session.confirmed.context;
  const create = session.confirmed.create;
  return {
    source:
      source === null
        ? Boolean(session.lessonId || session.recordingId || session.transcriptId)
        : session.lessonId !== source.lessonId ||
          session.recordingId !== source.recordingId ||
          session.transcriptId !== source.transcriptId ||
          artifactDiffers(artifacts.transcript, {
            workingVersion: source.transcriptWorkingVersion,
            contentHash: source.transcriptHash,
          }),
    context:
      context === null
        ? Boolean(
            normalizeText(session.teacherNotes) ||
              session.selectedProfileRevisionId ||
              session.selectedProfileRevisionHash,
          )
        : normalizeText(session.teacherNotes) !== normalizeText(context.teacherNotes) ||
          session.selectedProfileRevisionId !== context.profileRevisionId ||
          session.selectedProfileRevisionHash !== context.profileRevisionHash,
    create:
      create === null
        ? Boolean(session.promptPackageId || session.draftId)
        : session.promptPackageId !== create.promptPackageId ||
          session.draftId !== create.draftId ||
          artifactDiffers(artifacts.draft, {
            workingVersion: create.draftWorkingVersion,
            contentHash: create.draftHash,
          }),
  };
}

export function findResumeStep(
  session: AssignmentSession,
  artifacts: AssignmentWorkingArtifacts = {},
): Exclude<AssignmentWorkflowStep, 'student' | 'review'> | null {
  const dirty = deriveAssignmentDirtyState(session, artifacts);
  if (dirty.source) return 'source';
  if (dirty.context) return 'context';
  if (dirty.create) return 'assignment';
  return null;
}

export function deriveResumeDestination(
  session: AssignmentSession,
  artifacts: AssignmentWorkingArtifacts = {},
): AssignmentWorkflowStep | { jobId: string } {
  if (session.confirmedStep === 'share') {
    if (!session.shareJobId)
      throw new Error('Completed assignment session is missing its Share job');
    return { jobId: session.shareJobId };
  }
  const dirty = findResumeStep(session, artifacts);
  if (dirty) return dirty;
  switch (session.confirmedStep) {
    case 'student':
      return 'source';
    case 'source':
      return 'context';
    case 'context':
      return 'assignment';
    case 'create':
      return 'review';
    default:
      return assertNever(session.confirmedStep);
  }
}

export function canNavigateToStep(
  session: AssignmentSession,
  artifacts: AssignmentWorkingArtifacts,
  target: AssignmentWorkflowStep,
): boolean {
  if (session.confirmedStep === 'share') return false;
  const order: AssignmentWorkflowStep[] = ['student', 'source', 'context', 'assignment', 'review'];
  const targetIndex = order.indexOf(target);
  const dirty = findResumeStep(session, artifacts);
  const dirtyIndex = dirty ? order.indexOf(dirty) : Number.POSITIVE_INFINITY;
  const furthestIndex = order.indexOf(baseResumeStep(session));
  return targetIndex <= Math.min(dirtyIndex, furthestIndex);
}

export function canShareAssignment(
  session: AssignmentSession,
  artifacts: AssignmentWorkingArtifacts,
): { allowed: true } | { allowed: false; reason: string } {
  const dirty = deriveAssignmentDirtyState(session, artifacts);
  if (dirty.source) return { allowed: false, reason: 'Confirm Lesson source before sharing.' };
  if (dirty.context) return { allowed: false, reason: 'Confirm Teaching context before sharing.' };
  if (dirty.create || !session.confirmed.create || session.confirmedStep !== 'create') {
    return { allowed: false, reason: 'Confirm Create before sharing.' };
  }
  return { allowed: true };
}

export function shouldGuardAssignmentExit(safety: AssignmentPersistenceSafety): boolean {
  return safety.recovery !== 'saved' || safety.mutation === 'ambiguous';
}

export function shouldRefreshAssignmentData(input: {
  trigger: 'load' | 'focus' | 'mutation' | 'poll' | 'interval';
  asynchronous?: boolean;
}): boolean {
  if (input.trigger === 'load' || input.trigger === 'focus' || input.trigger === 'mutation') {
    return true;
  }
  return input.trigger === 'poll' && input.asynchronous === true;
}

export function getConflictResolutionDecision(input: {
  hasLocalDirty: boolean;
  overlapsRemote: boolean;
}): 'adopt-server' | 'rebase-once' | 'preserve-local-and-reconcile' {
  if (!input.hasLocalDirty) return 'adopt-server';
  return input.overlapsRemote ? 'preserve-local-and-reconcile' : 'rebase-once';
}

export function isAssignmentConfirmationApplied(
  session: AssignmentSession,
  request: ConfirmAssignmentSessionStepRequest,
): boolean {
  switch (request.step) {
    case 'source': {
      const source = session.confirmed.source;
      return Boolean(
        source &&
          source.lessonId === request.lessonId &&
          source.recordingId === request.recordingId &&
          source.transcriptId === request.transcriptId &&
          source.transcriptWorkingVersion === request.transcriptWorkingVersion,
      );
    }
    case 'context': {
      const context = session.confirmed.context;
      return Boolean(
        context &&
          normalizeText(context.teacherNotes) === normalizeText(request.teacherNotes) &&
          context.profileRevisionId === request.profileRevisionId &&
          context.profileRevisionHash === request.profileRevisionHash,
      );
    }
    case 'create': {
      const create = session.confirmed.create;
      return Boolean(
        create &&
          create.promptPackageId === request.promptPackageId &&
          create.draftId === request.draftId &&
          create.draftWorkingVersion === request.draftWorkingVersion,
      );
    }
    default:
      return assertNever(request);
  }
}

function baseResumeStep(session: AssignmentSession): AssignmentWorkflowStep {
  switch (session.confirmedStep) {
    case 'student':
      return 'source';
    case 'source':
      return 'context';
    case 'context':
      return 'assignment';
    case 'create':
      return 'review';
    case 'share':
      return 'review';
    default:
      return assertNever(session.confirmedStep);
  }
}

function artifactDiffers(
  working: ArtifactWorkingContentDto | null | undefined,
  confirmed: ArtifactWorkingContentDto,
): boolean {
  return working
    ? working.workingVersion !== confirmed.workingVersion ||
        working.contentHash !== confirmed.contentHash
    : false;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function assertNever(value: never): never {
  throw new Error(`Unsupported confirmed assignment step: ${String(value)}`);
}
