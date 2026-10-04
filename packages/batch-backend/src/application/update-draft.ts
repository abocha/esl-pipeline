import { serializeAssignmentV1 } from '@esl-pipeline/contracts';

import { getDraftById, updateDraftWorkingContent } from '../domain/draft-repository.js';
import {
  getPromptPackageById,
  isPromptPackageSourceCanonical,
} from '../domain/prompt-package-repository.js';
import type { TranscriptionStorage } from '../infrastructure/transcription-storage.js';
import { createTranscriptionStorage } from '../infrastructure/transcription-storage.js';
import { admitAssignment, assignmentContext } from './assignment-artifact.js';
import type { DraftResponse } from './create-draft.js';
import { toDraftResponse } from './create-draft.js';
import { PromptPackageAssignmentError } from './create-prompt-package.js';
import { requireTypedAssignment } from './historical-assignment.js';

export interface UpdateDraftParams {
  id: string;
  text: string;
  expectedWorkingVersion: number;
}

export interface UpdateDraftDependencies {
  storage: TranscriptionStorage;
  promptPackages: {
    getById: typeof getPromptPackageById;
    isSourceCanonical: typeof isPromptPackageSourceCanonical;
  };
  drafts: {
    getById: typeof getDraftById;
    update: typeof updateDraftWorkingContent;
  };
}

export async function updateDraft(
  params: UpdateDraftParams,
  overrides?: Partial<UpdateDraftDependencies>,
): Promise<DraftResponse | null> {
  const storage = overrides?.storage ?? createTranscriptionStorage();
  const drafts = overrides?.drafts ?? {
    getById: getDraftById,
    update: updateDraftWorkingContent,
  };

  const draft = await drafts.getById(params.id);
  if (!draft) return null;
  requireTypedAssignment(draft.format === 'assignment_v1');

  let text = params.text;
  let context;
  if (draft.format === 'assignment_v1') {
    const prompts = overrides?.promptPackages ?? {
      getById: getPromptPackageById,
      isSourceCanonical: isPromptPackageSourceCanonical,
    };
    const prompt = await prompts.getById(draft.promptPackageId);
    if (!prompt) return null;
    if (!(await prompts.isSourceCanonical(prompt.id)))
      throw new PromptPackageAssignmentError(
        'PROMPT_PACKAGE_SOURCE_NOT_CANONICAL',
        'Assignment source is no longer canonical',
      );
    context = assignmentContext(prompt);
    text = serializeAssignmentV1(admitAssignment(text, context));
  }
  const stored = await storage.putDraft({
    draftId: params.id,
    text,
    format: draft.format,
  });

  const updated = await drafts.update({
    id: params.id,
    expectedWorkingVersion: params.expectedWorkingVersion,
    storageUri: stored.uri,
    contentHash: stored.sha256,
  });

  if (!updated) return null;

  return toDraftResponse(updated, text, context);
}
