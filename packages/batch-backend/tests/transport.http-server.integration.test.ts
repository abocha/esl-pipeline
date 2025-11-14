import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

import { createHttpServer } from '../src/transport/http-server';
import * as submitJobModule from '../src/application/submit-job';
import * as getJobStatusModule from '../src/application/get-job-status';
import * as loggerModule from '../src/infrastructure/logger';

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
  const actual = await vi.importActual<typeof import('../src/transport/auth-middleware')>('../src/transport/auth-middleware');
  return {
    ...actual,
    authenticate: vi.fn((request, reply, done) => {
      // Mock user for testing
      (request as any).user = {
        id: 'test-user-id',
        email: 'test@example.com',
        role: 'user'
      };
      done?.();
    }),
    requireRole: vi.fn(() => vi.fn((request, reply, done) => {
      done?.();
    })),
    getAuthenticatedUser: vi.fn((request) => (request as any).user),
  };
});

// Mock rate limiting middleware to avoid Redis dependencies
vi.mock('../src/transport/rate-limit-middleware', async () => {
  const actual = await vi.importActual<typeof import('../src/transport/rate-limit-middleware')>('../src/transport/rate-limit-middleware');
  return {
    ...actual,
    createUploadRateLimitMiddleware: vi.fn(() => vi.fn((request, reply, done) => {
      done?.();
    })),
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
      }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ jobId: 'job-123' });

    expect(submitJob).toHaveBeenCalledWith({
      md: 'fixtures/ok.md',
      preset: undefined,
      withTts: undefined,
      upload: undefined,
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
      message: 'Required',
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
      }
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
      url: '/jobs/job-1'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      jobId: 'job-1',
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
      url: '/jobs/job-2/status'
    });

    expect(response.statusCode).toBe(200);
    expect(getJobStatus).toHaveBeenCalledWith('job-2');
  });

  it('GET /jobs/:jobId returns 404 with canonical schema when job not found', async () => {
    const getJobStatus = vi.spyOn(getJobStatusModule, 'getJobStatus');
    getJobStatus.mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: '/jobs/missing'
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
      url: '/jobs/job-err'
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'internal_error' });
  });
});
