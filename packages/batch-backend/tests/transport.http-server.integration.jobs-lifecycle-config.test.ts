import { readdirSync } from 'node:fs';

import { describeHttpServerIntegrationSuite } from './transport.http-server.integration.harness.js';

const latestPackagedMigration = readdirSync(new URL('../migrations/', import.meta.url), {
  withFileTypes: true,
})
  .filter((entry) => entry.isFile() && /^\d{4}_[a-z0-9_]+\.sql$/.test(entry.name))
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right))
  .at(-1)
  ?.replace(/\.sql$/, '');

describeHttpServerIntegrationSuite(
  'transport/http-server - integration (in-process) [jobs-config-students-content]',
  ({
    app,
    approveJobModule,
    CONTRACT_VERSIONS,
    createHttpServer,
    deriveStudentId,
    expect,
    getJobOptions,
    getJobStatusModule,
    getVersionMeta,
    it,
    mockListStudentProfiles,
    mockGetJobProvenance,
    mockGetJobWorkspaceAuthority,
    recordingRepositoryModule,
    studentStoreModule,
    submitJobModule,
    vi,
  }) => {
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

      expect(submitJob).toHaveBeenLastCalledWith({
        md: 'fixtures/ok.md',
        userId: 'test-user-id',
        learningPresetId: undefined,
        withTts: undefined,
        upload: undefined,
        voiceId: undefined,
        voiceAccent: undefined,
        forceTts: undefined,
        publishTarget: undefined,
        ttsStrategy: undefined,
        ttsProvider: undefined,
        ttsModel: undefined,
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
          learningPresetId: 'general-english',
          withTts: true,
          upload: 'auto',
          voiceId: 'voice_amanda',
          voiceAccent: 'american_female',
          forceTts: true,
          publishTarget: 'html',
          ttsStrategy: 'dialogue',
        },
      });

      expect(response.statusCode).toBe(202);
      expect(submitJob).toHaveBeenLastCalledWith({
        md: 'fixtures/ok.md',
        userId: 'test-user-id',
        learningPresetId: 'general-english',
        withTts: true,
        upload: 'auto',
        voiceId: 'voice_amanda',
        voiceAccent: 'american_female',
        forceTts: true,
        publishTarget: 'html',
        ttsStrategy: 'dialogue',
        ttsProvider: undefined,
        ttsModel: undefined,
      });
    });

    it('POST /jobs forwards google provider/model fields with explicit withTts', async () => {
      const submitJob = vi.spyOn(submitJobModule, 'submitJob');
      submitJob.mockResolvedValue({ jobId: 'job-google-1' });

      const response = await app.inject({
        method: 'POST',
        url: '/jobs',
        payload: {
          md: 'fixtures/ok.md',
          withTts: true,
          ttsProvider: 'google',
          ttsModel: 'chirp3_hd',
        },
      });

      expect(response.statusCode).toBe(202);
      expect(submitJob).toHaveBeenCalledWith(
        expect.objectContaining({
          md: 'fixtures/ok.md',
          userId: 'test-user-id',
          withTts: true,
          ttsProvider: 'google',
          ttsModel: 'chirp3_hd',
        }),
      );
    });

    it('POST /jobs forwards explicit dialogue study-text elevenlabs model', async () => {
      const submitJob = vi.spyOn(submitJobModule, 'submitJob');
      submitJob.mockResolvedValue({ jobId: 'job-eleven-1' });

      const response = await app.inject({
        method: 'POST',
        url: '/jobs',
        payload: {
          md: 'fixtures/ok.md',
          withTts: true,
          ttsProvider: 'elevenlabs',
          ttsStrategy: 'dialogue',
          ttsModel: 'eleven_v3',
        },
      });

      expect(response.statusCode).toBe(202);
      expect(submitJob).toHaveBeenCalledWith(
        expect.objectContaining({
          md: 'fixtures/ok.md',
          userId: 'test-user-id',
          withTts: true,
          ttsProvider: 'elevenlabs',
          ttsStrategy: 'dialogue',
          ttsModel: 'eleven_v3',
        }),
      );
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
      expect(submitJob).toHaveBeenLastCalledWith({
        md: 'fixtures/ok.md',
        userId: 'test-user-id',
        learningPresetId: 'general-english',
        withTts: undefined,
        upload: undefined,
        voiceId: undefined,
        voiceAccent: undefined,
        forceTts: undefined,
        publishTarget: undefined,
        ttsStrategy: undefined,
        ttsProvider: undefined,
        ttsModel: undefined,
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
        publishTarget: 'html',
        ttsStrategy: 'dialogue',
        htmlUrl: 'https://example.com/job-approve-1',
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
        publishTarget: 'html',
        ttsStrategy: 'dialogue',
        ttsProvider: null,
        ttsModel: null,
        htmlUrl: 'https://example.com/job-approve-1',
        lessonId: null,
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
      expect(approveJobForPipeline).toHaveBeenCalledWith('job-approve-1', {
        md: '/uploads/drafts/draft-1.md',
        mdStorageUri: undefined,
      });
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
        recordingId: 'recording-1',
        transcriptId: null,
        promptPackageId: null,
        draftId: null,
        preset: 'b1-default',
        withTts: true,
        upload: 's3',
        voiceId: 'voice_amanda',
        voiceAccent: 'american_female',
        forceTts: true,
        publishTarget: 'html',
        ttsStrategy: 'dialogue',
        ttsProvider: null,
        ttsModel: null,
        autoPublish: null,
        htmlUrl: 'https://example.com/job-1',
        state: 'queued',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        startedAt: null,
        finishedAt: null,
        error: null,
        manifestPath: null,
      });
      vi.spyOn(recordingRepositoryModule, 'getRecordingByIdForWorkspace').mockResolvedValueOnce({
        id: 'recording-1',
        workspaceId: '00000000-0000-4000-8000-000000000001',
      } as never);

      const response = await app.inject({
        method: 'GET',
        url: '/jobs/job-1',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        jobId: 'job-1',
        md: 'fixtures/ok.md',
        recordingId: 'recording-1',
        transcriptId: null,
        promptPackageId: null,
        draftId: null,
        preset: 'b1-default',
        withTts: true,
        upload: 's3',
        voiceId: 'voice_amanda',
        voiceAccent: 'american_female',
        forceTts: true,
        publishTarget: 'html',
        ttsStrategy: 'dialogue',
        ttsProvider: null,
        ttsModel: null,
        autoPublish: null,
        htmlUrl: 'https://example.com/job-1',
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

    it('GET /jobs/:jobId/status is not supported', async () => {
      const getJobStatus = vi.spyOn(getJobStatusModule, 'getJobStatus');
      getJobStatus.mockClear();

      const response = await app.inject({
        method: 'GET',
        url: '/jobs/job-2/status',
      });

      expect(response.statusCode).toBe(404);
      expect(getJobStatus).not.toHaveBeenCalled();
    });

    it('GET /jobs/:jobId authorizes before materialization and gives absent and foreign parity', async () => {
      const getJobStatus = vi.spyOn(getJobStatusModule, 'getJobStatus');
      getJobStatus.mockClear();
      mockGetJobWorkspaceAuthority.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

      const foreign = await app.inject({ method: 'GET', url: '/jobs/foreign-job' });
      const missing = await app.inject({ method: 'GET', url: '/jobs/missing-job' });

      expect(foreign.statusCode).toBe(404);
      expect(foreign.json()).toEqual(missing.json());
      expect(getJobStatus).not.toHaveBeenCalled();
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
          htmlUrl: 'https://example.com/published',
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
        pronunciationWarnings: [],
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
      expect(mockGetJobProvenance).toHaveBeenCalledWith(
        'job-3',
        '00000000-0000-4000-8000-000000000001',
        'test-user-id',
      );
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

    it('GET /jobs/:jobId/provenance gives absent and foreign lineage the same response', async () => {
      mockGetJobProvenance.mockResolvedValue(null);
      const foreign = await app.inject({ method: 'GET', url: '/jobs/foreign/provenance' });
      const missing = await app.inject({ method: 'GET', url: '/jobs/absent/provenance' });
      expect(foreign.statusCode).toBe(404);
      expect(foreign.json()).toEqual(missing.json());
    });

    it('GET /jobs/:jobId returns 404 with canonical schema when job not found', async () => {
      const getJobStatus = vi.spyOn(getJobStatusModule, 'getJobStatus');
      getJobStatus.mockClear();
      mockGetJobWorkspaceAuthority.mockResolvedValueOnce(null);

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
      expect(getJobStatus).not.toHaveBeenCalled();
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

    it('GET /meta/version returns repo + contract versions', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/meta/version',
      });

      expect(response.statusCode).toBe(200);
      const expectedVersionMeta = getVersionMeta();
      expect(response.json()).toEqual({
        repoVersion: expectedVersionMeta.repoVersion,
        contracts: {
          ...CONTRACT_VERSIONS,
          dbMigrationHead: latestPackagedMigration,
        },
      });
    });

    it('GET /meta/version remains available when extended API is disabled', async () => {
      const originalFlag = process.env.BATCH_BACKEND_ENABLE_EXTENDED_API;
      process.env.BATCH_BACKEND_ENABLE_EXTENDED_API = 'false';
      const disabledApp = await createHttpServer();

      try {
        const response = await disabledApp.inject({
          method: 'GET',
          url: '/meta/version',
        });

        expect(response.statusCode).toBe(200);
        const expectedVersionMeta = getVersionMeta();
        expect(response.json()).toEqual({
          repoVersion: expectedVersionMeta.repoVersion,
          contracts: {
            ...CONTRACT_VERSIONS,
            dbMigrationHead: latestPackagedMigration,
          },
        });
      } finally {
        await disabledApp.close();
        if (originalFlag === undefined) {
          delete process.env.BATCH_BACKEND_ENABLE_EXTENDED_API;
        } else {
          process.env.BATCH_BACKEND_ENABLE_EXTENDED_API = originalFlag;
        }
      }
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

    it('GET /config/students maps db-required student store errors to 503', async () => {
      mockListStudentProfiles.mockRejectedValueOnce(
        new studentStoreModule.StudentProfileStoreError(
          'Student profile APIs require Postgres (PG_ENABLED=true)',
          'student_profiles_db_required',
          503,
        ),
      );

      const response = await app.inject({
        method: 'GET',
        url: '/config/students',
      });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        error: 'student_profiles_db_required',
        code: 'student_profiles_db_required',
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
  },
);
