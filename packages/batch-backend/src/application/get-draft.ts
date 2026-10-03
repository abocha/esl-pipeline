import { serializeAssignmentV1 } from '@esl-pipeline/contracts';

import { getDraftById } from '../domain/draft-repository.js';
import { getPromptPackageById } from '../domain/prompt-package-repository.js';
import type { TranscriptionStorage } from '../infrastructure/transcription-storage.js';
import { createTranscriptionStorageForUri } from '../infrastructure/transcription-storage.js';
import {
  assignmentContext,
  draftArtifact,
  readValidatedAssignment,
} from './assignment-artifact.js';
import { type DraftResponse, toDraftResponse } from './create-draft.js';

export interface GetDraftDependencies {
  storage: TranscriptionStorage;
  promptPackages: { getById: typeof getPromptPackageById };
  drafts: {
    getById: typeof getDraftById;
  };
}

export async function getDraft(
  draftId: string,
  overrides?: Partial<GetDraftDependencies>,
): Promise<DraftResponse | null> {
  if (!draftId) return null;
  const drafts = overrides?.drafts ?? { getById: getDraftById };
  const draft = await drafts.getById(draftId);
  if (!draft) return null;
  const storage = overrides?.storage ?? createTranscriptionStorageForUri(draft.storageUri);
  const reference = draftArtifact(draft);
  if (reference) {
    const prompt = await (overrides?.promptPackages?.getById ?? getPromptPackageById)(
      draft.promptPackageId,
    );
    if (!prompt) throw new Error('Structured draft prompt not found');
    const context = assignmentContext(prompt);
    const assignment = await readValidatedAssignment(reference, context, storage);
    return toDraftResponse(draft, serializeAssignmentV1(assignment), context);
  }
  const text = await storage.getText(draft.storageUri);
  return toDraftResponse(draft, text);
}
