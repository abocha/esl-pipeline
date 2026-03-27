import { describeHttpServerIntegrationSuite } from './transport.http-server.integration.harness.js';

describeHttpServerIntegrationSuite(
  'transport/http-server - integration (in-process) [jobs-config-students-content]',
  ({
    app,
    approveJobModule,
    CONTRACT_VERSIONS,
    createHttpServer,
    DB_MIGRATION_HEAD,
    deriveStudentId,
    expect,
    getJobOptions,
    getJobStatusModule,
    getVersionMeta,
    it,
    mockListStudentProfiles,
    mockActivateProfileRevisionForProfile,
    mockDeleteProfileContent,
    mockDeleteTemplateContent,
    mockGetJobProvenance,
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
        learningPresetId: undefined,
        withTts: undefined,
        upload: undefined,
        voiceId: undefined,
        voiceAccent: undefined,
        forceTts: undefined,
        notionDatabase: undefined,
        publishTarget: undefined,
        ttsStrategy: undefined,
        ttsProvider: undefined,
        googleTtsModel: undefined,
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
          notionDatabase: 'db-123',
          ttsStrategy: 'dialogue',
        },
      });

      expect(response.statusCode).toBe(202);
      expect(submitJob).toHaveBeenLastCalledWith({
        md: 'fixtures/ok.md',
        learningPresetId: 'general-english',
        withTts: true,
        upload: 'auto',
        voiceId: 'voice_amanda',
        voiceAccent: 'american_female',
        forceTts: true,
        notionDatabase: 'db-123',
        publishTarget: undefined,
        ttsStrategy: 'dialogue',
        ttsProvider: undefined,
        googleTtsModel: undefined,
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
          googleTtsModel: 'chirp3_hd',
        },
      });

      expect(response.statusCode).toBe(202);
      expect(submitJob).toHaveBeenCalledWith(
        expect.objectContaining({
          md: 'fixtures/ok.md',
          withTts: true,
          ttsProvider: 'google',
          googleTtsModel: 'chirp3_hd',
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
        learningPresetId: 'general-english',
        withTts: undefined,
        upload: undefined,
        voiceId: undefined,
        voiceAccent: undefined,
        forceTts: undefined,
        notionDatabase: undefined,
        publishTarget: undefined,
        ttsStrategy: undefined,
        ttsProvider: undefined,
        googleTtsModel: undefined,
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
        ttsProvider: null,
        googleTtsModel: null,
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
          dbMigrationHead: DB_MIGRATION_HEAD,
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
            dbMigrationHead: DB_MIGRATION_HEAD,
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

    it('POST /students accepts starterProfile payload', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/students',
        payload: {
          student: 'Starter Student',
          starterProfile: {
            goals: 'Speak more confidently in meetings.',
            professionOrContext: 'Works with clients in IT.',
            interests: 'Likes travel and films.',
            longRunningChallenges: 'Needs more tense stability.',
            studyPreferencesOrConstraints: 'Prefers structured explanations.',
          },
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        student: expect.any(String),
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

    it('GET /students/:id/profile-candidates returns candidate list payload', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/students/${deriveStudentId('Anna')}/profile-candidates?reviewState=approved`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        studentId: deriveStudentId('Anna'),
        items: [],
        total: 0,
        limit: 50,
        offset: 0,
        order: 'desc',
        statuses: null,
        reviewStates: null,
      });
    });

    it('POST /students/:id/profile-candidates/:candidateId/approve approves a candidate', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/students/${deriveStudentId('Anna')}/profile-candidates/candidate-1/approve`,
        payload: {
          approvedFact: 'Wants to speak English more confidently at work.',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        id: 'candidate-1',
        status: 'approved',
        reviewState: 'approved',
      });
    });

    it('POST /students/:id/profile-candidates/:candidateId/reject rejects a candidate', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/students/${deriveStudentId('Anna')}/profile-candidates/candidate-1/reject`,
        payload: {
          reviewerNote: 'Too tentative for the profile.',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        id: 'candidate-1',
        status: 'rejected',
        reviewState: 'rejected',
      });
    });

    it('POST /students/:id/profile-candidates/:candidateId/defer defers a candidate', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/students/${deriveStudentId('Anna')}/profile-candidates/candidate-1/defer`,
        payload: {
          reviewerNote: 'Need another lesson first.',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        id: 'candidate-1',
        status: 'pending_review',
        reviewState: 'deferred',
      });
    });

    it('POST /students/:id/profile-candidates/promote creates a draft revision from explicit selection', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/students/${deriveStudentId('Anna')}/profile-candidates/promote`,
        payload: {
          candidateIds: ['candidate-1'],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        draftRevisionId: 'profile-revision-draft',
        profileId: 'profiles/anna.md',
        includedCandidateIds: ['candidate-1'],
        excludedCandidateIds: [],
        contentHash: 'profile-draft-hash',
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
        content: String.raw`Template content`,
        currentRevisionId: 'template-revision-1',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
    });

    it('PUT /templates/:id saves template content', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: '/templates/template.md',
        payload: {
          content: String.raw`Updated template content`,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        id: 'template.md',
        label: 'Template',
        content: String.raw`Updated template content`,
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
  },
);
