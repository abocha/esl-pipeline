import { MIGRATED_PROFILE_REVISION_ID } from './fixtures/migrated-profile-revision.js';
import { describeHttpServerIntegrationSuite } from './transport.http-server.integration.harness.js';

describeHttpServerIntegrationSuite(
  'transport/http-server - integration (in-process) [assignment-sessions]',
  ({
    app,
    assignmentSessionsModule,
    assignmentLearnerContextModule,
    confirmAssignmentSessionStepModule,
    finishTranscriptAssignmentSessionModule,
    publishAssignmentCorrectionModule,
    shareAssignmentSessionModule,
    expect,
    it,
    vi,
  }) => {
    const session = {
      homeworkIntent: 'create' as const,
      transcriptCompletedAt: null,
      transcriptCompletionHistory: [],
      completionKind: null,
      id: '11111111-1111-4111-8111-111111111111',
      userId: 'test-user-id',
      studentId: '22222222-2222-4222-8222-222222222222',
      lessonId: null,
      recordingId: null,
      transcriptId: null,
      promptPackageId: null,
      draftId: null,
      revision: 1,
      confirmedStep: 'student' as const,
      confirmed: {
        student: { studentId: '22222222-2222-4222-8222-222222222222' },
        source: null,
        context: null,
        create: null,
      },
      publishTarget: null,
      selectedTtsProvider: null,
      selectedTtsStrategy: null,
      selectedTtsModel: null,
      selectedPreset: null,
      selectedGenerationProvider: null,
      selectedGenerationModel: null,
      teacherNotes: null,
      selectedProfileId: null,
      selectedProfileRevisionId: null,
      selectedProfileRevisionHash: null,
      shareJobId: null,
      createdAt: '2026-07-19T00:00:00.000Z',
      updatedAt: '2026-07-19T00:00:00.000Z',
    };

    it('paginates older transcript history with a fixed limit and offset while keeping active admission', async () => {
      const older = {
        ...session,
        homeworkIntent: 'none' as const,
        completionKind: 'transcript_only' as const,
        transcriptCompletedAt: '2026-07-18T00:00:00.000Z',
      };
      const list = vi
        .spyOn(assignmentSessionsModule, 'listAssignmentSessionsForUserDto')
        .mockClear()
        .mockResolvedValue({ sessions: [older], total: 61, limit: 20 });
      const page = await app.inject({
        method: 'GET',
        url: '/user/assignment-sessions?scope=history&limit=20&offset=40',
      });
      expect(page.statusCode).toBe(200);
      expect(page.json()).toMatchObject({
        sessions: [{ id: session.id, completionKind: 'transcript_only' }],
        total: 61,
        limit: 20,
      });
      expect(list).toHaveBeenCalledWith('test-user-id', 20, 'history', 40);
      list.mockClear();
      for (const query of [
        'scope=history&limit=60&offset=40',
        'scope=history&offset=-1',
        'scope=active&offset=20',
        'offset=20',
      ]) {
        const invalid = await app.inject({
          method: 'GET',
          url: `/user/assignment-sessions?${query}`,
        });
        expect(invalid.statusCode).toBe(400);
      }
      expect(list).not.toHaveBeenCalled();
      const active = await app.inject({ method: 'GET', url: '/user/assignment-sessions' });
      expect(active.statusCode).toBe(200);
      expect(list).toHaveBeenCalledWith('test-user-id', 20, 'active', 0);
    });

    it('transports exact reviewed finish and promotion commands, and saved intent', async () => {
      const finish = vi
        .spyOn(finishTranscriptAssignmentSessionModule, 'finishTranscriptAssignmentSession')
        .mockResolvedValue({ session });
      const start = vi
        .spyOn(finishTranscriptAssignmentSessionModule, 'startHomeworkAssignmentSession')
        .mockResolvedValue({ session });
      const recovery = vi
        .spyOn(assignmentSessionsModule, 'updateAssignmentSessionRecoveryForUser')
        .mockResolvedValue(session);
      const reviewed = {
        expectedRevision: 3,
        lessonId: null,
        recordingId: '33333333-3333-4333-8333-333333333333',
        transcriptId: '44444444-4444-4444-8444-444444444444',
        transcriptWorkingVersion: 2,
        transcriptHash: 'a'.repeat(64),
      };
      const result = await app.inject({
        method: 'POST',
        url: `/assignment-sessions/${session.id}/finish-transcript`,
        payload: reviewed,
      });
      expect(result.statusCode).toBe(200);
      expect(finish).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'test-user-id',
          sessionId: session.id,
          request: reviewed,
        }),
      );
      const promoted = await app.inject({
        method: 'POST',
        url: `/assignment-sessions/${session.id}/start-homework`,
        payload: { expectedRevision: 5 },
      });
      expect(promoted.statusCode).toBe(200);
      expect(start).toHaveBeenCalledWith({
        userId: 'test-user-id',
        sessionId: session.id,
        request: { expectedRevision: 5 },
      });
      const saved = await app.inject({
        method: 'PATCH',
        url: `/assignment-sessions/${session.id}/recovery`,
        payload: { expectedRevision: 2, patch: { homeworkIntent: 'none' } },
      });
      expect(saved.statusCode).toBe(200);
      expect(recovery).toHaveBeenCalledWith('test-user-id', session.id, {
        expectedRevision: 2,
        patch: { homeworkIntent: 'none' },
      });
    });

    it('finish rejects incomplete review payload and returns current session on operation conflict', async () => {
      const finish = vi
        .spyOn(finishTranscriptAssignmentSessionModule, 'finishTranscriptAssignmentSession')
        .mockClear();
      const incomplete = await app.inject({
        method: 'POST',
        url: `/assignment-sessions/${session.id}/finish-transcript`,
        payload: { expectedRevision: 3 },
      });
      expect(incomplete.statusCode).toBe(400);
      expect(finish).not.toHaveBeenCalled();
      finish.mockRejectedValue(
        Object.assign(new Error('stale finish'), {
          code: 'ASSIGNMENT_SESSION_REVISION_CONFLICT',
          session,
        }),
      );
      const conflict = await app.inject({
        method: 'POST',
        url: `/assignment-sessions/${session.id}/finish-transcript`,
        payload: {
          expectedRevision: 3,
          lessonId: null,
          recordingId: '33333333-3333-4333-8333-333333333333',
          transcriptId: '44444444-4444-4444-8444-444444444444',
          transcriptWorkingVersion: 2,
          transcriptHash: 'a'.repeat(64),
        },
      });
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json()).toMatchObject({
        code: 'assignment_session_revision_conflict',
        session: { id: session.id },
      });
    });

    it('ordinary confirmation returns intent conflict before allowing callers to proceed', async () => {
      vi.spyOn(
        confirmAssignmentSessionStepModule,
        'confirmAssignmentSessionStep',
      ).mockRejectedValue(
        Object.assign(new Error('none'), { code: 'ASSIGNMENT_HOMEWORK_INTENT_CONFLICT' }),
      );
      const result = await app.inject({
        method: 'POST',
        url: `/assignment-sessions/${session.id}/confirm`,
        payload: {
          step: 'context',
          expectedRevision: 3,
          teacherNotes: null,
          profileRevisionId: null,
          profileRevisionHash: null,
        },
      });
      expect(result.statusCode).toBe(409);
      expect(result.json()).toMatchObject({ code: 'assignment_homework_intent_conflict' });
    });

    it('accepts migrated profile revision IDs in context confirmation and recovery', async () => {
      const confirm = vi
        .spyOn(confirmAssignmentSessionStepModule, 'confirmAssignmentSessionStep')
        .mockResolvedValue({ session, invalidated: [] });
      const recover = vi
        .spyOn(assignmentSessionsModule, 'updateAssignmentSessionRecoveryForUser')
        .mockResolvedValue(session);
      const context = {
        step: 'context',
        expectedRevision: 1,
        teacherNotes: null,
        profileRevisionId: MIGRATED_PROFILE_REVISION_ID,
        profileRevisionHash: 'a'.repeat(64),
      };
      const confirmed = await app.inject({
        method: 'POST',
        url: `/assignment-sessions/${session.id}/confirm`,
        payload: context,
      });
      expect(confirmed.statusCode).toBe(200);
      expect(confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'test-user-id',
          sessionId: session.id,
          request: context,
        }),
      );
      const recovery = {
        expectedRevision: 1,
        patch: { selectedProfileRevisionId: MIGRATED_PROFILE_REVISION_ID },
      };
      const recovered = await app.inject({
        method: 'PATCH',
        url: `/assignment-sessions/${session.id}/recovery`,
        payload: recovery,
      });
      expect(recovered.statusCode).toBe(200);
      expect(recover).toHaveBeenCalledWith('test-user-id', session.id, recovery);
    });

    it('rejects malformed revision IDs without weakening unrelated RFC UUID inputs', async () => {
      const confirm = vi
        .spyOn(confirmAssignmentSessionStepModule, 'confirmAssignmentSessionStep')
        .mockClear();
      const recover = vi
        .spyOn(assignmentSessionsModule, 'updateAssignmentSessionRecoveryForUser')
        .mockClear();
      for (const patch of [
        { selectedProfileRevisionId: 'not-a-uuid' },
        { recordingId: MIGRATED_PROFILE_REVISION_ID },
        { lessonId: MIGRATED_PROFILE_REVISION_ID },
      ]) {
        const response = await app.inject({
          method: 'PATCH',
          url: `/assignment-sessions/${session.id}/recovery`,
          payload: { expectedRevision: 1, patch },
        });
        expect(response.statusCode).toBe(400);
      }
      const malformed = await app.inject({
        method: 'POST',
        url: `/assignment-sessions/${session.id}/confirm`,
        payload: {
          step: 'context',
          expectedRevision: 1,
          teacherNotes: null,
          profileRevisionId: 'not-a-uuid',
          profileRevisionHash: 'a'.repeat(64),
        },
      });
      expect(malformed.statusCode).toBe(400);
      const student = await app.inject({
        method: 'POST',
        url: '/assignment-sessions/confirm-student',
        payload: { requestId: MIGRATED_PROFILE_REVISION_ID, studentId: session.studentId },
      });
      expect(student.statusCode).toBe(400);
      expect(confirm).not.toHaveBeenCalled();
      expect(recover).not.toHaveBeenCalled();
    });

    it('returns authenticated assignment-scoped learner authority', async () => {
      const projection = {
        assignmentSessionId: session.id,
        studentId: session.studentId,
        source: null,
        eligibility: 'no_confirmed_source',
        state: 'not_applicable',
        operationState: null,
        profile: null,
        pinned: null,
        confirmationAvailable: false,
        warning: null,
      };
      const read = vi
        .spyOn(assignmentLearnerContextModule, 'getAssignmentLearnerContext')
        .mockResolvedValue(projection);
      const response = await app.inject({
        method: 'GET',
        url: `/assignment-sessions/${session.id}/learner-context`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(projection);
      expect(read).toHaveBeenCalledWith('test-user-id', session.id);
    });

    it('confirms Student and updates recovery through revisioned routes', async () => {
      const confirmStudent = vi
        .spyOn(assignmentSessionsModule, 'confirmStudentAssignmentSessionForUser')
        .mockResolvedValue(session);
      const updateRecovery = vi
        .spyOn(assignmentSessionsModule, 'updateAssignmentSessionRecoveryForUser')
        .mockResolvedValue({ ...session, revision: 2, teacherNotes: 'Recovered automatically' });

      const created = await app.inject({
        method: 'POST',
        url: '/assignment-sessions/confirm-student',
        payload: {
          requestId: '33333333-3333-4333-8333-333333333333',
          studentId: session.studentId,
          lessonId: null,
        },
      });
      const recovered = await app.inject({
        method: 'PATCH',
        url: `/assignment-sessions/${session.id}/recovery`,
        payload: { expectedRevision: 1, patch: { teacherNotes: 'Recovered automatically' } },
      });

      expect(created.statusCode).toBe(200);
      expect(created.json()).toEqual(session);
      expect(recovered.statusCode).toBe(200);
      expect(recovered.json()).toMatchObject({ revision: 2 });
      expect(confirmStudent).toHaveBeenCalledWith('test-user-id', {
        requestId: '33333333-3333-4333-8333-333333333333',
        studentId: session.studentId,
        lessonId: null,
      });
      expect(updateRecovery).toHaveBeenCalledWith('test-user-id', session.id, {
        expectedRevision: 1,
        patch: { teacherNotes: 'Recovered automatically' },
      });
    });

    it('returns the latest session on recovery revision conflict', async () => {
      vi.spyOn(
        assignmentSessionsModule,
        'updateAssignmentSessionRecoveryForUser',
      ).mockRejectedValue({
        code: 'ASSIGNMENT_SESSION_REVISION_CONFLICT',
        session: { ...session, revision: 3 },
      });

      const response = await app.inject({
        method: 'PATCH',
        url: `/assignment-sessions/${session.id}/recovery`,
        payload: { expectedRevision: 1, patch: { teacherNotes: 'Stale' } },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({
        code: 'assignment_session_revision_conflict',
        session: { ...session, revision: 3 },
      });
    });

    it('attaches a source atomically and returns canonical resume as a normal outcome', async () => {
      const candidate = {
        expectedRevision: 1,
        recordingId: '33333333-3333-4333-8333-333333333333',
        transcriptId: '44444444-4444-4444-8444-444444444444',
      };
      const attachedSession = {
        ...session,
        revision: 2,
        recordingId: candidate.recordingId,
        transcriptId: candidate.transcriptId,
      };
      const attach = vi
        .spyOn(assignmentSessionsModule, 'attachAssignmentSourceForUser')
        .mockResolvedValue({ outcome: 'source_attached', session: attachedSession });
      const attached = await app.inject({
        method: 'POST',
        url: `/assignment-sessions/${session.id}/source-attachment`,
        payload: candidate,
      });
      expect(attached.statusCode).toBe(200);
      expect(attached.json()).toEqual({ outcome: 'source_attached', session: attachedSession });
      expect(attach).toHaveBeenCalledWith('test-user-id', session.id, candidate);

      const canonicalSession = {
        ...attachedSession,
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        revision: 5,
      };
      attach.mockResolvedValueOnce({
        outcome: 'existing_assignment_resumed',
        session: canonicalSession,
      });
      const resumed = await app.inject({
        method: 'POST',
        url: `/assignment-sessions/${session.id}/source-attachment`,
        payload: candidate,
      });
      expect(resumed.statusCode).toBe(200);
      expect(resumed.json()).toEqual({
        outcome: 'existing_assignment_resumed',
        session: canonicalSession,
      });
    });

    it('returns the canonical assignment when recovery selects an owned source', async () => {
      const canonicalSession = {
        ...session,
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        recordingId: '33333333-3333-4333-8333-333333333333',
        transcriptId: '44444444-4444-4444-8444-444444444444',
        revision: 4,
        confirmedStep: 'source' as const,
      };
      vi.spyOn(
        assignmentSessionsModule,
        'updateAssignmentSessionRecoveryForUser',
      ).mockRejectedValue({
        code: 'ASSIGNMENT_SOURCE_ALREADY_OWNED',
        session: canonicalSession,
      });

      const response = await app.inject({
        method: 'PATCH',
        url: `/assignment-sessions/${session.id}/recovery`,
        payload: {
          expectedRevision: 1,
          patch: {
            recordingId: canonicalSession.recordingId,
            transcriptId: canonicalSession.transcriptId,
          },
        },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({
        code: 'assignment_source_already_owned',
        session: canonicalSession,
      });
    });

    it('rejects recovery that would cross prompt and draft lineage', async () => {
      vi.spyOn(
        assignmentSessionsModule,
        'updateAssignmentSessionRecoveryForUser',
      ).mockRejectedValue({ code: 'ASSIGNMENT_RECOVERY_LINEAGE_INVALID' });

      const response = await app.inject({
        method: 'PATCH',
        url: `/assignment-sessions/${session.id}/recovery`,
        payload: {
          expectedRevision: 1,
          patch: {
            promptPackageId: '33333333-3333-4333-8333-333333333333',
            draftId: '44444444-4444-4444-8444-444444444444',
          },
        },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({ code: 'assignment_recovery_lineage_invalid' });
    });

    it('confirms a discriminated step and returns artifact CAS conflicts', async () => {
      const confirm = vi
        .spyOn(confirmAssignmentSessionStepModule, 'confirmAssignmentSessionStep')
        .mockResolvedValue({
          session: { ...session, revision: 2, confirmedStep: 'source' },
          invalidated: ['prompt', 'draft', 'preview'],
        });
      const payload = {
        step: 'source',
        expectedRevision: 1,
        lessonId: null,
        recordingId: '33333333-3333-4333-8333-333333333333',
        transcriptId: '44444444-4444-4444-8444-444444444444',
        transcriptWorkingVersion: 1,
      };
      const response = await app.inject({
        method: 'POST',
        url: `/assignment-sessions/${session.id}/confirm`,
        payload,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ invalidated: ['prompt', 'draft', 'preview'] });
      expect(confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'test-user-id',
          sessionId: session.id,
          request: payload,
        }),
      );

      confirm.mockRejectedValueOnce({
        code: 'ARTIFACT_WORKING_CONFLICT',
        latest: { workingVersion: 2, contentHash: 'a'.repeat(64) },
      });
      const conflict = await app.inject({
        method: 'POST',
        url: `/assignment-sessions/${session.id}/confirm`,
        payload,
      });
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json()).toEqual({
        code: 'artifact_working_conflict',
        artifact: { workingVersion: 2, contentHash: 'a'.repeat(64) },
      });

      confirm.mockRejectedValueOnce({
        code: 'ASSIGNMENT_STEP_SPEAKER_ROLE_MAPPING_REQUIRED',
      });
      const speakerMappingRequired = await app.inject({
        method: 'POST',
        url: `/assignment-sessions/${session.id}/confirm`,
        payload,
      });
      expect(speakerMappingRequired.statusCode).toBe(400);
      expect(speakerMappingRequired.json()).toEqual({
        code: 'assignment_step_speaker_role_mapping_required',
      });

      confirm.mockRejectedValueOnce({ code: 'ASSIGNMENT_STEP_PROFILE_PREPARING' });
      const pending = await app.inject({
        method: 'POST',
        url: `/assignment-sessions/${session.id}/confirm`,
        payload: {
          step: 'context',
          expectedRevision: 2,
          teacherNotes: 'Editable guidance',
          profileRevisionId: null,
          profileRevisionHash: null,
        },
      });
      expect(pending.statusCode).toBe(409);
      expect(pending.json()).toEqual({ code: 'assignment_step_profile_preparing' });
    });

    it('returns conflict when a Student request ID is reused with different input', async () => {
      vi.spyOn(
        assignmentSessionsModule,
        'confirmStudentAssignmentSessionForUser',
      ).mockRejectedValue({ code: 'ASSIGNMENT_SESSION_REQUEST_CONFLICT', session });

      const response = await app.inject({
        method: 'POST',
        url: '/assignment-sessions/confirm-student',
        payload: {
          requestId: '33333333-3333-4333-8333-333333333333',
          studentId: '44444444-4444-4444-8444-444444444444',
          lessonId: null,
        },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({
        code: 'assignment_session_request_conflict',
        session,
      });
    });

    it('rejects confirmed and Share fields in recovery payloads', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/assignment-sessions/${session.id}/recovery`,
        payload: {
          expectedRevision: 1,
          patch: { confirmedStep: 'share', confirmed: session.confirmed, shareJobId: session.id },
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects retired catalog profile selection in recovery and context writes', async () => {
      const recovery = await app.inject({
        method: 'PATCH',
        url: `/assignment-sessions/${session.id}/recovery`,
        payload: { expectedRevision: 1, patch: { selectedProfileId: 'profile.md' } },
      });
      expect(recovery.statusCode).toBe(400);
      const context = await app.inject({
        method: 'POST',
        url: `/assignment-sessions/${session.id}/confirm`,
        payload: {
          step: 'context',
          expectedRevision: 1,
          teacherNotes: null,
          profileId: 'profile.md',
          profileRevisionId: null,
          profileRevisionHash: null,
        },
      });
      expect(context.statusCode).toBe(400);
    });

    it('shares through one stable job-backed terminal operation', async () => {
      const request = {
        expectedRevision: 1,
        requestId: '55555555-5555-4555-8555-555555555555',
      };
      const completedSession = { ...session, revision: 3, confirmedStep: 'share' as const };
      const share = vi
        .spyOn(shareAssignmentSessionModule, 'shareAssignmentSession')
        .mockResolvedValue({
          session: completedSession,
          job: {
            jobId: request.requestId,
            state: 'queued',
            progress: 0,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            error: null,
            sourceJobId: null,
            manifestUri: null,
            manifest: null,
            provenance: null,
          },
        });

      const response = await app.inject({
        method: 'POST',
        url: `/assignment-sessions/${session.id}/share`,
        payload: request,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        session: { id: session.id, confirmedStep: 'share' },
        job: { jobId: request.requestId, state: 'queued' },
      });
      expect(share).toHaveBeenCalledWith({
        userId: 'test-user-id',
        sessionId: session.id,
        request,
      });
    });

    it('validates correction publish requests through the dedicated published-job route', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/jobs/55555555-5555-4555-8555-555555555555/publish-correction',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'validation_failed' });
    });

    it('publishes a correction child through the authenticated published-job route', async () => {
      const request = {
        requestId: '55555555-5555-4555-8555-555555555555',
        draftId: '66666666-6666-4666-8666-666666666666',
        draftWorkingVersion: 2,
        draftHash: 'a'.repeat(64),
      };
      const publishedJobId = '77777777-7777-4777-8777-777777777777';
      vi.spyOn(publishAssignmentCorrectionModule, 'publishAssignmentCorrection').mockResolvedValue({
        job: {
          jobId: request.requestId,
          state: 'queued',
          progress: 0,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          error: null,
          sourceJobId: publishedJobId,
          manifestUri: null,
          manifest: null,
          provenance: null,
        },
      });
      const response = await app.inject({
        method: 'POST',
        url: `/jobs/${publishedJobId}/publish-correction`,
        payload: request,
      });

      expect(response.statusCode).toBe(202);
      expect(response.json()).toMatchObject({ job: { jobId: request.requestId, state: 'queued' } });
      expect(publishAssignmentCorrectionModule.publishAssignmentCorrection).toHaveBeenCalledWith({
        userId: 'test-user-id',
        publishedJobId,
        request,
      });
    });

    it('removes revisionless create, patch, and archive routes', async () => {
      const [create, patch, archive] = await Promise.all([
        app.inject({ method: 'POST', url: '/assignment-sessions', payload: {} }),
        app.inject({ method: 'PATCH', url: `/assignment-sessions/${session.id}`, payload: {} }),
        app.inject({ method: 'POST', url: `/assignment-sessions/${session.id}/archive` }),
      ]);

      expect(create.statusCode).toBe(404);
      expect(patch.statusCode).toBe(404);
      expect(archive.statusCode).toBe(404);
    });
  },
);
