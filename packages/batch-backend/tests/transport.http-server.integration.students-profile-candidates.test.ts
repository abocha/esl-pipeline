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
    mockListStudentProfileCandidatesForStudent,
    mockRejectStudentProfileCandidate,
  }) => {
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
