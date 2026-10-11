import { ProfileRevisionDraftingError } from '../src/application/profile-revision-drafting.js';
import { describeHttpServerIntegrationSuite } from './transport.http-server.integration.harness.js';

describeHttpServerIntegrationSuite(
  'transport/http-server - integration (in-process) [students-profile-candidates]',
  ({
    app,
    deriveStudentId,
    expect,
    it,
    mockApproveStudentProfileCandidate,
    mockDeferStudentProfileCandidate,
    mockRefreshProfileDraftFromApprovedCandidates,
    mockPromoteStudentProfileCandidates,
    mockListStudentProfileCandidatesForStudent,
    mockRejectStudentProfileCandidate,
    mockActivateProfileRevisionForStudent,
  }) => {
    it.each(['refresh-from-approved-candidates', 'promote'])(
      'returns applied IDs and omission reasons for %s',
      async (operation: string) => {
        const studentId = deriveStudentId('Anna');
        const result = {
          studentId,
          baseRevisionId: null,
          draftRevision: {
            id: 'draft-1',
            studentId,
            contentHash: 'hash',
            source: 'profile_revision_refresh' as const,
            status: 'draft' as const,
            versionNumber: 1,
            versionLabel: 'v1',
            activatedAt: null,
            deprecatedAt: null,
            createdAt: '2026-10-11T00:00:00Z',
            createdBy: null,
            restoredFromRevisionId: null,
            content: 'Draft',
          },
          includedCandidateIds: ['candidate-1'],
          omittedCandidates: [{ candidateId: 'candidate-2', reason: 'empty_approved_fact' }],
          provider: 'openai' as const,
          model: 'fixture',
        };
        const mock =
          operation === 'promote'
            ? mockPromoteStudentProfileCandidates
            : mockRefreshProfileDraftFromApprovedCandidates;
        mock.mockResolvedValueOnce(result);
        const response = await app.inject({
          method: 'POST',
          url: `/students/${studentId}/${operation === 'promote' ? 'profile-candidates/promote' : 'profile-drafts/refresh-from-approved-candidates'}`,
          payload: { candidateIds: ['candidate-1', 'candidate-2'] },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
          includedCandidateIds: result.includedCandidateIds,
          omittedCandidates: result.omittedCandidates,
        });
      },
    );

    it('returns zero promotion and its reason on successful activation', async () => {
      const studentId = deriveStudentId('Anna');
      const candidatePromotion = {
        linkedCandidateCount: 1,
        promotedCandidateIds: [],
        omittedCandidates: [{ candidateId: 'candidate-1', reason: 'fact_not_represented' }],
      };
      const revisionId = '00000000-0000-4000-8000-000000000047';
      mockActivateProfileRevisionForStudent.mockResolvedValueOnce({
        id: revisionId,
        studentId,
        contentHash: 'hash',
        source: 'profile_revision_refresh',
        status: 'active',
        versionNumber: 1,
        versionLabel: 'v1',
        activatedAt: '2026-10-11T00:00:00Z',
        deprecatedAt: null,
        createdAt: '2026-10-11T00:00:00Z',
        createdBy: null,
        restoredFromRevisionId: null,
        content: 'Draft',
        candidatePromotion,
      });
      const response = await app.inject({
        method: 'POST',
        url: `/students/${studentId}/profile/revisions/${revisionId}/activate`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().candidatePromotion).toEqual(candidatePromotion);
    });

    it.each(['refresh-from-approved-candidates', 'promote'])(
      'returns a typed safe quota refusal for %s',
      async (operation: string) => {
        const mock =
          operation === 'refresh-from-approved-candidates'
            ? mockRefreshProfileDraftFromApprovedCandidates
            : mockPromoteStudentProfileCandidates;
        mock.mockRejectedValueOnce(
          new ProfileRevisionDraftingError({
            category: 'budget_exceeded',
            provider: 'openai',
            model: 'gpt-5.6-luna',
            message: 'Daily reserved-token budget exhausted. Wait for 00:00 UTC.',
            limitType: 'daily_tokens',
            limit: 2250000,
            used: 2249000,
            window: 'day',
          }),
        );
        const url =
          operation === 'refresh-from-approved-candidates'
            ? `/students/${deriveStudentId('Anna')}/profile-drafts/${operation}`
            : `/students/${deriveStudentId('Anna')}/profile-candidates/${operation}`;
        const response = await app.inject({
          method: 'POST',
          url,
          payload: { candidateIds: ['candidate-1'] },
        });
        expect(response.statusCode).toBe(429);
        expect(response.json()).toMatchObject({
          error: 'budget_exceeded',
          code: 'budget_exceeded',
          limitType: 'daily_tokens',
          limit: 2250000,
          used: 2249000,
          window: 'day',
          message: expect.stringContaining('00:00 UTC'),
        });
      },
    );

    it('GET /students/:id/profile-candidates parses status and review-state filters', async () => {
      const studentId = deriveStudentId('Anna');
      mockListStudentProfileCandidatesForStudent.mockResolvedValueOnce({
        studentId,
        items: [],
        limit: 25,
        offset: 10,
        order: 'asc',
        statuses: ['pending_review'],
        reviewStates: ['deferred'],
      });

      const response = await app.inject({
        method: 'GET',
        url: `/students/${studentId}/profile-candidates?status=pending_review&reviewState=deferred&limit=25&offset=10&order=asc`,
      });

      expect(response.statusCode).toBe(200);
      expect(mockListStudentProfileCandidatesForStudent).toHaveBeenCalledWith(
        expect.objectContaining({
          studentId,
          statuses: ['pending_review'],
          reviewStates: ['deferred'],
          limit: 25,
          offset: 10,
          order: 'asc',
        }),
      );
    });

    it('POST /students/:id/profile-candidates/:candidateId/approve forwards edited approval text', async () => {
      const studentId = deriveStudentId('Anna');

      const response = await app.inject({
        method: 'POST',
        url: `/students/${studentId}/profile-candidates/candidate-1/approve`,
        payload: {
          approvedFactText: 'Uses English in work meetings and wants more confidence there.',
          reviewerNote: 'Good durable profile fact.',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockApproveStudentProfileCandidate).toHaveBeenCalledWith(
        expect.objectContaining({
          studentId,
          candidateId: 'candidate-1',
          reviewerId: 'test-user-id',
          approvedFact: 'Uses English in work meetings and wants more confidence there.',
          reviewerNote: 'Good durable profile fact.',
        }),
      );
    });

    it('POST /students/:id/profile-candidates/:candidateId/reject forwards reviewer notes', async () => {
      const studentId = deriveStudentId('Anna');

      const response = await app.inject({
        method: 'POST',
        url: `/students/${studentId}/profile-candidates/candidate-1/reject`,
        payload: {
          reviewerNote: 'Too tactical for the foundational profile.',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockRejectStudentProfileCandidate).toHaveBeenCalledWith(
        expect.objectContaining({
          studentId,
          candidateId: 'candidate-1',
          reviewerId: 'test-user-id',
          reviewerNote: 'Too tactical for the foundational profile.',
        }),
      );
    });

    it('POST /students/:id/profile-candidates/:candidateId/defer keeps the mutation route available', async () => {
      const studentId = deriveStudentId('Anna');

      const response = await app.inject({
        method: 'POST',
        url: `/students/${studentId}/profile-candidates/candidate-1/defer`,
        payload: {
          reviewerNote: 'Need more corroboration first.',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockDeferStudentProfileCandidate).toHaveBeenCalledWith(
        expect.objectContaining({
          studentId,
          candidateId: 'candidate-1',
          reviewerNote: 'Need more corroboration first.',
        }),
      );
    });
  },
);
