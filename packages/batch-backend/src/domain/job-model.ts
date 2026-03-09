// packages/batch-backend/src/domain/job-model.ts
// Minimal job domain model for the batch-backend.
// Keeps semantics simple and mirrors the `jobs` table schema used in db.ts.
import type {
  GoogleTtsModel,
  JobState,
  JobUploadOption,
  PublishTarget,
  TtsProviderId,
  TtsStrategy,
} from '@esl-pipeline/contracts';

export interface JobRecord {
  id: string;
  studentId?: string | null;
  state: JobState;
  md: string | null;
  mdStorageUri?: string | null;
  recordingId?: string | null;
  transcriptId?: string | null;
  promptPackageId?: string | null;
  draftId?: string | null;
  preset?: string | null;
  learningPresetId?: string | null;
  learningPresetVersion?: string | null;
  promptSnapshotVersion?: string | null;
  promptAlias?: string | null;
  withTts?: boolean | null;
  upload?: JobUploadOption | null;
  voiceId?: string | null;
  voiceAccent?: string | null;
  forceTts?: boolean | null;
  notionDatabase?: string | null;
  publishTarget?: PublishTarget | null;
  ttsStrategy?: TtsStrategy | null;
  ttsProvider?: TtsProviderId | null;
  googleTtsModel?: GoogleTtsModel | null;
  notionUrl?: string | null;
  anytypeUrl?: string | null;
  htmlUrl?: string | null;
  autoPublish?: boolean | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  error?: string | null;
  manifestPath?: string | null;
  userId?: string | null;
  sourceJobId?: string | null;
}
// JobRecord.declaration()

// canTransition.declaration()
export function canTransition(from: JobState, to: JobState): boolean {
  if (from === to) return true;

  switch (from) {
    case 'queued': {
      // queued -> running or directly failed (if unrecoverable before start)
      return to === 'running' || to === 'failed';
    }
    case 'running': {
      // running -> awaiting_approval/succeeded/failed
      return to === 'awaiting_approval' || to === 'succeeded' || to === 'failed';
    }
    case 'awaiting_approval': {
      // awaiting_approval -> queued (approval) or failed (cancel/error)
      return to === 'queued' || to === 'failed';
    }
    case 'succeeded':
    case 'failed': {
      return false;
    }
    default: {
      return false;
    }
  }
}

export function assertTransition(from: JobState, to: JobState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid job state transition: ${from} -> ${to}`);
  }
}

export {
  type JobState,
  type JobUploadOption,
  type PublishTarget,
  type TtsProviderId,
  type GoogleTtsModel,
  type TtsStrategy,
} from '@esl-pipeline/contracts';
