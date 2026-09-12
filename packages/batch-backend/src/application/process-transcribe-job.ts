import { randomUUID } from 'node:crypto';

import type { AudioInputTopology, SttProviderId } from '@esl-pipeline/contracts';
import {
  formatSpeakerLabel,
  formatTranscriptFromSegments,
  type SttTranscriptionResult,
  transcribeAudio,
} from '@esl-pipeline/stt-core';

import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import { publishRecordingEvent } from '../domain/recording-events.js';
import { getRecordingByIdForWorker } from '../domain/recording-repository.js';
import { type TranscriptRecord } from '../domain/transcript-model.js';
import {
  getTranscriptByRecordingIdForWorker,
  insertTranscript,
} from '../domain/transcript-repository.js';
import {
  claimTranscriptionRun,
  completeTranscriptionRun,
  failTranscriptionRun,
  getTranscriptionRunById,
  markTranscriptionRunRetryWait,
  renewTranscriptionRunLease,
  reserveTranscriptionSubmissionSlot,
} from '../domain/transcription-run-repository.js';
import { createJobLogger } from '../infrastructure/logger.js';
import type { TranscribeQueuePayload } from '../infrastructure/transcribe-queue.js';
import type { TranscriptionStorage } from '../infrastructure/transcription-storage.js';
import {
  createTranscriptionStorage,
  createTranscriptionStorageForUri,
} from '../infrastructure/transcription-storage.js';
import { ensureSttProvidersRegistered } from './stt-provider-registry.js';
import {
  classifyTranscriptionFailure,
  createTranscriptionDispatchGuard,
  malformedProviderResultError,
  readStructuralValidationDiagnostics,
  TranscriptionExecutionLostError,
  validateTranscriptionResult,
} from './transcription-execution.js';
import { resolveTranscriptionRoute } from './transcription-routing.js';

export interface TranscribeDependencies {
  config: BatchBackendConfig;
  storage: TranscriptionStorage;
  recordings: {
    getById: typeof getRecordingByIdForWorker;
    updateStatus: (params: {
      id: string;
      status: import('../domain/recording-model.js').RecordingStatus;
      error?: string | null;
    }) => Promise<import('../domain/recording-model.js').RecordingRecord | null>;
  };
  transcripts: {
    getByRecordingId: typeof getTranscriptByRecordingIdForWorker;
    insert: typeof insertTranscript;
  };
  publishEvent: typeof publishRecordingEvent;
  sttTranscribe: typeof transcribeAudio;
}

type ProcessTranscribePayload =
  | TranscribeQueuePayload
  | (Omit<TranscribeQueuePayload, 'runId'> & { runId?: undefined });

export class TranscriptionDeliveryDeferredError extends Error {
  constructor() {
    super('Transcription run remains nonterminal and requires another delivery.');
    this.name = 'TranscriptionDeliveryDeferredError';
  }
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
  payload: ProcessTranscribePayload,
  overrides?: Partial<TranscribeDependencies>,
): Promise<TranscriptRecord | null> {
  const executionId = payload.runId ?? payload.recordingId;
  return processTranscribeJobWithinFence(payload, overrides);
}

async function processTranscribeJobWithinFence(
  payload: ProcessTranscribePayload,
  overrides?: Partial<TranscribeDependencies>,
): Promise<TranscriptRecord | null> {
  // Legacy deliveries without runId cannot locate a durable run in production and
  // therefore no-op at claim time; current enqueue always supplies runId.
  const executionId = payload.runId ?? payload.recordingId;
  const config = overrides?.config ?? loadConfig();
  const log = createJobLogger(executionId);
  const storage = overrides?.storage ?? createTranscriptionStorage();
  const recordings = overrides?.recordings ?? {
    getById: getRecordingByIdForWorker,
    updateStatus: async () => null,
  };
  void overrides?.transcripts;
  const publishEvent = overrides?.publishEvent ?? publishRecordingEvent;
  const sttTranscribe = overrides?.sttTranscribe ?? transcribeAudio;

  ensureSttProvidersRegistered();

  const claimed = await claimTranscriptionRun({
    runId: executionId,
    claimTtlMs: config.transcription.claimTtlMs ?? 10 * 60 * 1000,
  });
  if (!claimed) {
    log.info('Run is terminal or held by another worker; skipping delivery');
    const run = await getTranscriptionRunById(executionId);
    if (run && run.state !== 'succeeded' && run.state !== 'failed') {
      throw new TranscriptionDeliveryDeferredError();
    }
    return null;
  }
  const claimToken = claimed.claimToken;
  if (!claimToken) return null;
  const recording = await recordings.getById(claimed.recordingId);
  if (!recording) {
    await failTranscriptionRun({
      runId: claimed.id,
      claimToken,
      errorCode: 'transcription_permanent_failure',
    });
    log.warn('Recording not found; run terminalized', { event: 'recording_missing' });
    return null;
  }
  // The repository claim transaction owns the production projection. This small
  // compatibility seam keeps injected deterministic tests observable.
  await publishCommittedProjection({
    recordingId: recording.id,
    status: 'transcribing',
    error: null,
    recordings,
    hasInjectedRecordings: Boolean(overrides?.recordings),
    publishEvent,
    run: claimed,
  });

  const mode = config.transcription.mode;
  const transcriptId = randomUUID();
  const topology: AudioInputTopology = recording.audioTopology ?? 'mixed_recording';
  let sttProvider: SttProviderId = claimed.provider;
  let sttRequestProfile: string | undefined;
  let providerModel: string | undefined;
  let submissionSlot: number | undefined;

  try {
    const route = resolveTranscriptionRoute({
      config,
      topology,
      requestedProvider: claimed.provider,
    });
    sttProvider = route.provider;
    sttRequestProfile = route.profile;
    providerModel = configuredSttModel(config, sttProvider);

    if (!recording.storageUri) {
      throw new Error(`Recording has no retained audio: ${recording.id}`);
    }
    const reserved = await reserveTranscriptionSubmissionSlot({ runId: claimed.id, claimToken });
    if (!reserved) {
      const failed = await failTranscriptionRun({
        runId: claimed.id,
        claimToken,
        errorCode: 'transcription_unavailable_after_retries',
        outcome: 'ambiguous',
      });
      if (failed) {
        await publishCommittedProjection({
          recordingId: recording.id,
          status: 'failed',
          error: 'transcription_unavailable_after_retries',
          recordings,
          hasInjectedRecordings: Boolean(overrides?.recordings),
          publishEvent,
        });
      }
      return null;
    }
    submissionSlot = reserved.currentSubmissionSlot ?? reserved.submissionSlotsReserved;
    const storageUri = recording.storageUri;
    const readStorage =
      overrides?.storage ?? createTranscriptionStorageForUri(recording.storageUri);
    const guard = createTranscriptionDispatchGuard({
      claimTtlMs: config.transcription.claimTtlMs ?? 10 * 60 * 1000,
      submissionSlot: reserved.currentSubmissionSlot ?? reserved.submissionSlotsReserved,
      renew: async (submissionSlot) =>
        Boolean(
          await renewTranscriptionRunLease({
            runId: claimed.id,
            claimToken,
            claimTtlMs: config.transcription.claimTtlMs ?? 10 * 60 * 1000,
            submissionSlot,
          }),
        ),
    });
    guard.start();
    let transcription;
    try {
      transcription = await sttTranscribe({
        provider: sttProvider,
        context: {
          recordingId: recording.id,
          storageUri,
          getStream: () => readStorage.getStream(storageUri),
          getSubmissionSource: async () => {
            if (!readStorage.getProviderSubmissionSource) {
              throw new Error('Transcription storage cannot prepare a provider submission source.');
            }
            return readStorage.getProviderSubmissionSource(storageUri);
          },
          providerTransport: { fetch: guard.fetch, signal: guard.signal },
        },
        configByProvider: buildSttProviderConfig(config, topology),
      });
    } finally {
      guard.stop();
    }
    const validation = validateTranscriptionResult(transcription, topology);
    if (!validation.valid) throw malformedProviderResultError(validation.diagnostics);

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
      ...((recording.mediaPreparationVersion ?? payload.mediaPreparationVersion) === undefined
        ? {}
        : {
            mediaPreparationVersion:
              recording.mediaPreparationVersion ?? payload.mediaPreparationVersion,
          }),
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

    const transcriptParams = {
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
    };
    // Deterministic in-process callers retain the legacy persistence seam; the
    // normal worker never supplies it and uses the atomic run transaction below.
    if (overrides?.transcripts) await overrides.transcripts.insert(transcriptParams);
    const completed = await completeTranscriptionRun({
      runId: claimed.id,
      claimToken,
      transcript: transcriptParams,
    });
    if (!completed) {
      const current = await getTranscriptionRunById(claimed.id);
      if (current && current.state !== 'succeeded' && current.state !== 'failed') {
        throw new TranscriptionDeliveryDeferredError();
      }
      return null;
    }
    await publishCommittedProjection({
      recordingId: recording.id,
      status: 'transcribed',
      error: null,
      recordings,
      hasInjectedRecordings: Boolean(overrides?.recordings),
      publishEvent,
      transcriptId: completed.transcriptId,
      run: completed.run,
    });
    const transcriptRecord = {
      ...completed,
      id: completed.transcriptId,
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
      createdAt: new Date(),
      updatedAt: new Date(),
    } as TranscriptRecord;

    log.info('Recording transcribed', {
      transcriptId: transcriptRecord.id,
      fallbackUsed: transcription.fallbackUsed,
      provider: transcription.provider,
      mode,
    });

    return transcriptRecord;
  } catch (error) {
    if (
      error instanceof TranscriptionExecutionLostError ||
      error instanceof TranscriptionDeliveryDeferredError
    ) {
      throw new TranscriptionDeliveryDeferredError();
    }
    const classification = classifyTranscriptionFailure(error);
    const structuralDiagnostics = readStructuralValidationDiagnostics(error);
    const current = await getTranscriptionRunById(claimed.id);
    const canRetry = classification.retryable && (current?.submissionSlotsReserved ?? 3) < 3;
    const transitioned = canRetry
      ? await markTranscriptionRunRetryWait({
          runId: claimed.id,
          claimToken,
          errorCode: classification.errorCode,
          outcome: classification.category === 'ambiguous' ? 'ambiguous' : 'known_failure',
        })
      : await failTranscriptionRun({
          runId: claimed.id,
          claimToken,
          errorCode: classification.errorCode,
          outcome: classification.category === 'ambiguous' ? 'ambiguous' : 'known_failure',
        });
    // Do not project a state this execution did not authoritatively commit.
    // The lease/token condition can fail after a provider outcome is observed.
    if (!transitioned) throw new TranscriptionDeliveryDeferredError();
    await publishCommittedProjection({
      recordingId: recording.id,
      status:
        (transitioned?.state ?? (canRetry ? 'retry_wait' : 'failed')) === 'retry_wait'
          ? 'transcribing'
          : 'failed',
      error:
        (transitioned?.state ?? (canRetry ? 'retry_wait' : 'failed')) === 'retry_wait'
          ? null
          : classification.errorCode,
      recordings,
      hasInjectedRecordings: Boolean(overrides?.recordings),
      publishEvent,
      run: transitioned,
    });

    log.error('Transcription attempt failed', {
      event: 'recording_transcribe_failed',
      provider: sttProvider,
      providerCategory: classification.category,
      errorCode: classification.errorCode,
      ...(structuralDiagnostics
        ? {
            runId: claimed.id,
            recordingId: recording.id,
            sttRequestProfile,
            providerModel,
            submissionSlot,
            structuralValidation: structuralDiagnostics,
          }
        : {}),
    });

    throw new Error(classification.errorCode);
  }
}

async function publishCommittedProjection(params: {
  recordingId: string;
  status: import('../domain/recording-model.js').RecordingStatus;
  error: string | null;
  recordings: TranscribeDependencies['recordings'];
  hasInjectedRecordings: boolean;
  publishEvent: typeof publishRecordingEvent;
  transcriptId?: string;
  run?: Pick<
    import('../domain/transcription-run-repository.js').TranscriptionRun,
    'state' | 'errorCode'
  >;
}): Promise<void> {
  // Production transitions already committed their recording projection inside
  // the run transaction. Read that authority; never issue a second status write
  // just to obtain an event payload. Injected test seams retain their local view.
  const recording = params.hasInjectedRecordings
    ? await params.recordings.updateStatus({
        id: params.recordingId,
        status: params.status,
        error: params.error,
      })
    : await getRecordingByIdForWorker(params.recordingId);
  if (recording) {
    params.publishEvent({
      type: 'recording_state_changed',
      recording,
      ...(params.transcriptId ? { transcriptId: params.transcriptId } : {}),
      ...(params.run ? { run: params.run } : {}),
    });
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

function configuredSttModel(
  config: BatchBackendConfig,
  provider: SttProviderId,
): string | undefined {
  if (provider === 'deepgram') return config.stt.providers.deepgram.model;
  if (provider === 'elevenlabs') return config.stt.providers.elevenlabs.model;
  return config.stt.providers.google.model;
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
