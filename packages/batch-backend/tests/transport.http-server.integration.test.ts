import { request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { validateMarkdown } from '@esl-pipeline/md-validator';
import * as notionAdapterModule from '@esl-pipeline/notion-adapter';

import * as approveJobModule from '../src/application/approve-job.js';
import * as createDraftModule from '../src/application/create-draft.js';
import * as createPromptPackageModule from '../src/application/create-prompt-package.js';
import * as generateDraftModule from '../src/application/generate-draft.js';
import { getJobOptions } from '../src/application/get-job-options.js';
import * as getJobProvenanceModule from '../src/application/get-job-provenance.js';
import * as getJobStatusModule from '../src/application/get-job-status.js';
import * as getPromptPackageModule from '../src/application/get-prompt-package.js';
import * as getRecordingTranscriptModule from '../src/application/get-recording-transcript.js';
import * as getRecordingModule from '../src/application/get-recording.js';
import * as jobSummaryModule from '../src/application/job-summary.js';
import * as listJobsModule from '../src/application/list-jobs.js';
import * as listRecordingsModule from '../src/application/list-recordings.js';
import * as materializeDraftModule from '../src/application/materialize-draft.js';
import * as readinessMetricsModule from '../src/application/readiness-metrics.js';
import * as profileContentModule from '../src/application/profile-content.js';
import { ProfilePathError } from '../src/application/profile-path.js';
import * as retryRecordingModule from '../src/application/retry-recording-transcription.js';
import * as studentStoreModule from '../src/application/student-profiles-store.js';
import * as studentBindingsModule from '../src/application/student-profile-bindings.js';
import * as studentSummaryModule from '../src/application/student-summary.js';
import * as studentTimelineModule from '../src/application/student-timeline.js';
import * as submitJobModule from '../src/application/submit-job.js';
import * as templateContentModule from '../src/application/template-content.js';
import * as updateRecordingTranscriptModule from '../src/application/update-recording-transcript.js';
import { publishJobEvent } from '../src/domain/job-events.js';
import type { JobRecord } from '../src/domain/job-model.js';
import { publishRecordingEvent } from '../src/domain/recording-events.js';
import type { RecordingRecord } from '../src/domain/recording-model.js';
import * as recordingRepositoryModule from '../src/domain/recording-repository.js';
import { deriveStudentId } from '../src/domain/student-utils.js';
import * as transcriptRepositoryModule from '../src/domain/transcript-repository.js';
import * as settingsRepositoryModule from '../src/domain/settings-repository.js';
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
    cefrLevels: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const,
    cefrDefault: 'B1' as const,
    generation: {
      providers: ['openai', 'google_ai_studio', 'openrouter'] as const,
      defaultProvider: 'openai' as const,
      modelOptions: [
        {
          provider: 'openai' as const,
          id: 'gpt-5.2',
          tier: 'primary' as const,
          fallbackRank: 0,
          defaultSelected: true,
          enabled: true,
        },
      ],
      defaultModelByProvider: {
        openai: 'gpt-5.2',
      },
      quota: {
        source: 'hybrid' as const,
        lastUpdatedAt: '2026-02-18T00:00:00.000Z',
        requestsPerMinute: 5,
        tokensPerMinute: 250000,
        requestsPerDay: 20,
      },
    },
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
    validateMarkdown: vi.fn(),
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
    listProfileRevisionsForProfile: vi.fn(),
    getProfileRevisionForProfile: vi.fn(),
    restoreProfileRevision: vi.fn(),
    activateProfileRevisionForProfile: vi.fn(),
  };
});

vi.mock('../src/application/template-content', () => {
  return {
    listTemplateContents: vi.fn(),
    getTemplateContent: vi.fn(),
    upsertTemplateContent: vi.fn(),
    deleteTemplateContent: vi.fn(),
    listTemplateRevisionsForTemplate: vi.fn(),
    getTemplateRevisionForTemplate: vi.fn(),
    restoreTemplateRevision: vi.fn(),
    activateTemplateRevisionForTemplate: vi.fn(),
  };
});

vi.mock('../src/application/student-timeline', () => {
  return {
    getStudentTimeline: vi.fn(),
  };
});

vi.mock('../src/application/student-profile-bindings', () => {
  return {
    listStudentProfileBindingsForStudent: vi.fn(),
    getActiveStudentProfileBindingForStudent: vi.fn(),
    resolveStudentProfileBindingAt: vi.fn(),
  };
});

vi.mock('../src/application/get-job-provenance.js', () => {
  return {
    getJobProvenance: vi.fn(),
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
  const mockListProfileRevisionsForProfile = vi.mocked(
    profileContentModule.listProfileRevisionsForProfile,
  );
  const mockGetProfileRevisionForProfile = vi.mocked(profileContentModule.getProfileRevisionForProfile);
  const mockRestoreProfileRevision = vi.mocked(profileContentModule.restoreProfileRevision);
  const mockActivateProfileRevisionForProfile = vi.mocked(
    profileContentModule.activateProfileRevisionForProfile,
  );
  const mockListTemplateContents = vi.mocked(templateContentModule.listTemplateContents);
  const mockGetTemplateContent = vi.mocked(templateContentModule.getTemplateContent);
  const mockUpsertTemplateContent = vi.mocked(templateContentModule.upsertTemplateContent);
  const mockDeleteTemplateContent = vi.mocked(templateContentModule.deleteTemplateContent);
  const mockListTemplateRevisionsForTemplate = vi.mocked(
    templateContentModule.listTemplateRevisionsForTemplate,
  );
  const mockGetTemplateRevisionForTemplate = vi.mocked(
    templateContentModule.getTemplateRevisionForTemplate,
  );
  const mockRestoreTemplateRevision = vi.mocked(templateContentModule.restoreTemplateRevision);
  const mockActivateTemplateRevisionForTemplate = vi.mocked(
    templateContentModule.activateTemplateRevisionForTemplate,
  );
  const mockGetStudentTimeline = vi.mocked(studentTimelineModule.getStudentTimeline);
  const mockListStudentProfileBindingsForStudent = vi.mocked(
    studentBindingsModule.listStudentProfileBindingsForStudent,
  );
  const mockGetActiveStudentProfileBindingForStudent = vi.mocked(
    studentBindingsModule.getActiveStudentProfileBindingForStudent,
  );
  const mockGetJobProvenance = vi.mocked(getJobProvenanceModule.getJobProvenance);

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
      currentRevisionId: 'revision-1',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    mockUpsertProfileContent.mockResolvedValue({
      id: 'profile.md',
      label: 'Profile',
      content: 'Updated content',
      currentRevisionId: 'revision-latest',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    mockDeleteProfileContent.mockResolvedValue(true);
    mockListProfileRevisionsForProfile.mockResolvedValue({
      items: [
        {
          id: 'revision-1',
          profileId: 'profile.md',
          contentHash: 'hash-1',
          source: 'create',
          status: 'active',
          versionNumber: 1,
          versionLabel: 'v1',
          activatedAt: '2024-01-01T00:00:00.000Z',
          deprecatedAt: null,
          createdAt: '2024-01-01T00:00:00.000Z',
          createdBy: null,
          restoredFromRevisionId: null,
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
      order: 'desc',
    });
    mockGetProfileRevisionForProfile.mockResolvedValue({
      id: 'revision-1',
      profileId: 'profile.md',
      contentHash: 'hash-1',
      source: 'create',
      status: 'active',
      versionNumber: 1,
      versionLabel: 'v1',
      activatedAt: '2024-01-01T00:00:00.000Z',
      deprecatedAt: null,
      createdAt: '2024-01-01T00:00:00.000Z',
      createdBy: null,
      restoredFromRevisionId: null,
      content: 'Profile content',
    });
    mockRestoreProfileRevision.mockResolvedValue({
      id: 'profile.md',
      label: 'Profile',
      content: 'Restored content',
      currentRevisionId: 'revision-2',
      updatedAt: '2024-01-02T00:00:00.000Z',
    });
    mockListTemplateContents.mockResolvedValue({
      templates: [{ id: 'template.md', label: 'Template' }],
    });
    mockGetTemplateContent.mockResolvedValue({
      id: 'template.md',
      label: 'Template',
      content: String.raw`Template content\nINSERT PROFILE HERE`,
      currentRevisionId: 'template-revision-1',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
    mockUpsertTemplateContent.mockResolvedValue({
      id: 'template.md',
      label: 'Template',
      content: String.raw`Updated template content\nINSERT PROFILE HERE`,
      currentRevisionId: 'template-revision-2',
      updatedAt: '2024-01-02T00:00:00.000Z',
    });
    mockDeleteTemplateContent.mockResolvedValue(true);
    mockListTemplateRevisionsForTemplate.mockResolvedValue({
      items: [
        {
          id: 'template-revision-1',
          templateId: 'template.md',
          contentHash: 'template-hash-1',
          source: 'create',
          status: 'active',
          versionNumber: 1,
          versionLabel: 'v1',
          activatedAt: '2024-01-01T00:00:00.000Z',
          deprecatedAt: null,
          createdAt: '2024-01-01T00:00:00.000Z',
          createdBy: null,
          restoredFromRevisionId: null,
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
      order: 'desc',
    });
    mockGetTemplateRevisionForTemplate.mockResolvedValue({
      id: 'template-revision-1',
      templateId: 'template.md',
      contentHash: 'template-hash-1',
      source: 'create',
      status: 'active',
      versionNumber: 1,
      versionLabel: 'v1',
      activatedAt: '2024-01-01T00:00:00.000Z',
      deprecatedAt: null,
      createdAt: '2024-01-01T00:00:00.000Z',
      createdBy: null,
      restoredFromRevisionId: null,
      content: 'Template content',
    });
    mockRestoreTemplateRevision.mockResolvedValue({
      id: 'template.md',
      label: 'Template',
      content: 'Restored template',
      currentRevisionId: 'template-revision-2',
      updatedAt: '2024-01-02T00:00:00.000Z',
    });
    mockActivateTemplateRevisionForTemplate.mockResolvedValue({
      id: 'template-revision-1',
      templateId: 'template.md',
      contentHash: 'template-hash-1',
      source: 'create',
      status: 'active',
      versionNumber: 1,
      versionLabel: 'v1',
      activatedAt: '2024-01-01T00:00:00.000Z',
      deprecatedAt: null,
      createdAt: '2024-01-01T00:00:00.000Z',
      createdBy: null,
      restoredFromRevisionId: null,
      content: 'Template content',
    });
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
    mockGetJobProvenance.mockResolvedValue({
      job: {
        id: 'test-job-1',
        state: 'succeeded',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:01:00.000Z',
        startedAt: '2024-01-01T00:00:10.000Z',
        finishedAt: '2024-01-01T00:01:00.000Z',
        sourceJobId: null,
        manifestPath: '/tmp/manifest.json',
        notionUrl: null,
        anytypeUrl: null,
        error: null,
      },
      sourceJob: null,
      recording: null,
      transcript: null,
      promptPackage: null,
      draft: null,
      tts: null,
      lineage: null,
      actions: [],
    });
    mockListStudentProfileBindingsForStudent.mockResolvedValue({
      items: [
        {
          id: 'binding-1',
          studentId: deriveStudentId('Anna'),
          profileId: 'profile.md',
          effectiveFrom: '2024-01-01T00:00:00.000Z',
          effectiveTo: null,
          reason: 'sync_student_profile',
          changedBy: null,
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
      order: 'desc',
    });
    mockGetActiveStudentProfileBindingForStudent.mockResolvedValue({
      id: 'binding-1',
      studentId: deriveStudentId('Anna'),
      profileId: 'profile.md',
      effectiveFrom: '2024-01-01T00:00:00.000Z',
      effectiveTo: null,
      reason: 'sync_student_profile',
      changedBy: null,
      createdAt: '2024-01-01T00:00:00.000Z',
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
      learningPresetId: undefined,
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
      learningPresetId: undefined,
      withTts: true,
      upload: 'auto',
      voiceId: 'voice_amanda',
      voiceAccent: 'american_female',
      forceTts: true,
      notionDatabase: 'db-123',
      ttsStrategy: 'dialogue',
    });
  });

  it('POST /jobs accepts learningPresetId and forwards it', async () => {
    const submitJob = vi.spyOn(submitJobModule, 'submitJob');
    submitJob.mockResolvedValue({ jobId: 'job-345' });

    const response = await app.inject({
      method: 'POST',
      url: '/jobs',
      payload: {
        md: 'fixtures/ok.md',
        learningPresetId: 'general-english',
      },
    });

    expect(response.statusCode).toBe(202);
    expect(submitJob).toHaveBeenCalledWith({
      md: 'fixtures/ok.md',
      preset: undefined,
      learningPresetId: 'general-english',
      withTts: undefined,
      upload: undefined,
      voiceId: undefined,
      voiceAccent: undefined,
      forceTts: undefined,
      notionDatabase: undefined,
      publishTarget: undefined,
      ttsStrategy: undefined,
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
      mdStorageUri: 'local://drafts/draft-1.md',
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
      mdStorageUri: 'local://drafts/draft-1.md',
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
      publishTarget: null,
      ttsStrategy: 'dialogue',
      notionUrl: 'https://notion.so/job-approve-1',
      anytypeUrl: null,
      autoPublish: null,
      state: 'queued',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:01:00.000Z',
      startedAt: null,
      finishedAt: null,
      sourceJobId: null,
      error: null,
      providerError: null,
      manifestPath: '/manifests/job-approve-1.json',
    });
    expect(approveJobForPipeline).toHaveBeenCalledWith(
      'job-approve-1',
      {
        md: '/uploads/drafts/draft-1.md',
        mdStorageUri: undefined,
      },
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
      payload: { md: '' },
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
      publishTarget: 'notion',
      ttsStrategy: 'dialogue',
      autoPublish: null,
      notionUrl: 'https://notion.so/job-1',
      anytypeUrl: null,
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
      publishTarget: 'notion',
      ttsStrategy: 'dialogue',
      autoPublish: null,
      notionUrl: 'https://notion.so/job-1',
      anytypeUrl: null,
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
      publishTarget: 'notion',
      ttsStrategy: null,
      autoPublish: null,
      notionUrl: null,
      anytypeUrl: null,
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

  it('GET /jobs/:jobId/provenance returns provenance payload', async () => {
    mockGetJobProvenance.mockResolvedValue({
      job: {
        id: 'job-3',
        state: 'succeeded',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:01:00.000Z',
        startedAt: '2024-01-01T00:00:10.000Z',
        finishedAt: '2024-01-01T00:01:00.000Z',
        sourceJobId: 'job-2',
        manifestPath: '/tmp/manifest.json',
        notionUrl: 'https://notion.so/published',
        anytypeUrl: null,
        error: null,
      },
      sourceJob: {
        id: 'job-2',
        state: 'succeeded',
        createdAt: '2024-01-01T00:00:00.000Z',
        finishedAt: '2024-01-01T00:00:55.000Z',
      },
      recording: null,
      transcript: null,
      promptPackage: null,
      draft: null,
      tts: null,
      lineage: null,
      actions: [],
    });

    const response = await app.inject({
      method: 'GET',
      url: '/jobs/job-3/provenance',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      job: {
        id: 'job-3',
        sourceJobId: 'job-2',
      },
      sourceJob: {
        id: 'job-2',
      },
    });
    expect(mockGetJobProvenance).toHaveBeenCalledWith('job-3');
  });

  it('GET /jobs/:jobId/provenance returns 404 when missing', async () => {
    mockGetJobProvenance.mockResolvedValueOnce(null);

    const response = await app.inject({
      method: 'GET',
      url: '/jobs/missing/provenance',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });
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
    expect(response.json()).toEqual(
      expect.objectContaining({
        cefrLevels: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
        cefrDefault: 'B1',
        generation: expect.objectContaining({
          defaultProvider: 'openai',
          quota: expect.objectContaining({
            source: 'hybrid',
          }),
        }),
      }),
    );
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

  it('GET /students/:id/bindings returns binding history', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/students/${deriveStudentId('Anna')}/bindings?limit=10&offset=0&order=desc`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        {
          id: 'binding-1',
          studentId: deriveStudentId('Anna'),
          profileId: 'profile.md',
          effectiveFrom: '2024-01-01T00:00:00.000Z',
          effectiveTo: null,
          reason: 'sync_student_profile',
          changedBy: null,
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
      order: 'desc',
    });
  });

  it('GET /students/:id/bindings/active returns active binding', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/students/${deriveStudentId('Anna')}/bindings/active`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: 'binding-1',
      studentId: deriveStudentId('Anna'),
      profileId: 'profile.md',
      effectiveFrom: '2024-01-01T00:00:00.000Z',
      effectiveTo: null,
      reason: 'sync_student_profile',
      changedBy: null,
      createdAt: '2024-01-01T00:00:00.000Z',
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
      currentRevisionId: 'revision-1',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
  });

  it('DELETE /profiles/:id archives profile content', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/profiles/profile.md',
    });

    expect(response.statusCode).toBe(204);
    expect(mockDeleteProfileContent).toHaveBeenCalledWith('profile.md');
  });

  it('GET /profiles/:id/revisions returns profile revision list', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/profiles/profile.md/revisions?limit=10&offset=0&order=desc',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        {
          id: 'revision-1',
          profileId: 'profile.md',
          contentHash: 'hash-1',
          source: 'create',
          status: 'active',
          versionNumber: 1,
          versionLabel: 'v1',
          activatedAt: '2024-01-01T00:00:00.000Z',
          deprecatedAt: null,
          createdAt: '2024-01-01T00:00:00.000Z',
          createdBy: null,
          restoredFromRevisionId: null,
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
      order: 'desc',
    });
  });

  it('GET /profiles/:id/revisions/:revisionId returns revision detail', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/profiles/profile.md/revisions/11111111-1111-4111-8111-111111111111',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: 'revision-1',
      profileId: 'profile.md',
      contentHash: 'hash-1',
      source: 'create',
      status: 'active',
      versionNumber: 1,
      versionLabel: 'v1',
      activatedAt: '2024-01-01T00:00:00.000Z',
      deprecatedAt: null,
      createdAt: '2024-01-01T00:00:00.000Z',
      createdBy: null,
      restoredFromRevisionId: null,
      content: 'Profile content',
    });
  });

  it('POST /profiles/:id/revisions/:revisionId/restore restores profile content', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/profiles/profile.md/revisions/11111111-1111-4111-8111-111111111111/restore',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: 'profile.md',
      label: 'Profile',
      content: 'Restored content',
      currentRevisionId: 'revision-2',
      updatedAt: '2024-01-02T00:00:00.000Z',
    });
  });

  it('POST /profiles/:id/revisions/:revisionId/activate returns activated revision', async () => {
    mockActivateProfileRevisionForProfile.mockResolvedValueOnce({
      id: 'revision-1',
      profileId: 'profile.md',
      contentHash: 'hash-1',
      source: 'create',
      status: 'active',
      versionNumber: 1,
      versionLabel: 'v1',
      activatedAt: '2024-01-01T00:00:00.000Z',
      deprecatedAt: null,
      createdAt: '2024-01-01T00:00:00.000Z',
      createdBy: null,
      restoredFromRevisionId: null,
      content: 'Profile content',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/profiles/profile.md/revisions/11111111-1111-4111-8111-111111111111/activate',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: 'revision-1',
      profileId: 'profile.md',
      status: 'active',
      versionLabel: 'v1',
    });
  });

  it('GET /templates returns template list', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/templates',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      templates: [{ id: 'template.md', label: 'Template' }],
    });
  });

  it('GET /templates/:id returns template content', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/templates/template.md',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: 'template.md',
      label: 'Template',
      content: String.raw`Template content\nINSERT PROFILE HERE`,
      currentRevisionId: 'template-revision-1',
      updatedAt: '2024-01-01T00:00:00.000Z',
    });
  });

  it('PUT /templates/:id saves template content', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/templates/template.md',
      payload: {
        content: String.raw`Updated template content\nINSERT PROFILE HERE`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: 'template.md',
      label: 'Template',
      content: String.raw`Updated template content\nINSERT PROFILE HERE`,
      currentRevisionId: 'template-revision-2',
      updatedAt: '2024-01-02T00:00:00.000Z',
    });
  });

  it('DELETE /templates/:id archives template content', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/templates/template.md',
    });

    expect(response.statusCode).toBe(204);
    expect(mockDeleteTemplateContent).toHaveBeenCalledWith('template.md');
  });

  it('GET /templates/:id/revisions returns template revision list', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/templates/template.md/revisions?limit=10&offset=0&order=desc',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      items: [
        {
          id: 'template-revision-1',
          templateId: 'template.md',
          contentHash: 'template-hash-1',
          source: 'create',
          status: 'active',
          versionNumber: 1,
          versionLabel: 'v1',
          activatedAt: '2024-01-01T00:00:00.000Z',
          deprecatedAt: null,
          createdAt: '2024-01-01T00:00:00.000Z',
          createdBy: null,
          restoredFromRevisionId: null,
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
      order: 'desc',
    });
  });

  it('POST /recordings/upload reuses existing transcript when hash already exists', async () => {
    const listRecordingsBySha256 = vi.spyOn(recordingRepositoryModule, 'listRecordingsBySha256');
    const getTranscriptByRecordingId = vi.spyOn(
      transcriptRepositoryModule,
      'getTranscriptByRecordingId',
    );
    const insertRecording = vi.spyOn(recordingRepositoryModule, 'insertRecording');

    listRecordingsBySha256.mockResolvedValueOnce([
      {
        id: 'recording-cached',
        source: 'upload',
        studentId: deriveStudentId('Anna'),
        sourcePath: 'lesson.mp3',
        storageUri: 'memory://recordings/recording-cached.mp3',
        sha256: 'abc123',
        bytes: 1024,
        durationSec: 90,
        channels: 1,
        status: 'transcribed',
        error: null,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:05:00.000Z'),
      },
    ]);
    getTranscriptByRecordingId.mockResolvedValueOnce({
      id: 'transcript-cached',
      recordingId: 'recording-cached',
      storageUri: 'memory://transcripts/transcript-cached.txt',
      rawResponseUri: null,
      mode: 'timeline',
      model: 'nova-3',
      language: 'en',
      fallbackUsed: false,
      summaryJson: null,
      createdAt: new Date('2024-01-01T00:05:00.000Z'),
      updatedAt: new Date('2024-01-01T00:05:00.000Z'),
    });
    insertRecording.mockClear();

    const boundary = '----esl-test-boundary';
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
          'Content-Disposition: form-data; name="file"; filename="lesson.mp3"\r\n' +
          'Content-Type: audio/mpeg\r\n\r\n',
      ),
      Buffer.from('mock-audio-content'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/recordings/upload',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      recordingId: 'recording-cached',
      transcriptId: 'transcript-cached',
      cacheHit: true,
      cacheReason: 'transcript_reused',
      cacheRecordingId: 'recording-cached',
    });
    expect(insertRecording).not.toHaveBeenCalled();
  });

  it('POST /recordings/upload matches cached transcript by effective provider when query omits sttProvider', async () => {
    const listRecordingsBySha256 = vi.spyOn(recordingRepositoryModule, 'listRecordingsBySha256');
    const getTranscriptByRecordingId = vi.spyOn(
      transcriptRepositoryModule,
      'getTranscriptByRecordingId',
    );
    const insertRecording = vi.spyOn(recordingRepositoryModule, 'insertRecording');

    listRecordingsBySha256.mockResolvedValueOnce([
      {
        id: 'recording-elevenlabs',
        source: 'upload',
        studentId: deriveStudentId('Anna'),
        sourcePath: 'lesson.mp3',
        storageUri: 'memory://recordings/recording-elevenlabs.mp3',
        sha256: 'abc123',
        bytes: 1024,
        durationSec: 90,
        channels: 1,
        status: 'transcribed',
        error: null,
        createdAt: new Date('2024-01-02T00:00:00.000Z'),
        updatedAt: new Date('2024-01-02T00:05:00.000Z'),
      },
      {
        id: 'recording-deepgram',
        source: 'upload',
        studentId: deriveStudentId('Anna'),
        sourcePath: 'lesson.mp3',
        storageUri: 'memory://recordings/recording-deepgram.mp3',
        sha256: 'abc123',
        bytes: 1024,
        durationSec: 90,
        channels: 1,
        status: 'transcribed',
        error: null,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:05:00.000Z'),
      },
    ]);
    getTranscriptByRecordingId
      .mockResolvedValueOnce({
        id: 'transcript-elevenlabs',
        recordingId: 'recording-elevenlabs',
        storageUri: 'memory://transcripts/transcript-elevenlabs.txt',
        rawResponseUri: null,
        mode: 'timeline',
        model: 'scribe_v1',
        language: 'en',
        fallbackUsed: false,
        summaryJson: { provider: 'elevenlabs' },
        createdAt: new Date('2024-01-02T00:05:00.000Z'),
        updatedAt: new Date('2024-01-02T00:05:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'transcript-deepgram',
        recordingId: 'recording-deepgram',
        storageUri: 'memory://transcripts/transcript-deepgram.txt',
        rawResponseUri: null,
        mode: 'timeline',
        model: 'nova-3',
        language: 'en',
        fallbackUsed: false,
        summaryJson: { provider: 'deepgram' },
        createdAt: new Date('2024-01-01T00:05:00.000Z'),
        updatedAt: new Date('2024-01-01T00:05:00.000Z'),
      });
    insertRecording.mockClear();

    const boundary = '----esl-test-boundary-2';
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
          'Content-Disposition: form-data; name="file"; filename="lesson.mp3"\r\n' +
          'Content-Type: audio/mpeg\r\n\r\n',
      ),
      Buffer.from('mock-audio-content'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/recordings/upload',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    // Test env default STT provider is deepgram, so deepgram transcript should be selected.
    expect(response.json()).toMatchObject({
      recordingId: 'recording-deepgram',
      transcriptId: 'transcript-deepgram',
      cacheHit: true,
      cacheReason: 'transcript_reused',
      cacheRecordingId: 'recording-deepgram',
    });
    expect(insertRecording).not.toHaveBeenCalled();
  });

  it('POST /recordings/upload honors explicit sttProvider against mixed cached transcripts', async () => {
    const listRecordingsBySha256 = vi.spyOn(recordingRepositoryModule, 'listRecordingsBySha256');
    const getTranscriptByRecordingId = vi.spyOn(
      transcriptRepositoryModule,
      'getTranscriptByRecordingId',
    );
    const insertRecording = vi.spyOn(recordingRepositoryModule, 'insertRecording');

    listRecordingsBySha256.mockResolvedValueOnce([
      {
        id: 'recording-deepgram',
        source: 'upload',
        studentId: deriveStudentId('Anna'),
        sourcePath: 'lesson.mp3',
        storageUri: 'memory://recordings/recording-deepgram.mp3',
        sha256: 'abc123',
        bytes: 1024,
        durationSec: 90,
        channels: 1,
        status: 'transcribed',
        error: null,
        createdAt: new Date('2024-01-02T00:00:00.000Z'),
        updatedAt: new Date('2024-01-02T00:05:00.000Z'),
      },
      {
        id: 'recording-elevenlabs',
        source: 'upload',
        studentId: deriveStudentId('Anna'),
        sourcePath: 'lesson.mp3',
        storageUri: 'memory://recordings/recording-elevenlabs.mp3',
        sha256: 'abc123',
        bytes: 1024,
        durationSec: 90,
        channels: 1,
        status: 'transcribed',
        error: null,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:05:00.000Z'),
      },
    ]);
    getTranscriptByRecordingId
      .mockResolvedValueOnce({
        id: 'transcript-deepgram',
        recordingId: 'recording-deepgram',
        storageUri: 'memory://transcripts/transcript-deepgram.txt',
        rawResponseUri: null,
        mode: 'timeline',
        model: 'nova-3',
        language: 'en',
        fallbackUsed: false,
        summaryJson: { provider: 'deepgram' },
        createdAt: new Date('2024-01-02T00:05:00.000Z'),
        updatedAt: new Date('2024-01-02T00:05:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'transcript-elevenlabs',
        recordingId: 'recording-elevenlabs',
        storageUri: 'memory://transcripts/transcript-elevenlabs.txt',
        rawResponseUri: null,
        mode: 'timeline',
        model: 'scribe_v1',
        language: 'en',
        fallbackUsed: false,
        summaryJson: { provider: 'elevenlabs' },
        createdAt: new Date('2024-01-01T00:05:00.000Z'),
        updatedAt: new Date('2024-01-01T00:05:00.000Z'),
      });
    insertRecording.mockClear();

    const boundary = '----esl-test-boundary-3';
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
          'Content-Disposition: form-data; name="file"; filename="lesson.mp3"\r\n' +
          'Content-Type: audio/mpeg\r\n\r\n',
      ),
      Buffer.from('mock-audio-content'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/recordings/upload?sttProvider=elevenlabs',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      recordingId: 'recording-elevenlabs',
      transcriptId: 'transcript-elevenlabs',
      cacheHit: true,
      cacheReason: 'transcript_reused',
      cacheRecordingId: 'recording-elevenlabs',
    });
    expect(insertRecording).not.toHaveBeenCalled();
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
    const retryRecording = vi.spyOn(retryRecordingModule, 'retryRecordingTranscription');
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
      { sttProvider: undefined },
      expect.objectContaining({ enqueue: expect.any(Function) }),
    );
  });

  it('POST /recordings/:id/transcribe forwards explicit STT provider override', async () => {
    const retryRecording = vi.spyOn(retryRecordingModule, 'retryRecordingTranscription');
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
      payload: { sttProvider: 'elevenlabs' },
    });

    expect(response.statusCode).toBe(200);
    expect(retryRecording).toHaveBeenCalledWith(
      'recording-1',
      { sttProvider: 'elevenlabs' },
      expect.objectContaining({ enqueue: expect.any(Function) }),
    );
  });

  it('GET /recordings/:id/transcript returns transcript payload', async () => {
    const getRecordingTranscript = vi.spyOn(getRecordingTranscriptModule, 'getRecordingTranscript');
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
    const getRecordingTranscript = vi.spyOn(getRecordingTranscriptModule, 'getRecordingTranscript');
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

  it('GET /prompt-packages/:id/lineage returns lineage payload', async () => {
    const getPromptPackageLineage = vi.spyOn(getPromptPackageModule, 'getPromptPackageLineage');
    getPromptPackageLineage.mockClear();
    getPromptPackageLineage.mockResolvedValue({
      promptPackageId: 'prompt-1',
      recordingId: 'recording-1',
      transcriptId: 'transcript-1',
      studentId: 'student-1',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:10:00.000Z',
      profile: {
        snapshot: {
          profileId: 'profile.md',
          revisionId: 'revision-1',
          hash: 'hash-1',
          versionLabel: 'v1',
          status: 'active',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
        current: {
          profileId: 'profile.md',
          revisionId: 'revision-2',
          hash: 'hash-2',
          versionLabel: 'v2',
          status: 'active',
          updatedAt: '2024-01-02T00:00:00.000Z',
        },
        drift: {
          detected: true,
          reason: 'profile_content_changed',
          currentProfileHash: 'hash-2',
          currentProfileRevisionId: 'revision-2',
          currentProfileUpdatedAt: '2024-01-02T00:00:00.000Z',
        },
      },
      template: {
        snapshot: {
          templateId: 'template.md',
          revisionId: 'template-revision-1',
          hash: 'template-hash-1',
          versionLabel: 'v1',
          status: 'active',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
        current: {
          templateId: 'template.md',
          revisionId: 'template-revision-1',
          hash: 'template-hash-1',
          versionLabel: 'v1',
          status: 'active',
          updatedAt: '2024-01-01T00:00:00.000Z',
        },
        drift: null,
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/prompt-packages/prompt-1/lineage',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      promptPackageId: 'prompt-1',
      profile: {
        snapshot: {
          profileId: 'profile.md',
          revisionId: 'revision-1',
        },
      },
      template: {
        snapshot: {
          templateId: 'template.md',
          revisionId: 'template-revision-1',
        },
      },
    });
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

  it('POST /generation/drafts returns generated payload', async () => {
    const generateDraft = vi.spyOn(generateDraftModule, 'generateDraft');
    generateDraft.mockClear();
    generateDraft.mockResolvedValue({
      text: '# Generated draft',
      provider: 'openai',
      model: 'gpt-5.2',
      quota: {
        source: 'hybrid',
        lastUpdatedAt: '2026-02-18T00:00:00.000Z',
      },
      usage: {
        inputTokens: 123,
        outputTokens: 456,
        totalTokens: 579,
      },
      providerRequestId: 'resp-1',
    });

    const response = await app.inject({
      method: 'POST',
      url: '/generation/drafts',
      payload: {
        promptPackageId: 'prompt-1',
        provider: 'openai',
        model: 'gpt-5.2',
        maxOutputTokens: 800,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      text: '# Generated draft',
      provider: 'openai',
      model: 'gpt-5.2',
      quota: {
        source: 'hybrid',
      },
      usage: {
        totalTokens: 579,
      },
    });
    expect(generateDraft).toHaveBeenCalledWith(
      {
        promptPackageId: 'prompt-1',
        provider: 'openai',
        model: 'gpt-5.2',
        maxOutputTokens: 800,
      },
      expect.any(Object),
    );
  });

  it('POST /generation/drafts returns 404 when prompt package is missing', async () => {
    const generateDraft = vi.spyOn(generateDraftModule, 'generateDraft');
    generateDraft.mockClear();
    generateDraft.mockResolvedValue(null);

    const response = await app.inject({
      method: 'POST',
      url: '/generation/drafts',
      payload: {
        promptPackageId: 'missing',
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });
  });

  it('POST /generation/drafts maps provider errors to category-specific status and payload', async () => {
    const generateDraft = vi.spyOn(generateDraftModule, 'generateDraft');
    generateDraft.mockClear();
    generateDraft.mockRejectedValue(
      new generateDraftModule.GenerateDraftProviderError({
        category: 'provider_timeout',
        provider: 'google_ai_studio',
        model: 'gemini-3-flash-preview',
        message: 'Provider request timed out',
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/generation/drafts',
      payload: {
        promptPackageId: 'prompt-1',
      },
    });

    expect(response.statusCode).toBe(504);
    expect(response.json()).toEqual({
      error: 'internal_error',
      code: 'provider_timeout',
      message: 'Provider request timed out',
      provider: 'google_ai_studio',
      model: 'gemini-3-flash-preview',
      requestId: expect.any(String),
      timestamp: expect.any(String),
    });
  });

  it('POST /generation/drafts maps rate-limit provider errors to 429', async () => {
    const generateDraft = vi.spyOn(generateDraftModule, 'generateDraft');
    generateDraft.mockClear();
    generateDraft.mockRejectedValue(
      new generateDraftModule.GenerateDraftProviderError({
        category: 'provider_rate_limit',
        provider: 'openai',
        model: 'gpt-5.2',
        message: 'Rate limit exceeded',
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/generation/drafts',
      payload: {
        promptPackageId: 'prompt-1',
      },
    });

    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({
      error: 'internal_error',
      code: 'provider_rate_limit',
      message: 'Rate limit exceeded',
      provider: 'openai',
      model: 'gpt-5.2',
      requestId: expect.any(String),
      timestamp: expect.any(String),
    });
  });

  it('POST /generation/drafts maps contract provider errors to 502', async () => {
    const generateDraft = vi.spyOn(generateDraftModule, 'generateDraft');
    generateDraft.mockClear();
    generateDraft.mockRejectedValue(
      new generateDraftModule.GenerateDraftProviderError({
        category: 'provider_contract_error',
        provider: 'openrouter',
        model: 'openrouter/test-primary',
        message: 'Invalid provider payload',
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/generation/drafts',
      payload: {
        promptPackageId: 'prompt-1',
      },
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({
      error: 'internal_error',
      code: 'provider_contract_error',
      message: 'Invalid provider payload',
      provider: 'openrouter',
      model: 'openrouter/test-primary',
      requestId: expect.any(String),
      timestamp: expect.any(String),
    });
  });

  it('POST /generation/drafts maps budget errors to 429 with limit details', async () => {
    const generateDraft = vi.spyOn(generateDraftModule, 'generateDraft');
    generateDraft.mockClear();
    generateDraft.mockRejectedValue(
      new generateDraftModule.GenerateDraftProviderError({
        category: 'budget_exceeded',
        provider: 'openai',
        model: 'gpt-5.2',
        message: 'Generation blocked by daily_tokens safety limit (120000/120000).',
        limitType: 'daily_tokens',
        limit: 120000,
        used: 120000,
        window: 'day',
      }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/generation/drafts',
      payload: {
        promptPackageId: 'prompt-1',
      },
    });

    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({
      error: 'internal_error',
      code: 'budget_exceeded',
      message: 'Generation blocked by daily_tokens safety limit (120000/120000).',
      provider: 'openai',
      model: 'gpt-5.2',
      limitType: 'daily_tokens',
      limit: 120000,
      used: 120000,
      window: 'day',
      requestId: expect.any(String),
      timestamp: expect.any(String),
    });
  });

  it('POST /generation/drafts validates request body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/generation/drafts',
      payload: {
        promptPackageId: '',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'validation_failed',
      message: 'Invalid request body',
      details: expect.any(Array),
    });
  });

  it('POST /drafts/:id/materialize returns md path', async () => {
    const materializeDraft = vi.spyOn(materializeDraftModule, 'materializeDraft');
    materializeDraft.mockClear();
    materializeDraft.mockResolvedValue({
      draftId: 'draft-1',
      jobId: 'job-1',
      mdPath: '/uploads/drafts/draft-1.md',
      mdStorageUri: 'local://drafts/draft-1.md',
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
      mdStorageUri: 'local://drafts/draft-1.md',
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
      mdStorageUri: 'local://drafts/draft-2.md',
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
      mdStorageUri: 'local://drafts/draft-2.md',
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
      mdStorageUri: 'local://drafts/draft-3.md',
    });

    const payload = {
      jobOverrides: {
        preset: 'b1-default',
        learningPresetId: 'general-english',
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
    const mockValidateMarkdown = vi.mocked(validateMarkdown);
    mockValidateMarkdown.mockResolvedValue({
      ok: false,
      errors: ['Missing header'],
      warnings: ['Minor issue'],
      meta: {
        title: 'Lesson',
        student: 'Anna',
        level: 'B1',
        topic: 'Grammar',
        input_type: 'generate',
        study_text_type: 'dialogue',
        speaker_labels: ['A', 'B'],
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/validation/markdown',
      payload: {
        text: 'raw markdown',
        strict: true,
        learningPresetId: 'general-english',
        learningPresetVersion: 'v1',
        preset: 'b1-default',
      },
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
        input_type: 'generate',
        study_text_type: 'dialogue',
        speaker_labels: ['A', 'B'],
      },
    });
    expect(mockValidateMarkdown).toHaveBeenCalledWith({
      markdown: 'raw markdown',
      strict: true,
      learningPresetId: 'general-english',
      learningPresetVersion: 'v1',
      preset: 'b1-default',
    });
  });

  it('POST /validation/markdown preserves additive ruleset fallback metadata', async () => {
    const mockValidateMarkdown = vi.mocked(validateMarkdown);
    mockValidateMarkdown.mockResolvedValue({
      ok: true,
      errors: [],
      warnings: ['Unknown learning preset "ielts-academic". Falling back to general-english@v1.'],
      issues: [
        {
          code: 'ruleset.unknown_preset_fallback',
          ruleId: 'ruleset-resolution',
          severity: 'warning',
          message: 'Unknown learning preset "ielts-academic". Falling back to general-english@v1.',
          category: 'contract',
          blockingInStrict: false,
        },
      ],
      ruleset: {
        id: 'general-english',
        version: 'v1',
        requestedId: 'ielts-academic',
        requestedVersion: null,
        fallbackApplied: true,
        fallbackReason: 'unknown_preset',
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/validation/markdown',
      payload: {
        text: 'raw markdown',
        strict: true,
        learningPresetId: 'ielts-academic',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      errors: [],
      warnings: ['Unknown learning preset "ielts-academic". Falling back to general-english@v1.'],
      issues: [
        {
          code: 'ruleset.unknown_preset_fallback',
          ruleId: 'ruleset-resolution',
          severity: 'warning',
          message: 'Unknown learning preset "ielts-academic". Falling back to general-english@v1.',
          category: 'contract',
          blockingInStrict: false,
        },
      ],
      ruleset: {
        id: 'general-english',
        version: 'v1',
        requestedId: 'ielts-academic',
        requestedVersion: null,
        fallbackApplied: true,
        fallbackReason: 'unknown_preset',
      },
    });
    expect(mockValidateMarkdown).toHaveBeenCalledWith({
      markdown: 'raw markdown',
      strict: true,
      learningPresetId: 'ielts-academic',
      learningPresetVersion: undefined,
      preset: undefined,
    });
  });

  it('POST /preview/html injects audio placeholder when no audio URL is provided', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/preview/html',
      payload: {
        text: [
          '## Warm up',
          '',
          ':::study-text Transcript',
          'Teacher: Hello!',
          'Student: Hi!',
          ':::',
        ].join('\n'),
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(
      expect.objectContaining({
        html: expect.any(String),
      }),
    );

    const payload = response.json() as { html: string };
    expect(payload.html).toContain('Audio track generating...');
    expect(payload.html).toContain('audio-placeholder');
    expect(payload.html).not.toContain('esl-generated-study-text-audio-placeholder');
  });

  it('POST /preview/html derives title from markdown heading when title is omitted', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/preview/html',
      payload: {
        text: ['# Lesson heading from markdown', '', 'Body text.'].join('\n'),
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as { html: string };
    expect(payload.html).toContain('<h1 class="hero-title">Lesson heading from markdown</h1>');
  });

  it('POST /preview/html derives title from frontmatter when heading title is omitted', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/preview/html',
      payload: {
        text: ['---', 'title: "Frontmatter Lesson"', '---', '', 'Body text.'].join('\n'),
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as { html: string };
    expect(payload.html).toContain('<h1 class="hero-title">Frontmatter Lesson</h1>');
  });

  it('POST /preview/html derives title from CRLF frontmatter when heading title is omitted', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/preview/html',
      payload: {
        text: ['---', 'title: "CRLF Frontmatter Lesson"', '---', '', 'Body text.'].join('\r\n'),
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as { html: string };
    expect(payload.html).toContain('<h1 class="hero-title">CRLF Frontmatter Lesson</h1>');
  });

  it('POST /preview/html derives title from frontmatter at EOF without trailing newline', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/preview/html',
      payload: {
        text: ['---', 'title: "EOF Frontmatter Lesson"', '---'].join('\n'),
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as { html: string };
    expect(payload.html).toContain('<h1 class="hero-title">EOF Frontmatter Lesson</h1>');
  });

  it('POST /preview/html resolves heading colors from user default preset when learning preset is selected', async () => {
    const getSettingsSpy = vi
      .spyOn(settingsRepositoryModule, 'getSettingsByUserId')
      .mockResolvedValue({
        defaultPreset: 'b1-default',
      } as Awaited<ReturnType<typeof settingsRepositoryModule.getSettingsByUserId>>);
    const createDefaultSpy = vi.spyOn(settingsRepositoryModule, 'createDefaultSettings');
    const loadPresetSpy = vi.spyOn(notionAdapterModule, 'loadPreset').mockResolvedValue({
      h2: 'blue',
      h3: 'green',
    });

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/preview/html',
        payload: {
          text: '# Theme parity',
          learningPresetId: 'general-english',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(getSettingsSpy).toHaveBeenCalledWith('test-user-id');
      expect(createDefaultSpy).not.toHaveBeenCalled();
      expect(loadPresetSpy).toHaveBeenCalledWith('b1-default', expect.any(String));

      const payload = response.json() as { html: string };
      expect(payload.html).toContain('--theme-h2: #2d9cdb;');
      expect(payload.html).toContain('--theme-h3: #27ae60;');
    } finally {
      getSettingsSpy.mockRestore();
      createDefaultSpy.mockRestore();
      loadPresetSpy.mockRestore();
    }
  });

  it('POST /preview/html injects pronunciation placeholder in shadow_sentence mode', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/preview/html',
      payload: {
        text: [
          '### C. Pronunciation Micro-Focus',
          '',
          '**Mode:** shadow_sentence',
          '**Shadow sentence:** We should review this carefully.',
          '',
          '1. review — /rɪˈvjuː/',
          '2. carefully — /ˈkeə.fəl.i/',
          '3. should — /ʃʊd/',
          '',
          ':::study-text Transcript',
          'Teacher: Hello!',
          ':::',
        ].join('\n'),
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as { html: string };
    const placeholderCount = (payload.html.match(/Audio track generating\.\.\./g) ?? []).length;
    expect(placeholderCount).toBeGreaterThanOrEqual(2);
    expect(payload.html).not.toContain('esl-generated-pronunciation-audio-placeholder');
    expect(payload.html.lastIndexOf('Audio track generating...')).toBeGreaterThan(
      payload.html.indexOf('Shadow sentence'),
    );
  });

  it('POST /preview/html places pronunciation audio URL below shadow sentence content', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/preview/html',
      payload: {
        text: [
          '### C. Pronunciation Micro-Focus',
          '',
          '**Mode:** shadow_sentence',
          '**Shadow sentence:** We should review this carefully.',
          '',
          '1. review — /rɪˈvjuː/',
          '2. carefully — /ˈkeə.fəl.i/',
          '3. should — /ʃʊd/',
        ].join('\n'),
        pronunciationAudioUrl: 'https://example.com/pronunciation.mp3',
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as { html: string };
    expect(payload.html).toContain('https://example.com/pronunciation.mp3');
    const audioIndex = payload.html.indexOf('Audio recording: Pronunciation Shadow Sentence');
    expect(audioIndex).toBeGreaterThan(payload.html.indexOf('Shadow sentence'));
    expect(audioIndex).toBeLessThan(payload.html.indexOf('review —'));
  });

  it('POST /preview/html places pronunciation audio below multiline shadow sentence labels', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/preview/html',
      payload: {
        text: [
          '### C. Pronunciation Micro-Focus',
          '',
          '**Mode:** shadow_sentence',
          '**Shadow sentence:**',
          'There was a flood, so the vehicle stopped working.',
          '',
          '1. flood — /flʌd/',
          '2. vehicle — /ˈviː.ɪ.kəl/',
        ].join('\n'),
        pronunciationAudioUrl: 'https://example.com/pronunciation-multiline.mp3',
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as { html: string };
    const audioIndex = payload.html.indexOf('Audio recording: Pronunciation Shadow Sentence');
    expect(audioIndex).toBeGreaterThan(payload.html.indexOf('There was a flood, so the vehicle stopped working.'));
    expect(audioIndex).toBeLessThan(payload.html.indexOf('flood —'));
  });

  it('POST /preview/html injects pronunciation placeholder in connected_speech mode', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/preview/html',
      payload: {
        text: [
          '### C. Pronunciation Micro-Focus',
          '',
          '**Mode:** connected_speech',
          '',
          '- 1. "Change helps us." -> Change help-sus.',
          '- 2. "It gives us food." -> It give-sus food.',
          '- 3. "Light feels stronger." -> Light feel-stronger.',
          '',
          ':::study-text Transcript',
          'Teacher: Hello!',
          ':::',
        ].join('\n'),
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as { html: string };
    const placeholderCount = (payload.html.match(/Audio track generating\.\.\./g) ?? []).length;
    expect(placeholderCount).toBeGreaterThanOrEqual(2);
  });

  it('POST /preview/html preserves user-authored audio directives', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/preview/html',
      payload: {
        text: [
          '## Warm up',
          '',
          ':::audio https://example.com/custom.mp3',
          '',
          ':::study-text Transcript',
          'Teacher: Hello!',
          ':::',
        ].join('\n'),
        audioUrl: 'https://example.com/generated.mp3',
      },
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as { html: string };
    expect(payload.html).toContain('https://example.com/custom.mp3');
    expect(payload.html).toContain('https://example.com/generated.mp3');
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
          publishTarget: 'notion',
          ttsStrategy: 'auto',
          autoPublish: null,
          notionUrl: null,
          anytypeUrl: null,
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
          publishTarget: 'notion',
          ttsStrategy: 'auto',
          autoPublish: null,
          notionUrl: null,
          anytypeUrl: null,
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

  it('GET /metrics/readiness returns readiness metrics response', async () => {
    const getReadiness = vi.spyOn(readinessMetricsModule, 'getReadinessMetricsWithDefaults');
    getReadiness.mockResolvedValue({
      window: {
        from: '2024-03-01T00:00:00.000Z',
        to: '2024-03-07T00:00:00.000Z',
      },
      publishSuccess: {
        succeeded: 7,
        failed: 1,
        total: 8,
        rate: 0.875,
      },
      publishLatencyMs: {
        median: 10234.5,
        sampleSize: 7,
      },
      firstSessionSuccessProxy: {
        successfulUsers: 4,
        totalUsers: 5,
        rate: 0.8,
      },
      voiceAlignment: {
        validationFailures: 2,
        strictMismatches: 1,
        providerErrors: 1,
        providerErrorBreakdown: {
          provider_rate_limit: 1,
        },
        fallbackSelections: null,
        reuseSelections: null,
      },
      sources: {
        publishSuccessRate: {
          source: 'jobs table',
          window: 'last 7 days',
          calculation: 'succeeded / total',
        },
        medianPublishLatencyMs: {
          source: 'jobs table',
          window: 'last 7 days',
          calculation: 'median finished_at - created_at',
        },
        firstSessionSuccessProxy: {
          source: 'jobs table',
          window: 'last 7 days',
          calculation: 'first in-window publish success ratio',
        },
        voiceValidationFailureRate: {
          source: 'jobs table',
          window: 'last 7 days',
          calculation: 'voice validation failures / failed jobs',
        },
        voiceStrictMismatchRate: {
          source: 'jobs table',
          window: 'last 7 days',
          calculation: 'strict mismatches / validation failures',
        },
        voiceFallbackRate: {
          source: 'jobs table',
          window: 'last 7 days',
          calculation: 'fallback selections / total selections',
        },
        voiceProviderErrorRate: {
          source: 'jobs table',
          window: 'last 7 days',
          calculation: 'provider-classified failed-job errors / failed jobs',
        },
      },
    });

    const response = await app.inject({
      method: 'GET',
      url:
        '/metrics/readiness?from=2024-03-01T00:00:00.000Z&to=2024-03-07T00:00:00.000Z' +
        '&userId=8f8d9e53-bc3a-4658-8960-fbf4ff8cb84f',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      window: {
        from: '2024-03-01T00:00:00.000Z',
        to: '2024-03-07T00:00:00.000Z',
      },
      publishSuccess: {
        succeeded: 7,
        failed: 1,
        total: 8,
        rate: 0.875,
      },
      publishLatencyMs: {
        median: 10234.5,
        sampleSize: 7,
      },
      firstSessionSuccessProxy: {
        successfulUsers: 4,
        totalUsers: 5,
        rate: 0.8,
      },
      voiceAlignment: {
        validationFailures: 2,
        strictMismatches: 1,
        providerErrors: 1,
        providerErrorBreakdown: {
          provider_rate_limit: 1,
        },
        fallbackSelections: null,
        reuseSelections: null,
      },
      sources: {
        publishSuccessRate: {
          source: 'jobs table',
          window: 'last 7 days',
          calculation: 'succeeded / total',
        },
        medianPublishLatencyMs: {
          source: 'jobs table',
          window: 'last 7 days',
          calculation: 'median finished_at - created_at',
        },
        firstSessionSuccessProxy: {
          source: 'jobs table',
          window: 'last 7 days',
          calculation: 'first in-window publish success ratio',
        },
        voiceValidationFailureRate: {
          source: 'jobs table',
          window: 'last 7 days',
          calculation: 'voice validation failures / failed jobs',
        },
        voiceStrictMismatchRate: {
          source: 'jobs table',
          window: 'last 7 days',
          calculation: 'strict mismatches / validation failures',
        },
        voiceFallbackRate: {
          source: 'jobs table',
          window: 'last 7 days',
          calculation: 'fallback selections / total selections',
        },
        voiceProviderErrorRate: {
          source: 'jobs table',
          window: 'last 7 days',
          calculation: 'provider-classified failed-job errors / failed jobs',
        },
      },
    });

    const call = getReadiness.mock.calls[0]?.[0];
    expect(call?.from?.toISOString()).toBe('2024-03-01T00:00:00.000Z');
    expect(call?.to?.toISOString()).toBe('2024-03-07T00:00:00.000Z');
    expect(call?.userId).toBe('8f8d9e53-bc3a-4658-8960-fbf4ff8cb84f');
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

    const createStorage = vi.spyOn(transcriptionStorageModule, 'createTranscriptionStorageForUri');
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
      learningPresetId: 'general-english',
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
    expect(eventPayload.payload?.learningPresetId).toBe('general-english');
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
        publishTarget: 'notion',
        ttsStrategy: null,
        autoPublish: null,
        notionUrl: null,
        anytypeUrl: null,
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
