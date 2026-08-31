import { z } from 'zod';

import type { AudioInputTopology, RecordingSourceId } from '@esl-pipeline/contracts';

export type RecordingSource = RecordingSourceId;
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
  audioTopology?: AudioInputTopology | null;
  status: RecordingStatus;
  error?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const RecordingSourceSchema = z.enum(['upload', 'manual_transcript']);
export const RecordingStatusSchema = z.enum([
  'ingested',
  'queued',
  'transcribing',
  'transcribed',
  'failed',
]);
export const AudioInputTopologySchema = z.enum(['mixed_recording', 'trusted_split_channels']);
