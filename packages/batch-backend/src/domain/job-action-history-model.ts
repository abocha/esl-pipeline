import type { JobActionType } from '@esl-pipeline/contracts';

export type JobActionOutcome = 'succeeded' | 'failed';

export interface JobActionHistoryRecord {
  id: string;
  jobId: string;
  actionType: JobActionType;
  payload: Record<string, unknown> | null;
  requestedAt: Date;
  requestedBy: string | null;
  outcome: JobActionOutcome;
  message: string;
  errorCode: string | null;
  createdJobId: string | null;
  createdAt: Date;
}

export interface InsertJobActionHistoryParams {
  jobId: string;
  actionType: JobActionType;
  payload?: Record<string, unknown> | null;
  requestedAt: Date;
  requestedBy?: string | null;
  outcome: JobActionOutcome;
  message: string;
  errorCode?: string | null;
  createdJobId?: string | null;
}
