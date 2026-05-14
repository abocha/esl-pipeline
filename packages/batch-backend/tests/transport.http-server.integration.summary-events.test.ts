import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  describeHttpServerIntegrationSuite,
  type JobRecord,
  type RecordingRecord,
} from './transport.http-server.integration.harness.js';

type IncomingMessage = import('node:http').IncomingMessage;
type ClientRequest = import('node:http').ClientRequest;

describeHttpServerIntegrationSuite(
  'transport/http-server - integration (in-process) [summary-readiness-streams]',
  ({
    app,
    assignmentSessionsModule,
    authMiddlewareModule,
    createHttpServer,
    deriveStudentId,
    expect,
    getJobStatusModule,
    httpRequest,
    it,
    jobSummaryModule,
    listJobsModule,
    publishJobEvent,
    publishRecordingEvent,
    readinessMetricsModule,
    Readable,
    recordingRepositoryModule,
    studentSummaryModule,
    transcriptionStorageModule,
    vi,
  }) => {
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const recordingId = '22222222-2222-4222-8222-222222222222';

    it('assignment session routes use the authenticated user and validate ownership through application calls', async () => {
      const session = {
        id: sessionId,
        userId: 'test-user-id',
        studentId: null,
        recordingId,
        transcriptId: null,
        promptPackageId: null,
        draftId: null,
        currentStage: 'source' as const,
        publishTarget: 'html' as const,
        selectedTtsProvider: 'google' as const,
        selectedTtsStrategy: 'tts' as const,
        selectedTtsModel: 'chirp3_hd',
        selectedPreset: 'general-english',
        selectedGenerationProvider: 'openrouter' as const,
        selectedGenerationModel: 'model-1',
        teacherNotes: 'Practice past tense.',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:10:00.000Z',
        archivedAt: null,
      };
      const createSession = vi.spyOn(assignmentSessionsModule, 'createAssignmentSessionForUser');
      const updateSession = vi.spyOn(assignmentSessionsModule, 'updateAssignmentSessionForUser');
      const getSession = vi.spyOn(assignmentSessionsModule, 'getAssignmentSessionForUser');
      const listSessions = vi.spyOn(assignmentSessionsModule, 'listAssignmentSessionsForUserDto');
      const archiveSession = vi.spyOn(assignmentSessionsModule, 'archiveAssignmentSessionForUser');
      createSession.mockResolvedValue(session);
      updateSession.mockResolvedValue({ ...session, currentStage: 'assignment' });
      getSession.mockResolvedValue(session);
      listSessions.mockResolvedValue({ sessions: [session], total: 1, limit: 20 });
      archiveSession.mockResolvedValue({
        ...session,
        archivedAt: '2024-01-01T00:20:00.000Z',
      });

      const created = await app.inject({
        method: 'POST',
        url: '/assignment-sessions',
        payload: {
          recordingId,
          currentStage: 'source',
          selectedPreset: 'general-english',
        },
      });
      expect(created.statusCode).toBe(200);
      expect(createSession).toHaveBeenCalledWith('test-user-id', {
        recordingId,
        currentStage: 'source',
        selectedPreset: 'general-english',
      });

      const listed = await app.inject({
        method: 'GET',
        url: '/user/assignment-sessions?limit=20',
      });
      expect(listed.statusCode).toBe(200);
      expect(listSessions).toHaveBeenCalledWith('test-user-id', 20);
      expect(listed.json()).toEqual({ sessions: [session], total: 1, limit: 20 });

      const loaded = await app.inject({
        method: 'GET',
        url: `/assignment-sessions/${sessionId}`,
      });
      expect(loaded.statusCode).toBe(200);
      expect(getSession).toHaveBeenCalledWith('test-user-id', sessionId);

      const patched = await app.inject({
        method: 'PATCH',
        url: `/assignment-sessions/${sessionId}`,
        payload: { currentStage: 'assignment', teacherNotes: 'Review modal verbs.' },
      });
      expect(patched.statusCode).toBe(200);
      expect(updateSession).toHaveBeenCalledWith('test-user-id', sessionId, {
        currentStage: 'assignment',
        teacherNotes: 'Review modal verbs.',
      });

      const archived = await app.inject({
        method: 'POST',
        url: `/assignment-sessions/${sessionId}/archive`,
      });
      expect(archived.statusCode).toBe(200);
      expect(archiveSession).toHaveBeenCalledWith('test-user-id', sessionId);
    });

    it('GET /assignment-sessions/:id returns 404 when the owned session is missing', async () => {
      const getSession = vi.spyOn(assignmentSessionsModule, 'getAssignmentSessionForUser');
      getSession.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: `/assignment-sessions/${sessionId}`,
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'not_found' });
      expect(getSession).toHaveBeenCalledWith('test-user-id', sessionId);
    });

    it('GET /user/assignment-sessions requires authentication before application access', async () => {
      const listSessions = vi.spyOn(assignmentSessionsModule, 'listAssignmentSessionsForUserDto');
      listSessions.mockClear();
      vi.mocked(authMiddlewareModule.authenticate).mockImplementationOnce(
        (_request: FastifyRequest, reply: FastifyReply) => {
          void reply.code(401).send({ error: 'unauthorized' });
        },
      );

      const response = await app.inject({
        method: 'GET',
        url: '/user/assignment-sessions',
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'unauthorized' });
      expect(listSessions).not.toHaveBeenCalled();
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
            publishTarget: 'html',
            ttsStrategy: 'auto',
            autoPublish: null,
            htmlUrl: null,
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
            publishTarget: 'html',
            ttsStrategy: 'auto',
            autoPublish: null,
            htmlUrl: null,
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

      const call = listJobs.mock.calls.at(-1)?.[0];
      expect(call?.states).toEqual(['queued', 'failed']);
      expect(call?.studentId).toBe(studentId);
      expect(call?.limit).toBe(10);
      expect(call?.offset).toBe(5);
      expect(call?.order).toBe('asc');
      expect(call?.userId).toBe('test-user-id');
      expect(call?.from?.toISOString()).toBe('2024-01-01T00:00:00.000Z');
      expect(call?.to?.toISOString()).toBe('2024-02-01T00:00:00.000Z');
    });

    it('GET /admin/jobs applies filters and returns cross-user scope by default', async () => {
      const listJobs = vi.spyOn(listJobsModule, 'listJobsWithDefaults');
      listJobs.mockResolvedValue({
        jobs: [],
        total: 0,
        limit: 20,
        offset: 0,
      });

      const studentId = deriveStudentId('Boris');
      const response = await app.inject({
        method: 'GET',
        url:
          '/admin/jobs?state=succeeded' +
          `&studentId=${studentId}` +
          '&from=2024-02-01T00:00:00.000Z' +
          '&to=2024-02-15T00:00:00.000Z' +
          '&limit=20&offset=0&order=desc',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        jobs: [],
        total: 0,
        limit: 20,
        offset: 0,
      });

      const call = listJobs.mock.calls.at(-1)?.[0];
      expect(call?.states).toEqual(['succeeded']);
      expect(call?.studentId).toBe(studentId);
      expect(call?.limit).toBe(20);
      expect(call?.offset).toBe(0);
      expect(call?.order).toBe('desc');
      expect(call?.userId).toBeNull();
      expect(call?.from?.toISOString()).toBe('2024-02-01T00:00:00.000Z');
      expect(call?.to?.toISOString()).toBe('2024-02-15T00:00:00.000Z');
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

    it('GET /admin/jobs/summary returns summary response without user scoping', async () => {
      const getSummary = vi.spyOn(jobSummaryModule, 'getJobSummaryWithDefaults');
      getSummary.mockResolvedValue({
        total: 9,
        byState: {
          queued: 1,
          running: 1,
          awaiting_approval: 2,
          succeeded: 4,
          failed: 1,
        },
        pendingApprovals: 2,
        last7Days: {
          total: 9,
          succeeded: 4,
          failed: 1,
        },
        tts: {
          enabled: 5,
          succeeded: 4,
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/admin/jobs/summary?from=2024-04-01T00:00:00.000Z&to=2024-04-02T00:00:00.000Z',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        total: 9,
        byState: {
          queued: 1,
          running: 1,
          awaiting_approval: 2,
          succeeded: 4,
          failed: 1,
        },
        pendingApprovals: 2,
        last7Days: {
          total: 9,
          succeeded: 4,
          failed: 1,
        },
        tts: {
          enabled: 5,
          succeeded: 4,
        },
      });

      const call = getSummary.mock.calls.at(-1)?.[0];
      expect(call?.userId).toBeNull();
      expect(call?.from?.toISOString()).toBe('2024-04-01T00:00:00.000Z');
      expect(call?.to?.toISOString()).toBe('2024-04-02T00:00:00.000Z');
    });

    it('GET /admin/jobs/summary validates from/to query params', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/admin/jobs/summary?from=not-a-date&to=2024-04-02T00:00:00.000Z',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual(
        expect.objectContaining({
          error: expect.any(String),
          message: expect.any(String),
        }),
      );
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
        learningPresetId: 'general-english',
        withTts: true,
        upload: 's3',
        voiceAccent: 'american_female',
        voiceId: 'voice_amanda',
        ttsStrategy: null,
        forceTts: null,
        publishTarget: 'html',
        htmlUrl: null,
        createdAt: new Date('2024-01-01T10:00:00Z'),
        updatedAt: new Date('2024-01-01T10:01:00Z'),
        startedAt: new Date('2024-01-01T10:01:00Z'),
        finishedAt: null,
        error: null,
        manifestPath: null,
      };

      const eventPayload = await new Promise<any>((resolve, reject) => {
        let resRef: IncomingMessage | null = null;
        let settled = false;
        let buffer = '';
        let published = false;
        let requestRef: ClientRequest | null = null;
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

        const req = httpRequest(url, (res: IncomingMessage) => {
          resRef = res;
          res.setEncoding('utf8');

          res.on('data', (chunk: string) => {
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

          res.on('error', (err: Error) => {
            cleanup(err);
          });
        });

        requestRef = req;

        req.on('error', (err: Error) => {
          cleanup(err);
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

    it('GET /jobs/events streams recording events when jobId maps to a recording', {
      timeout: 10_000,
    }, async () => {
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
        publishTarget: 'html',
        ttsStrategy: null,
        autoPublish: null,
        htmlUrl: null,
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
        let resRef: IncomingMessage | null = null;
        let settled = false;
        let buffer = '';
        let published = false;
        let requestRef: ClientRequest | null = null;
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

        const req = httpRequest(url, (res: IncomingMessage) => {
          resRef = res;
          res.setEncoding('utf8');

          res.on('data', (chunk: string) => {
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

          res.on('error', (err: Error) => {
            cleanup(err);
          });
        });

        requestRef = req;

        req.on('error', (err: Error) => {
          cleanup(err);
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
    });

    it('GET /jobs/events streams directly targeted recording events without a jobId', {
      timeout: 10_000,
    }, async () => {
      const getJobStatus = vi.spyOn(getJobStatusModule, 'getJobStatus');
      getJobStatus.mockClear();

      const streamingApp = await createHttpServer();
      const address = (await streamingApp.listen({ port: 0, host: '127.0.0.1' })) as string;
      const url = new URL('/jobs/events', address);
      url.searchParams.set('recordingId', 'recording-direct');

      const recording: RecordingRecord = {
        id: 'recording-direct',
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
        let resRef: IncomingMessage | null = null;
        let settled = false;
        let buffer = '';
        let published = false;
        let requestRef: ClientRequest | null = null;
        let timeout: ReturnType<typeof setTimeout> | null = null;
        let publishTimer: ReturnType<typeof setTimeout> | null = null;

        const cleanup = (err?: Error, result?: any) => {
          if (settled) return;
          settled = true;
          requestRef?.destroy();
          resRef?.destroy();
          if (timeout) clearTimeout(timeout);
          if (publishTimer) clearTimeout(publishTimer);
          void streamingApp.close();
          if (err) {
            reject(err);
          } else {
            resolve(result);
          }
        };

        const req = httpRequest(url, (res: IncomingMessage) => {
          resRef = res;
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            buffer += chunk;

            if (!published && buffer.includes(': connected')) {
              published = true;
              publishTimer = setTimeout(() => {
                publishRecordingEvent({
                  type: 'recording_state_changed',
                  recording,
                  transcriptId: 'transcript-direct',
                });
              }, 0);
            }

            const dataMatch = buffer.match(/data: (.+)\n\n/);
            if (dataMatch) {
              cleanup(undefined, JSON.parse(dataMatch[1]!));
            }
          });
          res.on('error', (err: Error) => cleanup(err));
        });

        requestRef = req;
        req.on('error', (err: Error) => cleanup(err));
        req.end();

        timeout = setTimeout(() => {
          cleanup(new Error('Timed out waiting for targeted recording SSE payload'));
        }, 10_000);
      });

      expect(getJobStatus).not.toHaveBeenCalled();
      expect(eventPayload.type).toBe('recording_state_changed');
      expect(eventPayload.recordingId).toBe('recording-direct');
      expect(eventPayload.transcriptId).toBe('transcript-direct');
    });
  },
);
