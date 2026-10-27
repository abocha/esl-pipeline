import { WorkspaceContextError } from '../src/application/workspace-context.js';
import { MIGRATED_PROFILE_REVISION_ID } from './fixtures/migrated-profile-revision.js';
import { describeHttpServerIntegrationSuite } from './transport.http-server.integration.harness.js';

const DEFAULT_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';

describeHttpServerIntegrationSuite(
  'transport/http-server - integration (in-process) [jobs-config-students-content]',
  ({
    app,
    deriveStudentId,
    expect,
    it,
    mockActivateProfileRevisionForStudent,
    mockArchiveStudentProfile,
    mockGetStudentProfileById,
    mockGetStudentTimeline,
    mockGetStudentScheduleBillingSurface,
    mockGetStudentLesson,
    mockGetStudentLessonPage,
    mockHideStudentLessonFollowupReminder,
    mockListStudentProfiles,
    mockResolvePrimaryWorkspaceIdForUser,
    mockUndoLatestHiddenStudentReminder,
    mockUpdateStudentLessonPlan,
    mockUpdateStudentLesson,
    mockAddStudentPackage,
    mockAdjustStudentCredits,
    mockRecordStudentPayment,
    mockUpsertProfileContent,
    mockGetProfileContent,
    mockGetProfileRevisionForStudent,
    mockListProfileRevisionsForStudent,
    mockRestoreProfileRevision,
    mockSaveProfileRevisionContent,
    mockDeleteTemplateContent,
    mockSetDefaultTemplateContent,
    mockRestoreTemplateRevision,
    mockActivateTemplateRevisionForTemplate,
    mockRestoreStudentProfile,
    mockPromoteStudentProfileCandidates,
    mockRefreshProfileDraftFromApprovedCandidates,
    mockUpdateStudentProfile,
  }) => {
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

    it('POST /students accepts partial canonical starterProfile fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/students',
        payload: {
          student: 'Canonical Starter Student',
          starterProfile: {
            overallLevel: 'B1',
            stableStrengths: 'Prepared and curious.',
            durableConstraints: 'Mostly studies on mobile.',
          },
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        student: expect.any(String),
      });
    });

    it('POST /students ignores legacy advanced write fields', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/students',
        payload: {
          student: 'No Advanced Student',
          colorPreset: 'legacy-color',
          accentPreference: 'legacy-accent',
          manifestPreset: 'legacy-manifest',
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        student: expect.any(String),
        colorPreset: null,
        accentPreference: null,
        manifestPreset: null,
      });
    });

    it('rejects retired profile selection in student create and update', async () => {
      for (const method of ['POST', 'PUT'] as const) {
        const response = await app.inject({
          method,
          url: method === 'POST' ? '/students' : `/students/${deriveStudentId('Anna')}`,
          payload: { student: 'Name', profileId: 'legacy.md' },
        });
        expect(response.statusCode).toBe(400);
      }
    });

    it('PUT /students/:id updates the student name', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/students/${deriveStudentId('Anna')}`,
        payload: { student: 'Anna Updated' },
      });
      expect(response.statusCode).toBe(200);
      expect(mockUpdateStudentProfile).toHaveBeenCalledWith(
        deriveStudentId('Anna'),
        { student: 'Anna Updated' },
        expect.objectContaining({ workspaceId: expect.any(String) }),
      );
    });

    it('GET /students?status=archived returns archived student profiles', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/students?status=archived',
      });

      expect(response.statusCode).toBe(200);
      expect(mockListStudentProfiles).toHaveBeenCalledWith({
        search: undefined,
        limit: undefined,
        offset: undefined,
        order: undefined,
        status: 'archived',
        workspaceId: '00000000-0000-4000-8000-000000000001',
      });
    });

    it('POST /students/:id/archive archives a student profile with audit context', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/students/${deriveStudentId('Anna')}/archive`,
        payload: {
          reason: 'Student paused lessons.',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockArchiveStudentProfile).toHaveBeenCalledWith(
        deriveStudentId('Anna'),
        expect.objectContaining({
          archiveReason: 'Student paused lessons.',
        }),
        { workspaceId: '00000000-0000-4000-8000-000000000001' },
      );
      expect(response.json()).toMatchObject({
        id: deriveStudentId('Anna'),
        archivedAt: expect.any(String),
        archivedBy: expect.any(String),
        archiveReason: 'Student paused lessons.',
      });
    });

    it('POST /students/:id/restore restores an archived student profile', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/students/${deriveStudentId('Anna')}/restore`,
      });

      expect(response.statusCode).toBe(200);
      expect(mockRestoreStudentProfile).toHaveBeenCalledWith(
        deriveStudentId('Anna'),
        expect.objectContaining({
          restoredBy: expect.any(String),
        }),
        { workspaceId: '00000000-0000-4000-8000-000000000001' },
      );
      expect(response.json()).toMatchObject({
        id: deriveStudentId('Anna'),
        archivedAt: null,
      });
    });

    it('GET /students/:id/timeline hides archived or missing students', async () => {
      mockGetStudentProfileById.mockResolvedValueOnce(null);
      mockGetStudentTimeline.mockClear();

      const response = await app.inject({
        method: 'GET',
        url: `/students/${deriveStudentId('Anna')}/timeline`,
      });

      expect(response.statusCode).toBe(404);
      expect(mockGetStudentTimeline).not.toHaveBeenCalled();
    });

    it('DELETE /students/:id archives a student profile as a compatibility alias', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: `/students/${deriveStudentId('Anna')}`,
      });

      expect(response.statusCode).toBe(204);
      expect(mockArchiveStudentProfile).toHaveBeenCalledWith(
        deriveStudentId('Anna'),
        expect.objectContaining({
          archiveReason: 'Archived through legacy DELETE /students/:id route.',
        }),
        { workspaceId: '00000000-0000-4000-8000-000000000001' },
      );
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
        includedCandidateIds: ['candidate-1'],
        excludedCandidateIds: [],
        omittedCandidates: [],
        contentHash: 'profile-draft-hash',
        draftRevision: {
          id: 'profile-revision-draft',
          studentId: deriveStudentId('Anna'),
          contentHash: 'profile-draft-hash',
          source: 'candidate_promotion',
          status: 'draft',
          versionNumber: 3,
          versionLabel: 'v3',
          activatedAt: null,
          deprecatedAt: null,
          createdAt: '2024-01-01T00:00:00.000Z',
          createdBy: 'test-user-id',
          restoredFromRevisionId: null,
          content: '# Draft profile',
        },
      });
    });

    it('reports only the applied subset through both existing draft endpoints', async () => {
      for (const [path, mock] of [
        ['profile-candidates/promote', mockPromoteStudentProfileCandidates],
        [
          'profile-drafts/refresh-from-approved-candidates',
          mockRefreshProfileDraftFromApprovedCandidates,
        ],
      ] as const) {
        mock.mockResolvedValueOnce({
          studentId: deriveStudentId('Anna'),
          baseRevisionId: 'active',
          draftRevision: { id: 'partial-draft', contentHash: 'hash', status: 'draft' },
          includedCandidateIds: ['candidate-1'],
        });
        const response = await app.inject({
          method: 'POST',
          url: `/students/${deriveStudentId('Anna')}/${path}`,
          payload: { candidateIds: ['candidate-1', 'candidate-2'] },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().includedCandidateIds).toEqual(['candidate-1']);
        expect(response.json().excludedCandidateIds).toEqual(
          path === 'profile-candidates/promote' ? ['candidate-2'] : undefined,
        );
      }
    });

    it('POST /students/:id/profile-drafts/refresh-from-approved-candidates creates a full draft revision', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/students/${deriveStudentId('Anna')}/profile-drafts/refresh-from-approved-candidates`,
        payload: {
          candidateIds: ['candidate-1'],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        draftRevisionId: 'profile-revision-refreshed-draft',
        baseRevisionId: 'profile-revision-active',
        includedCandidateIds: ['candidate-1'],
        omittedCandidates: [],
        contentHash: 'profile-refreshed-draft-hash',
        draftRevision: {
          id: 'profile-revision-refreshed-draft',
          studentId: deriveStudentId('Anna'),
          contentHash: 'profile-refreshed-draft-hash',
          source: 'profile_revision_refresh',
          status: 'draft',
          versionNumber: 4,
          versionLabel: 'v4',
          activatedAt: null,
          deprecatedAt: null,
          createdAt: '2024-01-01T00:00:00.000Z',
          createdBy: 'test-user-id',
          restoredFromRevisionId: null,
          content: '# Refreshed foundational profile',
        },
        provider: 'google_ai_studio',
        model: 'gemini-3-flash-preview',
      });
    });

    it('does not expose the removed first-profile population command', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/students/${deriveStudentId('Anna')}/profile-drafts/populate-first-from-lesson`,
      });
      expect(response.statusCode).toBe(404);
    });
    it('POST /students/:id/profile-drafts/initialize creates an empty canonical draft', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/students/${deriveStudentId('Anna')}/profile-drafts/initialize`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        draftRevisionId: 'profile-revision-empty-draft',
        draftRevision: {
          id: 'profile-revision-empty-draft',
          studentId: deriveStudentId('Anna'),
          contentHash: 'profile-empty-draft-hash',
          source: 'create',
          status: 'draft',
          versionNumber: 1,
          versionLabel: 'v1',
          activatedAt: null,
          deprecatedAt: null,
          createdAt: '2024-01-01T00:00:00.000Z',
          createdBy: 'test-user-id',
          restoredFromRevisionId: null,
          content: '# Foundational Profile',
        },
      });
    });

    it('GET /students/:id/profile returns profile content', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/students/${deriveStudentId('Anna')}/profile`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        studentId: deriveStudentId('Anna'),
        content: 'Profile content',
        structuredContent: {
          schemaVersion: 'foundational_profile_v1',
          overallLevel: 'B1',
          primaryGoals: ['Speak more confidently in meetings.'],
          communicationContexts: ['Client calls'],
          interestsAndUsefulThemes: ['Travel'],
          stableStrengths: ['High motivation'],
          persistentChallenges: ['Article usage'],
          studyPreferences: ['Prefers structured explanations'],
          durableConstraints: ['Short homework windows'],
          teacherNotes: 'Responds well to practical scenarios.',
        },
        currentRevisionId: 'revision-1',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
    });

    it('PUT /students/:id/profile saves profile content with the authenticated creator', async () => {
      mockUpsertProfileContent.mockClear();

      const response = await app.inject({
        method: 'PUT',
        url: `/students/${deriveStudentId('Anna')}/profile`,
        payload: {
          content: 'Updated profile content',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        studentId: deriveStudentId('Anna'),
        content: 'Updated content',
        currentRevisionId: 'revision-latest',
      });
      expect(mockUpsertProfileContent).toHaveBeenCalledWith(
        deriveStudentId('Anna'),
        'Updated profile content',
        { createdBy: 'test-user-id' },
        null,
      );
    });

    it('PUT /students/:id/profile accepts structured ordinary edits for direct activation', async () => {
      mockUpsertProfileContent.mockClear();
      const structuredContent = {
        schemaVersion: 'foundational_profile_v1',
        overallLevel: 'B1',
        primaryGoals: ['Speak clearly'],
        communicationContexts: [],
        interestsAndUsefulThemes: [],
        stableStrengths: [],
        persistentChallenges: [],
        studyPreferences: [],
        durableConstraints: [],
        teacherNotes: null,
      };
      const response = await app.inject({
        method: 'PUT',
        url: `/students/${deriveStudentId('Anna')}/profile`,
        payload: { structuredContent },
      });
      expect(response.statusCode).toBe(200);
      expect(mockUpsertProfileContent).toHaveBeenCalledWith(
        deriveStudentId('Anna'),
        expect.stringContaining('Speak clearly'),
        { createdBy: 'test-user-id' },
        structuredContent,
      );
    });

    it('PUT /students/:id/profile rejects a missing content field', async () => {
      mockUpsertProfileContent.mockClear();

      const response = await app.inject({
        method: 'PUT',
        url: `/students/${deriveStudentId('Anna')}/profile`,
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'validation_failed' });
      expect(mockUpsertProfileContent).not.toHaveBeenCalled();
    });

    it('POST /students/:id/profile/revisions saves a structured draft revision', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/students/${deriveStudentId('Anna')}/profile/revisions`,
        payload: {
          structuredContent: {
            schemaVersion: 'foundational_profile_v1',
            overallLevel: 'B2',
            primaryGoals: ['Lead project updates confidently.'],
            communicationContexts: ['Sprint demos'],
            interestsAndUsefulThemes: ['Design systems'],
            stableStrengths: ['Strong listening'],
            persistentChallenges: ['Sentence rhythm'],
            studyPreferences: ['Prefers concise correction'],
            durableConstraints: ['Short homework windows'],
            teacherNotes: 'Needs practical speaking rehearsal.',
          },
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({
        id: 'revision-2',
        studentId: deriveStudentId('Anna'),
        contentHash: 'hash-2',
        source: 'update',
        status: 'draft',
        versionNumber: 2,
        versionLabel: 'v2',
        activatedAt: null,
        deprecatedAt: null,
        createdAt: '2024-01-02T00:00:00.000Z',
        createdBy: 'test-user-id',
        restoredFromRevisionId: null,
        content: '# Foundational Profile\n\nStructured draft content',
        structuredContent: {
          schemaVersion: 'foundational_profile_v1',
          overallLevel: 'B2',
          primaryGoals: ['Lead project updates confidently.'],
          communicationContexts: ['Sprint demos'],
          interestsAndUsefulThemes: ['Design systems'],
          stableStrengths: ['Strong listening'],
          persistentChallenges: ['Sentence rhythm'],
          studyPreferences: ['Prefers concise correction'],
          durableConstraints: ['Short homework windows'],
          teacherNotes: 'Needs practical speaking rehearsal.',
        },
      });
      expect(mockSaveProfileRevisionContent).toHaveBeenCalled();
    });

    it('accepts a migrated revision ID for draft candidate-link inheritance', async () => {
      mockSaveProfileRevisionContent.mockClear();
      const response = await app.inject({
        method: 'POST',
        url: `/students/${deriveStudentId('Anna')}/profile/revisions`,
        payload: {
          content: 'Inherited draft',
          inheritCandidateLinksFromRevisionId: MIGRATED_PROFILE_REVISION_ID,
        },
      });
      expect(response.statusCode).toBe(201);
      expect(mockSaveProfileRevisionContent).toHaveBeenCalledWith(
        deriveStudentId('Anna'),
        'Inherited draft',
        expect.objectContaining({
          inheritCandidateLinksFromRevisionId: MIGRATED_PROFILE_REVISION_ID,
        }),
      );
    });

    it.each(['', '/activate', '/restore'])(
      'accepts a migrated revision ID for detail%s',
      async (action: string) => {
        if (action === '/activate')
          mockActivateProfileRevisionForStudent.mockResolvedValueOnce({
            id: MIGRATED_PROFILE_REVISION_ID,
            studentId: deriveStudentId('Anna'),
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
          });
        const operation =
          action === '/activate'
            ? mockActivateProfileRevisionForStudent
            : action === '/restore'
              ? mockRestoreProfileRevision
              : mockGetProfileRevisionForStudent;
        operation.mockClear();
        const response = await app.inject({
          method: action ? 'POST' : 'GET',
          url: `/students/${deriveStudentId('Anna')}/profile/revisions/${MIGRATED_PROFILE_REVISION_ID}${action}`,
        });
        expect(response.statusCode).toBe(200);
        const expectedArgs = [
          deriveStudentId('Anna'),
          MIGRATED_PROFILE_REVISION_ID,
          ...(action === '/activate'
            ? [{ actorUserId: 'test-user-id' }]
            : action === '/restore'
              ? [{ createdBy: 'test-user-id' }]
              : []),
        ];
        expect(operation).toHaveBeenCalledWith(...expectedArgs);
      },
    );

    it.each(['', '/activate', '/restore', '/inherit'])(
      'rejects malformed profile revision input%s before application access',
      async (action: string) => {
        for (const operation of [
          mockGetProfileRevisionForStudent,
          mockActivateProfileRevisionForStudent,
          mockRestoreProfileRevision,
          mockSaveProfileRevisionContent,
        ])
          operation.mockClear();
        const inherit = action === '/inherit';
        const response = await app.inject({
          method: action ? 'POST' : 'GET',
          url: `/students/${deriveStudentId('Anna')}/profile/revisions${inherit ? '' : `/not-a-uuid${action}`}`,
          ...(inherit
            ? { payload: { content: 'Draft', inheritCandidateLinksFromRevisionId: 'not-a-uuid' } }
            : {}),
        });
        expect(response.statusCode).toBe(400);
        for (const operation of [
          mockGetProfileRevisionForStudent,
          mockActivateProfileRevisionForStudent,
          mockRestoreProfileRevision,
          mockSaveProfileRevisionContent,
        ])
          expect(operation).not.toHaveBeenCalled();
      },
    );

    it('GET /students/:id/profile/revisions returns profile revision list', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/students/${deriveStudentId('Anna')}/profile/revisions?limit=10&offset=0&order=desc`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        items: [
          {
            id: 'revision-1',
            studentId: deriveStudentId('Anna'),
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

    it('GET /students/:id/profile/revisions/:revisionId returns revision detail', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/students/${deriveStudentId('Anna')}/profile/revisions/11111111-1111-4111-8111-111111111111`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        id: 'revision-1',
        studentId: deriveStudentId('Anna'),
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
        structuredContent: {
          schemaVersion: 'foundational_profile_v1',
          overallLevel: 'B1',
          primaryGoals: ['Speak more confidently in meetings.'],
          communicationContexts: ['Client calls'],
          interestsAndUsefulThemes: ['Travel'],
          stableStrengths: ['High motivation'],
          persistentChallenges: ['Article usage'],
          studyPreferences: ['Prefers structured explanations'],
          durableConstraints: ['Short homework windows'],
          teacherNotes: 'Responds well to practical scenarios.',
        },
      });
    });

    it('POST /students/:id/profile/revisions/:revisionId/restore restores profile content', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/students/${deriveStudentId('Anna')}/profile/revisions/11111111-1111-4111-8111-111111111111/restore`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        studentId: deriveStudentId('Anna'),
        content: 'Restored content',
        structuredContent: {
          schemaVersion: 'foundational_profile_v1',
          overallLevel: 'B1',
          primaryGoals: ['Speak more confidently in meetings.'],
          communicationContexts: ['Client calls'],
          interestsAndUsefulThemes: ['Travel'],
          stableStrengths: ['High motivation'],
          persistentChallenges: ['Article usage'],
          studyPreferences: ['Prefers structured explanations'],
          durableConstraints: ['Short homework windows'],
          teacherNotes: 'Responds well to practical scenarios.',
        },
        currentRevisionId: 'revision-2',
        updatedAt: '2024-01-02T00:00:00.000Z',
      });
    });

    it('POST /students/:id/profile/revisions/:revisionId/activate returns activated revision', async () => {
      mockActivateProfileRevisionForStudent.mockResolvedValueOnce({
        id: 'revision-1',
        studentId: deriveStudentId('Anna'),
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
        url: `/students/${deriveStudentId('Anna')}/profile/revisions/11111111-1111-4111-8111-111111111111/activate`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        id: 'revision-1',
        studentId: deriveStudentId('Anna'),
        status: 'active',
        versionLabel: 'v1',
      });
    });

    it('keeps retired catalog and binding routes unavailable', async () => {
      for (const url of [
        '/profiles',
        '/profiles/profile.md',
        `/students/${deriveStudentId('Anna')}/bindings`,
        `/students/${deriveStudentId('Anna')}/bindings/active`,
      ]) {
        const response = await app.inject({ method: 'GET', url });
        expect(response.statusCode, url).toBe(404);
      }
    });

    it('rejects an unavailable student before profile reads or mutations', async () => {
      const priorStudentLookup = mockGetStudentProfileById.getMockImplementation();
      const dependencies = [
        mockGetProfileContent,
        mockUpsertProfileContent,
        mockListProfileRevisionsForStudent,
        mockGetProfileRevisionForStudent,
        mockSaveProfileRevisionContent,
        mockRestoreProfileRevision,
        mockActivateProfileRevisionForStudent,
      ];
      for (const dependency of dependencies) dependency.mockClear();
      mockGetStudentProfileById.mockResolvedValue(null);
      for (const route of [
        { method: 'GET' as const, suffix: '' },
        { method: 'PUT' as const, suffix: '', payload: { content: 'Updated' } },
        { method: 'GET' as const, suffix: '/revisions' },
        { method: 'POST' as const, suffix: '/revisions', payload: { content: 'Draft' } },
        { method: 'GET' as const, suffix: '/revisions/11111111-1111-4111-8111-111111111111' },
        {
          method: 'POST' as const,
          suffix: '/revisions/11111111-1111-4111-8111-111111111111/restore',
        },
        {
          method: 'POST' as const,
          suffix: '/revisions/11111111-1111-4111-8111-111111111111/activate',
        },
      ]) {
        const response = await app.inject({
          method: route.method,
          url: `/students/${deriveStudentId('Anna')}/profile${route.suffix}`,
          payload: 'payload' in route ? route.payload : undefined,
        });
        expect(response.statusCode, route.suffix).toBe(404);
        expect(response.json()).toEqual({ error: 'not_found' });
      }
      for (const dependency of dependencies) expect(dependency).not.toHaveBeenCalled();
      mockGetStudentProfileById.mockImplementation(priorStudentLookup);
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

    it('POST /templates/:id/default selects the default template', async () => {
      mockSetDefaultTemplateContent.mockClear();

      const response = await app.inject({
        method: 'POST',
        url: '/templates/template.md/default',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        id: 'template.md',
        label: 'Template',
        content: 'Template content',
        currentRevisionId: 'template-revision-1',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
      expect(mockSetDefaultTemplateContent).toHaveBeenCalledWith('template.md');
    });

    it('POST /templates/:id/default returns not found when the template is missing', async () => {
      mockSetDefaultTemplateContent.mockClear();
      mockSetDefaultTemplateContent.mockResolvedValueOnce(null);

      const response = await app.inject({
        method: 'POST',
        url: '/templates/missing.md/default',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: 'not_found' });
      expect(mockSetDefaultTemplateContent).toHaveBeenCalledWith('missing.md');
    });

    it('POST /templates/:id/revisions/:revisionId/restore restores a template revision', async () => {
      mockRestoreTemplateRevision.mockClear();

      const response = await app.inject({
        method: 'POST',
        url: '/templates/template.md/revisions/11111111-1111-4111-8111-111111111111/restore',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        id: 'template.md',
        label: 'Template',
        content: 'Restored template',
        currentRevisionId: 'template-revision-2',
        updatedAt: '2024-01-02T00:00:00.000Z',
      });
      expect(mockRestoreTemplateRevision).toHaveBeenCalledWith(
        'template.md',
        '11111111-1111-4111-8111-111111111111',
        { createdBy: 'test-user-id' },
      );
    });

    it('POST /templates/:id/revisions/:revisionId/restore returns not found for an unknown revision', async () => {
      mockRestoreTemplateRevision.mockClear();
      mockRestoreTemplateRevision.mockResolvedValueOnce(null);

      const response = await app.inject({
        method: 'POST',
        url: '/templates/template.md/revisions/11111111-1111-4111-8111-111111111111/restore',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: 'not_found' });
      expect(mockRestoreTemplateRevision).toHaveBeenCalledWith(
        'template.md',
        '11111111-1111-4111-8111-111111111111',
        { createdBy: 'test-user-id' },
      );
    });

    it('POST /templates/:id/revisions/:revisionId/activate activates a template revision', async () => {
      mockActivateTemplateRevisionForTemplate.mockClear();

      const response = await app.inject({
        method: 'POST',
        url: '/templates/template.md/revisions/11111111-1111-4111-8111-111111111111/activate',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        id: 'template-revision-1',
        templateId: 'template.md',
        status: 'active',
        versionLabel: 'v1',
        content: 'Template content',
      });
      expect(mockActivateTemplateRevisionForTemplate).toHaveBeenCalledWith(
        'template.md',
        '11111111-1111-4111-8111-111111111111',
      );
    });

    it('POST /templates/:id/revisions/:revisionId/activate returns not found for an unknown revision', async () => {
      mockActivateTemplateRevisionForTemplate.mockClear();
      mockActivateTemplateRevisionForTemplate.mockResolvedValueOnce(null);

      const response = await app.inject({
        method: 'POST',
        url: '/templates/template.md/revisions/11111111-1111-4111-8111-111111111111/activate',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: 'not_found' });
      expect(mockActivateTemplateRevisionForTemplate).toHaveBeenCalledWith(
        'template.md',
        '11111111-1111-4111-8111-111111111111',
      );
    });

    it('POST /templates/:id/revisions/:revisionId/activate rejects an invalid revision id', async () => {
      mockActivateTemplateRevisionForTemplate.mockClear();

      const response = await app.inject({
        method: 'POST',
        url: '/templates/template.md/revisions/not-a-uuid/activate',
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'validation_failed' });
      expect(mockActivateTemplateRevisionForTemplate).not.toHaveBeenCalled();
    });

    it('retires local scheduling endpoints and rejects timing/cancellation bypasses', async () => {
      const studentId = deriveStudentId('Anna');
      for (const [method, path] of [
        ['POST', 'lessons'],
        ['PUT', 'operations/primary-lesson-recurrence'],
      ] as const) {
        const response = await app.inject({
          method,
          url: `/students/${studentId}/${path}`,
          payload: {},
        });
        expect(response.statusCode).toBe(404);
      }
      for (const payload of [
        { startsAt: '2026-05-11T04:00:00Z' },
        { localStartsAt: '2026-05-11T09:30', timezone: 'UTC' },
        { status: 'canceled' },
        { status: 'scheduled' },
      ]) {
        const response = await app.inject({
          method: 'PATCH',
          url: `/students/${studentId}/lessons/lesson-1`,
          payload,
        });
        expect(response.statusCode).toBe(400);
      }
    });

    it('validates lesson page/exact reads and passes only the authenticated workspace', async () => {
      const studentId = deriveStudentId('Anna');
      const lessonId = '00000000-0000-4000-8000-000000000088';
      mockGetStudentLessonPage.mockResolvedValue({ items: [], nextCursor: null });
      mockGetStudentLesson.mockResolvedValue(null);
      const page = await app.inject({
        method: 'GET',
        url: `/students/${studentId}/lessons?window=recent&cursor=opaque&workspaceId=foreign`,
      });
      expect(page.statusCode).toBe(200);
      expect(mockGetStudentLessonPage).toHaveBeenCalledWith(
        DEFAULT_WORKSPACE_ID,
        studentId,
        'recent',
        'opaque',
      );
      const exact = await app.inject({
        method: 'GET',
        url: `/students/${studentId}/lessons/${lessonId}`,
      });
      expect(exact.statusCode).toBe(404);
      expect(mockGetStudentLesson).toHaveBeenCalledWith(DEFAULT_WORKSPACE_ID, studentId, lessonId);
      for (const url of [
        `/students/${studentId}/lessons?window=today&cursor=opaque`,
        `/students/${studentId}/lessons?window=recent`,
        `/students/${studentId}/lessons/not-a-uuid`,
      ]) {
        expect((await app.inject({ method: 'GET', url })).statusCode).toBe(400);
      }
      mockResolvePrimaryWorkspaceIdForUser.mockRejectedValueOnce(new WorkspaceContextError());
      expect(
        (await app.inject({ method: 'GET', url: `/students/${studentId}/lessons/${lessonId}` }))
          .statusCode,
      ).toBe(403);
    });

    it('passes authenticated workspace membership through every student business route', async () => {
      const studentId = deriveStudentId('Anna');
      const lessonId = 'lesson-1';
      mockResolvePrimaryWorkspaceIdForUser.mockClear();

      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/students/${studentId}/surfaces/schedule-billing`,
          })
        ).statusCode,
      ).toBe(200);
      expect(mockGetStudentScheduleBillingSurface).toHaveBeenCalledWith(
        DEFAULT_WORKSPACE_ID,
        studentId,
      );

      expect(
        (
          await app.inject({
            method: 'PUT',
            url: `/students/${studentId}/operations/lesson-plan`,
            payload: { timezone: 'UTC' },
          })
        ).statusCode,
      ).toBe(200);
      expect(mockUpdateStudentLessonPlan).toHaveBeenCalledWith(
        DEFAULT_WORKSPACE_ID,
        studentId,
        { timezone: 'UTC' },
        'test-user-id',
      );

      expect(
        (
          await app.inject({
            method: 'PATCH',
            url: `/students/${studentId}/lessons/${lessonId}`,
            payload: { notes: 'Updated lesson' },
          })
        ).statusCode,
      ).toBe(200);
      expect(mockUpdateStudentLesson).toHaveBeenCalledWith(
        DEFAULT_WORKSPACE_ID,
        studentId,
        lessonId,
        { notes: 'Updated lesson' },
        'test-user-id',
      );

      expect(
        (
          await app.inject({
            method: 'PUT',
            url: `/students/${studentId}/operations/reminders/lesson-followup/${lessonId}/hide`,
          })
        ).statusCode,
      ).toBe(200);
      expect(mockHideStudentLessonFollowupReminder).toHaveBeenCalledWith(
        DEFAULT_WORKSPACE_ID,
        studentId,
        lessonId,
        'test-user-id',
      );

      expect(
        (
          await app.inject({
            method: 'PUT',
            url: `/students/${studentId}/operations/reminders/latest-hidden/undo`,
          })
        ).statusCode,
      ).toBe(200);
      expect(mockUndoLatestHiddenStudentReminder).toHaveBeenCalledWith(
        DEFAULT_WORKSPACE_ID,
        studentId,
        'test-user-id',
      );

      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/students/${studentId}/packages`,
            payload: { lessons: 4 },
          })
        ).statusCode,
      ).toBe(201);
      expect(mockAddStudentPackage).toHaveBeenCalledWith(
        DEFAULT_WORKSPACE_ID,
        studentId,
        { lessons: 4 },
        'test-user-id',
      );

      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/students/${studentId}/credits/adjustments`,
            payload: { quantityDelta: 2 },
          })
        ).statusCode,
      ).toBe(201);
      expect(mockAdjustStudentCredits).toHaveBeenCalledWith(
        DEFAULT_WORKSPACE_ID,
        studentId,
        { quantityDelta: 2 },
        'test-user-id',
      );

      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/students/${studentId}/payments`,
            payload: { amountMinor: 9000, currency: 'USD' },
          })
        ).statusCode,
      ).toBe(201);
      expect(mockRecordStudentPayment).toHaveBeenCalledWith(
        DEFAULT_WORKSPACE_ID,
        studentId,
        { amountMinor: 9000, currency: 'USD' },
        'test-user-id',
      );

      expect(mockResolvePrimaryWorkspaceIdForUser).toHaveBeenCalledWith('test-user-id');
    });

    it('maps missing workspace membership on direct and shared schedule-billing handlers', async () => {
      const studentId = deriveStudentId('Anna');
      mockResolvePrimaryWorkspaceIdForUser.mockRejectedValueOnce(new WorkspaceContextError());
      const readResponse = await app.inject({
        method: 'GET',
        url: `/students/${studentId}/surfaces/schedule-billing`,
      });
      expect(readResponse.statusCode).toBe(403);
      expect(readResponse.json()).toMatchObject({ error: 'workspace_required' });

      mockResolvePrimaryWorkspaceIdForUser.mockRejectedValueOnce(new WorkspaceContextError());
      const mutationResponse = await app.inject({
        method: 'POST',
        url: `/students/${studentId}/credits/adjustments`,
        payload: { quantityDelta: 2 },
      });
      expect(mutationResponse.statusCode).toBe(403);
      expect(mutationResponse.json()).toMatchObject({ error: 'workspace_required' });
    });
  },
);
