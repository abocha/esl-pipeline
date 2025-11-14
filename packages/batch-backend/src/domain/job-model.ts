// packages/batch-backend/src/domain/job-model.ts

// Minimal job domain model for the batch-backend.
// Keeps semantics simple and mirrors the `jobs` table schema used in db.ts.

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed';
// JobState.declaration()

export interface JobRecord {
  id: string;
  state: JobState;
  md: string;
  preset?: string | null;
  withTts?: boolean | null;
  upload?: string | null;
  voiceAccent?: string | null;
  forceTts?: boolean | null;
  notionDatabase?: string | null;
  mode?: string | null;
  notionUrl?: string | null;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  error?: string | null;
  manifestPath?: string | null;
}
// JobRecord.declaration()

// canTransition.declaration()
export function canTransition(from: JobState, to: JobState): boolean {
  if (from === to) return true;

  switch (from) {
    case 'queued':
      // queued -> running or directly failed (if unrecoverable before start)
      return to === 'running' || to === 'failed';
    case 'running':
      // running -> succeeded/failed
      return to === 'succeeded' || to === 'failed';
    case 'succeeded':
    case 'failed':
      return false;
    default:
      return false;
  }
}

export function assertTransition(from: JobState, to: JobState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid job state transition: ${from} -> ${to}`);
  }
}
