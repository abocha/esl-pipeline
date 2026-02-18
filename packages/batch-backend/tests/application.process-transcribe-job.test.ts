import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { processTranscribeJob } from '../src/application/process-transcribe-job.js';
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
    const deepgramClient = createDeepgramStub({
      results: {
        utterances: [
          { transcript: 'Hello there', speaker: 0, start: 0.2 },
          { transcript: 'Hi!', speaker: 1, start: 1 },
        ],
        channels: [
          {
            alternatives: [{ transcript: 'Hello there Hi!' }],
          },
        ],
      },
    });

    const config = createConfig();

    const result = await processTranscribeJob(
      { recordingId: recording.id },
      {
        config,
        storage,
        deepgramClient,
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
    expect(result?.storageUri).toContain('local://transcripts/');
    expect(updates).toEqual(['transcribing', 'transcribed']);
  });

  it('uses fallback diarized transcription when multichannel fails', async () => {
    const recording = createRecording('recording-2');
    const storage = createStorageStub();
    const deepgramClient = createDeepgramStub(null, {
      results: {
        utterances: [{ transcript: 'Fallback text', speaker: 0, start: 0.1 }],
        channels: [{ alternatives: [{ transcript: 'Fallback text' }] }],
      },
    });

    const inserted: TranscriptRecord[] = [];

    await processTranscribeJob(
      { recordingId: recording.id },
      {
        config: createConfig(),
        storage,
        deepgramClient,
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
              id: params.id ?? 'transcript-2',
              recordingId: params.recordingId,
              storageUri: params.storageUri,
              rawResponseUri: params.rawResponseUri ?? null,
              mode: params.mode,
              model: params.model,
              language: params.language,
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
  });

  it('retries transient terminated transport errors and succeeds', async () => {
    const recording = createRecording('recording-retry-terminated');
    let attemptCount = 0;

    const deepgramClient = {
      listen: {
        prerecorded: {
          async transcribeFile() {
            attemptCount += 1;
            if (attemptCount === 1) {
              throw new TypeError('terminated');
            }
            return {
              result: {
                metadata: { channels: 2 },
                results: {
                  utterances: [{ transcript: 'Recovered transcript', speaker: 0, start: 0.1 }],
                  channels: [
                    { alternatives: [{ transcript: 'Recovered transcript' }] },
                    { alternatives: [{ transcript: '' }] },
                  ],
                },
              },
              error: undefined,
            };
          },
        },
      },
    };

    const result = await processTranscribeJob(
      { recordingId: recording.id },
      {
        config: createConfig(),
        storage: createStorageStub(),
        deepgramClient,
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
              id: params.id ?? 'transcript-retry-terminated',
              recordingId: params.recordingId,
              storageUri: params.storageUri,
              rawResponseUri: params.rawResponseUri ?? null,
              mode: params.mode,
              model: params.model,
              language: params.language,
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

    expect(result).not.toBeNull();
    expect(result?.fallbackUsed).toBe(false);
    expect(attemptCount).toBe(2);
    expect(recording.status).toBe('transcribed');
    expect(recording.error).toBeNull();
  });

  it('formats transcript with speaker labels and merges adjacent utterances', async () => {
    const recording = createRecording('recording-3');
    const stored: { text?: string } = {};

    const storage: TranscriptionStorage = {
      ...createStorageStub(),
      async putTranscript({ text }) {
        stored.text = text;
        return { uri: 'local://transcripts/transcript.txt', bytes: text.length };
      },
    };

    const deepgramClient = createDeepgramStub({
      metadata: { channels: 2 },
      results: {
        utterances: [
          { transcript: 'Hello', speaker: 0, start: 0, end: 0.5 },
          { transcript: 'there.', speaker: 0, start: 0.7, end: 1.2 },
          { transcript: 'Hi.', speaker: 1, start: 2, end: 2.4 },
        ],
        channels: [
          { alternatives: [{ transcript: 'Hello there.' }] },
          { alternatives: [{ transcript: 'Hi.' }] },
        ],
      },
    });

    await processTranscribeJob(
      { recordingId: recording.id },
      {
        config: createConfig(),
        storage,
        deepgramClient,
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

    expect(stored.text).toBe(
      '[Teacher 00:00.000-00:01.200] Hello there.\n[Student 00:02.000-00:02.400] Hi.',
    );
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
    },
    redis: {
      enabled: false,
      host: '',
      port: 0,
    },
    queue: { name: 'esl-jobs' },
    transcription: { queueName: 'transcribe-queue', mode: 'timeline', maxConcurrency: 1 },
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
      models: {
        openai: {
          primary: 'gpt-5.2',
          fallback: 'gpt-5-mini',
        },
        googleAiStudio: {
          primary: 'gemini-3-flash-preview',
          fallback: 'gemini-2.5-flash-lite',
          tertiary: 'gemini-2.5-pro',
        },
        openrouter: {},
      },
      providers: {
        openai: {
          apiKey: undefined,
          requestTimeoutMs: 30_000,
          retryMax: 1,
          retryBackoffMs: 250,
          dailyTokenBudget: undefined,
        },
        googleAiStudio: {
          apiKey: undefined,
          requestTimeoutMs: 30_000,
          retryMax: 1,
          retryBackoffMs: 250,
          dailyRequestBudget: undefined,
        },
        openrouter: {
          apiKey: undefined,
          httpReferer: undefined,
          xTitle: undefined,
          requestTimeoutMs: 30_000,
          retryMax: 1,
          retryBackoffMs: 250,
          dailyTokenBudget: undefined,
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

function createDeepgramStub(primaryResult?: unknown, fallbackResult?: unknown) {
  const calls: unknown[] = [];
  return {
    listen: {
      prerecorded: {
        async transcribeFile(_stream: Readable, options: Record<string, unknown>) {
          calls.push(options);
          if (calls.length === 1 && primaryResult === null) {
            return { result: undefined, error: new Error('primary failed') };
          }
          if (calls.length === 1 && primaryResult !== undefined) {
            return { result: primaryResult, error: undefined };
          }
          return { result: fallbackResult, error: undefined };
        },
      },
    },
  };
}
