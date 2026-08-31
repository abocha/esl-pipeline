import { randomUUID } from 'node:crypto';

import type { AudioInputTopology, SttProviderId } from '@esl-pipeline/contracts';
import { classifyProviderRuntimeFailure } from '@esl-pipeline/provider-runtime';
import {
  formatSpeakerLabel,
  formatTranscriptFromSegments,
  type SttTranscriptionResult,
  transcribeAudio,
} from '@esl-pipeline/stt-core';

import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import { publishRecordingEvent } from '../domain/recording-events.js';
import { getRecordingById, updateRecordingStatus } from '../domain/recording-repository.js';
import { type TranscriptRecord } from '../domain/transcript-model.js';
import { getTranscriptByRecordingId, insertTranscript } from '../domain/transcript-repository.js';
import { createJobLogger } from '../infrastructure/logger.js';
import type { TranscribeQueuePayload } from '../infrastructure/transcribe-queue.js';
import type { TranscriptionStorage } from '../infrastructure/transcription-storage.js';
import {
  createTranscriptionStorage,
  createTranscriptionStorageForUri,
} from '../infrastructure/transcription-storage.js';
import { ensureSttProvidersRegistered } from './stt-provider-registry.js';
import { resolveTranscriptionRoute } from './transcription-routing.js';

export interface TranscribeDependencies {
  config: BatchBackendConfig;
  storage: TranscriptionStorage;
  recordings: {
    getById: typeof getRecordingById;
    updateStatus: typeof updateRecordingStatus;
  };
  transcripts: {
    getByRecordingId: typeof getTranscriptByRecordingId;
    insert: typeof insertTranscript;
  };
  publishEvent: typeof publishRecordingEvent;
  sttTranscribe: typeof transcribeAudio;
}

export function resolveElevenLabsSttApiKey(config: BatchBackendConfig): string {
  return (
    config.stt.providers.elevenlabs.apiKey ??
    config.orchestrator.elevenLabsApiKey ??
    process.env.ESL_STT_PROVIDER_ELEVENLABS_API_KEY ??
    process.env.ESL_STT_PROVIDER_ELEVENLABS_API_TOKEN ??
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
  const recordings = overrides?.recordings ?? {
    getById: getRecordingById,
    updateStatus: updateRecordingStatus,
  };
  const transcripts = overrides?.transcripts ?? {
    getByRecordingId: getTranscriptByRecordingId,
    insert: insertTranscript,
  };
  const publishEvent = overrides?.publishEvent ?? publishRecordingEvent;
  const sttTranscribe = overrides?.sttTranscribe ?? transcribeAudio;

  ensureSttProvidersRegistered();

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

  const mode = config.transcription.mode;
  const transcriptId = randomUUID();
  const topology: AudioInputTopology = recording.audioTopology ?? 'mixed_recording';
  let sttProvider: SttProviderId =
    payload.sttProvider ??
    config.transcription.hardOverride ??
    (topology === 'mixed_recording'
      ? config.stt.defaultProvider
      : (config.stt.trustedSplitProvider ?? 'deepgram'));

  try {
    const route = resolveTranscriptionRoute({
      config,
      topology,
      requestedProvider: payload.sttProvider,
    });
    sttProvider = route.provider;

    const transcribing = await recordings.updateStatus({
      id: recording.id,
      status: 'transcribing',
      error: null,
    });

    if (transcribing) {
      publishEvent({ type: 'recording_state_changed', recording: transcribing });
    }

    const readStorage =
      overrides?.storage ?? createTranscriptionStorageForUri(recording.storageUri);
    const transcription = await sttTranscribe({
      provider: sttProvider,
      context: {
        recordingId: recording.id,
        storageUri: recording.storageUri,
        getStream: () => readStorage.getStream(recording.storageUri),
      },
      configByProvider: buildSttProviderConfig(config, topology),
    });

    const transcriptText = formatTranscriptFromSegments(
      transcription.text,
      transcription.segments,
      mode,
      topology,
    );

    const transcriptStored = await storage.putTranscript({
      transcriptId,
      text: transcriptText,
    });

    let rawResponseUri: string | null = null;
    if (config.stt.storeRawResponse && transcription.rawResponse !== null) {
      const rawStored = await storage.putRawResponse({
        transcriptId,
        json: transcription.rawResponse,
      });
      rawResponseUri = rawStored.uri;
    }

    const speakerTracks = buildSpeakerTracks(transcription.segments, topology);
    let summaryJson: Record<string, unknown> = {
      ...(transcription.summary ?? undefined),
      provider: transcription.provider,
      segmentCount: transcription.segments.length,
      fallbackUsed: transcription.fallbackUsed,
      audioTopology: topology,
      sttRequestProfile: route.profile,
    };

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
      summaryJson = {
        ...summaryJson,
        speakerTracks: {
          uri: storedTracks.uri,
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
      workingVersion: 1,
      contentHash: transcriptStored.sha256,
      rawResponseUri,
      mode,
      model: transcription.model,
      language: transcription.language,
      sttProvider: transcription.provider,
      fallbackUsed: transcription.fallbackUsed,
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
      fallbackUsed: transcription.fallbackUsed,
      provider: transcription.provider,
      mode,
    });

    return transcriptRecord;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const statusCode = extractStatusCode(error);
    const providerCategory = classifyProviderRuntimeFailure({
      provider: sttProvider,
      message,
      ...(statusCode === null ? {} : { status: statusCode }),
    });

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
      provider: sttProvider,
      providerCategory,
    });

    throw error;
  }
}

function buildSttProviderConfig(
  config: BatchBackendConfig,
  topology: AudioInputTopology,
): Partial<Record<SttProviderId, Record<string, unknown>>> {
  return {
    deepgram: {
      apiKey: config.stt.providers.deepgram.apiKey,
      accessToken: config.stt.providers.deepgram.accessToken,
      model: config.stt.providers.deepgram.model,
      language: config.stt.providers.deepgram.language,
      trustedSplitChannels: topology === 'trusted_split_channels',
    },
    elevenlabs: {
      apiKey: resolveElevenLabsSttApiKey(config),
      modelId: config.stt.providers.elevenlabs.model,
    },
    google: {
      projectId: config.stt.providers.google.projectId,
      location: config.stt.providers.google.location,
      recognizer: config.stt.providers.google.recognizer,
      model: config.stt.providers.google.model,
      languageCodes: config.stt.providers.google.languageCodes,
      gcsStagingBucket: config.stt.providers.google.gcsStagingBucket,
      gcsStagingPrefix: config.stt.providers.google.gcsStagingPrefix,
    },
  };
}

function extractStatusCode(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number') return status;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === 'number' ? statusCode : null;
}

function buildSpeakerTracks(
  segments: SttTranscriptionResult['segments'],
  topology: AudioInputTopology,
): {
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
          label: formatSpeakerLabel(speaker, topology),
          text,
          turns: value.turns,
          characters: text.length,
        };
      }),
  };
}
