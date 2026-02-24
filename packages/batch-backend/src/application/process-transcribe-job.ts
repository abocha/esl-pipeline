import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';

import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import { publishRecordingEvent } from '../domain/recording-events.js';
import { getRecordingById, updateRecordingStatus } from '../domain/recording-repository.js';
import { type TranscriptMode, type TranscriptRecord } from '../domain/transcript-model.js';
import { getTranscriptByRecordingId, insertTranscript } from '../domain/transcript-repository.js';
import { createDeepgramClient } from '../infrastructure/deepgram-client.js';
import { createJobLogger } from '../infrastructure/logger.js';
import type { TranscribeQueuePayload } from '../infrastructure/transcribe-queue.js';
import type { TranscriptionStorage } from '../infrastructure/transcription-storage.js';
import {
  createTranscriptionStorage,
  createTranscriptionStorageForUri,
} from '../infrastructure/transcription-storage.js';

interface DeepgramResult {
  metadata?: Record<string, unknown>;
  results?: {
    channels?: {
      alternatives?: {
        transcript?: string;
        words?: {
          end?: number;
          speaker?: number;
          start?: number;
          punctuated_word?: string;
          word?: string;
        }[];
      }[];
    }[];
    utterances?: {
      channel?: number;
      end?: number;
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

interface RetryableStatusError {
  status?: unknown;
}

function resolveSttProvider(
  requested: string | undefined,
  fallback: 'deepgram' | 'elevenlabs',
): 'deepgram' | 'elevenlabs' {
  if (!requested) return fallback;
  if (requested === 'deepgram' || requested === 'elevenlabs') {
    return requested;
  }
  return fallback;
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

export function resolveElevenLabsSttApiKey(config: BatchBackendConfig): string {
  return (
    config.orchestrator.elevenLabsApiKey ??
    process.env.ELEVENLABS_API_KEY ??
    process.env.ELEVENLABS_API_TOKEN ??
    ''
  );
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
    const readStorage =
      overrides?.storage ?? createTranscriptionStorageForUri(recording.storageUri);

    const sttProvider = resolveSttProvider(payload.sttProvider, config.transcription.sttProvider);
    let transcriptText: string;
    let rawResponse: unknown = null;
    let summaryJson: Record<string, unknown> | null = null;
    let transcriptSegments: TranscriptSegment[] = [];
    let provider: string;
    let usedFallback = false;

    if (sttProvider === 'elevenlabs') {
      const elevenApiKey = resolveElevenLabsSttApiKey(config);
      const { text, segments, raw } = await transcribeWithElevenLabs({
        storage: readStorage,
        storageUri: recording.storageUri,
        apiKey: elevenApiKey,
      });
      transcriptText = formatElevenLabsTranscript(text, segments, mode);
      transcriptSegments = segments;
      rawResponse = raw;
      summaryJson = {
        provider: 'elevenlabs',
        segmentCount: segments.length,
      };
      provider = 'elevenlabs';
    } else {
      const { result, fallbackUsed } = await transcribeWithDeepgram({
        client: deepgramClient,
        storage: readStorage,
        storageUri: recording.storageUri,
        model: config.deepgram.model,
        language: config.deepgram.language,
      });
      const segments = mergeSegments(getTranscriptSegments(result));
      transcriptText = formatTranscriptFromSegments(getRawTranscript(result), segments, mode);
      transcriptSegments = segments;
      rawResponse = result;
      const deepgramSummary = buildSummary(result);
      summaryJson = {
        ...(deepgramSummary ?? {}),
        provider: 'deepgram',
        segmentCount: segments.length,
      };
      provider = 'deepgram';
      usedFallback = fallbackUsed;
    }

    const transcriptStored = await storage.putTranscript({
      transcriptId,
      text: transcriptText,
    });

    let rawResponseUri: string | null = null;
    if (config.deepgram.storeRawResponse && rawResponse !== null) {
      const rawStored = await storage.putRawResponse({
        transcriptId,
        json: rawResponse,
      });
      rawResponseUri = rawStored.uri;
    }

    const speakerTracks = buildSpeakerTracks(transcriptSegments);
    let speakerTracksUri: string | null = null;
    if (speakerTracks.tracks.length > 0) {
      const speakerTrackTranscripts: {
        speaker: number;
        label: string;
        uri: string;
      }[] = [];
      for (const track of speakerTracks.tracks) {
        const storedTrackText = await storage.putTranscript({
          transcriptId: `${transcriptId}-speaker-${track.speaker}`,
          text: track.text,
        });
        speakerTrackTranscripts.push({
          speaker: track.speaker,
          label: track.label,
          uri: storedTrackText.uri,
        });
      }

      const storedTracks = await storage.putRawResponse({
        transcriptId: `${transcriptId}-speaker-tracks`,
        json: speakerTracks,
      });
      speakerTracksUri = storedTracks.uri;
      const summary = summaryJson ? { ...summaryJson } : {};
      summaryJson = {
        ...summary,
        speakerTracks: {
          uri: speakerTracksUri,
          transcripts: speakerTrackTranscripts,
          speakers: speakerTracks.tracks.map((track) => ({
            speaker: track.speaker,
            label: track.label,
            turns: track.turns,
            characters: track.characters,
          })),
        },
      };
    }

    const transcriptRecord = await transcripts.insert({
      id: transcriptId,
      recordingId: recording.id,
      storageUri: transcriptStored.uri,
      rawResponseUri,
      mode,
      model: provider === 'elevenlabs' ? 'scribe_v1' : config.deepgram.model,
      language: provider === 'elevenlabs' ? 'auto' : config.deepgram.language,
      fallbackUsed: usedFallback,
      summaryJson,
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
      fallbackUsed: usedFallback,
      provider,
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
    punctuate: true,
    smart_format: true,
    utterances: true,
  });

  if (primary.result && !primary.error) {
    const primaryResult = asDeepgramResult(primary.result);
    const channelCount = getChannelCount(primaryResult);
    if (channelCount === 1) {
      const fallback = await transcribeAttempt(args, {
        model: args.model,
        language: args.language,
        diarize: true,
        utterances: true,
        punctuate: true,
        smart_format: true,
      });

      if (fallback.result && !fallback.error) {
        return { result: asDeepgramResult(fallback.result), fallbackUsed: true };
      }
    }

    return { result: primaryResult, fallbackUsed: false };
  }

  const fallback = await transcribeAttempt(args, {
    model: args.model,
    language: args.language,
    diarize: true,
    utterances: true,
    punctuate: true,
    smart_format: true,
  });

  if (fallback.error || !fallback.result) {
    const error = fallback.error ?? primary.error ?? new Error('Deepgram transcription failed');
    throw error instanceof Error ? error : new Error(String(error));
  }

  return { result: asDeepgramResult(fallback.result), fallbackUsed: true };
}

interface ElevenLabsWord {
  text?: string;
  speaker_id?: string | null;
  start?: number;
  end?: number;
  type?: string;
}

interface ElevenLabsTranscriptResult {
  text: string;
  segments: TranscriptSegment[];
  raw: unknown;
}

interface TranscriptSegment {
  text: string;
  speaker?: number;
  start?: number;
  end?: number;
}

async function transcribeWithElevenLabs(args: {
  storage: TranscriptionStorage;
  storageUri: string;
  apiKey: string;
}): Promise<ElevenLabsTranscriptResult> {
  if (!args.apiKey.trim()) {
    throw new Error('ELEVENLABS_API_KEY is required when STT_PROVIDER=elevenlabs');
  }

  const client = new ElevenLabsClient({ apiKey: args.apiKey });
  const stream = await args.storage.getStream(args.storageUri);

  // Collect the stream into a Buffer
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    (stream as NodeJS.ReadableStream).on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    (stream as NodeJS.ReadableStream).on('end', resolve);
    (stream as NodeJS.ReadableStream).on('error', reject);
  });
  stream.destroy();

  const audioBuffer = Buffer.concat(chunks);
  const blob = new Blob([audioBuffer], { type: 'audio/mpeg' });

  const response = await client.speechToText.convert({
    file: blob,
    modelId: 'scribe_v1',
    diarize: true,
    timestampsGranularity: 'word',
  });

  const words: ElevenLabsWord[] = (response as unknown as { words?: ElevenLabsWord[] }).words ?? [];
  const fullText = (response as unknown as { text?: string }).text ?? '';

  // Build segments by grouping consecutive same-speaker words
  const segments: TranscriptSegment[] = [];
  let currentSpeaker: number | undefined;
  let currentText = '';
  let currentStart: number | undefined;
  let currentEnd: number | undefined;

  for (const word of words) {
    if (word.type === 'spacing') continue;
    const wordText = word.text?.trim() ?? '';
    if (!wordText) continue;

    // Convert speaker_id like "speaker_0" => 0
    let speakerIndex: number | undefined;
    if (word.speaker_id !== null && word.speaker_id !== undefined) {
      const match = /(\d+)$/.exec(word.speaker_id);
      speakerIndex = match ? Number.parseInt(match[1] ?? '0', 10) : 0;
    }

    if (speakerIndex !== currentSpeaker && currentText) {
      segments.push({
        text: currentText.trim(),
        speaker: currentSpeaker,
        start: currentStart,
        end: currentEnd,
      });
      currentText = '';
      currentStart = undefined;
      currentEnd = undefined;
    }

    currentSpeaker = speakerIndex;
    currentText = currentText ? `${currentText} ${wordText}` : wordText;
    if (currentStart === undefined && word.start !== undefined) currentStart = word.start;
    if (word.end !== undefined) currentEnd = word.end;
  }

  if (currentText) {
    segments.push({
      text: currentText.trim(),
      speaker: currentSpeaker,
      start: currentStart,
      end: currentEnd,
    });
  }

  return { text: fullText, segments, raw: response };
}

function formatElevenLabsTranscript(
  rawText: string,
  segments: TranscriptSegment[],
  mode: TranscriptMode,
): string {
  return formatTranscriptFromSegments(rawText, segments, mode);
}

async function transcribeAttempt(
  args: {
    client: TranscribeDependencies['deepgramClient'];
    storage: TranscriptionStorage;
    storageUri: string;
  },
  options: Record<string, unknown>,
): Promise<DeepgramResponseLike> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= TRANSCRIBE_ATTEMPT_MAX_RETRIES; attempt += 1) {
    const stream = await args.storage.getStream(args.storageUri);
    try {
      const response = await args.client.listen.prerecorded.transcribeFile(stream, options);
      if (!response.error || !isRetryableTranscriptionError(response.error)) {
        return response;
      }

      lastError = response.error;
    } catch (error) {
      if (!isRetryableTranscriptionError(error)) {
        return { result: undefined, error };
      }
      lastError = error;
    } finally {
      // Close stream descriptors promptly before retrying.
      stream.destroy();
    }

    if (attempt < TRANSCRIBE_ATTEMPT_MAX_RETRIES) {
      await wait(getRetryDelayMs(attempt));
    }
  }

  return {
    result: undefined,
    error: lastError ?? new Error('Deepgram transcription failed after retries'),
  };
}

function isRetryableTranscriptionError(error: unknown): boolean {
  const status = getRetryableStatus(error);
  if (typeof status === 'number' && RETRYABLE_DEEPGRAM_STATUS_CODES.has(status)) {
    return true;
  }

  const message = extractErrorMessage(error).toLowerCase();
  if (!message) return false;
  return RETRYABLE_DEEPGRAM_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern));
}

function getRetryableStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = (error as RetryableStatusError).status;
  return typeof candidate === 'number' ? candidate : null;
}

function extractErrorMessage(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' ? message : '';
  }
  return String(error);
}

function getRetryDelayMs(attempt: number): number {
  return Math.min(TRANSCRIBE_ATTEMPT_BASE_DELAY_MS * 2 ** (attempt - 1), 2_000);
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function formatTranscriptFromSegments(
  transcript: string,
  utterances: TranscriptSegment[],
  mode: TranscriptMode,
): string {
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
      .map(([speaker, lines]) => `${formatSpeakerLabel(speaker)}:\n${lines.join('\n')}`)
      .join('\n\n');
  }

  return utterances
    .map((utterance) => {
      const start = formatTimestamp(utterance.start ?? 0);
      const end = formatTimestamp(utterance.end ?? utterance.start ?? 0);
      const speaker = formatSpeakerLabel(utterance.speaker ?? 0);
      return `[${speaker} ${start}-${end}] ${utterance.text}`;
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

function getTranscriptSegments(result: DeepgramResult): {
  text: string;
  speaker?: number;
  start?: number;
  end?: number;
}[] {
  const utterances = result.results?.utterances;
  if (Array.isArray(utterances) && utterances.length > 0) {
    const segments = utterances
      .map((item) => ({
        text: (item.transcript ?? '').trim(),
        speaker: resolveSpeakerIndex(item.channel, item.speaker),
        start: typeof item.start === 'number' ? item.start : undefined,
        end: typeof item.end === 'number' ? item.end : undefined,
      }))
      .filter((item) => item.text.length > 0);
    return normalizeSegmentEnds(segments).sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  }

  return buildSegmentsFromWords(result);
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
  if (!Number.isFinite(seconds)) return '00:00.000';
  const totalMillis = Math.round(seconds * 1000);
  const mins = Math.floor(totalMillis / 60_000);
  const secs = Math.floor((totalMillis % 60_000) / 1000);
  const millis = totalMillis % 1000;
  return `${mins.toString().padStart(2, '0')}:${secs
    .toString()
    .padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

function formatSpeakerLabel(index: number): string {
  if (index === 0) return 'Teacher';
  if (index === 1) return 'Student';
  return `Speaker ${index + 1}`;
}

function buildSpeakerTracks(segments: TranscriptSegment[]): {
  tracks: {
    speaker: number;
    label: string;
    text: string;
    turns: number;
    characters: number;
  }[];
} {
  if (segments.length === 0) return { tracks: [] };

  const bySpeaker = new Map<number, { lines: string[]; turns: number }>();
  for (const segment of segments) {
    const normalizedText = segment.text.trim();
    if (!normalizedText) continue;
    const speaker = segment.speaker ?? 0;
    const existing = bySpeaker.get(speaker) ?? { lines: [], turns: 0 };
    existing.lines.push(normalizedText);
    existing.turns += 1;
    bySpeaker.set(speaker, existing);
  }

  return {
    tracks: [...bySpeaker.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([speaker, value]) => {
        const text = value.lines.join('\n');
        return {
          speaker,
          label: formatSpeakerLabel(speaker),
          text,
          turns: value.turns,
          characters: text.length,
        };
      }),
  };
}

function getChannelCount(result: DeepgramResult): number | null {
  const metadataChannels = (result.metadata as { channels?: unknown } | undefined)?.channels;
  if (typeof metadataChannels === 'number') {
    return metadataChannels;
  }
  if (Array.isArray(result.results?.channels)) {
    return result.results?.channels?.length ?? null;
  }
  return null;
}

function resolveSpeakerIndex(channel?: number, speaker?: number): number | undefined {
  if (typeof channel === 'number') return channel;
  if (typeof speaker === 'number') return speaker;
  return undefined;
}

function buildSegmentsFromWords(result: DeepgramResult): {
  text: string;
  speaker?: number;
  start?: number;
  end?: number;
}[] {
  const channels = result.results?.channels;
  if (!Array.isArray(channels) || channels.length === 0) {
    return [];
  }

  const segments: {
    text: string;
    speaker?: number;
    start?: number;
    end?: number;
  }[] = [];

  for (const [channelIndex, channel] of channels.entries()) {
    const words = channel.alternatives?.[0]?.words;
    if (!Array.isArray(words) || words.length === 0) {
      continue;
    }

    let current: { text: string; speaker?: number; start?: number; end?: number } | null = null;

    for (const word of words) {
      const text = (word.punctuated_word ?? word.word ?? '').trim();
      if (!text) continue;
      const start = typeof word.start === 'number' ? word.start : undefined;
      const end = typeof word.end === 'number' ? word.end : start;

      if (!current) {
        current = { text, speaker: channelIndex, start, end };
        continue;
      }

      const gap = getGapSeconds(current.end, start);
      if (gap > UTTERANCE_GAP_SEC) {
        segments.push(current);
        current = { text, speaker: channelIndex, start, end };
        continue;
      }

      current.text = `${current.text} ${text}`;
      current.end = end ?? current.end;
    }

    if (current) {
      segments.push(current);
    }
  }

  return segments.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
}

function normalizeSegmentEnds<T extends { start?: number; end?: number }>(segments: T[]): T[] {
  return segments.map((segment, index) => {
    if (typeof segment.end === 'number') return segment;
    const nextStart = segments[index + 1]?.start;
    return {
      ...segment,
      end: typeof nextStart === 'number' ? nextStart : segment.start,
    };
  });
}

function mergeSegments(
  segments: { text: string; speaker?: number; start?: number; end?: number }[],
): { text: string; speaker?: number; start?: number; end?: number }[] {
  if (segments.length === 0) return segments;
  const merged: { text: string; speaker?: number; start?: number; end?: number }[] = [];

  for (const segment of segments) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.speaker === segment.speaker &&
      getGapSeconds(previous.end, segment.start) <= UTTERANCE_GAP_SEC
    ) {
      previous.text = `${previous.text} ${segment.text}`.trim();
      previous.end = segment.end ?? previous.end;
      continue;
    }
    merged.push({ ...segment });
  }

  return merged;
}

function getGapSeconds(previousEnd?: number, nextStart?: number): number {
  const previous = typeof previousEnd === 'number' ? previousEnd : Number.NaN;
  const next = typeof nextStart === 'number' ? nextStart : Number.NaN;
  if (!Number.isFinite(previous) || !Number.isFinite(next)) {
    return 0;
  }
  return next - previous;
}

const UTTERANCE_GAP_SEC = 1.5;
const TRANSCRIBE_ATTEMPT_MAX_RETRIES = 3;
const TRANSCRIBE_ATTEMPT_BASE_DELAY_MS = process.env.NODE_ENV === 'test' ? 0 : 250;
const RETRYABLE_DEEPGRAM_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_DEEPGRAM_MESSAGE_PATTERNS = [
  'terminated',
  'fetch failed',
  'network',
  'socket',
  'timeout',
  'timed out',
  'etimedout',
  'econnreset',
  'econnrefused',
  'aborted',
  'connection reset',
];
