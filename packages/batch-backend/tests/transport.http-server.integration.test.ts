import { request as httpRequest } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { getJobOptions } from '../src/application/get-job-options.js';
import * as createPromptPackageModule from '../src/application/create-prompt-package.js';
import * as getRecordingTranscriptModule from '../src/application/get-recording-transcript.js';
import * as getJobStatusModule from '../src/application/get-job-status.js';
import * as getPromptPackageModule from '../src/application/get-prompt-package.js';
import * as submitJobModule from '../src/application/submit-job.js';
import * as updateRecordingTranscriptModule from '../src/application/update-recording-transcript.js';
import { ProfilePathError } from '../src/application/profile-path.js';
import { publishJobEvent } from '../src/domain/job-events.js';
import type { JobRecord } from '../src/domain/job-model.js';
import { publishRecordingEvent } from '../src/domain/recording-events.js';
import type { RecordingRecord } from '../src/domain/recording-model.js';
import * as loggerModule from '../src/infrastructure/logger.js';
import { createHttpServer } from '../src/transport/http-server.js';

/**
 * Intent:
 * - Black-box test the HTTP API contract for:
 *   - POST /jobs
 *   - GET /jobs/:jobId
 * - Uses the real route implementation from http-server.ts (no ad-hoc routes).
 * - Mocks application layer to avoid real DB/queue/orchestrator.
 * - Focuses on:
 *   - Request/response shapes
 *   - Status codes and canonical error handling
 * - Does NOT hit real DB, queue, or orchestrator.
 */

// Mock auth middleware to bypass authentication for integration tests
vi.mock('../src/transport/auth-middleware.js', async () => {
  const actual = await vi.importActual<typeof import('../src/transport/auth-middleware.js')>(
    '../src/transport/auth-middleware.js',
  );
  return {
    ...actual,
    authenticate: vi.fn((request, reply, done) => {
      // Mock user for testing
      (request as any).user = {
        id: 'test-user-id',
        email: 'test@example.com',
        role: 'user',
      };
      done?.();
    }),
    requireRole: vi.fn(() =>
      vi.fn((request, reply, done) => {
        done?.();
      }),
    ),
    getAuthenticatedUser: vi.fn((request) => (request as any).user),
  };
});

// Mock rate limiting middleware to avoid Redis dependencies
vi.mock('../src/transport/rate-limit-middleware', async () => {
  const actual = await vi.importActual<typeof import('../src/transport/rate-limit-middleware.js')>(
    '../src/transport/rate-limit-middleware',
  );
  return {
    ...actual,
    createUploadRateLimitMiddleware: vi.fn(() =>
      vi.fn((request, reply, done) => {
        done?.();
      }),
    ),
  };
});

vi.mock('../src/infrastructure/logger', async () => {
  const actual = await vi.importActual<typeof loggerModule>('../src/infrastructure/logger');
  return {
    ...actual,
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      child: vi.fn().mockReturnValue({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      }),
    },
  };
});

vi.mock('../src/infrastructure/orchestrator-service', () => {
  const orchestratorJobOptionsMock = {
    presets: ['b1-default'],
    voiceAccents: ['american_female'],
    voices: [{ id: 'voice-1', name: 'Voice One', accent: 'american_female', gender: 'female' }],
    notionDatabases: [{ id: 'db-1', name: 'DB One' }],
    uploadOptions: ['auto', 's3', 'none'] as const,
    ttsStrategies: ['auto', 'dialogue', 'tts'] as const,
  };
  return {
    getJobOptionsFromOrchestrator: vi.fn().mockResolvedValue(orchestratorJobOptionsMock),
  };
});

describe('transport/http-server - integration (in-process)', () => {
  let app: Awaited<ReturnType<typeof createHttpServer>>;

  beforeAll(async () => {
    vi.clearAllMocks();
    // Use real route implementation via createHttpServer; no network listen.
    app = await createHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /jobs returns 202 and jobId on success', async () => {
    const submitJob = vi.spyOn(submitJobModule, 'submitJob');
    submitJob.mockResolvedValue({ jobId: 'job-123' });

    const response = await app.inject({
      method: 'POST',
      url: '/jobs',
      payload: {
        md: 'fixtures/ok.md',
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ jobId: 'job-123' });

    expect(submitJob).toHaveBeenCalledWith({
      md: 'fixtures/ok.md',
      preset: undefined,
      withTts: undefined,
      upload: undefined,
      voiceId: undefined,
      voiceAccent: undefined,
      forceTts: undefined,
      notionDatabase: undefined,
      ttsStrategy: undefined,
    });
  });

  it('POST /jobs accepts advanced metadata fields', async () => {
    const submitJob = vi.spyOn(submitJobModule, 'submitJob');
    submitJob.mockResolvedValue({ jobId: 'job-234' });

    const response = await app.inject({
      method: 'POST',
      url: '/jobs',
      payload: {
        md: 'fixtures/ok.md',
        preset: 'b1-default',
        withTts: true,
        upload: 'auto',
        voiceId: 'voice_amanda',
        voiceAccent: 'american_female',
        forceTts: true,
        notionDatabase: 'db-123',
        ttsStrategy: 'dialogue',
      },
    });

    expect(response.statusCode).toBe(202);
    expect(submitJob).toHaveBeenCalledWith({
      md: 'fixtures/ok.md',
      preset: 'b1-default',
      withTts: true,
      upload: 'auto',
      voiceId: 'voice_amanda',
      voiceAccent: 'american_female',
      forceTts: true,
      notionDatabase: 'db-123',
      ttsStrategy: 'dialogue',
    });
  });

  it('POST /jobs maps ValidationError to canonical 400 schema', async () => {
    const { ValidationError } = await import('../src/application/submit-job.js');
    const submitJob = vi.spyOn(submitJobModule, 'submitJob');
    const error = new ValidationError('md is required', 'md_required');
    submitJob.mockRejectedValue(error);

    const response = await app.inject({
      method: 'POST',
      url: '/jobs',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'validation_failed',
      message: 'md or transcribeWorkdir is required',
      code: 'custom',
      requestId: expect.any(String),
      timestamp: expect.any(String),
    });
  });

  it('POST /jobs maps unexpected error to canonical 500 schema', async () => {
    const submitJob = vi.spyOn(submitJobModule, 'submitJob');
    submitJob.mockRejectedValue(new Error('boom'));

    const response = await app.inject({
      method: 'POST',
      url: '/jobs',
      payload: {
        md: 'fixtures/ok.md',
      },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: 'internal_error',
      message: 'An internal server error occurred',
      code: 'Error',
      requestId: expect.any(String),
      timestamp: expect.any(String),
    });
  });

  it('GET /jobs/:jobId returns 200 with status when job exists', async () => {
    const getJobStatus = vi.spyOn(getJobStatusModule, 'getJobStatus');
    getJobStatus.mockResolvedValue({
      jobId: 'job-1',
      md: 'fixtures/ok.md',
      transcribeWorkdir: null,
      transcriptPath: null,
      promptPayload: null,
      promptNotes: null,
      profilePath: null,
      recordingId: null,
      transcriptId: null,
      promptPackageId: null,
      draftId: null,
      preset: 'b1-default',
      withTts: true,
      upload: 's3',
      voiceId: 'voice_amanda',
      voiceAccent: 'american_female',
      forceTts: true,
      notionDatabase: 'db-123',
      ttsStrategy: 'dialogue',
      notionUrl: 'https://notion.so/job-1',
      state: 'queued',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      startedAt: null,
      finishedAt: null,
      error: null,
      manifestPath: null,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/jobs/job-1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      jobId: 'job-1',
      md: 'fixtures/ok.md',
      transcribeWorkdir: null,
      transcriptPath: null,
      promptPayload: null,
      promptNotes: null,
      profilePath: null,
      recordingId: null,
      transcriptId: null,
      promptPackageId: null,
      draftId: null,
      preset: 'b1-default',
      withTts: true,
      upload: 's3',
      voiceId: 'voice_amanda',
      voiceAccent: 'american_female',
      forceTts: true,
      notionDatabase: 'db-123',
      ttsStrategy: 'dialogue',
      notionUrl: 'https://notion.so/job-1',
      state: 'queued',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      startedAt: null,
      finishedAt: null,
      error: null,
      manifestPath: null,
    });

    expect(getJobStatus).toHaveBeenCalledWith('job-1');
  });

  it('GET /jobs/:jobId/status remains available as an alias', async () => {
    const getJobStatus = vi.spyOn(getJobStatusModule, 'getJobStatus');
    getJobStatus.mockResolvedValue({
      jobId: 'job-2',
      md: 'fixtures/ok.md',
      transcribeWorkdir: null,
      transcriptPath: null,
      promptPayload: null,
      promptNotes: null,
      profilePath: null,
      recordingId: null,
      transcriptId: null,
      promptPackageId: null,
      draftId: null,
      preset: null,
      withTts: null,
      upload: null,
      voiceId: null,
      voiceAccent: null,
      forceTts: null,
      notionDatabase: null,
      ttsStrategy: null,
      notionUrl: null,
      state: 'queued',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      startedAt: null,
      finishedAt: null,
      error: null,
      manifestPath: null,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/jobs/job-2/status',
    });

    expect(response.statusCode).toBe(200);
    expect(getJobStatus).toHaveBeenCalledWith('job-2');
  });

  it('GET /jobs/:jobId returns 404 with canonical schema when job not found', async () => {
    const getJobStatus = vi.spyOn(getJobStatusModule, 'getJobStatus');
    getJobStatus.mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: '/jobs/missing',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: 'not_found',
    });
    // Check that the response includes expected debugging fields but don't assert exact values
    const responseData = response.json();
    expect(responseData.error).toBe('not_found');
  });

  it('GET /jobs/:jobId returns 500 with canonical schema when getJobStatus throws', async () => {
    const getJobStatus = vi.spyOn(getJobStatusModule, 'getJobStatus');
    getJobStatus.mockRejectedValue(new Error('boom'));

    const response = await app.inject({
      method: 'GET',
      url: '/jobs/job-err',
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'internal_error' });
  });

  it('GET /config/job-options returns metadata payload when extended API enabled', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/config/job-options',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, max-age=60');
    const expected = await getJobOptions();
    expect(response.json()).toEqual(expected);
  });

  it('GET /config/job-options returns 404 when extended API disabled', async () => {
    const originalFlag = process.env.BATCH_BACKEND_ENABLE_EXTENDED_API;
    process.env.BATCH_BACKEND_ENABLE_EXTENDED_API = 'false';
    const disabledApp = await createHttpServer();

    try {
      const response = await disabledApp.inject({
        method: 'GET',
        url: '/config/job-options',
      });

      expect(response.statusCode).toBe(404);
    } finally {
      await disabledApp.close();
      if (originalFlag === undefined) {
        delete process.env.BATCH_BACKEND_ENABLE_EXTENDED_API;
      } else {
        process.env.BATCH_BACKEND_ENABLE_EXTENDED_API = originalFlag;
      }
    }
  });

  it('GET /recordings/:id/transcript returns transcript payload', async () => {
    const getRecordingTranscript = vi.spyOn(
      getRecordingTranscriptModule,
      'getRecordingTranscript',
    );
    getRecordingTranscript.mockClear();
    getRecordingTranscript.mockResolvedValue({
      recordingId: 'recording-1',
      transcriptId: 'transcript-1',
      text: 'Hello transcript',
      summaryJson: { channels: 2 },
      model: 'nova-3',
      language: 'en',
      mode: 'timeline',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:10:00.000Z',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/recordings/recording-1/transcript',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      recordingId: 'recording-1',
      transcriptId: 'transcript-1',
      text: 'Hello transcript',
      summaryJson: { channels: 2 },
      model: 'nova-3',
      language: 'en',
      mode: 'timeline',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:10:00.000Z',
    });
    expect(getRecordingTranscript).toHaveBeenCalledWith('recording-1');
  });

  it('GET /recordings/:id/transcript returns 404 when missing', async () => {
    const getRecordingTranscript = vi.spyOn(
      getRecordingTranscriptModule,
      'getRecordingTranscript',
    );
    getRecordingTranscript.mockClear();
    getRecordingTranscript.mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: '/recordings/missing/transcript',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });
  });

  it('PUT /recordings/:id/transcript updates transcript text', async () => {
    const updateRecordingTranscript = vi.spyOn(
      updateRecordingTranscriptModule,
      'updateRecordingTranscript',
    );
    updateRecordingTranscript.mockClear();
    updateRecordingTranscript.mockResolvedValue({
      recordingId: 'recording-1',
      transcriptId: 'transcript-1',
      text: 'Updated text',
      summaryJson: null,
      model: 'nova-3',
      language: 'en',
      mode: 'timeline',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:20:00.000Z',
    });

    const response = await app.inject({
      method: 'PUT',
      url: '/recordings/recording-1/transcript',
      payload: { text: 'Updated text' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      recordingId: 'recording-1',
      transcriptId: 'transcript-1',
      text: 'Updated text',
      summaryJson: null,
      model: 'nova-3',
      language: 'en',
      mode: 'timeline',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:20:00.000Z',
    });
    expect(updateRecordingTranscript).toHaveBeenCalledWith({
      recordingId: 'recording-1',
      text: 'Updated text',
    });
  });

  it('PUT /recordings/:id/transcript returns 404 when missing', async () => {
    const updateRecordingTranscript = vi.spyOn(
      updateRecordingTranscriptModule,
      'updateRecordingTranscript',
    );
    updateRecordingTranscript.mockClear();
    updateRecordingTranscript.mockResolvedValue(null);

    const response = await app.inject({
      method: 'PUT',
      url: '/recordings/missing/transcript',
      payload: { text: 'Updated text' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });
  });

  it('POST /recordings/:id/prompt-package returns assembled payload', async () => {
    const createPromptPackage = vi.spyOn(createPromptPackageModule, 'createPromptPackage');
    createPromptPackage.mockClear();
    createPromptPackage.mockResolvedValue({
      id: 'prompt-1',
      recordingId: 'recording-1',
      transcriptId: 'transcript-1',
      profilePath: '/profiles/p1.md',
      templateVersion: '/templates/t1.md',
      notes: 'Some notes',
      storageUri: 'local://prompt-packages/prompt-1.txt',
      text: 'PROMPT TEXT',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:10:00.000Z',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/recordings/recording-1/prompt-package',
      payload: { notes: 'Some notes', profilePath: '/profiles/p1.md' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: 'prompt-1',
      recordingId: 'recording-1',
      transcriptId: 'transcript-1',
      profilePath: '/profiles/p1.md',
      templateVersion: '/templates/t1.md',
      notes: 'Some notes',
      storageUri: 'local://prompt-packages/prompt-1.txt',
      text: 'PROMPT TEXT',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:10:00.000Z',
    });
    expect(createPromptPackage).toHaveBeenCalledWith({
      recordingId: 'recording-1',
      notes: 'Some notes',
      profilePath: '/profiles/p1.md',
    });
  });

  it('POST /recordings/:id/prompt-package returns 404 when transcript missing', async () => {
    const createPromptPackage = vi.spyOn(createPromptPackageModule, 'createPromptPackage');
    createPromptPackage.mockClear();
    createPromptPackage.mockResolvedValue(null);

    const response = await app.inject({
      method: 'POST',
      url: '/recordings/missing/prompt-package',
      payload: { notes: 'Some notes' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });
  });

  it('POST /recordings/:id/prompt-package rejects profilePath outside repo', async () => {
    const createPromptPackage = vi.spyOn(createPromptPackageModule, 'createPromptPackage');
    createPromptPackage.mockClear();
    createPromptPackage.mockRejectedValue(
      new ProfilePathError(
        'profilePath must resolve within the configured profile root',
        'profile_path_outside_root',
      ),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/recordings/recording-1/prompt-package',
      payload: { profilePath: '/etc/passwd' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'validation_failed',
      message: 'profilePath must resolve within the configured profile root',
      code: 'profile_path_outside_root',
    });
  });

  it('GET /prompt-packages/:id returns prompt package payload', async () => {
    const getPromptPackage = vi.spyOn(getPromptPackageModule, 'getPromptPackage');
    getPromptPackage.mockClear();
    getPromptPackage.mockResolvedValue({
      id: 'prompt-1',
      recordingId: 'recording-1',
      transcriptId: 'transcript-1',
      profilePath: '/profiles/p1.md',
      templateVersion: '/templates/t1.md',
      notes: 'Some notes',
      storageUri: 'local://prompt-packages/prompt-1.txt',
      text: 'PROMPT TEXT',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:10:00.000Z',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/prompt-packages/prompt-1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: 'prompt-1',
      recordingId: 'recording-1',
      transcriptId: 'transcript-1',
      profilePath: '/profiles/p1.md',
      templateVersion: '/templates/t1.md',
      notes: 'Some notes',
      storageUri: 'local://prompt-packages/prompt-1.txt',
      text: 'PROMPT TEXT',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:10:00.000Z',
    });
    expect(getPromptPackage).toHaveBeenCalledWith('prompt-1');
  });

  it('GET /prompt-packages/:id returns 404 when missing', async () => {
    const getPromptPackage = vi.spyOn(getPromptPackageModule, 'getPromptPackage');
    getPromptPackage.mockClear();
    getPromptPackage.mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: '/prompt-packages/missing',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });
  });

  it('GET /jobs/events streams job events as SSE', { timeout: 10_000 }, async () => {
    const getJobStatus = vi.spyOn(getJobStatusModule, 'getJobStatus');
    getJobStatus.mockClear();
    getJobStatus.mockResolvedValue(null);
    const streamingApp = await createHttpServer();
    const address = (await streamingApp.listen({ port: 0, host: '127.0.0.1' })) as string;
    const url = new URL('/jobs/events', address);
    url.searchParams.set('jobId', 'job-stream');

    const job: JobRecord = {
      id: 'job-stream',
      state: 'running',
      md: 'fixtures/ok.md',
      preset: 'b1-default',
      withTts: true,
      upload: 's3',
      voiceAccent: 'american_female',
      voiceId: 'voice_amanda',
      ttsStrategy: null,
      notionDatabase: null,
      forceTts: null,
      notionUrl: null,
      createdAt: new Date('2024-01-01T10:00:00Z'),
      updatedAt: new Date('2024-01-01T10:01:00Z'),
      startedAt: new Date('2024-01-01T10:01:00Z'),
      finishedAt: null,
      error: null,
      manifestPath: null,
    };

    const eventPayload = await new Promise<any>((resolve, reject) => {
      let resRef: import('node:http').IncomingMessage | null = null;
      let settled = false;
      let buffer = '';
      let published = false;
      let requestRef: import('node:http').ClientRequest | null = null;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      let publishTimer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = (err?: Error, result?: any) => {
        if (settled) return;
        settled = true;
        requestRef?.destroy();
        resRef?.destroy();
        if (timeout) {
          clearTimeout(timeout);
        }
        if (publishTimer) {
          clearTimeout(publishTimer);
        }
        void streamingApp.close();
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      };

      const req = httpRequest(url, (res) => {
        resRef = res;
        res.setEncoding('utf8');

        res.on('data', (chunk) => {
          buffer += chunk;

          if (!published && buffer.includes(': connected')) {
            published = true;
            publishTimer = setTimeout(() => {
              publishJobEvent({ type: 'job_state_changed', job });
            }, 0);
          }

          const dataMatch = buffer.match(/data: (.+)\n\n/);
          if (dataMatch) {
            const payload = JSON.parse(dataMatch[1]!);
            cleanup(undefined, payload);
          }
        });

        res.on('error', (err) => {
          cleanup(err as Error);
        });
      });

      requestRef = req;

      req.on('error', (err) => {
        cleanup(err as Error);
      });

      req.end();

      timeout = setTimeout(() => {
        cleanup(new Error('Timed out waiting for SSE payload'));
      }, 10_000);
    });

    expect(eventPayload.type).toBe('job_state_changed');
    expect(eventPayload.jobId).toBe(job.id);
    expect(eventPayload.state).toBe('running');
    expect(eventPayload.payload?.ttsStrategy).toBeNull();
    expect(eventPayload.payload?.md).toBe(job.md);
    expect(getJobStatus).toHaveBeenCalledTimes(1);
  });

  it(
    'GET /jobs/events streams recording events when jobId maps to a recording',
    { timeout: 10_000 },
    async () => {
      const getJobStatus = vi.spyOn(getJobStatusModule, 'getJobStatus');
      getJobStatus.mockClear();
      getJobStatus.mockResolvedValue({
        jobId: 'job-stream',
        md: 'fixtures/ok.md',
        transcribeWorkdir: null,
        transcriptPath: null,
        promptPayload: null,
        promptNotes: null,
        profilePath: null,
        recordingId: 'recording-1',
        transcriptId: null,
        promptPackageId: null,
        draftId: null,
        preset: null,
        withTts: null,
        upload: null,
        voiceId: null,
        voiceAccent: null,
        forceTts: null,
        notionDatabase: null,
        ttsStrategy: null,
        notionUrl: null,
        state: 'queued',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        startedAt: null,
        finishedAt: null,
        error: null,
        manifestPath: null,
      });

      const streamingApp = await createHttpServer();
      const address = (await streamingApp.listen({ port: 0, host: '127.0.0.1' })) as string;
      const url = new URL('/jobs/events', address);
      url.searchParams.set('jobId', 'job-stream');

      const recording: RecordingRecord = {
        id: 'recording-1',
        source: 'scan',
        studentId: null,
        sourcePath: '/tmp/recording.opus',
        storageUri: 'local://recordings/recording.opus',
        sha256: 'hash',
        bytes: 12,
        durationSec: 120,
        channels: 2,
        status: 'transcribed',
        error: null,
        createdAt: new Date('2024-01-01T10:00:00Z'),
        updatedAt: new Date('2024-01-01T10:01:00Z'),
      };

      const eventPayload = await new Promise<any>((resolve, reject) => {
        let resRef: import('node:http').IncomingMessage | null = null;
        let settled = false;
        let buffer = '';
      let published = false;
      let requestRef: import('node:http').ClientRequest | null = null;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      let publishTimer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = (err?: Error, result?: any) => {
        if (settled) return;
        settled = true;
        requestRef?.destroy();
        resRef?.destroy();
        if (timeout) {
          clearTimeout(timeout);
        }
        if (publishTimer) {
          clearTimeout(publishTimer);
        }
        void streamingApp.close();
        if (err) {
          reject(err);
          } else {
            resolve(result);
          }
        };

        const req = httpRequest(url, (res) => {
          resRef = res;
          res.setEncoding('utf8');

          res.on('data', (chunk) => {
            buffer += chunk;

          if (!published && buffer.includes(': connected')) {
            published = true;
            publishTimer = setTimeout(() => {
              publishRecordingEvent({
                type: 'recording_state_changed',
                recording,
                transcriptId: 'transcript-1',
              });
            }, 0);
          }

            const dataMatch = buffer.match(/data: (.+)\n\n/);
            if (dataMatch) {
              const payload = JSON.parse(dataMatch[1]!);
              cleanup(undefined, payload);
            }
          });

          res.on('error', (err) => {
            cleanup(err as Error);
          });
        });

        requestRef = req;

        req.on('error', (err) => {
          cleanup(err as Error);
        });

        req.end();

        timeout = setTimeout(() => {
          cleanup(new Error('Timed out waiting for SSE payload'));
        }, 10_000);
      });

      expect(getJobStatus).toHaveBeenCalledWith('job-stream');
      expect(getJobStatus).toHaveBeenCalledTimes(1);
      expect(eventPayload.type).toBe('recording_state_changed');
      expect(eventPayload.recordingId).toBe('recording-1');
      expect(eventPayload.status).toBe('transcribed');
      expect(eventPayload.transcriptId).toBe('transcript-1');
      expect(eventPayload.error).toBeNull();
    },
  );
});
