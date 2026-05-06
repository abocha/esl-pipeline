import { describeHttpServerIntegrationSuite } from './transport.http-server.integration.harness.js';

describeHttpServerIntegrationSuite(
  'transport/http-server - integration (in-process) [students-memory]',
  ({
    app,
    deriveStudentId,
    expect,
    it,
    mockGetStudentMemoryOverview,
    mockGetProfileContent,
    mockGetStudentTimeline,
    mockListStudentHomeworkMemory,
    mockListStudentLessonMemory,
    mockListStudentMemorySnapshotsForStudent,
    mockListStudentProfileBindingsForStudent,
    mockListStudentProfileCandidatesForStudent,
    mockListProfileRevisionsForProfile,
    mockGetStudentScheduleBillingSurface,
  }) => {
    it('GET /students/:id/memory returns the overview payload for authenticated inspection', async () => {
      const studentId = deriveStudentId('Anna');
      mockGetStudentMemoryOverview.mockResolvedValueOnce({
        studentId,
        latestReadyStudentMemorySnapshot: {
          id: 'snapshot-1',
          studentId,
          schemaVersion: 'student-memory-snapshot.v1',
          generatedAt: new Date('2024-01-05T00:00:00.000Z'),
          provider: 'openai',
          model: 'gpt-5.2',
          status: 'ready',
          sourceKind: 'student_memory_rollup',
          lessonMemoryEntryIds: ['lesson-1'],
          homeworkMemoryEntryIds: ['homework-1'],
          contentHash: 'hash-1',
          generationNotes: null,
          stableStrengths: [],
          recurringIssues: [],
          activeReviewBacklog: [],
          recentProgress: [],
          personalFacts: [],
          recommendedAssignmentDirections: [],
          unresolvedIssues: [],
          snapshotSummary: 'Summary',
          supersededById: null,
          supersededAt: null,
          createdAt: new Date('2024-01-05T00:00:00.000Z'),
          updatedAt: new Date('2024-01-05T00:00:00.000Z'),
        },
        recentReadyLessonMemory: [],
        recentReadyHomeworkMemory: [],
        unresolvedIssues: [],
      });

      const response = await app.inject({
        method: 'GET',
        url: `/students/${studentId}/memory?lessonLimit=4&homeworkLimit=3`,
      });

      expect(response.statusCode).toBe(200);
      expect(mockGetStudentMemoryOverview).toHaveBeenCalledWith(
        expect.objectContaining({
          studentId,
          lessonLimit: 4,
          homeworkLimit: 3,
        }),
      );
      expect(response.json()).toMatchObject({
        studentId,
        latestReadyStudentMemorySnapshot: {
          id: 'snapshot-1',
          status: 'ready',
          snapshotSummary: 'Summary',
        },
      });
    });

    it('GET /students/:id/surfaces/overview composes the overview route payload', async () => {
      const studentId = deriveStudentId('Anna');
      mockGetProfileContent.mockClear();
      mockListProfileRevisionsForProfile.mockClear();
      mockGetStudentMemoryOverview.mockClear();
      mockListStudentProfileCandidatesForStudent.mockClear();
      mockGetStudentTimeline.mockClear();
      mockGetStudentScheduleBillingSurface.mockClear();

      const response = await app.inject({
        method: 'GET',
        url: `/students/${studentId}/surfaces/overview`,
      });

      expect(response.statusCode).toBe(200);
      expect(mockGetStudentMemoryOverview).toHaveBeenCalledWith(
        expect.objectContaining({ studentId, lessonLimit: 3, homeworkLimit: 2 }),
      );
      expect(mockListStudentProfileCandidatesForStudent).toHaveBeenCalledWith(
        expect.objectContaining({
          studentId,
          statuses: ['pending_review'],
          reviewStates: ['unreviewed', 'deferred'],
          limit: 10,
        }),
      );
      expect(mockGetStudentTimeline).toHaveBeenCalledWith(
        studentId,
        expect.objectContaining({ limit: 8 }),
      );
      expect(mockGetStudentScheduleBillingSurface).toHaveBeenCalledWith(studentId);
      expect(response.json()).toMatchObject({
        profile: { id: 'profile.md' },
        revisions: { items: [{ id: 'revision-1' }] },
        memory: { studentId },
        pendingCandidates: { items: [] },
        recentTimeline: { items: [{ type: 'recording_ingested' }] },
        scheduleBilling: { studentId },
      });
    });

    it('GET /students/:id/surfaces/learning composes profile, memory, binding, and candidate data', async () => {
      const studentId = deriveStudentId('Anna');
      mockGetStudentMemoryOverview.mockClear();
      mockListStudentProfileBindingsForStudent.mockClear();
      mockListStudentProfileCandidatesForStudent.mockClear();

      const response = await app.inject({
        method: 'GET',
        url: `/students/${studentId}/surfaces/learning`,
      });

      expect(response.statusCode).toBe(200);
      expect(mockGetStudentMemoryOverview).toHaveBeenCalledWith(
        expect.objectContaining({ studentId, lessonLimit: 5, homeworkLimit: 3 }),
      );
      expect(mockListStudentProfileBindingsForStudent).toHaveBeenCalledWith(
        studentId,
        expect.objectContaining({ limit: 20 }),
      );
      expect(response.json()).toMatchObject({
        profile: { id: 'profile.md' },
        revisions: { items: [{ id: 'revision-1' }] },
        memory: { studentId },
        bindings: { items: [{ id: 'binding-1' }] },
        candidates: { items: [] },
      });
    });

    it('GET /students/:id/surfaces/history composes timeline and memory lists', async () => {
      const studentId = deriveStudentId('Anna');
      mockGetStudentTimeline.mockClear();
      mockListStudentLessonMemory.mockClear();
      mockListStudentHomeworkMemory.mockClear();

      const response = await app.inject({
        method: 'GET',
        url: `/students/${studentId}/surfaces/history`,
      });

      expect(response.statusCode).toBe(200);
      expect(mockGetStudentTimeline).toHaveBeenCalledWith(
        studentId,
        expect.objectContaining({ limit: 80 }),
      );
      expect(mockListStudentLessonMemory).toHaveBeenCalledWith(
        expect.objectContaining({ studentId, statuses: ['ready'], limit: 50 }),
      );
      expect(mockListStudentHomeworkMemory).toHaveBeenCalledWith(
        expect.objectContaining({ studentId, statuses: ['ready'], limit: 50 }),
      );
      expect(response.json()).toMatchObject({
        timeline: { items: [{ type: 'recording_ingested' }] },
        lessonMemory: { items: [] },
        homeworkMemory: { items: [] },
      });
    });

    it('GET /students/:id/lesson-memory parses statuses and pagination into inspection queries', async () => {
      const studentId = deriveStudentId('Anna');
      mockListStudentLessonMemory.mockResolvedValueOnce({
        studentId,
        items: [],
        limit: 25,
        offset: 10,
        order: 'asc',
        statuses: ['ready', 'failed'],
      });

      const response = await app.inject({
        method: 'GET',
        url: `/students/${studentId}/lesson-memory?status=ready,failed&limit=25&offset=10&order=asc`,
      });

      expect(response.statusCode).toBe(200);
      expect(mockListStudentLessonMemory).toHaveBeenCalledWith(
        expect.objectContaining({
          studentId,
          statuses: ['ready', 'failed'],
          limit: 25,
          offset: 10,
          order: 'asc',
        }),
      );
      expect(response.json()).toMatchObject({
        studentId,
        limit: 25,
        offset: 10,
        order: 'asc',
        statuses: ['ready', 'failed'],
      });
    });

    it('GET /students/:id/homework-memory returns paginated homework memory inspection', async () => {
      const studentId = deriveStudentId('Anna');
      mockListStudentHomeworkMemory.mockResolvedValueOnce({
        studentId,
        items: [
          {
            id: 'homework-1',
            studentId,
            jobId: 'job-1',
            assignmentLineageKey: 'job-root',
            promptPackageId: 'prompt-1',
            draftId: 'draft-1',
            recordingId: 'recording-1',
            transcriptId: 'transcript-1',
            schemaVersion: 'homework-memory.v1',
            generatedAt: new Date('2024-01-06T00:00:00.000Z'),
            provider: 'openrouter',
            model: 'qwen/qwen3.5',
            status: 'ready',
            sourceKind: 'published_assignment',
            contentHash: 'hash-1',
            generationNotes: null,
            homeworkSummary: 'Homework summary',
            topic: 'Travel',
            grammarTargets: [],
            vocabularyTargets: [],
            reviewTargets: [],
            taskList: [],
            pronunciationFocus: [],
            studyTextType: 'dialogue',
            inputType: 'generate',
            communicativeOutcome: 'Give advice',
            teacherFollowUpCues: [],
            publishedAt: new Date('2024-01-06T00:00:00.000Z'),
            publishTargets: [],
            supersededById: null,
            supersededAt: null,
            createdAt: new Date('2024-01-06T00:00:00.000Z'),
            updatedAt: new Date('2024-01-06T00:00:00.000Z'),
          },
        ],
        limit: 10,
        offset: 0,
        order: 'desc',
        statuses: ['ready'],
      });

      const response = await app.inject({
        method: 'GET',
        url: `/students/${studentId}/homework-memory?status=ready&limit=10`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        studentId,
        items: [
          {
            id: 'homework-1',
            status: 'ready',
            topic: 'Travel',
          },
        ],
      });
    });

    it('GET /students/:id/memory-snapshots returns paginated snapshot inspection', async () => {
      const studentId = deriveStudentId('Anna');
      mockListStudentMemorySnapshotsForStudent.mockResolvedValueOnce({
        studentId,
        items: [],
        limit: 20,
        offset: 5,
        order: 'desc',
        statuses: ['ready', 'superseded'],
      });

      const response = await app.inject({
        method: 'GET',
        url: `/students/${studentId}/memory-snapshots?status=ready,superseded&limit=20&offset=5`,
      });

      expect(response.statusCode).toBe(200);
      expect(mockListStudentMemorySnapshotsForStudent).toHaveBeenCalledWith(
        expect.objectContaining({
          studentId,
          statuses: ['ready', 'superseded'],
          limit: 20,
          offset: 5,
          order: undefined,
        }),
      );
      expect(response.json()).toMatchObject({
        studentId,
        limit: 20,
        offset: 5,
        statuses: ['ready', 'superseded'],
      });
    });
  },
);
