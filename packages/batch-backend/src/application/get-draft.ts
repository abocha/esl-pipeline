import { getDraftById } from '../domain/draft-repository.js';
import type { TranscriptionStorage } from '../infrastructure/transcription-storage.js';
import { createTranscriptionStorageForUri } from '../infrastructure/transcription-storage.js';
import { type DraftResponse, toDraftResponse } from './create-draft.js';

export interface GetDraftDependencies {
  storage: TranscriptionStorage;
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
  const text = await storage.getText(draft.storageUri);
  return toDraftResponse(draft, text);
}
