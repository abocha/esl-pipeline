import { z } from 'zod';

export type TranscriptMode = 'timeline' | 'stack';

export interface TranscriptRecord {
  id: string;
  recordingId: string;
  storageUri: string;
  rawResponseUri?: string | null;
  mode: TranscriptMode;
  model: string;
  language: string;
  fallbackUsed: boolean;
  summaryJson?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export const TranscriptModeSchema = z.enum(['timeline', 'stack']);
