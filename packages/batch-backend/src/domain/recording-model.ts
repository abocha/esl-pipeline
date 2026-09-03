import { z } from 'zod';

import type { AudioInputTopology, RecordingSourceId } from '@esl-pipeline/contracts';

export type RecordingSource = RecordingSourceId;
export type RecordingStatus = 'ingested' | 'queued' | 'transcribing' | 'transcribed' | 'failed';
export type AudioLifecycle =
  | 'not_retained'
  | 'retained'
  | 'pending'
  | 'deleting'
  | 'deleted'
  | 'delete_failed';

export interface RecordingRecord {
  id: string;
  workspaceId: string;
  source: RecordingSource;
  studentId?: string | null;
  sourcePath?: string | null;
  storageUri: string | null;
  sha256?: string | null;
  bytes: number;
  durationSec?: number | null;
  channels?: number | null;
  audioTopology?: AudioInputTopology | null;
  audioLifecycle: AudioLifecycle;
  audioDeletionRequestedAt?: Date | null;
  audioDeletedAt?: Date | null;
  audioDeletionAttemptCount?: number;
  audioDeletionErrorCode?: string | null;
  audioDeletionNextAttemptAt?: Date | null;
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
export const AudioLifecycleSchema = z.enum([
  'not_retained',
  'retained',
  'pending',
  'deleting',
  'deleted',
  'delete_failed',
]);
