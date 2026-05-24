import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import type { SttProviderId } from '@esl-pipeline/contracts';
import type { SttTranscriptionResult } from '@esl-pipeline/stt-core';

import {
  processTranscribeJob,
  resolveElevenLabsSttApiKey,
} from '../src/application/process-transcribe-job.js';
import type { BatchBackendConfig } from '../src/config/env.js';
import type { RecordingRecord } from '../src/domain/recording-model.js';
import type { TranscriptRecord } from '../src/domain/transcript-model.js';
import type { TranscriptionStorage } from '../src/infrastructure/transcription-storage.js';

describe('application/process-transcribe-job', () => {
  it('transcribes recording and persists transcript metadata', async () => {
    const recording = createRecording('recording-1');
    const transcriptStore: TranscriptRecord[] = [];
    const updates: string[] = [];

    const storage = createStorageStub();
    const sttTranscribe = vi.fn(async () =>
      createSttResult({
        provider: 'deepgram',
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
      { recordingId: recording.id },
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
    expect(result?.sttProvider).toBe('deepgram');
    expect((result?.summaryJson as { provider?: unknown } | null)?.provider).toBe('deepgram');
    expect(updates).toEqual(['transcribing', 'transcribed']);
    expect(sttTranscribe).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'deepgram',
      }),
    );
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
            text: 'Fallback text',
            segments: [{ text: 'Fallback text', speaker: 0, start: 0.1, end: 0.9 }],
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
    ).rejects.toThrow('service unavailable');

    expect(recording.status).toBe('failed');
    expect(recording.error).toContain('service unavailable');
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
    ).rejects.toThrow(/async accepted response/i);

    expect(recording.status).toBe('failed');
  });

  it('formats transcript with speaker labels and merges adjacent utterances', async () => {
    const recording = createRecording('recording-3');
    const storedTexts: string[] = [];

    const storage: TranscriptionStorage = {
      ...createStorageStub(),
      async putTranscript({ text }) {
        storedTexts.push(text);
        return { uri: 'local://transcripts/transcript.txt', bytes: text.length };
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

    expect(storedTexts).toContain('[Teacher 00:00] Hello there.\n[Student 00:02] Hi.');
    expect(storedTexts).toContain('Hello there.');
    expect(storedTexts).toContain('Hi.');
  });
});

function createRecording(id: string): RecordingRecord {
  return {
    id,
    source: 'upload',
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
    },
    studentMemory: {
      queueName: 'student-memory-queue',
      maxConcurrency: 1,
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
    recordings: { maxFileSize: 0 },
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
      return { uri: 'local://transcripts/transcript.txt', bytes: 10 };
    },
    async putRawResponse() {
      return { uri: 'local://transcripts/transcript.json', bytes: 10 };
    },
    async putPromptPackage() {
      return { uri: 'local://prompt-packages/prompt.txt', bytes: 10 };
    },
    async putDraft() {
      return { uri: 'local://drafts/draft.md', bytes: 10 };
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
