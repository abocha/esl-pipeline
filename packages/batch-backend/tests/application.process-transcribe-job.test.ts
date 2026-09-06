import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import type { SttProviderId } from '@esl-pipeline/contracts';
import { createSttEngine, type SttTranscriptionResult } from '@esl-pipeline/stt-core';
import { createDeepgramSttProvider } from '@esl-pipeline/stt-provider-deepgram';
import { createElevenLabsSttProvider } from '@esl-pipeline/stt-provider-elevenlabs';

const jobLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
}));

const transcriptionRuns = vi.hoisted(() => ({
  claim: vi.fn(async ({ runId }: { runId: string }) => ({
    id: runId,
    recordingId: runId,
    provider: 'elevenlabs',
    claimToken: 'claim-token',
    submissionSlotsReserved: 0,
  })),
  reserve: vi.fn(async ({ runId }: { runId: string }) => ({
    id: runId,
    submissionSlotsReserved: 1,
    currentSubmissionSlot: 1,
  })),
  renew: vi.fn(async () => ({ id: 'run', claimToken: 'claim-token' })),
  complete: vi.fn(async ({ transcript }: { transcript: { id?: string } }) => ({
    transcriptId: transcript.id ?? 'transcript-1',
  })),
  get: vi.fn(async () => ({ submissionSlotsReserved: 1 })),
  retry: vi.fn(async () => ({ state: 'retry_wait' as const })),
  fail: vi.fn(async () => ({ state: 'failed' as const })),
}));

vi.mock('../src/infrastructure/logger.js', () => ({
  createJobLogger: vi.fn(() => jobLogger),
}));

vi.mock('../src/domain/transcription-run-repository.js', () => ({
  claimTranscriptionRun: transcriptionRuns.claim,
  reserveTranscriptionSubmissionSlot: transcriptionRuns.reserve,
  completeTranscriptionRun: transcriptionRuns.complete,
  getTranscriptionRunById: transcriptionRuns.get,
  markTranscriptionRunRetryWait: transcriptionRuns.retry,
  failTranscriptionRun: transcriptionRuns.fail,
  renewTranscriptionRunLease: transcriptionRuns.renew,
}));

import type { TranscribeDependencies } from '../src/application/process-transcribe-job.js';
import {
  processTranscribeJob,
  resolveElevenLabsSttApiKey,
} from '../src/application/process-transcribe-job.js';
import {
  MIXED_ELEVENLABS_PROFILE,
  resolveTranscriptionRoute,
  TRUSTED_SPLIT_DEEPGRAM_PROFILE,
} from '../src/application/transcription-routing.js';
import type { BatchBackendConfig } from '../src/config/env.js';
import type { RecordingRecord } from '../src/domain/recording-model.js';
import type { TranscriptRecord } from '../src/domain/transcript-model.js';
import type { TranscriptionStorage } from '../src/infrastructure/transcription-storage.js';

describe('application/process-transcribe-job', () => {
  it('projects a committed terminal failure after all three submission slots are exhausted', async () => {
    const recording = createRecording('reservation-exhausted');
    const publishEvent = vi.fn();
    transcriptionRuns.reserve.mockResolvedValueOnce(null as never);
    transcriptionRuns.fail.mockResolvedValueOnce({ state: 'failed' } as never);
    const updateStatus = vi.fn(async ({ status, error }) => {
      recording.status = status;
      recording.error = error ?? null;
      return recording;
    });

    await processTranscribeJob(
      { recordingId: recording.id },
      {
        config: createConfig(),
        storage: createStorageStub(),
        sttTranscribe: vi.fn(),
        recordings: { getById: async () => recording, updateStatus },
        transcripts: { getByRecordingId: async () => null, insert: vi.fn() },
        publishEvent,
      },
    );

    expect(transcriptionRuns.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'ambiguous',
        errorCode: 'transcription_unavailable_after_retries',
      }),
    );
    expect(publishEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ recording: expect.objectContaining({ status: 'failed' }) }),
    );
  });

  it('does not publish a fabricated failed projection when terminal transition loses authority', async () => {
    const recording = createRecording('reservation-authority-lost');
    const publishEvent = vi.fn();
    transcriptionRuns.reserve.mockResolvedValueOnce(null as never);
    transcriptionRuns.fail.mockResolvedValueOnce(null as never);
    const updateStatus = vi.fn(async ({ status, error }) => {
      recording.status = status;
      recording.error = error ?? null;
      return recording;
    });

    await processTranscribeJob(
      { recordingId: recording.id },
      {
        config: createConfig(),
        storage: createStorageStub(),
        sttTranscribe: vi.fn(),
        recordings: { getById: async () => recording, updateStatus },
        transcripts: { getByRecordingId: async () => null, insert: vi.fn() },
        publishEvent,
      },
    );

    expect(publishEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ recording: expect.objectContaining({ status: 'failed' }) }),
    );
  });

  it('marks a recording failed when a forced route-resolution error occurs before provider execution', async () => {
    const recording = {
      ...createRecording('trusted-override'),
      audioTopology: 'trusted_split_channels' as const,
    };
    const config = createConfig();
    config.transcription.hardOverride = 'elevenlabs';
    const sttTranscribe = vi.fn();
    const updateStatus = vi.fn(async ({ status, error }) => {
      recording.status = status;
      recording.error = error ?? null;
      return recording;
    });
    const publishEvent = vi.fn();

    await expect(
      processTranscribeJob(
        { recordingId: recording.id },
        {
          config,
          storage: createStorageStub(),
          sttTranscribe,
          recordings: {
            getById: async () => recording,
            updateStatus,
          },
          transcripts: {
            getByRecordingId: async () => null,
            insert: vi.fn(),
          },
          publishEvent,
        },
      ),
    ).rejects.toThrow('transcription_permanent_failure');

    expect(sttTranscribe).not.toHaveBeenCalled();
    expect(updateStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        id: recording.id,
        status: 'failed',
        error: 'transcription_permanent_failure',
      }),
    );
    expect(publishEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'recording_state_changed',
        recording: expect.objectContaining({ status: 'failed' }),
      }),
    );
  });

  it('keeps trusted Deepgram and ordinary mixed ElevenLabs routes distinct', () => {
    const config = createConfig();
    config.stt.defaultProvider = 'elevenlabs';
    config.stt.trustedSplitProvider = 'deepgram';

    expect(resolveTranscriptionRoute({ config, topology: 'mixed_recording' })).toEqual({
      provider: 'elevenlabs',
      profile: MIXED_ELEVENLABS_PROFILE,
    });

    expect(resolveTranscriptionRoute({ config, topology: 'trusted_split_channels' })).toEqual({
      provider: 'deepgram',
      profile: TRUSTED_SPLIT_DEEPGRAM_PROFILE,
    });
    expect(() =>
      resolveTranscriptionRoute({
        config,
        topology: 'trusted_split_channels',
        requestedProvider: 'elevenlabs',
      }),
    ).toThrow(/require the Deepgram multichannel route/i);
    expect(
      resolveTranscriptionRoute({
        config,
        topology: 'mixed_recording',
        requestedProvider: 'elevenlabs',
      }),
    ).toEqual({ provider: 'elevenlabs', profile: MIXED_ELEVENLABS_PROFILE });

    config.transcription.hardOverride = 'deepgram';
    expect(resolveTranscriptionRoute({ config, topology: 'trusted_split_channels' })).toEqual({
      provider: 'deepgram',
      profile: TRUSTED_SPLIT_DEEPGRAM_PROFILE,
    });
  });

  it('persists the ingest-captured preparation version rather than the worker media module version', async () => {
    const recording = createRecording('recording-1');
    const transcriptStore: TranscriptRecord[] = [];
    const updates: string[] = [];

    const storage = createStorageStub();
    const sttTranscribe = vi.fn(async () =>
      createSttResult({
        provider: 'elevenlabs',
        model: 'nova-3',
        language: 'multi',
        text: 'Hello there Hi!',
        segments: [
          { text: 'Hello there', speaker: 0, start: 0.2, end: 0.8 },
          { text: 'Hi!', speaker: 1, start: 1, end: 1.3 },
        ],
      }),
    );

    const result = await processTranscribeJob(
      { recordingId: recording.id, mediaPreparationVersion: 'recording-media-vA' },
      {
        config: createConfig(),
        storage,
        sttTranscribe,
        recordings: {
          async getById(id: string) {
            return id === recording.id ? recording : null;
          },
          async updateStatus({ id, status, error }) {
            if (id !== recording.id) return null;
            recording.status = status;
            recording.error = error ?? null;
            updates.push(status);
            return recording;
          },
        },
        transcripts: {
          async getByRecordingId() {
            return transcriptStore[0] ?? null;
          },
          async insert(params) {
            const transcript: TranscriptRecord = {
              id: params.id ?? 'transcript-1',
              recordingId: params.recordingId,
              storageUri: params.storageUri,
              workingVersion: params.workingVersion,
              contentHash: params.contentHash,
              rawResponseUri: params.rawResponseUri ?? null,
              mode: params.mode,
              model: params.model,
              language: params.language,
              sttProvider: params.sttProvider,
              fallbackUsed: params.fallbackUsed,
              summaryJson: params.summaryJson ?? null,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            transcriptStore.push(transcript);
            return transcript;
          },
        },
        publishEvent: vi.fn(),
      },
    );

    expect(result).not.toBeNull();
    expect(result?.recordingId).toBe(recording.id);
    expect(result?.mode).toBe('timeline');
    expect(result?.fallbackUsed).toBe(false);
    expect(result?.sttProvider).toBe('elevenlabs');
    expect(result).toMatchObject({ workingVersion: 1, contentHash: expect.any(String) });
    expect((result?.summaryJson as { provider?: unknown } | null)?.provider).toBe('elevenlabs');
    expect(
      (result?.summaryJson as { mediaPreparationVersion?: unknown } | null)
        ?.mediaPreparationVersion,
    ).toBe('recording-media-vA');
    expect(updates).toEqual(['transcribing', 'transcribed']);
    expect(sttTranscribe).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'elevenlabs',
      }),
    );
  });

  it('passes a lazy storage-owned provider submission source to the STT engine', async () => {
    const recording = createRecording('recording-source');
    const source = {
      kind: 'file' as const,
      path: 'C:\\recordings\\audio.opus',
      filename: 'audio.opus',
      contentType: 'audio/ogg',
      contentLength: 128,
    };
    const getProviderSubmissionSource = vi.fn(async (uri: string) => {
      expect(uri).toBe(recording.storageUri);
      return source;
    });
    const storage: TranscriptionStorage = {
      ...createStorageStub(),
      getProviderSubmissionSource,
    };
    const sttTranscribe: TranscribeDependencies['sttTranscribe'] = vi.fn(async ({ context }) => {
      expect(context.getSubmissionSource).toBeDefined();
      await expect(context.getSubmissionSource?.()).resolves.toEqual(source);
      return createSttResult({
        provider: 'deepgram',
        model: 'nova-3',
        language: 'multi',
        text: 'Hello there',
        segments: [
          { text: 'Hello', speaker: 0, start: 0, end: 0.5 },
          { text: 'there', speaker: 1, start: 0.6, end: 1 },
        ],
      });
    });

    await processTranscribeJob(
      { recordingId: recording.id },
      {
        config: createConfig(),
        storage,
        sttTranscribe,
        recordings: {
          async getById() {
            return recording;
          },
          async updateStatus({ status, error }) {
            recording.status = status;
            recording.error = error ?? null;
            return recording;
          },
        },
        transcripts: {
          async getByRecordingId() {
            return null;
          },
          async insert(params) {
            return {
              id: params.id ?? 'transcript-source',
              recordingId: params.recordingId,
              storageUri: params.storageUri,
              workingVersion: params.workingVersion,
              contentHash: params.contentHash,
              rawResponseUri: params.rawResponseUri ?? null,
              mode: params.mode,
              model: params.model,
              language: params.language,
              sttProvider: params.sttProvider,
              fallbackUsed: params.fallbackUsed,
              summaryJson: params.summaryJson ?? null,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
          },
        },
        publishEvent: vi.fn(),
      },
    );

    expect(getProviderSubmissionSource).toHaveBeenCalledTimes(1);
  });

  it('leaves historical recordings without a preparation version cache-ineligible', async () => {
    const recording = createRecording('historical-recording');
    const transcriptStore: TranscriptRecord[] = [];

    const result = await processTranscribeJob(
      { recordingId: recording.id },
      {
        config: createConfig(),
        storage: createStorageStub(),
        sttTranscribe: vi.fn(async () =>
          createSttResult({
            provider: 'deepgram',
            model: 'nova-3',
            language: 'multi',
            text: 'Historical recording.',
            segments: [
              { text: 'Historical', speaker: 0, start: 0, end: 0.4 },
              { text: 'recording.', speaker: 1, start: 0.5, end: 1 },
            ],
          }),
        ),
        recordings: {
          async getById(id: string) {
            return id === recording.id ? recording : null;
          },
          async updateStatus({ id, status, error }) {
            if (id !== recording.id) return null;
            recording.status = status;
            recording.error = error ?? null;
            return recording;
          },
        },
        transcripts: {
          async getByRecordingId() {
            return transcriptStore[0] ?? null;
          },
          async insert(params) {
            const transcript: TranscriptRecord = {
              id: params.id ?? 'historical-transcript',
              recordingId: params.recordingId,
              storageUri: params.storageUri,
              workingVersion: params.workingVersion,
              contentHash: params.contentHash,
              rawResponseUri: params.rawResponseUri ?? null,
              mode: params.mode,
              model: params.model,
              language: params.language,
              sttProvider: params.sttProvider,
              fallbackUsed: params.fallbackUsed,
              summaryJson: params.summaryJson ?? null,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            transcriptStore.push(transcript);
            return transcript;
          },
        },
        publishEvent: vi.fn(),
      },
    );

    expect(result?.summaryJson).not.toHaveProperty('mediaPreparationVersion');
  });

  it('accepts ELEVENLABS_API_TOKEN fallback for ElevenLabs STT credentials', () => {
    const config = createConfig();
    config.stt.providers.elevenlabs.apiKey = undefined;
    config.orchestrator.elevenLabsApiKey = undefined;

    const previousApiKey = process.env.ELEVENLABS_API_KEY;
    const previousApiToken = process.env.ELEVENLABS_API_TOKEN;
    delete process.env.ELEVENLABS_API_KEY;
    process.env.ELEVENLABS_API_TOKEN = 'token-only-credential';

    try {
      expect(resolveElevenLabsSttApiKey(config)).toBe('token-only-credential');
    } finally {
      if (previousApiKey === undefined) {
        delete process.env.ELEVENLABS_API_KEY;
      } else {
        process.env.ELEVENLABS_API_KEY = previousApiKey;
      }
      if (previousApiToken === undefined) {
        delete process.env.ELEVENLABS_API_TOKEN;
      } else {
        process.env.ELEVENLABS_API_TOKEN = previousApiToken;
      }
    }
  });

  it('persists fallbackUsed when provider returns fallback transcript', async () => {
    const recording = createRecording('recording-fallback');
    const inserted: TranscriptRecord[] = [];

    await processTranscribeJob(
      { recordingId: recording.id },
      {
        config: createConfig(),
        storage: createStorageStub(),
        sttTranscribe: vi.fn(async () =>
          createSttResult({
            provider: 'elevenlabs',
            model: 'scribe_v2',
            language: 'auto',
            text: 'Fallback text here',
            segments: [
              { text: 'Fallback text', speaker: 0, start: 0.1, end: 0.5 },
              { text: 'here', speaker: 1, start: 0.6, end: 0.9 },
            ],
            fallbackUsed: true,
          }),
        ),
        recordings: {
          async getById() {
            return recording;
          },
          async updateStatus({ status }) {
            recording.status = status;
            return recording;
          },
        },
        transcripts: {
          async getByRecordingId() {
            return null;
          },
          async insert(params) {
            const transcript: TranscriptRecord = {
              id: params.id ?? 'transcript-fallback',
              recordingId: params.recordingId,
              storageUri: params.storageUri,
              workingVersion: params.workingVersion,
              contentHash: params.contentHash,
              rawResponseUri: params.rawResponseUri ?? null,
              mode: params.mode,
              model: params.model,
              language: params.language,
              sttProvider: params.sttProvider,
              fallbackUsed: params.fallbackUsed,
              summaryJson: params.summaryJson ?? null,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            inserted.push(transcript);
            return transcript;
          },
        },
        publishEvent: vi.fn(),
      },
    );

    expect(inserted[0]?.fallbackUsed).toBe(true);
    expect(inserted[0]?.sttProvider).toBe('elevenlabs');
  });

  it('marks recording failed when STT provider throws', async () => {
    const recording = createRecording('recording-fail');

    await expect(
      processTranscribeJob(
        { recordingId: recording.id },
        {
          config: createConfig(),
          storage: createStorageStub(),
          sttTranscribe: vi.fn(async () => {
            throw new Error('service unavailable');
          }),
          recordings: {
            async getById() {
              return recording;
            },
            async updateStatus({ status, error }) {
              recording.status = status;
              recording.error = error ?? null;
              return recording;
            },
          },
          transcripts: {
            async getByRecordingId() {
              return null;
            },
            async insert() {
              throw new Error('insert should not be called on failures');
            },
          },
          publishEvent: vi.fn(),
        },
      ),
    ).rejects.toThrow('transcription_permanent_failure');

    expect(recording.status).toBe('failed');
    expect(recording.error).toBe('transcription_permanent_failure');
  });

  it('routes a malformed successful trusted-channel Deepgram result through retry_wait classification', async () => {
    const recording = {
      ...createRecording('recording-malformed-deepgram'),
      audioTopology: 'trusted_split_channels' as const,
    };
    const provider = createDeepgramSttProvider({
      clientFactory: () => ({
        listen: {
          v1: {
            media: {
              async transcribeFile() {
                return {
                  metadata: { channels: 2 },
                  results: {
                    channels: [{ alternatives: [{ transcript: 'Only one channel' }] }],
                    utterances: [{ channel: 0, transcript: 'Only one channel', start: 0, end: 1 }],
                  },
                };
              },
            },
          },
        },
      }),
    });
    transcriptionRuns.claim.mockResolvedValueOnce({
      id: recording.id,
      recordingId: recording.id,
      provider: 'deepgram',
      claimToken: 'claim-token',
      submissionSlotsReserved: 0,
    });
    const config = createConfig();
    config.stt.defaultProvider = 'deepgram';
    config.stt.trustedSplitProvider = 'deepgram';
    config.stt.providers.deepgram.apiKey = 'deepgram-test-key';
    const updateStatus = vi.fn(async ({ status, error }) => {
      recording.status = status;
      recording.error = error ?? null;
      return recording;
    });
    const publishEvent = vi.fn();

    let thrown: unknown;
    try {
      await processTranscribeJob(
        { recordingId: recording.id },
        {
          config,
          storage: createStorageStub(),
          sttTranscribe: ({ context }) =>
            provider.transcribe({
              context,
              config: {
                apiKey: 'deepgram-test-key',
                  model: 'nova-3',
                  language: 'en',
                trustedSplitChannels: true,
              },
            }),
          recordings: { getById: async () => recording, updateStatus },
          transcripts: { getByRecordingId: async () => null, insert: vi.fn() },
          publishEvent,
        },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toHaveProperty('message', 'malformed_provider_result');
    expect(transcriptionRuns.retry).toHaveBeenLastCalledWith(
      expect.objectContaining({ errorCode: 'malformed_provider_result', outcome: 'known_failure' }),
    );
    expect(updateStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'transcribing', error: null }),
    );
    expect(publishEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ recording: expect.objectContaining({ status: 'transcribing' }) }),
    );
  });

  it('keeps reflected signed URL details out of worker persistence and logs', async () => {
    const secret = 'SIGNED_URL_SECRET_123';
    const signedUrl = `https://storage.example.test/audio.mp3?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=${secret}`;
    const rawCause = new Error(`provider cause ${signedUrl}`);
    const rawError = new Error(`provider message ${signedUrl}`);
    const providerCodeSecret = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    Object.assign(rawError, {
      body: { message: `provider body ${signedUrl}` },
      status: 504,
      code: providerCodeSecret,
    });
    Object.defineProperty(rawError, 'cause', { value: rawCause, enumerable: true });
    rawError.stack = `Error: provider stack ${signedUrl}`;

    const recording = { ...createRecording('recording-url-secret') };
    recording.storageUri = 's3://bucket/recordings/recording.mp3';
    const storage = createStorageStub();
    storage.getProviderSubmissionSource = async () => ({
      kind: 'url' as const,
      url: signedUrl,
    });
    const config = createConfig();
    config.stt.defaultProvider = 'elevenlabs';
    config.stt.providers.elevenlabs.apiKey = 'elevenlabs-test-key';
    const convert = vi.fn().mockRejectedValue(rawError);
    const provider = createElevenLabsSttProvider({
      clientFactory: () => ({ speechToText: { convert } }),
    });
    const sttEngine = createSttEngine([provider]);
    const updateStatus = vi.fn(async ({ status, error }) => {
      recording.status = status;
      recording.error = error ?? null;
      return recording;
    });
    jobLogger.error.mockClear();

    let thrown: unknown;
    try {
      await processTranscribeJob(
        { recordingId: recording.id },
        {
          config,
          storage,
          sttTranscribe: (args) => sttEngine.transcribe(args),
          recordings: {
            getById: async () => recording,
            updateStatus,
          },
          transcripts: {
            getByRecordingId: async () => null,
            insert: vi.fn(),
          },
          publishEvent: vi.fn(),
        },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBe(rawError);
    expect((thrown as Error).message).not.toContain(signedUrl);
    expect((thrown as Error).message).not.toContain('X-Amz-Signature');
    expect((thrown as Error).message).not.toContain(secret);
    expect((thrown as Error).message).not.toContain(providerCodeSecret);
    expect((thrown as Error).stack).not.toContain(signedUrl);
    expect((thrown as Error).stack).not.toContain('X-Amz-Signature');
    expect((thrown as Error).stack).not.toContain(secret);
    expect((thrown as Error).stack).not.toContain(providerCodeSecret);
    expect((thrown as Error & { cause?: unknown }).cause).toBeUndefined();
    expect((thrown as Error & { status?: number }).status).toBeUndefined();
    expect((thrown as Error & { code?: string }).code).toBeUndefined();
    expect(recording.status).toBe('transcribing');
    expect(recording.error).toBeNull();
    const persistedRecording = JSON.stringify(recording);
    expect(persistedRecording).not.toContain(signedUrl);
    expect(persistedRecording).not.toContain('X-Amz-Signature');
    expect(persistedRecording).not.toContain(secret);
    expect(convert).toHaveBeenCalledTimes(1);
    expect(jobLogger.error).toHaveBeenCalledTimes(1);
    const loggedError = jobLogger.error.mock.calls[0]?.[0];
    expect(loggedError).toBe('Transcription attempt failed');
    const applicationLogs = JSON.stringify(jobLogger.error.mock.calls);
    expect(applicationLogs).not.toContain(signedUrl);
    expect(applicationLogs).not.toContain('X-Amz-Signature');
    expect(applicationLogs).not.toContain(secret);
    expect(applicationLogs).not.toContain(providerCodeSecret);
    expect(jobLogger.error.mock.calls[0]?.[1]).toMatchObject({
      provider: 'elevenlabs',
      providerCategory: 'transient',
    });
  });

  it('does not persist arbitrary URL-backed provider responses', async () => {
    const signedUrl =
      'https://storage.example.test/audio.mp3?X-Amz-Signature=SIGNED_URL_SECRET_123&X-Amz-Security-Token=TEMP_TOKEN_SECRET_456';
    const recording = {
      ...createRecording('recording-url-success'),
      storageUri: 's3://bucket/recordings/recording.mp3',
    };
    const storedTexts: string[] = [];
    const putRawResponse = vi.fn(async () => ({
      uri: 'local://transcripts/raw.json',
      bytes: 1,
      sha256: 'raw-hash',
    }));
    const storage: TranscriptionStorage = {
      ...createStorageStub(),
      putRawResponse,
      async putTranscript({ text }) {
        storedTexts.push(text);
        return { uri: 'local://transcripts/transcript.txt', bytes: text.length, sha256: 'hash' };
      },
      async getProviderSubmissionSource() {
        return { kind: 'url' as const, url: signedUrl };
      },
    };
    const config = createConfig();
    config.stt.defaultProvider = 'elevenlabs';
    config.stt.providers.elevenlabs.apiKey = 'elevenlabs-test-key';
    const convert = vi.fn(async (_request: Record<string, unknown>) => ({
      language_code: 'eng',
      language_probability: 1,
      text: 'Hello there',
      words: [
        { text: 'Hello', speakerId: 'speaker_0', start: 0, end: 0.4 },
        { text: 'there', speakerId: 'speaker_1', start: 0.5, end: 0.9 },
      ],
      provider_echo: signedUrl,
      diagnostics: { nested_secret: 'TEMP_TOKEN_SECRET_456' },
    }));
    const provider = createElevenLabsSttProvider({
      clientFactory: () => ({ speechToText: { convert } }),
    });
    const sttEngine = createSttEngine([provider]);
    const inserted: TranscriptRecord[] = [];
    const updateStatus = vi.fn(async ({ status, error }) => {
      recording.status = status;
      recording.error = error ?? null;
      return recording;
    });
    jobLogger.info.mockClear();
    jobLogger.error.mockClear();

    const result = await processTranscribeJob(
      { recordingId: recording.id },
      {
        config,
        storage,
        sttTranscribe: (args) => sttEngine.transcribe(args),
        recordings: {
          getById: async () => recording,
          updateStatus,
        },
        transcripts: {
          getByRecordingId: async () => null,
          async insert(params) {
            const transcript: TranscriptRecord = {
              id: params.id ?? 'transcript-url-success',
              recordingId: params.recordingId,
              storageUri: params.storageUri,
              workingVersion: params.workingVersion,
              contentHash: params.contentHash,
              rawResponseUri: params.rawResponseUri ?? null,
              mode: params.mode,
              model: params.model,
              language: params.language,
              sttProvider: params.sttProvider,
              fallbackUsed: params.fallbackUsed,
              summaryJson: params.summaryJson ?? null,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            inserted.push(transcript);
            return transcript;
          },
        },
        publishEvent: vi.fn(),
      },
    );

    expect(result).not.toBeNull();
    expect(recording.status).toBe('transcribed');
    expect(recording.error).toBeNull();
    expect(storedTexts).toContain('[Speaker 1 00:00] Hello\n[Speaker 2 00:01] there');
    expect(inserted[0]?.rawResponseUri).toBeNull();
    expect(putRawResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        transcriptId: expect.stringContaining('-speaker-tracks'),
      }),
    );
    expect(convert).toHaveBeenCalledTimes(1);
    const durableState = JSON.stringify({ recording, inserted, storedTexts });
    expect(durableState).not.toContain(signedUrl);
    expect(durableState).not.toContain('SIGNED_URL_SECRET_123');
    expect(durableState).not.toContain('TEMP_TOKEN_SECRET_456');
    expect(JSON.stringify(putRawResponse.mock.calls)).not.toContain(signedUrl);
    expect(JSON.stringify(jobLogger.info.mock.calls)).not.toContain('SIGNED_URL_SECRET_123');
    expect(JSON.stringify(jobLogger.info.mock.calls)).not.toContain('TEMP_TOKEN_SECRET_456');
    expect(jobLogger.error).not.toHaveBeenCalled();
  });

  it('contains normalized URL credential reflections before worker persistence and logging', async () => {
    const signedUrl =
      'https://storage.example.test/audio.mp3?X-Amz-Signature=SIGNED_URL_SECRET_123&X-Amz-Security-Token=TEMP_TOKEN_SECRET_456';
    const recording = {
      ...createRecording('recording-url-contaminated'),
      storageUri: 's3://bucket/recordings/recording.mp3',
    };
    const storage = createStorageStub();
    const putRawResponse = vi.fn(storage.putRawResponse);
    storage.putRawResponse = putRawResponse;
    storage.getProviderSubmissionSource = async () => ({
      kind: 'url' as const,
      url: signedUrl,
    });
    const config = createConfig();
    config.stt.defaultProvider = 'elevenlabs';
    config.stt.providers.elevenlabs.apiKey = 'elevenlabs-test-key';
    const convert = vi.fn(async (_request: Record<string, unknown>) => ({
      language_code: 'eng',
      language_probability: 1,
      text: signedUrl,
      words: [],
    }));
    const provider = createElevenLabsSttProvider({
      clientFactory: () => ({ speechToText: { convert } }),
    });
    const sttEngine = createSttEngine([provider]);
    const updateStatus = vi.fn(async ({ status, error }) => {
      recording.status = status;
      recording.error = error ?? null;
      return recording;
    });
    jobLogger.info.mockClear();
    jobLogger.error.mockClear();

    let thrown: unknown;
    try {
      await processTranscribeJob(
        { recordingId: recording.id },
        {
          config,
          storage,
          sttTranscribe: (args) => sttEngine.transcribe(args),
          recordings: {
            getById: async () => recording,
            updateStatus,
          },
          transcripts: {
            getByRecordingId: async () => null,
            insert: vi.fn(),
          },
          publishEvent: vi.fn(),
        },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('transcription_unavailable_after_retries');
    expect(recording.status).toBe('transcribing');
    expect(recording.error).toBeNull();
    expect(putRawResponse).not.toHaveBeenCalled();
    const workerState = JSON.stringify({ recording, thrown });
    expect(workerState).not.toContain(signedUrl);
    expect(workerState).not.toContain('SIGNED_URL_SECRET_123');
    expect(workerState).not.toContain('TEMP_TOKEN_SECRET_456');
    expect(JSON.stringify(jobLogger.error.mock.calls)).not.toContain(signedUrl);
    expect(JSON.stringify(jobLogger.error.mock.calls)).not.toContain('SIGNED_URL_SECRET_123');
    expect(JSON.stringify(jobLogger.error.mock.calls)).not.toContain('TEMP_TOKEN_SECRET_456');
    expect(jobLogger.error.mock.calls[0]?.[1]).toMatchObject({
      provider: 'elevenlabs',
      providerCategory: 'ambiguous',
    });
    expect(convert).toHaveBeenCalledTimes(1);
  });

  it('fails loudly when provider raises async accepted response error', async () => {
    const recording = createRecording('recording-accepted-response');

    await expect(
      processTranscribeJob(
        { recordingId: recording.id },
        {
          config: createConfig(),
          storage: createStorageStub(),
          sttTranscribe: vi.fn(async () => {
            throw new Error(
              'Deepgram returned async accepted response (request_id=req-123); synchronous transcription response is required.',
            );
          }),
          recordings: {
            async getById() {
              return recording;
            },
            async updateStatus({ status, error }) {
              recording.status = status;
              recording.error = error ?? null;
              return recording;
            },
          },
          transcripts: {
            async getByRecordingId() {
              return null;
            },
            async insert() {
              throw new Error('insert should not be called for async accepted responses');
            },
          },
          publishEvent: vi.fn(),
        },
      ),
    ).rejects.toThrow('transcription_permanent_failure');

    expect(recording.status).toBe('failed');
  });

  it('formats transcript with speaker labels and merges adjacent utterances', async () => {
    const recording = createRecording('recording-3');
    const storedTexts: string[] = [];

    const storage: TranscriptionStorage = {
      ...createStorageStub(),
      async putTranscript({ text }) {
        storedTexts.push(text);
        return { uri: 'local://transcripts/transcript.txt', bytes: text.length, sha256: 'hash' };
      },
    };

    await processTranscribeJob(
      { recordingId: recording.id },
      {
        config: createConfig(),
        storage,
        sttTranscribe: vi.fn(async () =>
          createSttResult({
            provider: 'deepgram',
            model: 'nova-3',
            language: 'multi',
            text: 'Hello there. Hi.',
            segments: [
              { text: 'Hello there.', speaker: 0, start: 0, end: 1.2 },
              { text: 'Hi.', speaker: 1, start: 2, end: 2.4 },
            ],
          }),
        ),
        recordings: {
          async getById() {
            return recording;
          },
          async updateStatus({ status }) {
            recording.status = status;
            return recording;
          },
        },
        transcripts: {
          async getByRecordingId() {
            return null;
          },
          async insert(params) {
            return {
              id: params.id ?? 'transcript-3',
              recordingId: params.recordingId,
              storageUri: params.storageUri,
              workingVersion: params.workingVersion,
              contentHash: params.contentHash,
              rawResponseUri: params.rawResponseUri ?? null,
              mode: params.mode,
              model: params.model,
              language: params.language,
              sttProvider: params.sttProvider,
              fallbackUsed: params.fallbackUsed,
              summaryJson: params.summaryJson ?? null,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
          },
        },
        publishEvent: vi.fn(),
      },
    );

    expect(storedTexts).toContain('[Speaker 1 00:00] Hello there.\n[Speaker 2 00:02] Hi.');
    expect(storedTexts).toContain('Hello there.');
    expect(storedTexts).toContain('Hi.');
  });
});

function createRecording(id: string): RecordingRecord {
  return {
    id,
    workspaceId: 'workspace-1',
    source: 'upload',
    audioLifecycle: 'retained',
    studentId: null,
    sourcePath: '/tmp/audio.opus',
    storageUri: 'local://recordings/recording.opus',
    sha256: 'hash',
    bytes: 10,
    durationSec: null,
    channels: null,
    status: 'queued',
    error: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createConfig(): BatchBackendConfig {
  return {
    nodeEnv: 'test',
    httpPort: 0,
    pg: {
      enabled: false,
      host: '',
      port: 0,
      user: '',
      password: '',
      database: '',
      applicationName: 'esl-pipeline-test',
      poolMax: 10,
      idleTimeoutMs: 30_000,
      connectionTimeoutMs: 5_000,
      autoMigrateOnBoot: false,
      migrationLockKey: '910001',
    },
    redis: {
      enabled: false,
      host: '',
      port: 0,
    },
    queue: { name: 'esl-jobs' },
    transcription: {
      queueName: 'transcribe-queue',
      mode: 'timeline',
      maxConcurrency: 1,
      sttProvider: 'deepgram',
      sttProviders: ['deepgram', 'elevenlabs', 'google'],
      reconciliationIntervalMs: 30_000,
      reconciliationBatchSize: 100,
    },
    studentMemory: {
      queueName: 'student-memory-queue',
      maxConcurrency: 1,
      openAiBatchEnabled: false,
    },
    stt: {
      defaultProvider: 'deepgram',
      providerOrder: ['deepgram', 'elevenlabs', 'google'],
      storeRawResponse: true,
      providers: {
        deepgram: {
          apiKey: 'dg-key',
          accessToken: undefined,
          model: 'nova-3',
          language: 'multi',
        },
        elevenlabs: {
          apiKey: undefined,
          model: 'scribe_v2',
        },
        google: {
          projectId: '',
          location: 'us-central1',
          recognizer: undefined,
          model: 'latest_long',
          languageCodes: ['en-US'],
          gcsStagingBucket: '',
          gcsStagingPrefix: 'stt-staging',
        },
      },
    },
    recordings: { maxFileSize: 0, diskReserveBytes: 0 },
    deepgram: {
      apiKey: 'dg-key',
      accessToken: undefined,
      model: 'nova-3',
      language: 'multi',
      storeRawResponse: true,
    },
    worker: {
      concurrency: 1,
      maxConcurrentFfmpeg: 1,
      ttsCacheDir: '/tmp/tts-cache',
      ttsCacheMaxAgeDays: 30,
      ttsCacheMaxBytes: 10 * 1024 * 1024 * 1024,
      ttsCacheMaintenanceIntervalMinutes: 60,
      ttsCacheMaintenanceLockKey: '910021',
    },
    mail: {
      enabled: false,
      host: '',
      port: 0,
      from: '',
      secure: false,
    },
    orchestrator: {
      manifestStore: 'filesystem',
      configProvider: 'local',
    },
    auth: {
      jwtSecret: 'secret',
      jwtExpiresIn: '1h',
      refreshTokenExpiresIn: '1d',
      bcryptRounds: 10,
      refreshCookieName: 'esl_refresh',
      refreshCookieSecure: false,
      refreshCookieSameSite: 'lax',
      refreshCookiePath: '/',
    },
    security: {
      maxFileSize: 0,
      allowedMimeTypes: [],
      uploadRateLimit: 0,
      uploadBurstLimit: 0,
      enableFileValidation: false,
      enableFileSanitization: false,
      enableRateLimiting: false,
      enableSecurityLogging: false,
      corsCredentials: false,
      enableCors: false,
      securityHeadersEnabled: false,
      hstsMaxAge: 0,
      uploadQuotaPerUser: 0,
      jobSubmissionRateLimit: 0,
    },
    storage: {
      provider: 'filesystem',
      presignedUrlExpiresIn: 0,
    },
    generation: {
      defaultProvider: 'openai',
      fallbackProviders: ['google_ai_studio', 'openrouter'],
      quotaSourceMode: 'hybrid',
      safetyMode: 'hard_stop',
      strictNoPaid: true,
      maxOutputTokensHard: 1200,
      budgetEmergencyOverride: false,
      models: {
        openai: {
          primary: 'gpt-5.2',
          fallback: 'gpt-5-mini',
          allowed: ['gpt-5.2', 'gpt-5-mini'],
        },
        googleAiStudio: {
          primary: 'gemini-3-flash-preview',
          fallback: 'gemini-2.5-flash-lite',
          tertiary: 'gemini-2.5-pro',
          allowed: ['gemini-3-flash-preview', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'],
        },
        openrouter: {
          allowed: [],
        },
      },
      providers: {
        openai: {
          apiKey: undefined,
          requestTimeoutMs: 240_000,
          retryMax: 1,
          retryBackoffMs: 250,
          dailyTokenBudget: 120_000,
          dailyRequestBudget: 40,
          rpmBudget: 3,
        },
        googleAiStudio: {
          apiKey: undefined,
          requestTimeoutMs: 240_000,
          retryMax: 1,
          retryBackoffMs: 250,
          dailyRequestBudget: 12,
          rpmBudget: 4,
        },
        openrouter: {
          apiKey: undefined,
          httpReferer: undefined,
          xTitle: undefined,
          requestTimeoutMs: 240_000,
          retryMax: 1,
          retryBackoffMs: 250,
          dailyTokenBudget: 0,
          dailyRequestBudget: 0,
          rpmBudget: 0,
        },
      },
    },
    speechPlanner: {
      enabled: false,
      provider: 'google_ai_studio',
      model: 'gemini-3.1-flash-lite',
      maxOutputTokens: 2400,
      rpmBudget: 4,
      dailyRequestBudget: 120,
      debugLogPlan: false,
    },
    voiceRanker: {
      enabled: true,
      model: 'gemma-4-31b-it',
      maxOutputTokens: 1200,
      rpmBudget: 12,
      dailyRequestBudget: 1000,
      debugLogPlan: false,
    },
    prompt: {
      templatePath: '',
      defaultProfilePath: '',
    },
    drafts: {
      localExport: false,
    },
    jobOptions: {
      allowStaticFallback: false,
    },
    opsControl: {
      enabled: false,
      botSharedSecret: undefined,
      statusCommand: 'echo {}',
      backupCommand: 'echo backup',
      restoreDrillCommand: 'echo restore-drill',
      actionTimeoutMs: 60_000,
      actionHistoryLimit: 100,
      actionRetentionDays: 30,
    },
    experimental: {
      extendedApiEnabled: false,
    },
  };
}

function createStorageStub(): TranscriptionStorage {
  return {
    async putAudio() {
      return { uri: 'local://recordings/recording.opus', bytes: 10, sha256: 'hash' };
    },
    async putTranscript() {
      return { uri: 'local://transcripts/transcript.txt', bytes: 10, sha256: 'transcript-hash' };
    },
    async putRawResponse() {
      return { uri: 'local://transcripts/transcript.json', bytes: 10, sha256: 'raw-hash' };
    },
    async putPromptPackage() {
      return { uri: 'local://prompt-packages/prompt.txt', bytes: 10, sha256: 'prompt-hash' };
    },
    async putDraft() {
      return { uri: 'local://drafts/draft.md', bytes: 10, sha256: 'draft-hash' };
    },
    async getText() {
      return 'text';
    },
    async getStream() {
      return Readable.from(['audio']);
    },
    async delete() {},
  };
}

function createSttResult(params: {
  provider: SttProviderId;
  model: string;
  language: string;
  text: string;
  segments: SttTranscriptionResult['segments'];
  fallbackUsed?: boolean;
}): SttTranscriptionResult {
  return {
    provider: params.provider,
    model: params.model,
    language: params.language,
    text: params.text,
    segments: params.segments,
    rawResponse: { provider: params.provider },
    fallbackUsed: params.fallbackUsed ?? false,
    summary: {
      provider: params.provider,
      segmentCount: params.segments.length,
    },
  };
}
