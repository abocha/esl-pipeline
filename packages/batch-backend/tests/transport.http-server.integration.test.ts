import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { request as httpRequest } from 'node:http';
import type { JobRecord } from '../src/domain/job-model';
import { publishJobEvent } from '../src/domain/job-events';

import { createHttpServer } from '../src/transport/http-server';
import * as submitJobModule from '../src/application/submit-job';
import * as getJobStatusModule from '../src/application/get-job-status';
import * as loggerModule from '../src/infrastructure/logger';
import { getJobOptions } from '../src/application/get-job-options';

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
vi.mock('../src/transport/auth-middleware', async () => {
  const actual = await vi.importActual<typeof import('../src/transport/auth-middleware')>(
    '../src/transport/auth-middleware'
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
      })
    ),
    getAuthenticatedUser: vi.fn(request => (request as any).user),
  };
});

// Mock rate limiting middleware to avoid Redis dependencies
vi.mock('../src/transport/rate-limit-middleware', async () => {
  const actual = await vi.importActual<typeof import('../src/transport/rate-limit-middleware')>(
    '../src/transport/rate-limit-middleware'
  );
  return {
    ...actual,
    createUploadRateLimitMiddleware: vi.fn(() =>
      vi.fn((request, reply, done) => {
        done?.();
      })
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
    modes: ['auto', 'dialogue', 'monologue'] as const,
  };
  return {
    getJobOptionsFromOrchestrator: vi.fn().mockResolvedValue(orchestratorJobOptionsMock),
  };
});

describe('transport/http-server - integration (in-process)', () => {
  let app: ReturnType<typeof createHttpServer>;

  beforeAll(async () => {
    vi.clearAllMocks();
    // Use real route implementation via createHttpServer; no network listen.
    app = createHttpServer();
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
      mode: undefined,
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
        mode: 'dialogue',
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
      mode: 'dialogue',
    });
  });

  it('POST /jobs maps ValidationError to canonical 400 schema', async () => {
    const { ValidationError } = await import('../src/application/submit-job');
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
      message: 'Invalid input: expected string, received undefined',
      code: 'invalid_type',
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
      preset: 'b1-default',
      withTts: true,
      upload: 's3',
      voiceId: 'voice_amanda',
      voiceAccent: 'american_female',
      forceTts: true,
      notionDatabase: 'db-123',
      mode: 'dialogue',
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
      preset: 'b1-default',
      withTts: true,
      upload: 's3',
      voiceId: 'voice_amanda',
      voiceAccent: 'american_female',
      forceTts: true,
      notionDatabase: 'db-123',
      mode: 'dialogue',
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
      preset: null,
      withTts: null,
      upload: null,
      voiceId: null,
      voiceAccent: null,
      forceTts: null,
      notionDatabase: null,
      mode: null,
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
    const disabledApp = createHttpServer();

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

  it('GET /jobs/events streams job events as SSE', async () => {
    const streamingApp = createHttpServer();
    const address = (await streamingApp.listen({ port: 0, host: '127.0.0.1' })) as string;
    const url = new URL('/jobs/events', address);

    const job: JobRecord = {
      id: 'job-stream',
      state: 'running',
      md: 'fixtures/ok.md',
      preset: 'b1-default',
      withTts: true,
      upload: 's3',
      voiceAccent: 'american_female',
      voiceId: 'voice_amanda',
      createdAt: new Date('2024-01-01T10:00:00Z'),
      updatedAt: new Date('2024-01-01T10:01:00Z'),
      startedAt: new Date('2024-01-01T10:01:00Z'),
      finishedAt: null,
      error: null,
      manifestPath: null,
    };

    await new Promise<void>((resolve, reject) => {
      let resRef: import('node:http').IncomingMessage | null = null;
      let settled = false;
      let buffer = '';
      let published = false;
      let requestRef: import('node:http').ClientRequest | null = null;
      let timeout: ReturnType<typeof setTimeout> | null = null;

      const cleanup = (err?: Error) => {
        if (settled) return;
        settled = true;
        requestRef?.destroy();
        resRef?.destroy();
        if (timeout) {
          clearTimeout(timeout);
        }
        void streamingApp.close();
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      };

      const req = httpRequest(url, res => {
        resRef = res;
        res.setEncoding('utf8');

        res.on('data', chunk => {
          buffer += chunk;

          if (!published && buffer.includes(': connected')) {
            published = true;
            publishJobEvent({ type: 'job_state_changed', job });
          }

          const dataMatch = buffer.match(/data: (.+)\n\n/);
          if (dataMatch) {
            const payload = JSON.parse(dataMatch[1]!);
            expect(payload.type).toBe('job_state_changed');
            expect(payload.jobId).toBe(job.id);
            expect(payload.state).toBe('running');
            expect(payload.payload?.runMode).toBeUndefined();
            cleanup();
          }
        });

        res.on('error', err => {
          cleanup(err as Error);
        });
      });

      requestRef = req;

      req.on('error', err => {
        cleanup(err as Error);
      });

      req.end();

      timeout = setTimeout(() => {
        cleanup(new Error('Timed out waiting for SSE payload'));
      }, 5000);
    });
  });
});
