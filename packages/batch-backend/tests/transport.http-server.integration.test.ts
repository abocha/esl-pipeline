import { request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { validateMarkdownFile } from '@esl-pipeline/md-validator';

import { getJobOptions } from '../src/application/get-job-options.js';
import * as approveJobModule from '../src/application/approve-job.js';
import * as createDraftModule from '../src/application/create-draft.js';
import * as createPromptPackageModule from '../src/application/create-prompt-package.js';
import * as jobSummaryModule from '../src/application/job-summary.js';
import * as getRecordingModule from '../src/application/get-recording.js';
import * as getRecordingTranscriptModule from '../src/application/get-recording-transcript.js';
import * as getJobStatusModule from '../src/application/get-job-status.js';
import * as getPromptPackageModule from '../src/application/get-prompt-package.js';
import * as listJobsModule from '../src/application/list-jobs.js';
import * as listRecordingsModule from '../src/application/list-recordings.js';
import * as materializeDraftModule from '../src/application/materialize-draft.js';
import * as retryRecordingModule from '../src/application/retry-recording-transcription.js';
import * as studentSummaryModule from '../src/application/student-summary.js';
import * as submitJobModule from '../src/application/submit-job.js';
import * as updateRecordingTranscriptModule from '../src/application/update-recording-transcript.js';
import { ProfilePathError } from '../src/application/profile-path.js';
import * as profileContentModule from '../src/application/profile-content.js';
import * as studentTimelineModule from '../src/application/student-timeline.js';
import * as studentStoreModule from '../src/application/student-profiles-store.js';
import { publishJobEvent } from '../src/domain/job-events.js';
import type { JobRecord } from '../src/domain/job-model.js';
import { publishRecordingEvent } from '../src/domain/recording-events.js';
import type { RecordingRecord } from '../src/domain/recording-model.js';
import * as recordingRepositoryModule from '../src/domain/recording-repository.js';
import { deriveStudentId } from '../src/domain/student-utils.js';
import * as loggerModule from '../src/infrastructure/logger.js';
import * as transcriptionStorageModule from '../src/infrastructure/transcription-storage.js';
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
  const orchestratorStudentProfilesMock = [
    { student: 'Anna' },
    { student: 'Bob' },
    { student: '  ' },
  ];
  return {
    getJobOptionsFromOrchestrator: vi.fn().mockResolvedValue(orchestratorJobOptionsMock),
    getStudentProfilesFromOrchestrator: vi.fn().mockResolvedValue(orchestratorStudentProfilesMock),
  };
});

vi.mock('@esl-pipeline/md-validator', () => {
  return {
    validateMarkdownFile: vi.fn(),
  };
});

vi.mock('../src/application/student-profiles-store', () => {
  return {
    listStudentProfiles: vi.fn(),
    getStudentProfileById: vi.fn(),
    createStudentProfile: vi.fn(),
    updateStudentProfile: vi.fn(),
    deleteStudentProfile: vi.fn(),
  };
});

vi.mock('../src/application/profile-content', () => {
  return {
    listProfileContents: vi.fn(),
    getProfileContent: vi.fn(),
    upsertProfileContent: vi.fn(),
    deleteProfileContent: vi.fn(),
  };
});

vi.mock('../src/application/student-timeline', () => {
  return {
    getStudentTimeline: vi.fn(),
  };
});

vi.mock('../src/application/get-prompt-options.js', () => {
  return {
    getPromptOptions: vi.fn().mockResolvedValue({
      templates: [{ id: 'template.md', label: 'Template' }],
      profiles: [{ id: 'profile.md', label: 'Profile' }],
      defaults: { templateId: 'template.md', profileId: 'profile.md' },
    }),
  };
});

describe('transport/http-server - integration (in-process)', () => {
  let app: Awaited<ReturnType<typeof createHttpServer>>;
  const mockListStudentProfiles = vi.mocked(studentStoreModule.listStudentProfiles);
  const mockGetStudentProfileById = vi.mocked(studentStoreModule.getStudentProfileById);
  const mockCreateStudentProfile = vi.mocked(studentStoreModule.createStudentProfile);
  const mockUpdateStudentProfile = vi.mocked(studentStoreModule.updateStudentProfile);
  const mockDeleteStudentProfile = vi.mocked(studentStoreModule.deleteStudentProfile);
  const mockListProfileContents = vi.mocked(profileContentModule.listProfileContents);
  const mockGetProfileContent = vi.mocked(profileContentModule.getProfileContent);
  const mockUpsertProfileContent = vi.mocked(profileContentModule.upsertProfileContent);
  const mockDeleteProfileContent = vi.mocked(profileContentModule.deleteProfileContent);
  const mockGetStudentTimeline = vi.mocked(studentTimelineModule.getStudentTimeline);

  beforeAll(async () => {
    vi.clearAllMocks();
    mockListStudentProfiles.mockResolvedValue({
      items: [
        {
          id: deriveStudentId('Anna'),
          student: 'Anna',
          dbId: null,
          pageParentId: null,
          colorPreset: null,
          accentPreference: null,
          voices: {},
          manifestPreset: null,
          profileId: null,
        },
        {
          id: deriveStudentId('Bob'),
          student: 'Bob',
          dbId: null,
          pageParentId: null,
          colorPreset: null,
          accentPreference: null,
          voices: {},
          manifestPreset: null,
          profileId: null,
        },
      ],
      total: 2,
      limit: 50,
      offset: 0,
      order: 'asc',
    });
    mockGetStudentProfileById.mockResolvedValue({
      id: deriveStudentId('Anna'),
      student: 'Anna',
      dbId: null,
      pageParentId: null,
      colorPreset: null,
      accentPreference: null,
      voices: {},
      manifestPreset: null,
      profileId: null,
    });
    mockCreateStudentProfile.mockResolvedValue({
      id: deriveStudentId('New Student'),
      student: 'New Student',
      dbId: null,
      pageParentId: null,
      colorPreset: null,
      accentPreference: null,
      voices: {},
      manifestPreset: null,
      profileId: null,
    });
    mockUpdateStudentProfile.mockResolvedValue({
      id: deriveStudentId('Anna'),
      student: 'Anna',
      dbId: null,
      pageParentId: null,
      colorPreset: 'b1-default',
      accentPreference: null,
      voices: {},
      manifestPreset: null,
      profileId: 'profile.md',
    });
    mockDeleteStudentProfile.mockResolvedValue(true);
    mockListProfileContents.mockResolvedValue({
      profiles: [{ id: 'profile.md', label: 'Profile' }],
    });
    mockGetProfileContent.mockResolvedValue({
      id: 'profile.md',
      label: 'Profile',
      content: 'Profile content',
    });
    mockUpsertProfileContent.mockResolvedValue({
      id: 'profile.md',
      label: 'Profile',
      content: 'Updated content',
    });
    mockDeleteProfileContent.mockResolvedValue(true);
    mockGetStudentTimeline.mockResolvedValue({
      items: [
        {
          type: 'recording_ingested',
          studentId: deriveStudentId('Anna'),
          recordingId: 'recording-1',
          transcriptId: null,
          promptPackageId: null,
          draftId: null,
          jobId: null,
          status: 'queued',
          createdAt: '2024-01-01T00:00:00.000Z',
          displayName: 'recording-1.opus',
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
      order: 'desc',
    });

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
      payload: {
        md: 'fixtures/ok.md',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'validation_failed',
      message: 'md is required',
      code: 'md_required',
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

  it('POST /jobs/:jobId/approve returns 202 with job payload when approved', async () => {
    const approveJobForPipeline = vi.spyOn(approveJobModule, 'approveJobForPipeline');
    approveJobForPipeline.mockResolvedValue({
      id: 'job-approve-1',
      state: 'queued',
      md: '/uploads/drafts/draft-1.md',
      recordingId: 'recording-1',
      transcriptId: 'transcript-1',
      promptPackageId: 'prompt-1',
      draftId: 'draft-1',
      preset: 'b1-default',
      withTts: true,
      upload: 's3',
      voiceId: 'voice_amanda',
      voiceAccent: 'american_female',
      forceTts: false,
      notionDatabase: 'db-123',
      ttsStrategy: 'dialogue',
      notionUrl: 'https://notion.so/job-approve-1',
      createdAt: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:01:00Z'),
      startedAt: null,
      finishedAt: null,
      error: null,
      manifestPath: '/manifests/job-approve-1.json',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/jobs/job-approve-1/approve',
      payload: { md: '/uploads/drafts/draft-1.md' },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      jobId: 'job-approve-1',
      md: '/uploads/drafts/draft-1.md',
      recordingId: 'recording-1',
      transcriptId: 'transcript-1',
      promptPackageId: 'prompt-1',
      draftId: 'draft-1',
      preset: 'b1-default',
      withTts: true,
      upload: 's3',
      voiceId: 'voice_amanda',
      voiceAccent: 'american_female',
      forceTts: false,
      notionDatabase: 'db-123',
      ttsStrategy: 'dialogue',
      notionUrl: 'https://notion.so/job-approve-1',
      autoPublish: null,
      state: 'queued',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:01:00.000Z',
      startedAt: null,
      finishedAt: null,
      error: null,
      manifestPath: '/manifests/job-approve-1.json',
    });
    expect(approveJobForPipeline).toHaveBeenCalledWith(
      'job-approve-1',
      '/uploads/drafts/draft-1.md',
    );
  });

  it('POST /jobs/:jobId/approve returns 404 when job not awaiting approval', async () => {
    const approveJobForPipeline = vi.spyOn(approveJobModule, 'approveJobForPipeline');
    approveJobForPipeline.mockResolvedValue(null);

    const response = await app.inject({
      method: 'POST',
      url: '/jobs/job-missing/approve',
      payload: { md: '/uploads/drafts/missing.md' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: 'not_found',
    });
  });

  it('POST /jobs/:jobId/approve validates request body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/jobs/job-approve-1/approve',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'validation_failed',
      message: 'Invalid request body',
      details: expect.any(Array),
    });
  });

  it('GET /jobs/:jobId returns 200 with status when job exists', async () => {
    const getJobStatus = vi.spyOn(getJobStatusModule, 'getJobStatus');
    getJobStatus.mockResolvedValue({
      jobId: 'job-1',
      md: 'fixtures/ok.md',
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
      autoPublish: null,
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
      autoPublish: null,
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
      autoPublish: null,
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

  it('GET /config/students returns student options', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/config/students',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      students: [
        { id: deriveStudentId('Anna'), name: 'Anna', profileId: null },
        { id: deriveStudentId('Bob'), name: 'Bob', profileId: null },
      ],
    });
  });

  it('GET /config/prompts returns prompt options', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/config/prompts',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      templates: [{ id: 'template.md', label: 'Template' }],
      profiles: [{ id: 'profile.md', label: 'Profile' }],
      defaults: { templateId: 'template.md', profileId: 'profile.md' },
    });
  });

  it('GET /students returns student profiles', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/students',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        {
          id: deriveStudentId('Anna'),
          student: 'Anna',
          dbId: null,
          pageParentId: null,
          colorPreset: null,
          accentPreference: null,
          voices: {},
          manifestPreset: null,
          profileId: null,
        },
        {
          id: deriveStudentId('Bob'),
          student: 'Bob',
          dbId: null,
          pageParentId: null,
          colorPreset: null,
          accentPreference: null,
          voices: {},
          manifestPreset: null,
          profileId: null,
        },
      ],
      total: 2,
      limit: 50,
      offset: 0,
      order: 'asc',
    });
  });

  it('GET /students/:id returns a student profile', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/students/${deriveStudentId('Anna')}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: deriveStudentId('Anna'),
      student: 'Anna',
      dbId: null,
      pageParentId: null,
      colorPreset: null,
      accentPreference: null,
      voices: {},
      manifestPreset: null,
      profileId: null,
    });
  });

  it('POST /students creates a student profile', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/students',
      payload: {
        student: 'New Student',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({
      id: deriveStudentId('New Student'),
      student: 'New Student',
      dbId: null,
      pageParentId: null,
      colorPreset: null,
      accentPreference: null,
      voices: {},
      manifestPreset: null,
      profileId: null,
    });
  });

  it('PUT /students/:id updates a student profile', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/students/${deriveStudentId('Anna')}`,
      payload: {
        colorPreset: 'b1-default',
        profileId: 'profile.md',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: deriveStudentId('Anna'),
      student: 'Anna',
      dbId: null,
      pageParentId: null,
      colorPreset: 'b1-default',
      accentPreference: null,
      voices: {},
      manifestPreset: null,
      profileId: 'profile.md',
    });
  });

  it('DELETE /students/:id removes a student profile', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: `/students/${deriveStudentId('Anna')}`,
    });

    expect(response.statusCode).toBe(204);
  });

  it('GET /students/:id/timeline returns timeline entries', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/students/${deriveStudentId('Anna')}/timeline`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        {
          type: 'recording_ingested',
          studentId: deriveStudentId('Anna'),
          recordingId: 'recording-1',
          transcriptId: null,
          promptPackageId: null,
          draftId: null,
          jobId: null,
          status: 'queued',
          createdAt: '2024-01-01T00:00:00.000Z',
          displayName: 'recording-1.opus',
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
      order: 'desc',
    });
  });

  it('GET /profiles returns profile list', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/profiles',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      profiles: [{ id: 'profile.md', label: 'Profile' }],
    });
  });

  it('GET /profiles/:id returns profile content', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/profiles/profile.md',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: 'profile.md',
      label: 'Profile',
      content: 'Profile content',
    });
  });

  it('GET /recordings returns paginated recording list', async () => {
    const listRecordings = vi.spyOn(listRecordingsModule, 'listRecordingsWithDefaults');
    listRecordings.mockClear();
    listRecordings.mockResolvedValue({
      items: [
        {
          recordingId: 'recording-1',
          status: 'transcribed',
          transcriptId: 'transcript-1',
          error: null,
          source: 'upload',
          studentId: null,
          displayName: 'recording-1.opus',
          durationSec: 120,
          channels: 2,
          bytes: 2048,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:10:00.000Z',
        },
      ],
      limit: 10,
      offset: 5,
      total: 42,
      order: 'asc',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/recordings?status=transcribed&limit=10&offset=5&order=asc',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        {
          recordingId: 'recording-1',
          status: 'transcribed',
          transcriptId: 'transcript-1',
          error: null,
          source: 'upload',
          studentId: null,
          displayName: 'recording-1.opus',
          durationSec: 120,
          channels: 2,
          bytes: 2048,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:10:00.000Z',
        },
      ],
      limit: 10,
      offset: 5,
      total: 42,
      order: 'asc',
    });
    expect(listRecordings).toHaveBeenCalledWith({
      statuses: ['transcribed'],
      sources: null,
      search: null,
      studentId: null,
      limit: 10,
      offset: 5,
      order: 'asc',
    });
  });

  it('GET /recordings maps student filter to studentId', async () => {
    const listRecordings = vi.spyOn(listRecordingsModule, 'listRecordingsWithDefaults');
    listRecordings.mockResolvedValue({
      items: [],
      limit: 50,
      offset: 0,
      total: 0,
      order: 'desc',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/recordings?student=Anna',
    });

    expect(response.statusCode).toBe(200);
    expect(listRecordings).toHaveBeenCalledWith(
      expect.objectContaining({
        studentId: deriveStudentId('Anna'),
      }),
    );
  });

  it('GET /recordings maps source and query filters', async () => {
    const listRecordings = vi.spyOn(listRecordingsModule, 'listRecordingsWithDefaults');
    listRecordings.mockResolvedValue({
      items: [],
      limit: 50,
      offset: 0,
      total: 0,
      order: 'desc',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/recordings?source=upload&q=lesson',
    });

    expect(response.statusCode).toBe(200);
    expect(listRecordings).toHaveBeenCalledWith(
      expect.objectContaining({
        sources: ['upload'],
        search: 'lesson',
      }),
    );
  });

  it('GET /recordings/:id returns recording payload', async () => {
    const getRecording = vi.spyOn(getRecordingModule, 'getRecording');
    getRecording.mockClear();
    getRecording.mockResolvedValue({
      recordingId: 'recording-1',
      status: 'queued',
      transcriptId: null,
      error: null,
      source: 'upload',
      studentId: null,
      displayName: 'recording-1.opus',
      durationSec: null,
      channels: null,
      bytes: 1234,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:05:00.000Z',
    });

    const response = await app.inject({
      method: 'GET',
      url: '/recordings/recording-1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      recordingId: 'recording-1',
      status: 'queued',
      transcriptId: null,
      error: null,
      source: 'upload',
      studentId: null,
      displayName: 'recording-1.opus',
      durationSec: null,
      channels: null,
      bytes: 1234,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:05:00.000Z',
    });
    expect(getRecording).toHaveBeenCalledWith('recording-1');
  });

  it('GET /recordings/:id returns 404 when missing', async () => {
    const getRecording = vi.spyOn(getRecordingModule, 'getRecording');
    getRecording.mockClear();
    getRecording.mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: '/recordings/missing',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });
  });

  it('POST /recordings/:id/transcribe enqueues retry', async () => {
    const retryRecording = vi.spyOn(
      retryRecordingModule,
      'retryRecordingTranscription',
    );
    retryRecording.mockClear();
    retryRecording.mockResolvedValue({
      recordingId: 'recording-1',
      status: 'queued',
      transcriptId: null,
      error: null,
      source: 'upload',
      studentId: null,
      displayName: 'recording-1.opus',
      durationSec: null,
      channels: null,
      bytes: 1234,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:05:00.000Z',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/recordings/recording-1/transcribe',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      recordingId: 'recording-1',
      status: 'queued',
      transcriptId: null,
      error: null,
      source: 'upload',
      studentId: null,
      displayName: 'recording-1.opus',
      durationSec: null,
      channels: null,
      bytes: 1234,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:05:00.000Z',
    });
    expect(retryRecording).toHaveBeenCalledWith(
      'recording-1',
      expect.objectContaining({ enqueue: expect.any(Function) }),
    );
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
      studentId: null,
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
      studentId: null,
      profilePath: '/profiles/p1.md',
      templateVersion: '/templates/t1.md',
      notes: 'Some notes',
      storageUri: 'local://prompt-packages/prompt-1.txt',
      text: 'PROMPT TEXT',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:10:00.000Z',
    });
    expect(createPromptPackage).toHaveBeenCalledWith(
      expect.objectContaining({
        recordingId: 'recording-1',
        notes: 'Some notes',
        profilePath: '/profiles/p1.md',
      }),
    );
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
      studentId: 'student-1',
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
      studentId: 'student-1',
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

  it('POST /prompt-packages/:id/draft returns draft payload', async () => {
    const createDraft = vi.spyOn(createDraftModule, 'createDraft');
    createDraft.mockClear();
    createDraft.mockResolvedValue({
      id: 'draft-1',
      promptPackageId: 'prompt-1',
      studentId: 'student-1',
      storageUri: 'local://drafts/draft-1.md',
      createdBy: 'test-user-id',
      text: 'DRAFT TEXT',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:10:00.000Z',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/prompt-packages/prompt-1/draft',
      payload: { text: 'DRAFT TEXT' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: 'draft-1',
      promptPackageId: 'prompt-1',
      studentId: 'student-1',
      storageUri: 'local://drafts/draft-1.md',
      createdBy: 'test-user-id',
      text: 'DRAFT TEXT',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:10:00.000Z',
    });
    expect(createDraft).toHaveBeenCalledWith({
      promptPackageId: 'prompt-1',
      text: 'DRAFT TEXT',
      createdBy: 'test-user-id',
    });
  });

  it('POST /prompt-packages/:id/draft returns 404 when missing', async () => {
    const createDraft = vi.spyOn(createDraftModule, 'createDraft');
    createDraft.mockClear();
    createDraft.mockResolvedValue(null);

    const response = await app.inject({
      method: 'POST',
      url: '/prompt-packages/missing/draft',
      payload: { text: 'DRAFT TEXT' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });
  });

  it('POST /drafts/:id/materialize returns md path', async () => {
    const materializeDraft = vi.spyOn(materializeDraftModule, 'materializeDraft');
    materializeDraft.mockClear();
    materializeDraft.mockResolvedValue({
      draftId: 'draft-1',
      jobId: 'job-1',
      mdPath: '/uploads/drafts/draft-1.md',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/drafts/draft-1/materialize',
      payload: { jobId: 'job-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      draftId: 'draft-1',
      jobId: 'job-1',
      mdPath: '/uploads/drafts/draft-1.md',
    });
    expect(materializeDraft).toHaveBeenCalledWith({
      draftId: 'draft-1',
      jobId: 'job-1',
      jobOverrides: undefined,
    });
  });

  it('POST /drafts/:id/materialize accepts missing jobId', async () => {
    const materializeDraft = vi.spyOn(materializeDraftModule, 'materializeDraft');
    materializeDraft.mockClear();
    materializeDraft.mockResolvedValue({
      draftId: 'draft-2',
      jobId: 'job-2',
      mdPath: '/uploads/drafts/draft-2.md',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/drafts/draft-2/materialize',
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      draftId: 'draft-2',
      jobId: 'job-2',
      mdPath: '/uploads/drafts/draft-2.md',
    });
    expect(materializeDraft).toHaveBeenCalledWith({
      draftId: 'draft-2',
      jobId: undefined,
      jobOverrides: undefined,
    });
  });

  it('POST /drafts/:id/materialize forwards jobOverrides', async () => {
    const materializeDraft = vi.spyOn(materializeDraftModule, 'materializeDraft');
    materializeDraft.mockClear();
    materializeDraft.mockResolvedValue({
      draftId: 'draft-3',
      jobId: 'job-3',
      mdPath: '/uploads/drafts/draft-3.md',
    });

    const payload = {
      jobOverrides: {
        preset: 'b1-default',
        notionDatabase: 'notion-db',
        withTts: true,
        forceTts: true,
        ttsStrategy: 'dialogue',
        upload: 's3',
        voiceId: 'voice-1',
        voiceAccent: 'american_female',
      },
    };

    const response = await app.inject({
      method: 'POST',
      url: '/drafts/draft-3/materialize',
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(materializeDraft).toHaveBeenCalledWith({
      draftId: 'draft-3',
      jobId: undefined,
      jobOverrides: payload.jobOverrides,
    });
  });

  it('POST /drafts/:id/materialize returns 404 when missing', async () => {
    const materializeDraft = vi.spyOn(materializeDraftModule, 'materializeDraft');
    materializeDraft.mockClear();
    materializeDraft.mockResolvedValue(null);

    const response = await app.inject({
      method: 'POST',
      url: '/drafts/missing/materialize',
      payload: { jobId: 'job-1' },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });
  });

  it('POST /validation/markdown returns validation payload', async () => {
    const mockValidateMarkdownFile = vi.mocked(validateMarkdownFile);
    mockValidateMarkdownFile.mockResolvedValue({
      ok: false,
      errors: ['Missing header'],
      warnings: ['Minor issue'],
      meta: {
        title: 'Lesson',
        student: 'Anna',
        level: 'B1',
        topic: 'Grammar',
        input_type: 'dialogue',
        speaker_labels: ['A', 'B'],
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/validation/markdown',
      payload: { text: 'raw markdown', strict: true },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: false,
      errors: ['Missing header'],
      warnings: ['Minor issue'],
      meta: {
        title: 'Lesson',
        student: 'Anna',
        level: 'B1',
        topic: 'Grammar',
        input_type: 'dialogue',
        speaker_labels: ['A', 'B'],
      },
    });
    expect(mockValidateMarkdownFile).toHaveBeenCalledWith('inline.md', {
      content: 'raw markdown',
      strict: true,
    });
  });

  it('GET /user/jobs applies filters and pagination', async () => {
    const listJobs = vi.spyOn(listJobsModule, 'listJobsWithDefaults');
    listJobs.mockResolvedValue({
      jobs: [
        {
          jobId: 'job-1',
          md: 'fixtures/ok.md',
          recordingId: null,
          transcriptId: null,
          promptPackageId: null,
          draftId: null,
          preset: 'b1-default',
          withTts: true,
          voiceId: 'voice-1',
          upload: 's3',
          voiceAccent: 'american_female',
          forceTts: false,
          notionDatabase: null,
          ttsStrategy: 'auto',
          autoPublish: null,
          notionUrl: null,
          state: 'queued',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          startedAt: null,
          finishedAt: null,
          error: null,
          manifestPath: null,
        },
      ],
      total: 1,
      limit: 10,
      offset: 5,
    });

    const studentId = deriveStudentId('Anna');
    const response = await app.inject({
      method: 'GET',
      url:
        '/user/jobs?state=queued,failed' +
        `&studentId=${studentId}` +
        '&from=2024-01-01T00:00:00.000Z' +
        '&to=2024-02-01T00:00:00.000Z' +
        '&limit=10&offset=5&order=asc',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      jobs: [
        {
          jobId: 'job-1',
          md: 'fixtures/ok.md',
          recordingId: null,
          transcriptId: null,
          promptPackageId: null,
          draftId: null,
          preset: 'b1-default',
          withTts: true,
          voiceId: 'voice-1',
          upload: 's3',
          voiceAccent: 'american_female',
          forceTts: false,
          notionDatabase: null,
          ttsStrategy: 'auto',
          autoPublish: null,
          notionUrl: null,
          state: 'queued',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          startedAt: null,
          finishedAt: null,
          error: null,
          manifestPath: null,
        },
      ],
      total: 1,
      limit: 10,
      offset: 5,
    });

    const call = listJobs.mock.calls[0]?.[0];
    expect(call?.states).toEqual(['queued', 'failed']);
    expect(call?.studentId).toBe(studentId);
    expect(call?.limit).toBe(10);
    expect(call?.offset).toBe(5);
    expect(call?.order).toBe('asc');
    expect(call?.userId).toBe('test-user-id');
    expect(call?.from?.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(call?.to?.toISOString()).toBe('2024-02-01T00:00:00.000Z');
  });

  it('GET /user/jobs/summary returns summary response', async () => {
    const getSummary = vi.spyOn(jobSummaryModule, 'getJobSummaryWithDefaults');
    getSummary.mockResolvedValue({
      total: 12,
      byState: {
        queued: 1,
        running: 2,
        awaiting_approval: 3,
        succeeded: 4,
        failed: 2,
      },
      pendingApprovals: 3,
      last7Days: {
        total: 5,
        succeeded: 3,
        failed: 1,
      },
      tts: {
        enabled: 6,
        succeeded: 4,
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/user/jobs/summary?from=2024-03-01T00:00:00.000Z&to=2024-03-07T00:00:00.000Z',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      total: 12,
      byState: {
        queued: 1,
        running: 2,
        awaiting_approval: 3,
        succeeded: 4,
        failed: 2,
      },
      pendingApprovals: 3,
      last7Days: {
        total: 5,
        succeeded: 3,
        failed: 1,
      },
      tts: {
        enabled: 6,
        succeeded: 4,
      },
    });

    const call = getSummary.mock.calls[0]?.[0];
    expect(call?.userId).toBe('test-user-id');
    expect(call?.from?.toISOString()).toBe('2024-03-01T00:00:00.000Z');
    expect(call?.to?.toISOString()).toBe('2024-03-07T00:00:00.000Z');
  });

  it('GET /students/summary returns student summary response', async () => {
    const getSummary = vi.spyOn(studentSummaryModule, 'getStudentSummaryWithDefaults');
    getSummary.mockResolvedValue({
      items: [
        {
          id: deriveStudentId('Anna'),
          name: 'Anna',
          lastLessonAt: '2024-02-01T10:00:00.000Z',
          pendingDrafts: 1,
        },
      ],
      total: 1,
      limit: 5,
      offset: 10,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/students/summary?limit=5&offset=10&order=desc',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        {
          id: deriveStudentId('Anna'),
          name: 'Anna',
          lastLessonAt: '2024-02-01T10:00:00.000Z',
          pendingDrafts: 1,
        },
      ],
      total: 1,
      limit: 5,
      offset: 10,
    });

    expect(getSummary).toHaveBeenCalledWith({
      limit: 5,
      offset: 10,
      order: 'desc',
    });
  });

  it('GET /recordings/:id/audio supports range requests', async () => {
    const getRecordingById = vi.spyOn(recordingRepositoryModule, 'getRecordingById');
    getRecordingById.mockResolvedValue({
      id: 'recording-1',
      source: 'upload',
      studentId: null,
      sourcePath: null,
      storageUri: 'local://recordings/recording.opus',
      sha256: null,
      bytes: 11,
      durationSec: null,
      channels: null,
      status: 'transcribed',
      error: null,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    });

    const createStorage = vi.spyOn(
      transcriptionStorageModule,
      'createTranscriptionStorageForUri',
    );
    createStorage.mockReturnValue({
      getStream: async () => Readable.from(Buffer.from('hello world')),
    } as any);

    const response = await app.inject({
      method: 'GET',
      url: '/recordings/recording-1/audio',
      headers: {
        range: 'bytes=0-4',
      },
    });

    expect(response.statusCode).toBe(206);
    expect(response.headers['accept-ranges']).toBe('bytes');
    expect(response.headers['content-range']).toBe('bytes 0-4/11');
    expect(response.headers['content-length']).toBe('5');
    expect(response.headers['content-type']).toBe('audio/ogg');
    expect(response.payload).toBe('hello');
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
        autoPublish: null,
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
        source: 'upload',
        studentId: 'student-1',
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
      expect(eventPayload.studentId).toBe('student-1');
      expect(eventPayload.source).toBe('upload');
      expect(eventPayload.bytes).toBe(12);
    },
  );
});
