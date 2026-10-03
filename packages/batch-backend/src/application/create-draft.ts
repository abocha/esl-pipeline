import { randomUUID } from 'node:crypto';

import { type AssignmentDraftDto, serializeAssignmentV1 } from '@esl-pipeline/contracts';

import type { DraftRecord } from '../domain/draft-model.js';
import { insertDraft } from '../domain/draft-repository.js';
import {
  getPromptPackageById,
  isPromptPackageSourceCanonical,
} from '../domain/prompt-package-repository.js';
import type { TranscriptionStorage } from '../infrastructure/transcription-storage.js';
import { createTranscriptionStorage } from '../infrastructure/transcription-storage.js';
import {
  admitAssignment,
  assignmentContext,
  draftArtifact,
  isStructuredPrompt,
} from './assignment-artifact.js';
import { PromptPackageAssignmentError } from './create-prompt-package.js';

export interface CreateDraftParams {
  promptPackageId: string;
  text: string;
  createdBy?: string | null;
}

export type DraftResponse = AssignmentDraftDto;
export interface CreateDraftDependencies {
  storage: TranscriptionStorage;
  promptPackages: {
    getById: typeof getPromptPackageById;
    isSourceCanonical: typeof isPromptPackageSourceCanonical;
  };
  drafts: {
    insert: typeof insertDraft;
  };
}

export async function createDraft(
  params: CreateDraftParams,
  overrides?: Partial<CreateDraftDependencies>,
): Promise<DraftResponse | null> {
  if (!params.promptPackageId || !params.text) return null;

  const storage = overrides?.storage ?? createTranscriptionStorage();
  const promptPackages = overrides?.promptPackages ?? {
    getById: getPromptPackageById,
    isSourceCanonical: isPromptPackageSourceCanonical,
  };
  const drafts = overrides?.drafts ?? {
    insert: insertDraft,
  };

  const promptPackage = await promptPackages.getById(params.promptPackageId);
  if (!promptPackage) return null;
  if (!(await promptPackages.isSourceCanonical(promptPackage.id))) {
    throw new PromptPackageAssignmentError(
      'PROMPT_PACKAGE_SOURCE_NOT_CANONICAL',
      'Assignment source is no longer canonical',
    );
  }

  const format = isStructuredPrompt(promptPackage) ? 'assignment_v1' : 'markdown';
  const context = format === 'assignment_v1' ? assignmentContext(promptPackage) : undefined;
  const assignment = context ? admitAssignment(params.text, context) : undefined;
  const text = assignment ? serializeAssignmentV1(assignment) : params.text;
  const draftId = randomUUID();
  const stored = await storage.putDraft({
    draftId,
    text,
    format,
  });

  const draft = await drafts.insert({
    id: draftId,
    promptPackageId: promptPackage.id,
    studentId: promptPackage.studentId ?? null,
    lessonId: promptPackage.lessonId ?? null,
    format,
    storageUri: stored.uri,
    workingVersion: 1,
    contentHash: stored.sha256,
    createdBy: params.createdBy ?? null,
  });

  return toDraftResponse(draft, text, context);
}

export function toDraftResponse(
  draft: DraftRecord,
  text: string,
  context?: import('@esl-pipeline/contracts').AssignmentValidationContext,
): DraftResponse {
  const assignment =
    draft.format === 'assignment_v1' ? admitAssignment(text, context ?? {}) : undefined;
  return {
    id: draft.id,
    promptPackageId: draft.promptPackageId,
    studentId: draft.studentId ?? null,
    lessonId: draft.lessonId ?? null,
    storageUri: draft.storageUri,
    workingVersion: draft.workingVersion,
    contentHash: draft.contentHash,
    createdBy: draft.createdBy ?? null,
    format: draft.format ?? 'markdown',
    ...(assignment
      ? {
          assignment,
          artifact: draftArtifact(draft),
          validationContext: context,
          text: JSON.stringify(assignment, null, 2),
        }
      : { text }),
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  };
}
