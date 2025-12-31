import { z } from 'zod';

export type RecordingSource = 'scan' | 'upload';
export type RecordingStatus = 'ingested' | 'queued' | 'transcribing' | 'transcribed' | 'failed';

export interface RecordingRecord {
  id: string;
  source: RecordingSource;
  studentId?: string | null;
  sourcePath?: string | null;
  storageUri: string;
  sha256?: string | null;
  bytes: number;
  durationSec?: number | null;
  channels?: number | null;
  status: RecordingStatus;
  error?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const RecordingSourceSchema = z.enum(['scan', 'upload']);
export const RecordingStatusSchema = z.enum([
  'ingested',
  'queued',
  'transcribing',
  'transcribed',
  'failed',
]);
