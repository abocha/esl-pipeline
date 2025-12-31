import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';

import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import { publishRecordingEvent } from '../domain/recording-events.js';
import {
  getRecordingById,
  updateRecordingStatus,
} from '../domain/recording-repository.js';
import {
  type TranscriptMode,
  type TranscriptRecord,
} from '../domain/transcript-model.js';
import { getTranscriptByRecordingId, insertTranscript } from '../domain/transcript-repository.js';
import { createDeepgramClient } from '../infrastructure/deepgram-client.js';
import { createJobLogger } from '../infrastructure/logger.js';
import type { TranscriptionStorage } from '../infrastructure/transcription-storage.js';
import { createTranscriptionStorage } from '../infrastructure/transcription-storage.js';
import type { TranscribeQueuePayload } from '../infrastructure/transcribe-queue.js';

interface DeepgramResult {
  metadata?: Record<string, unknown>;
  results?: {
    channels?: {
      alternatives?: {
        transcript?: string;
        words?: {
          speaker?: number;
          start?: number;
          punctuated_word?: string;
          word?: string;
        }[];
      }[];
    }[];
    utterances?: {
      transcript?: string;
      speaker?: number;
      start?: number;
    }[];
  };
}

interface DeepgramResponseLike {
  result?: unknown;
  error?: unknown;
}

export interface TranscribeDependencies {
  config: BatchBackendConfig;
  storage: TranscriptionStorage;
  deepgramClient: {
    listen: {
      prerecorded: {
        transcribeFile: (
          stream: Readable,
          options: Record<string, unknown>,
        ) => Promise<DeepgramResponseLike>;
      };
    };
  };
  recordings: {
    getById: typeof getRecordingById;
    updateStatus: typeof updateRecordingStatus;
  };
  transcripts: {
    getByRecordingId: typeof getTranscriptByRecordingId;
    insert: typeof insertTranscript;
  };
  publishEvent: typeof publishRecordingEvent;
}

export async function processTranscribeJob(
  payload: TranscribeQueuePayload,
  overrides?: Partial<TranscribeDependencies>,
): Promise<TranscriptRecord | null> {
  const config = overrides?.config ?? loadConfig();
  const log = createJobLogger(payload.recordingId);
  const storage = overrides?.storage ?? createTranscriptionStorage();
  const deepgramClient =
    overrides?.deepgramClient ??
    createDeepgramClient({
      apiKey: config.deepgram.apiKey,
      accessToken: config.deepgram.accessToken,
    });
  const recordings = overrides?.recordings ?? {
    getById: getRecordingById,
    updateStatus: updateRecordingStatus,
  };
  const transcripts = overrides?.transcripts ?? {
    getByRecordingId: getTranscriptByRecordingId,
    insert: insertTranscript,
  };
  const publishEvent = overrides?.publishEvent ?? publishRecordingEvent;

  const recording = await recordings.getById(payload.recordingId);
  if (!recording) {
    log.warn('Recording not found; skipping', { event: 'recording_missing' });
    return null;
  }

  const existingTranscript = await transcripts.getByRecordingId(recording.id);
  if (existingTranscript) {
    log.info('Transcript already exists; skipping', { transcriptId: existingTranscript.id });
    return existingTranscript;
  }

  if (recording.status === 'transcribing') {
    log.info('Recording already transcribing; skipping', { recordingId: recording.id });
    return null;
  }

  const transcribing = await recordings.updateStatus({
    id: recording.id,
    status: 'transcribing',
    error: null,
  });

  if (transcribing) {
    publishEvent({ type: 'recording_state_changed', recording: transcribing });
  }

  const mode = config.transcription.mode;
  const transcriptId = randomUUID();

  try {
    const { result, fallbackUsed } = await transcribeWithDeepgram({
      client: deepgramClient,
      storage,
      storageUri: recording.storageUri,
      model: config.deepgram.model,
      language: config.deepgram.language,
    });

    const transcriptText = formatTranscript(result, mode);
    const transcriptStored = await storage.putTranscript({
      transcriptId,
      text: transcriptText,
    });

    let rawResponseUri: string | null = null;
    if (config.deepgram.storeRawResponse) {
      const rawStored = await storage.putRawResponse({
        transcriptId,
        json: result,
      });
      rawResponseUri = rawStored.uri;
    }

    const transcriptRecord = await transcripts.insert({
      id: transcriptId,
      recordingId: recording.id,
      storageUri: transcriptStored.uri,
      rawResponseUri,
      mode,
      model: config.deepgram.model,
      language: config.deepgram.language,
      fallbackUsed,
      summaryJson: buildSummary(result),
    });

    const updated = await recordings.updateStatus({
      id: recording.id,
      status: 'transcribed',
      error: null,
    });

    if (updated) {
      publishEvent({
        type: 'recording_state_changed',
        recording: updated,
        transcriptId: transcriptRecord.id,
      });
    }

    log.info('Recording transcribed', {
      transcriptId: transcriptRecord.id,
      fallbackUsed,
      mode,
    });

    return transcriptRecord;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = await recordings.updateStatus({
      id: recording.id,
      status: 'failed',
      error: message,
    });

    if (failed) {
      publishEvent({ type: 'recording_state_changed', recording: failed });
    }

    log.error(error instanceof Error ? error : String(error), {
      event: 'recording_transcribe_failed',
    });

    throw error;
  }
}

async function transcribeWithDeepgram(args: {
  client: TranscribeDependencies['deepgramClient'];
  storage: TranscriptionStorage;
  storageUri: string;
  model: string;
  language: string;
}): Promise<{ result: DeepgramResult; fallbackUsed: boolean }> {
  const primary = await transcribeAttempt(args, {
    model: args.model,
    language: args.language,
    multichannel: true,
  });

  if (primary.result && !primary.error) {
    return { result: asDeepgramResult(primary.result), fallbackUsed: false };
  }

  const fallback = await transcribeAttempt(args, {
    model: args.model,
    language: args.language,
    diarize: true,
    utterances: true,
  });

  if (fallback.error || !fallback.result) {
    const error =
      fallback.error ?? primary.error ?? new Error('Deepgram transcription failed');
    throw error instanceof Error ? error : new Error(String(error));
  }

  return { result: asDeepgramResult(fallback.result), fallbackUsed: true };
}

async function transcribeAttempt(
  args: {
    client: TranscribeDependencies['deepgramClient'];
    storage: TranscriptionStorage;
    storageUri: string;
  },
  options: Record<string, unknown>,
): Promise<DeepgramResponseLike> {
  const stream = await args.storage.getStream(args.storageUri);
  return args.client.listen.prerecorded.transcribeFile(stream, options);
}

function formatTranscript(result: DeepgramResult, mode: TranscriptMode): string {
  const transcript = getRawTranscript(result);
  const utterances = getUtterances(result);

  if (utterances.length === 0) {
    return transcript;
  }

  if (mode === 'stack') {
    const grouped = new Map<number, string[]>();
    for (const utterance of utterances) {
      const speaker = utterance.speaker ?? 0;
      const list = grouped.get(speaker) ?? [];
      list.push(utterance.text);
      grouped.set(speaker, list);
    }

    return [...grouped.entries()]
      .map(([speaker, lines]) => `Speaker ${speaker + 1}:\n${lines.join(' ')}`)
      .join('\n\n');
  }

  return utterances
    .map((utterance) => {
      const timestamp = formatTimestamp(utterance.start ?? 0);
      const speaker = `Speaker ${((utterance.speaker ?? 0) + 1).toString()}`;
      return `[${timestamp}] ${speaker}: ${utterance.text}`;
    })
    .join('\n');
}

function getRawTranscript(result: DeepgramResult): string {
  const channel = result.results?.channels?.[0];
  const alternative = channel?.alternatives?.[0];
  const transcript = alternative?.transcript ?? '';
  return transcript.trim();
}

function asDeepgramResult(value: unknown): DeepgramResult {
  if (!value || typeof value !== 'object') {
    return {};
  }
  return value as DeepgramResult;
}

function getUtterances(result: DeepgramResult): {
  text: string;
  speaker?: number;
  start?: number;
}[] {
  const utterances = result.results?.utterances;
  if (Array.isArray(utterances) && utterances.length > 0) {
    return utterances
      .map((item) => ({
        text: (item.transcript ?? '').trim(),
        speaker: typeof item.speaker === 'number' ? item.speaker : undefined,
        start: typeof item.start === 'number' ? item.start : undefined,
      }))
      .filter((item) => item.text.length > 0);
  }

  return [];
}

function buildSummary(result: DeepgramResult): Record<string, unknown> | null {
  const metadata = result.metadata ?? null;
  const channelCount = result.results?.channels?.length;

  if (!metadata && !channelCount) {
    return null;
  }

  const summary: Record<string, unknown> = metadata ? { ...metadata } : {};
  if (channelCount) {
    summary.channels = channelCount;
  }

  return summary;
}

function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds)) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
