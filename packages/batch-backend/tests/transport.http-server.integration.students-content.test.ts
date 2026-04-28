import { describeHttpServerIntegrationSuite } from './transport.http-server.integration.harness.js';

describeHttpServerIntegrationSuite(
  'transport/http-server - integration (in-process) [jobs-config-students-content]',
  ({
    app,
    deriveStudentId,
    expect,
    it,
    mockActivateProfileRevisionForProfile,
    mockDeleteProfileContent,
    mockSaveProfileRevisionContent,
    mockDeleteTemplateContent,
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
