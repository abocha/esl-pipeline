import { getDraftById, updateDraftWorkingContent } from '../domain/draft-repository.js';
import type { TranscriptionStorage } from '../infrastructure/transcription-storage.js';
import { createTranscriptionStorage } from '../infrastructure/transcription-storage.js';
import type { DraftResponse } from './create-draft.js';
import { toDraftResponse } from './create-draft.js';

export interface UpdateDraftParams {
  id: string;
  text: string;
  expectedWorkingVersion: number;
}

export interface UpdateDraftDependencies {
  storage: TranscriptionStorage;
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

  const stored = await storage.putDraft({
    draftId: params.id,
    text: params.text,
  });

  const updated = await drafts.update({
    id: params.id,
    expectedWorkingVersion: params.expectedWorkingVersion,
    storageUri: stored.uri,
    contentHash: stored.sha256,
  });

  if (!updated) return null;

  return toDraftResponse(updated, params.text);
}
