import { describeHttpServerIntegrationSuite } from './transport.http-server.integration.harness.js';

describeHttpServerIntegrationSuite(
  'transport/http-server - integration (in-process) [jobs-config-students-content]',
  ({
    app,
    deriveStudentId,
    expect,
    it,
    mockActivateProfileRevisionForProfile,
    mockArchiveStudentProfile,
    mockGetActiveStudentProfileBindingForStudent,
    mockGetStudentProfileById,
    mockGetStudentTimeline,
    mockListStudentProfileBindingsForStudent,
    mockListStudentProfiles,
    mockUpsertPrimaryStudentLessonRecurrence,
    mockDeleteProfileContent,
    mockGetProfileRevisionForProfile,
    mockListProfileRevisionsForProfile,
    mockRestoreProfileRevision,
    mockSaveProfileRevisionContent,
    mockDeleteTemplateContent,
    mockRestoreStudentProfile,
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
      expect(mockUpdateStudentProfile).toHaveBeenCalledWith(
        deriveStudentId('Anna'),
        { profileId: 'profile.md' },
        expect.objectContaining({
          workspaceId: expect.any(String),
        }),
      );
      expect(response.json()).toMatchObject({
        profileId: 'profile.md',
      });
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
        profileId: 'profiles/anna.md',
        includedCandidateIds: ['candidate-1'],
        excludedCandidateIds: [],
        contentHash: 'profile-draft-hash',
        draftRevision: {
          id: 'profile-revision-draft',
          profileId: 'profiles/anna.md',
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
        profileId: 'profiles/anna.md',
        baseRevisionId: 'profile-revision-active',
        includedCandidateIds: ['candidate-1'],
        contentHash: 'profile-refreshed-draft-hash',
        draftRevision: {
          id: 'profile-revision-refreshed-draft',
          profileId: 'profiles/anna.md',
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

    it('POST /students/:id/profile-drafts/populate-first-from-lesson creates the initial structured draft', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/students/${deriveStudentId('Anna')}/profile-drafts/populate-first-from-lesson`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        draftRevisionId: 'profile-revision-first-draft',
        profileId: 'profiles/anna.md',
        snapshotId: 'snapshot-1',
        lessonMemoryIds: ['lesson-1'],
        homeworkMemoryIds: [],
        draftRevision: {
          id: 'profile-revision-first-draft',
          profileId: 'profiles/anna.md',
          contentHash: 'profile-first-draft-hash',
          source: 'lesson_population',
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

    it('POST /students/:id/profile-drafts/initialize creates an empty canonical draft', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/students/${deriveStudentId('Anna')}/profile-drafts/initialize`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        draftRevisionId: 'profile-revision-empty-draft',
        profileId: 'profiles/anna.md',
        draftRevision: {
          id: 'profile-revision-empty-draft',
          profileId: 'profiles/anna.md',
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

    it('GET /students/:id/bindings hides archived or missing students', async () => {
      mockGetStudentProfileById.mockResolvedValueOnce(null);
      mockListStudentProfileBindingsForStudent.mockClear();

      const response = await app.inject({
        method: 'GET',
        url: `/students/${deriveStudentId('Anna')}/bindings?limit=10&offset=0&order=desc`,
      });

      expect(response.statusCode).toBe(404);
      expect(mockListStudentProfileBindingsForStudent).not.toHaveBeenCalled();
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

    it('GET /students/:id/bindings/active hides archived or missing students', async () => {
      mockGetStudentProfileById.mockResolvedValueOnce(null);
      mockGetActiveStudentProfileBindingForStudent.mockClear();

      const response = await app.inject({
        method: 'GET',
        url: `/students/${deriveStudentId('Anna')}/bindings/active`,
      });

      expect(response.statusCode).toBe(404);
      expect(mockGetActiveStudentProfileBindingForStudent).not.toHaveBeenCalled();
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

    it('DELETE /profiles/:id archives profile content', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/profiles/profile.md',
      });

      expect(response.statusCode).toBe(204);
      expect(mockDeleteProfileContent).toHaveBeenCalledWith('profile.md');
    });

    it('POST /profiles/:id/revisions saves a structured draft revision', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/profiles/profile.md/revisions',
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
        profileId: 'profile.md',
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

    it('POST /profiles/revisions saves a draft revision with profileId in the body', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/profiles/revisions',
        payload: {
          profileId: 'profiles/students/alex.md',
          content: '# Profile',
        },
      });

      expect(response.statusCode).toBe(201);
      expect(mockSaveProfileRevisionContent).toHaveBeenCalledWith(
        'profiles/students/alex.md',
        '# Profile',
        expect.objectContaining({
          source: 'update',
          status: 'draft',
          createdBy: 'test-user-id',
        }),
      );
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

    it('GET /profiles/revisions returns profile revision list with profileId in the query', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/profiles/revisions?profileId=profiles%2Fstudents%2Falex.md&limit=10&offset=0&order=desc',
      });

      expect(response.statusCode).toBe(200);
      expect(mockListProfileRevisionsForProfile).toHaveBeenCalledWith('profiles/students/alex.md', {
        limit: 10,
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

    it('GET /profiles/revisions/:revisionId returns revision detail with profileId in the query', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/profiles/revisions/11111111-1111-4111-8111-111111111111?profileId=profiles%2Fstudents%2Falex.md',
      });

      expect(response.statusCode).toBe(200);
      expect(mockGetProfileRevisionForProfile).toHaveBeenCalledWith(
        'profiles/students/alex.md',
        '11111111-1111-4111-8111-111111111111',
      );
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

    it('POST /profiles/revisions/:revisionId/restore restores profile content with profileId in the body', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/profiles/revisions/11111111-1111-4111-8111-111111111111/restore',
        payload: {
          profileId: 'profiles/students/alex.md',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockRestoreProfileRevision).toHaveBeenCalledWith(
        'profiles/students/alex.md',
        '11111111-1111-4111-8111-111111111111',
        expect.objectContaining({
          createdBy: 'test-user-id',
        }),
      );
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

    it('POST /profiles/revisions/:revisionId/activate activates a revision with profileId in the body', async () => {
      mockActivateProfileRevisionForProfile.mockResolvedValueOnce({
        id: 'revision-1',
        profileId: 'profiles/students/alex.md',
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
        url: '/profiles/revisions/11111111-1111-4111-8111-111111111111/activate',
        payload: {
          profileId: 'profiles/students/alex.md',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockActivateProfileRevisionForProfile).toHaveBeenCalledWith(
        'profiles/students/alex.md',
        '11111111-1111-4111-8111-111111111111',
      );
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

    it('PUT /students/:id/operations/primary-lesson-recurrence validates and saves recurrence rules', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/students/${deriveStudentId('Anna')}/operations/primary-lesson-recurrence`,
        payload: {
          timezone: 'Asia/Bangkok',
          startsOn: '2026-05-11',
          generationHorizonDays: 56,
          slots: [{ isoWeekday: 1, localStartTime: '11:00', durationMinutes: 50 }],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockUpsertPrimaryStudentLessonRecurrence).toHaveBeenCalledWith(
        deriveStudentId('Anna'),
        {
          timezone: 'Asia/Bangkok',
          startsOn: '2026-05-11',
          generationHorizonDays: 56,
          slots: [{ isoWeekday: 1, localStartTime: '11:00', durationMinutes: 50 }],
        },
        'test-user-id',
      );
      expect(response.json()).toMatchObject({
        recurrenceRule: {
          timezone: 'Asia/Bangkok',
          slots: [{ isoWeekday: 1, localStartTime: '11:00' }],
        },
      });
    });

    it('PUT /students/:id/operations/primary-lesson-recurrence rejects invalid recurrence rules', async () => {
      const response = await app.inject({
        method: 'PUT',
        url: `/students/${deriveStudentId('Anna')}/operations/primary-lesson-recurrence`,
        payload: {
          timezone: 'Asia/Bangkok',
          startsOn: '2026-05-11',
          slots: [{ isoWeekday: 8, localStartTime: '11:00', durationMinutes: 50 }],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'validation_failed' });
    });
  },
);
