import {
    getDraftById,
    updateDraft as updateDraftRepo,
} from '../domain/draft-repository.js';
import type { DraftResponse } from './create-draft.js';
import { toDraftResponse } from './create-draft.js';
import type { TranscriptionStorage } from '../infrastructure/transcription-storage.js';
import { createTranscriptionStorage } from '../infrastructure/transcription-storage.js';

export interface UpdateDraftParams {
    id: string;
    text: string;
}

export interface UpdateDraftDependencies {
    storage: TranscriptionStorage;
    drafts: {
        getById: typeof getDraftById;
        update: typeof updateDraftRepo;
    };
}

export async function updateDraft(
    params: UpdateDraftParams,
    overrides?: Partial<UpdateDraftDependencies>,
): Promise<DraftResponse | null> {
    const storage = overrides?.storage ?? createTranscriptionStorage();
    const drafts = overrides?.drafts ?? {
        getById: getDraftById,
        update: updateDraftRepo,
    };

    const draft = await drafts.getById(params.id);
    if (!draft) return null;

    // Optimistically assume we can overwrite the existing storage file
    // or create a new one. Since storage URI is derived or random, usually we just
    // write new content. If using content-based addressing, URI changes.
    // If using ID-based addressing, URI stays same.
    // The current storage implementation (putDraft) usually creates a new file.
    const stored = await storage.putDraft({
        draftId: params.id, // Reuse draft ID for storage key if supported
        text: params.text,
    });

    const updated = await drafts.update({
        id: params.id,
        storageUri: stored.uri,
    });

    if (!updated) return null;

    return toDraftResponse(updated, params.text);
}
