import * as ingestManualTranscriptSourceModule from '../src/application/ingest-manual-transcript-source.js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { describeHttpServerIntegrationSuite } from './transport.http-server.integration.harness.js';

describeHttpServerIntegrationSuite(
  'transport/http-server - integration (in-process) [manual-transcript-source]',
  ({ app, authMiddlewareModule, expect, it, vi }) => {
    it('POST /recordings/transcript-source requires authentication', async () => {
      vi.mocked(authMiddlewareModule.authenticate).mockImplementationOnce(
        (_request: FastifyRequest, reply: FastifyReply) => {
          void reply.code(401).send({
            error: 'unauthorized',
            message: 'Authentication required',
            code: 'not_authenticated',
          });
        },
      );

      const response = await app.inject({
        method: 'POST',
        url: '/recordings/transcript-source',
        payload: {
          studentId: '11111111-1111-4111-8111-111111111111',
          text: 'Tutor supplied transcript',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('POST /recordings/transcript-source rejects blank text', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/recordings/transcript-source',
        payload: {
          studentId: '11111111-1111-4111-8111-111111111111',
          text: '   ',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'validation_failed' });
    });

    it('POST /recordings/transcript-source rejects oversized text', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/recordings/transcript-source',
        payload: {
          studentId: '11111111-1111-4111-8111-111111111111',
          text: 'x'.repeat(500_001),
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'validation_failed' });
    });

    it('POST /recordings/transcript-source returns a transcribed manual source', async () => {
      const now = new Date('2026-07-10T00:00:00.000Z');
      vi.spyOn(
        ingestManualTranscriptSourceModule,
        'ingestManualTranscriptSource',
      ).mockResolvedValueOnce({
        recording: {
          id: '22222222-2222-4222-8222-222222222222',
          source: 'manual_transcript',
          studentId: '11111111-1111-4111-8111-111111111111',
          sourcePath: 'Lesson on travel',
          storageUri: 'local://transcripts/33333333-3333-4333-8333-333333333333.txt',
          sha256: null,
          bytes: 25,
          durationSec: null,
          channels: null,
          status: 'transcribed',
          error: null,
          createdAt: now,
          updatedAt: now,
        },
        transcript: {
          id: '33333333-3333-4333-8333-333333333333',
          recordingId: '22222222-2222-4222-8222-222222222222',
          storageUri: 'local://transcripts/33333333-3333-4333-8333-333333333333.txt',
          rawResponseUri: null,
          mode: 'timeline',
          model: 'manual-entry',
          language: 'und',
          sttProvider: 'manual',
          fallbackUsed: false,
          summaryJson: { provider: 'manual', origin: 'tutor_paste' },
          createdAt: now,
          updatedAt: now,
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/recordings/transcript-source',
        payload: {
          studentId: '11111111-1111-4111-8111-111111111111',
          text: 'Tutor supplied transcript',
          displayName: 'Lesson on travel',
        },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        recordingId: '22222222-2222-4222-8222-222222222222',
        transcriptId: '33333333-3333-4333-8333-333333333333',
        source: 'manual_transcript',
        status: 'transcribed',
        studentId: '11111111-1111-4111-8111-111111111111',
        displayName: 'Lesson on travel',
      });
    });
  },
);
