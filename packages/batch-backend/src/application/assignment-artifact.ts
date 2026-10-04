import { createHash } from 'node:crypto';

import {
  type AssignmentArtifactReference,
  AssignmentArtifactReferenceSchema,
  type AssignmentValidationContext,
  parseAssignmentV1,
  serializeAssignmentV1,
} from '@esl-pipeline/contracts';

import type { DraftRecord } from '../domain/draft-model.js';
import type { PromptPackageRecord } from '../domain/prompt-package-model.js';
import { getPromptPackageById } from '../domain/prompt-package-repository.js';
import {
  createTranscriptionStorageForUri,
  type TranscriptionStorage,
} from '../infrastructure/transcription-storage.js';
import { isGenerationRequestEnvelope } from './generation-request-envelope.js';

export class AssignmentArtifactValidationError extends Error {
  readonly code = 'assignment_validation_failed';
}

export function assignmentContext(
  prompt: Pick<PromptPackageRecord, 'requestEnvelope'>,
): AssignmentValidationContext {
  const envelope = prompt.requestEnvelope;
  if (
    !isGenerationRequestEnvelope(envelope) ||
    envelope.promptVersion !== 'assignment_v1' ||
    !envelope.assignmentContext
  ) {
    throw new AssignmentArtifactValidationError(
      'Structured assignment requires its pinned AssignmentV1 prompt context',
    );
  }
  return envelope.assignmentContext;
}

export function isStructuredPrompt(prompt: Pick<PromptPackageRecord, 'requestEnvelope'>): boolean {
  return (
    isGenerationRequestEnvelope(prompt.requestEnvelope) &&
    prompt.requestEnvelope.promptVersion === 'assignment_v1'
  );
}

export function admitAssignment(text: string, context: AssignmentValidationContext) {
  try {
    return parseAssignmentV1(text, context);
  } catch (error) {
    throw new AssignmentArtifactValidationError(
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function assignmentHash(assignment: ReturnType<typeof parseAssignmentV1>): string {
  return createHash('sha256').update(serializeAssignmentV1(assignment), 'utf8').digest('hex');
}

export function draftArtifact(draft: DraftRecord): AssignmentArtifactReference | undefined {
  if (draft.format !== 'assignment_v1') return undefined;
  if (!draft.contentHash || !draft.workingVersion)
    throw new Error('Incomplete structured draft identity');
  return {
    format: 'assignment_v1',
    schemaVersion: 1,
    serializationVersion: 1,
    workingVersion: draft.workingVersion,
    storageUri: draft.storageUri,
    contentHash: draft.contentHash,
  };
}

/** Always read the frozen reference, never the mutable draft pointer. */
export async function readAssignmentArtifact(
  reference: AssignmentArtifactReference,
  promptPackageId: string,
  storage?: TranscriptionStorage,
) {
  const prompt = await getPromptPackageById(promptPackageId);
  if (!prompt) throw new Error('Structured assignment prompt context not found');
  return readValidatedAssignment(reference, assignmentContext(prompt), storage);
}

export async function readValidatedAssignment(
  reference: AssignmentArtifactReference,
  context: AssignmentValidationContext,
  storage?: TranscriptionStorage,
) {
  AssignmentArtifactReferenceSchema.parse(reference);
  const text = await (storage ?? createTranscriptionStorageForUri(reference.storageUri)).getText(
    reference.storageUri,
  );
  const assignment = admitAssignment(text, context);
  if (assignmentHash(assignment) !== reference.contentHash)
    throw new Error('Assignment artifact content hash mismatch');
  if (!reference.storageUri.endsWith(`/content/${reference.contentHash}.json`))
    throw new Error('Assignment artifact storage identity mismatch');
  return assignment;
}
