import { randomUUID } from 'node:crypto';

import type { PoolClient } from 'pg';

import type { RecordingRecord } from '../domain/recording-model.js';
import { insertRecording } from '../domain/recording-repository.js';
import type { TranscriptRecord } from '../domain/transcript-model.js';
import { insertTranscript } from '../domain/transcript-repository.js';
import { withPgClient } from '../infrastructure/db.js';
import {
  createTranscriptionStorage,
  type TranscriptionStorage,
} from '../infrastructure/transcription-storage.js';

const MANUAL_TRANSCRIPT_MODEL = 'manual-entry';
const MANUAL_TRANSCRIPT_LANGUAGE = 'und';
const DEFAULT_DISPLAY_NAME = 'Pasted lesson transcript';
const MAX_MANUAL_TRANSCRIPT_CHARACTERS = 500_000;

export interface ManualTranscriptSourceInput {
  studentId: string;
  text: string;
  displayName?: string | null;
}

export interface ManualTranscriptSourceResult {
  recording: RecordingRecord;
  transcript: TranscriptRecord;
}

export interface PersistManualTranscriptSourceParams {
  recordingId: string;
  transcriptId: string;
  studentId: string;
  displayName: string;
  storageUri: string;
  bytes: number;
}

export interface ManualTranscriptSourceDependencies {
  storage: TranscriptionStorage;
  persist: (params: PersistManualTranscriptSourceParams) => Promise<ManualTranscriptSourceResult>;
}

export class ManualTranscriptSourceValidationError extends Error {
  constructor(
    message: string,
    readonly code: 'text_required' | 'text_too_large',
  ) {
    super(message);
    this.name = 'ManualTranscriptSourceValidationError';
  }
}

export async function ingestManualTranscriptSource(
  input: ManualTranscriptSourceInput,
  overrides?: Partial<ManualTranscriptSourceDependencies>,
): Promise<ManualTranscriptSourceResult> {
  const text = input.text.trim();
  if (text.length === 0) {
    throw new ManualTranscriptSourceValidationError(
      'Transcript text is required.',
      'text_required',
    );
  }
  if (text.length > MAX_MANUAL_TRANSCRIPT_CHARACTERS) {
    throw new ManualTranscriptSourceValidationError(
      `Transcript text exceeds ${MAX_MANUAL_TRANSCRIPT_CHARACTERS} characters.`,
      'text_too_large',
    );
  }

  const recordingId = randomUUID();
  const transcriptId = randomUUID();
  const storage = overrides?.storage ?? createTranscriptionStorage();
  const stored = await storage.putTranscript({ transcriptId, text });

  try {
    return await (overrides?.persist ?? persistManualTranscriptSourceWithDefaults)({
      recordingId,
      transcriptId,
      studentId: input.studentId,
      displayName: input.displayName?.trim() || DEFAULT_DISPLAY_NAME,
      storageUri: stored.uri,
      bytes: Buffer.byteLength(text, 'utf8'),
    });
  } catch (error) {
    await storage.delete(stored.uri).catch(() => undefined);
    throw error;
  }
}

export async function persistManualTranscriptSourceWithDefaults(
  params: PersistManualTranscriptSourceParams,
): Promise<ManualTranscriptSourceResult> {
  return withPgClient(async (client: PoolClient) => {
    await client.query('BEGIN');
    try {
      const recording = await insertRecording(
        {
          id: params.recordingId,
          source: 'manual_transcript',
          studentId: params.studentId,
          sourcePath: params.displayName,
          storageUri: params.storageUri,
          bytes: params.bytes,
          status: 'transcribed',
        },
        { client },
      );
      const transcript = await insertTranscript(
        {
          id: params.transcriptId,
          recordingId: params.recordingId,
          storageUri: params.storageUri,
          rawResponseUri: null,
          mode: 'timeline',
          model: MANUAL_TRANSCRIPT_MODEL,
          language: MANUAL_TRANSCRIPT_LANGUAGE,
          sttProvider: 'manual',
          fallbackUsed: false,
          summaryJson: { provider: 'manual', origin: 'tutor_paste' },
        },
        { client },
      );
      await client.query('COMMIT');
      return { recording, transcript };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}
