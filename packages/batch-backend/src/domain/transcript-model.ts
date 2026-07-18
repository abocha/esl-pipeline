import { z } from 'zod';

import type { TranscriptProviderId } from '@esl-pipeline/contracts';

export type TranscriptMode = 'timeline' | 'stack';

export interface TranscriptRecord {
  id: string;
  recordingId: string;
  storageUri: string;
  workingVersion: number | null;
  contentHash: string | null;
  rawResponseUri?: string | null;
  mode: TranscriptMode;
  model: string;
  language: string;
  sttProvider: TranscriptProviderId;
  fallbackUsed: boolean;
  summaryJson?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export const TranscriptModeSchema = z.enum(['timeline', 'stack']);
