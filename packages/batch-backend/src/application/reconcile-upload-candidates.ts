import {
  type ObsoleteUploadCandidate,
  isObsoleteUploadCandidateDeletable,
  listObsoleteUploadCandidates,
  recordObsoleteUploadCandidateCleanupResult,
} from '../domain/recording-upload-operation-repository.js';
import { createTranscriptionStorageForUri } from '../infrastructure/transcription-storage.js';

/**
 * Bounded, retryable deletion for retired immutable upload candidates. A failure
 * defers its durable obsolete row so newer work can progress before the next
 * worker startup/interval retry.
 */
export async function reconcileUploadCandidates(params?: {
  candidates?: {
    list: typeof listObsoleteUploadCandidates;
    deletable: typeof isObsoleteUploadCandidateDeletable;
    recordResult: typeof recordObsoleteUploadCandidateCleanupResult;
  };
  storageForUri?: typeof createTranscriptionStorageForUri;
  limit?: number;
}): Promise<number> {
  const candidates = params?.candidates ?? {
    list: listObsoleteUploadCandidates,
    deletable: isObsoleteUploadCandidateDeletable,
    recordResult: recordObsoleteUploadCandidateCleanupResult,
  };
  const storageForUri = params?.storageForUri ?? createTranscriptionStorageForUri;
  const uris = await candidates.list(params?.limit ?? 100);
  let deleted = 0;
  for (const candidate of uris) {
    if (!(await candidates.deletable(candidate))) continue;
    try {
      await storageForUri(candidate.uri).delete(candidate.uri);
      await candidates.recordResult({ candidate, deleted: true });
      deleted += 1;
    } catch {
      // The durable delay yields this failure to newer work before retrying it.
      await candidates.recordResult({ candidate, deleted: false });
    }
  }
  return deleted;
}
