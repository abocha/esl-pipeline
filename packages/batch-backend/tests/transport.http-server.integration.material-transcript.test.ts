import type { FastifyReply, FastifyRequest } from 'fastify';

import * as materialTranscript from '../src/application/fetch-assignment-material-transcript.js';
import { MaterialTranscriptError } from '../src/infrastructure/material-transcript.js';
import { describeHttpServerIntegrationSuite } from './transport.http-server.integration.harness.js';

describeHttpServerIntegrationSuite(
  'assignment material transcript HTTP boundary',
  ({ app, it, vi, expect, authMiddlewareModule }) => {
    const sessionId = '11111111-1111-4111-8111-111111111111';
    const url = `/assignment-sessions/${sessionId}/material-transcript`;
    const sourceUrl = 'https://youtu.be/abc123XYZ_0';

    it('transports explicit retrieval and keeps the response limited to external material', async () => {
      const retrieve = vi
        .spyOn(materialTranscript, 'fetchAssignmentMaterialTranscript')
        .mockResolvedValue({ sourceUrl, sourceText: 'Caption text.' });
      const result = await app.inject({ method: 'POST', url, payload: { sourceUrl } });
      expect(result.statusCode).toBe(200);
      expect(result.json()).toEqual({ sourceUrl, sourceText: 'Caption text.' });
      expect(retrieve).toHaveBeenCalledWith(
        'test-user-id',
        sessionId,
        sourceUrl,
        expect.any(Object),
      );
      retrieve.mockRestore();
    });

    it('requires authentication before invoking retrieval', async () => {
      const retrieve = vi.spyOn(materialTranscript, 'fetchAssignmentMaterialTranscript');
      vi.mocked(authMiddlewareModule.authenticate).mockImplementationOnce(
        (_request: FastifyRequest, reply: FastifyReply) => {
          void reply.code(401).send({ error: 'unauthorized' });
        },
      );
      const result = await app.inject({ method: 'POST', url, payload: { sourceUrl } });
      expect(result.statusCode).toBe(401);
      expect(retrieve).not.toHaveBeenCalled();
      retrieve.mockRestore();
    });

    it('returns identical not-found responses without external data for unauthorized sessions', async () => {
      const retrieve = vi
        .spyOn(materialTranscript, 'fetchAssignmentMaterialTranscript')
        .mockResolvedValue(null);
      const result = await app.inject({ method: 'POST', url, payload: { sourceUrl } });
      expect(result.statusCode).toBe(404);
      expect(result.json()).toEqual({ error: 'not_found' });
      retrieve.mockRestore();
    });

    it('rejects extra fields before sending tutor/learner data downstream', async () => {
      const retrieve = vi.spyOn(materialTranscript, 'fetchAssignmentMaterialTranscript');
      const result = await app.inject({
        method: 'POST',
        url,
        payload: { sourceUrl, teacherNotes: 'Private notes' },
      });
      expect(result.statusCode).toBe(400);
      expect(retrieve).not.toHaveBeenCalled();
      retrieve.mockRestore();
    });

    it('preserves an actionable provider failure for the manual entry path', async () => {
      const retrieve = vi
        .spyOn(materialTranscript, 'fetchAssignmentMaterialTranscript')
        .mockRejectedValue(
          new MaterialTranscriptError(
            'transcript_timeout',
            504,
            'Transcript fetching timed out. Paste source text below.',
          ),
        );
      const result = await app.inject({ method: 'POST', url, payload: { sourceUrl } });
      expect(result.statusCode).toBe(504);
      expect(result.json()).toMatchObject({
        code: 'transcript_timeout',
        message: 'Transcript fetching timed out. Paste source text below.',
      });
      retrieve.mockRestore();
    });
  },
);
