import { randomUUID } from 'node:crypto';

import type { InsertRecordingParams } from '../src/domain/recording-repository.js';
import * as recordingUploadOperationRepositoryModule from '../src/domain/recording-upload-operation-repository.js';
import type { InsertTranscriptParams } from '../src/domain/transcript-repository.js';
import { describeHttpServerIntegrationSuite } from './transport.http-server.integration.harness.js';

describeHttpServerIntegrationSuite(
  'transport/http-server - integration (in-process) [recordings-prompt-packages]',
  ({
    app,
    assignmentSessionRepositoryModule,
    createDraftModule,
    createPromptPackageModule,
    deriveStudentId,
    expect,
    getPromptPackageModule,
    getRecordingModule,
    getRecordingTranscriptModule,
    it,
    listRecordingsModule,
    loggerModule,
    recordingRepositoryModule,
    retryRecordingModule,
    transcriptRepositoryModule,
    transcriptionStorageModule,
    updateDraftModule,
    updateRecordingTranscriptModule,
    vi,
  }) => {
    vi.spyOn(
      recordingUploadOperationRepositoryModule,
      'beginRecordingUploadOperation',
    ).mockImplementation(
      async (
        context: recordingUploadOperationRepositoryModule.RecordingUploadOperationContext,
      ) => ({
        kind: 'claimed',
        operation: {
          ...context,
          id: randomUUID(),
          recordingId: randomUUID(),
          state: 'processing',
          attemptToken: randomUUID(),
          attemptExpiresAt: new Date(Date.now() + 60_000),
          finalRecordingId: null,
          outcomeKind: null,
          canonicalAssignmentSessionId: null,
        },
        obsoleteCandidateUris: [],
      }),
    );
    vi.spyOn(
      recordingUploadOperationRepositoryModule,
      'recordUploadAttemptCandidate',
    ).mockResolvedValue(true);

    function injectRecordingUpload(
      options: {
        method: 'POST';
        url: string;
        headers?: Record<string, string>;
        payload?: Buffer;
      },
      fixture: { operationId?: string | null } = {},
    ) {
      const existingOperationId = options.headers?.['x-upload-operation-id'];
      const operationId =
        fixture.operationId === null
          ? null
          : (fixture.operationId ?? existingOperationId ?? randomUUID());
      return app.inject({
        ...options,
        headers: {
          ...options.headers,
          ...(operationId ? { 'x-upload-operation-id': operationId } : {}),
        },
      });
    }

    function mockCanonicalUploadProjection(
      resolveIds: () => { recordingId: string; transcriptId: string },
    ) {
      vi.spyOn(getRecordingModule, 'getRecording').mockImplementationOnce(async () => {
        const { recordingId, transcriptId } = resolveIds();
        return {
          recordingId,
          transcriptId,
          source: 'upload',
          status: 'transcribed',
          productState: 'ready',
          runState: null,
          error: null,
          errorCode: null,
          studentId: deriveStudentId('Anna'),
          displayName: 'lesson.mp3',
          durationSec: 90,
          channels: 1,
          audioTopology: 'mixed_recording',
          audioLifecycle: 'not_retained',
          audioAvailable: false,
          bytes: 1024,
          createdAt: '2024-01-02T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z',
        };
      });
    }

    it('POST /recordings/upload durably resumes a canonical owner before cache or STT work', async () => {
      const studentId = deriveStudentId('Anna');
      vi.mocked(
        assignmentSessionRepositoryModule.getCanonicalAssignmentSessionBySourceIdentity,
      ).mockResolvedValueOnce({
        id: '44444444-4444-4444-8444-444444444444',
        userId: 'test-user-id',
        studentId,
        lessonId: null,
        recordingId: '22222222-2222-4222-8222-222222222222',
        transcriptId: '33333333-3333-4333-8333-333333333333',
        promptPackageId: null,
        draftId: null,
        revision: 3,
        confirmedStep: 'source',
        confirmed: { source: null, context: null, create: null },
        creationRequestId: '55555555-5555-4555-8555-555555555555',
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
        createdAt: new Date('2026-09-23T00:00:00.000Z'),
        updatedAt: new Date('2026-09-23T00:00:00.000Z'),
      });
      const complete = vi
        .spyOn(
          recordingUploadOperationRepositoryModule,
          'completeRecordingUploadOperationWithCanonicalAssignment',
        )
        .mockResolvedValueOnce(true);
      const cacheLookup = vi.spyOn(recordingRepositoryModule, 'listRecordingsBySha256ForWorkspace');
      cacheLookup.mockClear();
      const payloadBoundary = '----canonical-owner-boundary';
      const payload = Buffer.concat([
        Buffer.from(
          `--${payloadBoundary}\r\n` +
            'Content-Disposition: form-data; name="file"; filename="lesson.mp3"\r\n' +
            'Content-Type: audio/mpeg\r\n\r\n',
        ),
        Buffer.from('same-canonical-audio'),
        Buffer.from(`\r\n--${payloadBoundary}--\r\n`),
      ]);

      const response = await injectRecordingUpload({
        method: 'POST',
        url: `/recordings/upload?studentId=${studentId}`,
        headers: { 'content-type': `multipart/form-data; boundary=${payloadBoundary}` },
        payload,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        outcome: 'existing_assignment_resumed',
        session: { id: '44444444-4444-4444-8444-444444444444' },
      });
      expect(complete).toHaveBeenCalledWith(
        expect.objectContaining({
          assignmentSessionId: '44444444-4444-4444-8444-444444444444',
        }),
      );
      expect(cacheLookup).not.toHaveBeenCalled();
    });

    vi.spyOn(recordingRepositoryModule, 'insertCachedRecordingLineage').mockImplementation(
      async ({
        recording,
        transcript,
      }: {
        recording: InsertRecordingParams;
        transcript: InsertTranscriptParams;
      }) => ({
        recording: await recordingRepositoryModule.insertRecording(recording),
        transcript: await transcriptRepositoryModule.insertTranscript(transcript),
      }),
    );

    function arrangeCacheCloneFault() {
      const studentId = deriveStudentId('Anna');
      const sourceUris = [
        'memory://transcripts/source-primary.txt',
        'memory://transcripts/source-speaker-0.txt',
        'memory://transcripts/source-speaker-1.txt',
        'memory://transcripts/source-speaker-tracks.json',
      ];
      vi.spyOn(
        recordingRepositoryModule,
        'listRecordingsBySha256ForWorkspace',
      ).mockResolvedValueOnce([
        {
          id: 'source-recording',
          workspaceId: '00000000-0000-4000-8000-000000000001',
          source: 'upload',
          studentId,
          sourcePath: 'source.mp3',
          storageUri: null,
          audioLifecycle: 'not_retained',
          sha256: 'source-hash',
          bytes: 1024,
          durationSec: 90,
          channels: 1,
          audioTopology: 'mixed_recording',
          status: 'transcribed',
          error: null,
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          updatedAt: new Date('2024-01-01T00:05:00.000Z'),
        },
      ]);
      vi.spyOn(
        transcriptRepositoryModule,
        'listLatestTranscriptsByRecordingIdsForWorkspace',
      ).mockResolvedValueOnce([
        {
          id: 'source-transcript',
          recordingId: 'source-recording',
          storageUri: sourceUris[0]!,
          workingVersion: 1,
          contentHash: 'source-content-hash',
          rawResponseUri: null,
          mode: 'timeline',
          model: 'scribe_v2',
          language: 'auto',
          sttProvider: 'elevenlabs',
          fallbackUsed: false,
          summaryJson: {
            provider: 'elevenlabs',
            audioTopology: 'mixed_recording',
            sttRequestProfile: 'mixed-recording-elevenlabs-scribe-v2-v1',
            mediaPreparationVersion: 'recording-media-v1',
            speakerTracks: {
              uri: sourceUris[3],
              transcripts: [
                { speaker: 0, label: 'Teacher', uri: sourceUris[1] },
                { speaker: 1, label: 'Student', uri: sourceUris[2] },
              ],
              speakers: [{ speaker: 0 }, { speaker: 1 }],
            },
          },
          createdAt: new Date('2024-01-01T00:05:00.000Z'),
          updatedAt: new Date('2024-01-01T00:05:00.000Z'),
        },
      ]);
      vi.spyOn(transcriptionStorageModule, 'createTranscriptionStorageForUri').mockReturnValue({
        getText: vi.fn().mockImplementation(async (uri: string) => `copied:${uri}`),
      } as never);
      const createdUris: string[] = [];
      vi.spyOn(
        transcriptionStorageModule.FilesystemTranscriptionStorage.prototype,
        'putTranscript',
      ).mockImplementation(async ({ transcriptId }: { transcriptId: string }) => {
        const uri = `local://transcripts/${transcriptId}/content/copied.txt`;
        createdUris.push(uri);
        return { uri, bytes: 20, sha256: 'copied-hash' };
      });
      vi.spyOn(
        transcriptionStorageModule.FilesystemTranscriptionStorage.prototype,
        'putRawResponse',
      ).mockImplementation(async ({ transcriptId }: { transcriptId: string }) => {
        const uri = `local://transcripts/${transcriptId}.json`;
        createdUris.push(uri);
        return { uri, bytes: 20, sha256: 'metadata-hash' };
      });
      const deleteArtifact = vi
        .spyOn(transcriptionStorageModule.FilesystemTranscriptionStorage.prototype, 'delete')
        .mockResolvedValue(undefined);
      deleteArtifact.mockClear();
      const payloadBoundary = '----cache-clone-fault-boundary';
      const payload = Buffer.concat([
        Buffer.from(
          `--${payloadBoundary}\r\n` +
            'Content-Disposition: form-data; name="file"; filename="lesson.mp3"\r\n' +
            'Content-Type: audio/mpeg\r\n\r\n',
        ),
        Buffer.from('cache-clone-fault-audio'),
        Buffer.from(`\r\n--${payloadBoundary}--\r\n`),
      ]);
      const upload = () =>
        injectRecordingUpload({
          method: 'POST',
          url: `/recordings/upload?studentId=${studentId}`,
          headers: { 'content-type': `multipart/form-data; boundary=${payloadBoundary}` },
          payload,
        });
      return { createdUris, deleteArtifact, sourceUris, upload };
    }

    it('cache clone failure before COMMIT deletes only newly copied artifacts', async () => {
      const fault = arrangeCacheCloneFault();
      vi.mocked(recordingRepositoryModule.insertCachedRecordingLineage).mockRejectedValueOnce(
        new Error('insert failed before COMMIT'),
      );
      vi.spyOn(recordingRepositoryModule, 'getRecordingByIdForWorkspace').mockResolvedValueOnce(
        null,
      );
      vi.spyOn(
        transcriptRepositoryModule,
        'getTranscriptByRecordingIdForWorkspace',
      ).mockResolvedValueOnce(null);

      const response = await fault.upload();

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: 'internal_error' });
      expect(new Set(fault.deleteArtifact.mock.calls.map(([uri]: [string]) => uri))).toEqual(
        new Set(fault.createdUris),
      );
      for (const sourceUri of fault.sourceUris) {
        expect(fault.deleteArtifact).not.toHaveBeenCalledWith(sourceUri);
      }
    });

    it('cache clone recovers committed lineage when COMMIT acknowledgement is lost', async () => {
      const fault = arrangeCacheCloneFault();
      let attempted: {
        recording: InsertRecordingParams;
        transcript: InsertTranscriptParams;
      } | null = null;
      vi.mocked(recordingRepositoryModule.insertCachedRecordingLineage).mockImplementationOnce(
        async (params: {
          recording: InsertRecordingParams;
          transcript: InsertTranscriptParams;
        }) => {
          attempted = params;
          throw new Error('connection lost awaiting COMMIT acknowledgement');
        },
      );
      vi.spyOn(recordingRepositoryModule, 'getRecordingByIdForWorkspace').mockImplementationOnce(
        async (id: string, workspaceId: string) =>
          ({
            ...attempted!.recording,
            id,
            workspaceId,
            createdAt: new Date('2024-01-02T00:00:00.000Z'),
            updatedAt: new Date('2024-01-02T00:00:00.000Z'),
          }) as never,
      );
      vi.spyOn(
        transcriptRepositoryModule,
        'getTranscriptByRecordingIdForWorkspace',
      ).mockImplementationOnce(
        async () =>
          ({
            ...attempted!.transcript,
            createdAt: new Date('2024-01-02T00:00:00.000Z'),
            updatedAt: new Date('2024-01-02T00:00:00.000Z'),
          }) as never,
      );
      mockCanonicalUploadProjection(() => ({
        recordingId: attempted!.recording.id!,
        transcriptId: attempted!.transcript.id!,
      }));

      const response = await fault.upload();

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        cacheHit: true,
        recordingId: attempted!.recording.id,
      });
      expect(fault.createdUris).toHaveLength(4);
      expect(fault.deleteArtifact).not.toHaveBeenCalled();
    });

    it('cache clone ambiguous failure with no committed lineage cleans every clone artifact', async () => {
      const fault = arrangeCacheCloneFault();
      vi.mocked(recordingRepositoryModule.insertCachedRecordingLineage).mockRejectedValueOnce(
        new Error('ambiguous persistence failure'),
      );
      vi.spyOn(recordingRepositoryModule, 'getRecordingByIdForWorkspace').mockResolvedValueOnce(
        null,
      );
      vi.spyOn(
        transcriptRepositoryModule,
        'getTranscriptByRecordingIdForWorkspace',
      ).mockResolvedValueOnce(null);

      const response = await fault.upload();

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: 'internal_error' });
      expect(fault.deleteArtifact).toHaveBeenCalledTimes(4);
      expect(new Set(fault.deleteArtifact.mock.calls.map(([uri]: [string]) => uri))).toEqual(
        new Set(fault.createdUris),
      );
    });

    it('cache clone cleanup failure is logged and returned as a stable failure', async () => {
      const fault = arrangeCacheCloneFault();
      vi.mocked(recordingRepositoryModule.insertCachedRecordingLineage).mockRejectedValueOnce(
        new Error('ambiguous persistence failure'),
      );
      vi.spyOn(recordingRepositoryModule, 'getRecordingByIdForWorkspace').mockResolvedValueOnce(
        null,
      );
      vi.spyOn(
        transcriptRepositoryModule,
        'getTranscriptByRecordingIdForWorkspace',
      ).mockResolvedValueOnce(null);
      fault.deleteArtifact.mockRejectedValue(new Error('storage unavailable'));
      const logError = vi.mocked(loggerModule.logger.error);
      logError.mockClear();

      const response = await fault.upload();

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: 'internal_error' });
      expect(logError).toHaveBeenCalledWith(
        'Cache clone artifact cleanup failed',
        expect.objectContaining({
          event: 'recording_cache_clone_cleanup_failed',
          failures: expect.arrayContaining([expect.stringContaining('storage unavailable')]),
        }),
      );
      expect(fault.deleteArtifact).toHaveBeenCalledTimes(4);
    });

    it('POST /recordings/upload rejects a trusted ElevenLabs override before recording work starts', async () => {
      const insertRecording = vi.spyOn(recordingRepositoryModule, 'insertRecording');
      const listRecordingsBySha256 = vi.spyOn(
        recordingRepositoryModule,
        'listRecordingsBySha256ForWorkspace',
      );
      insertRecording.mockClear();
      listRecordingsBySha256.mockClear();

      const boundary = '----esl-route-validation-boundary';
      const payload = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\n` +
            'Content-Disposition: form-data; name="file"; filename="lesson.mp3"\r\n' +
            'Content-Type: audio/mpeg\r\n\r\n',
        ),
        Buffer.from('mock-audio-content'),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);

      const response = await injectRecordingUpload({
        method: 'POST',
        url: `/recordings/upload?studentId=${deriveStudentId('Anna')}&audioTopology=trusted_split_channels&sttProvider=elevenlabs`,
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: 'validation_failed',
        code: 'trusted_split_provider_incompatible',
        message:
          'Trusted split-channel recordings require the Deepgram multichannel route; elevenlabs cannot prove the declared channel contract.',
      });
      expect(listRecordingsBySha256).not.toHaveBeenCalled();
      expect(insertRecording).not.toHaveBeenCalled();
      listRecordingsBySha256.mockReset();
    });

    it('POST /recordings/upload requires an explicitly selected student before cache lookup', async () => {
      const listRecordingsBySha256 = vi.spyOn(
        recordingRepositoryModule,
        'listRecordingsBySha256ForWorkspace',
      );
      const listLatestTranscriptsByRecordingIds = vi.spyOn(
        transcriptRepositoryModule,
        'listLatestTranscriptsByRecordingIdsForWorkspace',
      );
      const insertRecording = vi.spyOn(recordingRepositoryModule, 'insertRecording');

      listRecordingsBySha256.mockResolvedValueOnce([
        {
          id: 'recording-cached',
          source: 'upload',
          studentId: deriveStudentId('Anna'),
          sourcePath: 'lesson.mp3',
          storageUri: 'memory://recordings/recording-cached.mp3',
          sha256: 'abc123',
          bytes: 1024,
          durationSec: 90,
          channels: 1,
          audioTopology: 'mixed_recording',
          status: 'transcribed',
          error: null,
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          updatedAt: new Date('2024-01-01T00:05:00.000Z'),
        },
      ]);
      listLatestTranscriptsByRecordingIds.mockResolvedValueOnce([
        {
          id: 'transcript-cached',
          recordingId: 'recording-cached',
          storageUri: 'memory://transcripts/transcript-cached.txt',
          workingVersion: 1,
          contentHash: 'cached-hash',
          rawResponseUri: null,
          mode: 'timeline',
          model: 'scribe_v2',
          language: 'auto',
          sttProvider: 'elevenlabs',
          fallbackUsed: false,
          summaryJson: {
            provider: 'elevenlabs',
            audioTopology: 'mixed_recording',
            sttRequestProfile: 'mixed-recording-elevenlabs-scribe-v2-v1',
            mediaPreparationVersion: 'recording-media-v1',
          },
          createdAt: new Date('2024-01-01T00:05:00.000Z'),
          updatedAt: new Date('2024-01-01T00:05:00.000Z'),
        },
      ]);
      insertRecording.mockClear();

      const boundary = '----esl-test-boundary';
      const payload = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\n` +
            'Content-Disposition: form-data; name="file"; filename="lesson.mp3"\r\n' +
            'Content-Type: audio/mpeg\r\n\r\n',
        ),
        Buffer.from('mock-audio-content'),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);

      const response = await injectRecordingUpload({
        method: 'POST',
        url: '/recordings/upload',
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: 'validation_failed',
        message: 'Select a student before uploading.',
        code: 'student_required',
      });
      expect(insertRecording).not.toHaveBeenCalled();
      listRecordingsBySha256.mockReset();
      listLatestTranscriptsByRecordingIds.mockReset();
    });

    it('POST /recordings/upload rejects prepared media before cache, storage, or recording creation', async () => {
      const media = await import('../src/infrastructure/recording-media.js');
      const prepare = vi.mocked(media.prepareRecordingMedia);
      const listRecordingsBySha256 = vi.spyOn(
        recordingRepositoryModule,
        'listRecordingsBySha256ForWorkspace',
      );
      const putAudio = vi.spyOn(
        transcriptionStorageModule.FilesystemTranscriptionStorage.prototype,
        'putAudio',
      );
      const insertRecording = vi.spyOn(recordingRepositoryModule, 'insertRecording');
      prepare.mockRejectedValueOnce(new media.RecordingMediaError('no_audio', 'No audio stream.'));
      const boundary = '----invalid-media-boundary';
      const payload = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="bad.mp4"\r\n\r\n`,
        ),
        Buffer.from('synthetic'),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);

      const response = await injectRecordingUpload({
        method: 'POST',
        url: `/recordings/upload?studentId=${deriveStudentId('Anna')}`,
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'validation_failed', code: 'no_audio' });
      expect(listRecordingsBySha256).not.toHaveBeenCalled();
      expect(putAudio).not.toHaveBeenCalled();
      expect(insertRecording).not.toHaveBeenCalled();
    });

    it('POST /recordings/upload rejects insufficient disk capacity before multipart media work', async () => {
      const media = await import('../src/infrastructure/recording-media.js');
      const admit = vi.mocked(media.ensureRecordingUploadCapacity);
      const prepare = vi.mocked(media.prepareRecordingMedia);
      const listRecordingsBySha256 = vi.spyOn(
        recordingRepositoryModule,
        'listRecordingsBySha256ForWorkspace',
      );
      const putAudio = vi.spyOn(
        transcriptionStorageModule.FilesystemTranscriptionStorage.prototype,
        'putAudio',
      );
      admit.mockRejectedValueOnce(
        new media.RecordingMediaError(
          'insufficient_upload_capacity',
          'The server does not currently have enough free upload capacity. Try again later.',
        ),
      );
      prepare.mockClear();
      const boundary = '----disk-capacity-boundary';
      const payload = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="lesson.mp3"\r\n\r\n`,
        ),
        Buffer.from('synthetic'),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);

      const response = await injectRecordingUpload({
        method: 'POST',
        url: `/recordings/upload?studentId=${deriveStudentId('Anna')}`,
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: 'validation_failed',
        code: 'insufficient_upload_capacity',
      });
      expect(prepare).not.toHaveBeenCalled();
      expect(listRecordingsBySha256).not.toHaveBeenCalled();
      expect(putAudio).not.toHaveBeenCalled();
    });

    it('POST /recordings/upload performs cache lookup before a cache-miss audio storage failure', async () => {
      const media = await import('../src/infrastructure/recording-media.js');
      const prepare = vi.mocked(media.prepareRecordingMedia);
      const listRecordingsBySha256 = vi
        .spyOn(recordingRepositoryModule, 'listRecordingsBySha256ForWorkspace')
        .mockResolvedValueOnce([]);
      const putAudio = vi
        .spyOn(transcriptionStorageModule.FilesystemTranscriptionStorage.prototype, 'putAudio')
        .mockRejectedValueOnce(new Error('storage unavailable'));
      const insertRecording = vi.spyOn(recordingRepositoryModule, 'insertRecording');
      const boundary = '----storage-failure-boundary';
      const payload = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="lesson.mp3"\r\n\r\n`,
        ),
        Buffer.from('synthetic'),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);

      const response = await injectRecordingUpload({
        method: 'POST',
        url: `/recordings/upload?studentId=${deriveStudentId('Anna')}`,
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
        payload,
      });

      expect(response.statusCode).toBe(500);
      expect(listRecordingsBySha256).toHaveBeenCalledBefore(putAudio);
      expect(insertRecording).not.toHaveBeenCalled();
      const preparedSourcePath = prepare.mock.calls.at(-1)?.[0].sourcePath;
      expect(preparedSourcePath).toEqual(expect.any(String));
      await expect(
        import('node:fs/promises').then((fs) => fs.stat(preparedSourcePath!)),
      ).rejects.toMatchObject({
        code: 'ENOENT',
      });
    });

    it("POST /recordings/upload clones cached artifacts instead of transferring another student's recording", async () => {
      const cachedStudentId = deriveStudentId('Anna');
      const requestedStudentId = deriveStudentId('Bella');
      const listRecordingsBySha256 = vi.spyOn(
        recordingRepositoryModule,
        'listRecordingsBySha256ForWorkspace',
      );
      const listLatestTranscriptsByRecordingIds = vi.spyOn(
        transcriptRepositoryModule,
        'listLatestTranscriptsByRecordingIdsForWorkspace',
      );
      const insertRecording = vi.spyOn(recordingRepositoryModule, 'insertRecording');
      const insertTranscript = vi.spyOn(transcriptRepositoryModule, 'insertTranscript');
      const createReadStorage = vi
        .spyOn(transcriptionStorageModule, 'createTranscriptionStorageForUri')
        .mockReturnValue({
          getText: vi.fn().mockImplementation(async (uri: string) => `copied:${uri}`),
        } as never);
      const putClonedTranscript = vi
        .spyOn(transcriptionStorageModule.FilesystemTranscriptionStorage.prototype, 'putTranscript')
        .mockImplementation(async ({ transcriptId }: { transcriptId: string }) => ({
          uri: `local://transcripts/${transcriptId}/content/new.txt`,
          bytes: 22,
          sha256: 'new-hash',
        }));
      const putClonedTrackMetadata = vi
        .spyOn(
          transcriptionStorageModule.FilesystemTranscriptionStorage.prototype,
          'putRawResponse',
        )
        .mockImplementation(async ({ transcriptId }: { transcriptId: string }) => ({
          uri: `local://transcripts/${transcriptId}.json`,
          bytes: 22,
          sha256: 'track-hash',
        }));

      listRecordingsBySha256.mockResolvedValueOnce([
        {
          id: 'recording-anna',
          source: 'upload',
          studentId: cachedStudentId,
          sourcePath: 'anna-lesson.mp3',
          storageUri: null,
          audioLifecycle: 'not_retained',
          sha256: 'abc123',
          bytes: 1024,
          durationSec: 90,
          channels: 1,
          audioTopology: 'mixed_recording',
          status: 'transcribed',
          error: null,
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          updatedAt: new Date('2024-01-01T00:05:00.000Z'),
        },
      ]);
      listLatestTranscriptsByRecordingIds.mockResolvedValueOnce([
        {
          id: 'transcript-anna',
          recordingId: 'recording-anna',
          storageUri: 'memory://transcripts/transcript-anna.txt',
          workingVersion: 1,
          contentHash: 'anna-hash',
          rawResponseUri: 'memory://transcripts/transcript-anna.raw.json',
          mode: 'timeline',
          model: 'scribe_v2',
          language: 'auto',
          sttProvider: 'elevenlabs',
          fallbackUsed: false,
          summaryJson: {
            provider: 'elevenlabs',
            audioTopology: 'mixed_recording',
            sttRequestProfile: 'mixed-recording-elevenlabs-scribe-v2-v1',
            mediaPreparationVersion: 'recording-media-v1',
            speakerTracks: {
              uri: 'memory://transcripts/transcript-anna-speaker-tracks.json',
              transcripts: [
                { speaker: 0, label: 'Teacher', uri: 'memory://transcripts/anna-teacher.txt' },
                { speaker: 1, label: 'Student', uri: 'memory://transcripts/anna-student.txt' },
              ],
              speakers: [{ speaker: 0 }, { speaker: 1 }],
            },
          },
          createdAt: new Date('2024-01-01T00:05:00.000Z'),
          updatedAt: new Date('2024-01-01T00:05:00.000Z'),
        },
      ]);
      insertRecording.mockResolvedValueOnce({
        id: 'recording-bella',
        source: 'upload',
        studentId: requestedStudentId,
        sourcePath: 'bella-lesson.mp3',
        storageUri: null,
        audioLifecycle: 'not_retained',
        sha256: 'abc123',
        bytes: 1024,
        durationSec: 90,
        channels: 1,
        audioTopology: 'mixed_recording',
        status: 'transcribed',
        error: null,
        createdAt: new Date('2024-01-02T00:00:00.000Z'),
        updatedAt: new Date('2024-01-02T00:00:00.000Z'),
      });
      insertTranscript.mockResolvedValueOnce({
        id: 'transcript-bella',
        recordingId: 'recording-bella',
        storageUri: 'local://transcripts/transcript-bella/content/new.txt',
        workingVersion: 1,
        contentHash: 'new-hash',
        rawResponseUri: null,
        mode: 'timeline',
        model: 'scribe_v2',
        language: 'auto',
        sttProvider: 'elevenlabs',
        fallbackUsed: false,
        summaryJson: {
          provider: 'elevenlabs',
          audioTopology: 'mixed_recording',
          sttRequestProfile: 'mixed-recording-elevenlabs-scribe-v2-v1',
          mediaPreparationVersion: 'recording-media-v1',
        },
        createdAt: new Date('2024-01-02T00:00:00.000Z'),
        updatedAt: new Date('2024-01-02T00:00:00.000Z'),
      });
      mockCanonicalUploadProjection(() => ({
        recordingId: 'recording-bella',
        transcriptId: 'transcript-bella',
      }));

      const boundary = '----esl-test-boundary';
      const payload = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\n` +
            'Content-Disposition: form-data; name="file"; filename="bella-lesson.mp3"\r\n' +
            'Content-Type: audio/mpeg\r\n\r\n',
        ),
        Buffer.from('mock-audio-content'),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);

      const response = await injectRecordingUpload({
        method: 'POST',
        url: `/recordings/upload?studentId=${requestedStudentId}`,
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload,
      });
      createReadStorage.mockRestore();
      putClonedTranscript.mockRestore();
      putClonedTrackMetadata.mockRestore();

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        recordingId: 'recording-bella',
        transcriptId: 'transcript-bella',
        cacheHit: true,
        cacheReason: 'transcript_reused',
        cacheRecordingId: 'recording-anna',
      });
      expect(insertRecording).toHaveBeenCalledWith(
        expect.objectContaining({
          studentId: requestedStudentId,
          storageUri: null,
          audioLifecycle: 'not_retained',
          status: 'transcribed',
        }),
      );
      const insertedTranscript = insertTranscript.mock.calls[0]?.[0];
      expect(insertedTranscript).toEqual(
        expect.objectContaining({
          workingVersion: 1,
          contentHash: expect.any(String),
        }),
      );
      expect(insertedTranscript?.storageUri).not.toBe('memory://transcripts/transcript-anna.txt');
      expect(insertedTranscript?.recordingId).not.toBe('recording-anna');
      expect(JSON.stringify(insertedTranscript?.summaryJson)).not.toContain('transcript-anna');
      expect(JSON.stringify(insertedTranscript?.summaryJson)).not.toContain('anna-student');
      expect(insertedTranscript?.summaryJson).toMatchObject({
        speakerTracks: {
          transcripts: [
            { speaker: 0, uri: expect.stringContaining('-speaker-0') },
            { speaker: 1, uri: expect.stringContaining('-speaker-1') },
          ],
        },
      });
    });

    it('POST /recordings/upload matches cached transcript by effective provider when query omits sttProvider', async () => {
      const media = await import('../src/infrastructure/recording-media.js');
      const prepare = vi.mocked(media.prepareRecordingMedia);
      const listRecordingsBySha256 = vi.spyOn(
        recordingRepositoryModule,
        'listRecordingsBySha256ForWorkspace',
      );
      const listLatestTranscriptsByRecordingIds = vi.spyOn(
        transcriptRepositoryModule,
        'listLatestTranscriptsByRecordingIdsForWorkspace',
      );
      const insertRecording = vi.spyOn(recordingRepositoryModule, 'insertRecording');
      const insertTranscript = vi.spyOn(transcriptRepositoryModule, 'insertTranscript');
      const putAudio = vi.spyOn(
        transcriptionStorageModule.FilesystemTranscriptionStorage.prototype,
        'putAudio',
      );
      putAudio.mockClear();
      vi.spyOn(transcriptionStorageModule, 'createTranscriptionStorageForUri').mockReturnValueOnce({
        getText: vi.fn().mockResolvedValue('cached transcript'),
      } as never);
      vi.spyOn(
        transcriptionStorageModule.FilesystemTranscriptionStorage.prototype,
        'putTranscript',
      ).mockResolvedValueOnce({
        uri: 'local://transcripts/new.txt',
        bytes: 17,
        sha256: 'new-hash',
      });

      listRecordingsBySha256.mockResolvedValueOnce([
        {
          id: 'recording-elevenlabs',
          source: 'upload',
          studentId: deriveStudentId('Anna'),
          sourcePath: 'lesson.mp3',
          storageUri: 'memory://recordings/recording-elevenlabs.mp3',
          sha256: 'abc123',
          bytes: 1024,
          durationSec: 90,
          channels: 1,
          audioTopology: 'mixed_recording',
          status: 'transcribed',
          error: null,
          createdAt: new Date('2024-01-02T00:00:00.000Z'),
          updatedAt: new Date('2024-01-02T00:05:00.000Z'),
        },
        {
          id: 'recording-deepgram',
          source: 'upload',
          studentId: deriveStudentId('Anna'),
          sourcePath: 'lesson.mp3',
          storageUri: 'memory://recordings/recording-deepgram.mp3',
          sha256: 'abc123',
          bytes: 1024,
          durationSec: 90,
          channels: 1,
          audioTopology: 'mixed_recording',
          status: 'transcribed',
          error: null,
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          updatedAt: new Date('2024-01-01T00:05:00.000Z'),
        },
      ]);
      listLatestTranscriptsByRecordingIds.mockResolvedValueOnce([
        {
          id: 'transcript-elevenlabs',
          recordingId: 'recording-elevenlabs',
          storageUri: 'memory://transcripts/transcript-elevenlabs.txt',
          workingVersion: 1,
          contentHash: 'elevenlabs-hash',
          rawResponseUri: null,
          mode: 'timeline',
          model: 'scribe_v2',
          language: 'auto',
          sttProvider: 'elevenlabs',
          fallbackUsed: false,
          summaryJson: {
            provider: 'elevenlabs',
            audioTopology: 'mixed_recording',
            sttRequestProfile: 'mixed-recording-elevenlabs-scribe-v2-v1',
            mediaPreparationVersion: 'recording-media-v1',
          },
          createdAt: new Date('2024-01-02T00:05:00.000Z'),
          updatedAt: new Date('2024-01-02T00:05:00.000Z'),
        },
        {
          id: 'transcript-deepgram',
          recordingId: 'recording-deepgram',
          storageUri: 'memory://transcripts/transcript-deepgram.txt',
          workingVersion: 1,
          contentHash: 'deepgram-hash',
          rawResponseUri: null,
          mode: 'timeline',
          model: 'nova-3',
          language: 'multi',
          sttProvider: 'deepgram',
          fallbackUsed: false,
          summaryJson: {
            provider: 'deepgram',
            audioTopology: 'mixed_recording',
            sttRequestProfile: 'support-override-mixed_recording-deepgram-v1',
            mediaPreparationVersion: 'recording-media-v1',
          },
          createdAt: new Date('2024-01-01T00:05:00.000Z'),
          updatedAt: new Date('2024-01-01T00:05:00.000Z'),
        },
      ]);
      insertRecording.mockClear();
      insertRecording.mockResolvedValueOnce({
        ...listRecordingsBySha256.mock.results[0]?.value,
        id: 'recording-reused',
        source: 'upload',
        studentId: deriveStudentId('Anna'),
        sourcePath: 'lesson.mp3',
        storageUri: null,
        bytes: 1024,
        audioTopology: 'mixed_recording',
        audioLifecycle: 'not_retained',
        status: 'transcribed',
        createdAt: new Date('2024-01-03T00:00:00.000Z'),
        updatedAt: new Date('2024-01-03T00:00:00.000Z'),
      } as never);
      insertTranscript.mockResolvedValueOnce({
        id: 'transcript-reused',
        recordingId: 'recording-reused',
        storageUri: 'local://transcripts/new.txt',
        workingVersion: 1,
        contentHash: 'new-hash',
        rawResponseUri: null,
        mode: 'timeline',
        model: 'scribe_v2',
        language: 'auto',
        sttProvider: 'elevenlabs',
        fallbackUsed: false,
        summaryJson: null,
        createdAt: new Date('2024-01-03T00:00:00.000Z'),
        updatedAt: new Date('2024-01-03T00:00:00.000Z'),
      });
      mockCanonicalUploadProjection(() => ({
        recordingId: 'recording-reused',
        transcriptId: 'transcript-reused',
      }));

      const boundary = '----esl-test-boundary-2';
      const payload = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\n` +
            'Content-Disposition: form-data; name="file"; filename="lesson.mp3"\r\n' +
            'Content-Type: audio/mpeg\r\n\r\n',
        ),
        Buffer.from('mock-audio-content'),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);

      const response = await injectRecordingUpload({
        method: 'POST',
        url: `/recordings/upload?studentId=${deriveStudentId('Anna')}`,
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      // Ordinary mixed recordings now default to ElevenLabs, so its transcript should be selected.
      expect(response.json()).toMatchObject({
        recordingId: 'recording-reused',
        transcriptId: 'transcript-reused',
        cacheHit: true,
        cacheReason: 'transcript_reused',
        cacheRecordingId: 'recording-elevenlabs',
      });
      expect(insertRecording).toHaveBeenCalledWith(
        expect.objectContaining({
          storageUri: null,
          audioLifecycle: 'not_retained',
          mediaPreparationVersion: 'recording-media-v1',
        }),
      );
      expect(putAudio).not.toHaveBeenCalled();
      const preparedSourcePath = prepare.mock.calls.at(-1)?.[0].sourcePath;
      expect(preparedSourcePath).toEqual(expect.any(String));
      await expect(
        import('node:fs/promises').then((fs) => fs.stat(preparedSourcePath!)),
      ).rejects.toMatchObject({
        code: 'ENOENT',
      });
    });

    it('POST /recordings/upload honors explicit sttProvider against mixed cached transcripts', async () => {
      const listRecordingsBySha256 = vi.spyOn(
        recordingRepositoryModule,
        'listRecordingsBySha256ForWorkspace',
      );
      const listLatestTranscriptsByRecordingIds = vi.spyOn(
        transcriptRepositoryModule,
        'listLatestTranscriptsByRecordingIdsForWorkspace',
      );
      const insertRecording = vi.spyOn(recordingRepositoryModule, 'insertRecording');
      const insertTranscript = vi.spyOn(transcriptRepositoryModule, 'insertTranscript');
      vi.spyOn(transcriptionStorageModule, 'createTranscriptionStorageForUri').mockReturnValueOnce({
        getText: vi.fn().mockResolvedValue('cached transcript'),
      } as never);
      vi.spyOn(
        transcriptionStorageModule.FilesystemTranscriptionStorage.prototype,
        'putTranscript',
      ).mockResolvedValueOnce({
        uri: 'local://transcripts/new-2.txt',
        bytes: 17,
        sha256: 'new-hash-2',
      });

      listRecordingsBySha256.mockResolvedValueOnce([
        {
          id: 'recording-deepgram',
          source: 'upload',
          studentId: deriveStudentId('Anna'),
          sourcePath: 'lesson.mp3',
          storageUri: 'memory://recordings/recording-deepgram.mp3',
          sha256: 'abc123',
          bytes: 1024,
          durationSec: 90,
          channels: 1,
          audioTopology: 'mixed_recording',
          status: 'transcribed',
          error: null,
          createdAt: new Date('2024-01-02T00:00:00.000Z'),
          updatedAt: new Date('2024-01-02T00:05:00.000Z'),
        },
        {
          id: 'recording-elevenlabs',
          source: 'upload',
          studentId: deriveStudentId('Anna'),
          sourcePath: 'lesson.mp3',
          storageUri: 'memory://recordings/recording-elevenlabs.mp3',
          sha256: 'abc123',
          bytes: 1024,
          durationSec: 90,
          channels: 1,
          audioTopology: 'mixed_recording',
          status: 'transcribed',
          error: null,
          createdAt: new Date('2024-01-01T00:00:00.000Z'),
          updatedAt: new Date('2024-01-01T00:05:00.000Z'),
        },
      ]);
      listLatestTranscriptsByRecordingIds.mockResolvedValueOnce([
        {
          id: 'transcript-deepgram',
          recordingId: 'recording-deepgram',
          storageUri: 'memory://transcripts/transcript-deepgram.txt',
          workingVersion: 1,
          contentHash: 'deepgram-hash',
          rawResponseUri: null,
          mode: 'timeline',
          model: 'nova-3',
          language: 'multi',
          sttProvider: 'deepgram',
          fallbackUsed: false,
          summaryJson: {
            provider: 'deepgram',
            audioTopology: 'mixed_recording',
            sttRequestProfile: 'support-override-mixed_recording-deepgram-v1',
            mediaPreparationVersion: 'recording-media-v1',
          },
          createdAt: new Date('2024-01-02T00:05:00.000Z'),
          updatedAt: new Date('2024-01-02T00:05:00.000Z'),
        },
        {
          id: 'transcript-elevenlabs',
          recordingId: 'recording-elevenlabs',
          storageUri: 'memory://transcripts/transcript-elevenlabs.txt',
          workingVersion: 1,
          contentHash: 'elevenlabs-hash',
          rawResponseUri: null,
          mode: 'timeline',
          model: 'scribe_v2',
          language: 'auto',
          sttProvider: 'elevenlabs',
          fallbackUsed: false,
          summaryJson: {
            provider: 'elevenlabs',
            audioTopology: 'mixed_recording',
            sttRequestProfile: 'mixed-recording-elevenlabs-scribe-v2-v1',
            mediaPreparationVersion: 'recording-media-v1',
          },
          createdAt: new Date('2024-01-01T00:05:00.000Z'),
          updatedAt: new Date('2024-01-01T00:05:00.000Z'),
        },
      ]);
      insertRecording.mockClear();
      insertRecording.mockResolvedValueOnce({
        id: 'recording-reused-2',
        source: 'upload',
        studentId: deriveStudentId('Anna'),
        sourcePath: 'lesson.mp3',
        storageUri: null,
        sha256: 'abc123',
        bytes: 1024,
        durationSec: 90,
        channels: 1,
        audioTopology: 'mixed_recording',
        audioLifecycle: 'not_retained',
        status: 'transcribed',
        error: null,
        createdAt: new Date('2024-01-03T00:00:00.000Z'),
        updatedAt: new Date('2024-01-03T00:00:00.000Z'),
      });
      insertTranscript.mockResolvedValueOnce({
        id: 'transcript-reused-2',
        recordingId: 'recording-reused-2',
        storageUri: 'local://transcripts/new-2.txt',
        workingVersion: 1,
        contentHash: 'new-hash-2',
        rawResponseUri: null,
        mode: 'timeline',
        model: 'scribe_v2',
        language: 'auto',
        sttProvider: 'elevenlabs',
        fallbackUsed: false,
        summaryJson: null,
        createdAt: new Date('2024-01-03T00:00:00.000Z'),
        updatedAt: new Date('2024-01-03T00:00:00.000Z'),
      });
      mockCanonicalUploadProjection(() => ({
        recordingId: 'recording-reused-2',
        transcriptId: 'transcript-reused-2',
      }));

      const boundary = '----esl-test-boundary-3';
      const payload = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\n` +
            'Content-Disposition: form-data; name="file"; filename="lesson.mp3"\r\n' +
            'Content-Type: audio/mpeg\r\n\r\n',
        ),
        Buffer.from('mock-audio-content'),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);

      const response = await injectRecordingUpload({
        method: 'POST',
        url: `/recordings/upload?studentId=${deriveStudentId('Anna')}&sttProvider=elevenlabs`,
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        recordingId: 'recording-reused-2',
        transcriptId: 'transcript-reused-2',
        cacheHit: true,
        cacheReason: 'transcript_reused',
        cacheRecordingId: 'recording-elevenlabs',
      });
      expect(insertRecording).toHaveBeenCalledWith(
        expect.objectContaining({ storageUri: null, audioLifecycle: 'not_retained' }),
      );
    });

    it('GET /recordings returns paginated recording list', async () => {
      const listRecordings = vi.spyOn(listRecordingsModule, 'listRecordingsWithDefaults');
      listRecordings.mockClear();
      listRecordings.mockResolvedValue({
        items: [
          {
            recordingId: 'recording-1',
            status: 'transcribed',
            transcriptId: 'transcript-1',
            error: null,
            source: 'upload',
            studentId: null,
            displayName: 'recording-1.opus',
            durationSec: 120,
            channels: 2,
            bytes: 2048,
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:10:00.000Z',
          },
        ],
        limit: 10,
        offset: 5,
        total: 42,
        order: 'asc',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/recordings?status=transcribed&limit=10&offset=5&order=asc',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        items: [
          {
            recordingId: 'recording-1',
            status: 'transcribed',
            transcriptId: 'transcript-1',
            error: null,
            source: 'upload',
            studentId: null,
            displayName: 'recording-1.opus',
            durationSec: 120,
            channels: 2,
            bytes: 2048,
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:10:00.000Z',
          },
        ],
        limit: 10,
        offset: 5,
        total: 42,
        order: 'asc',
      });
      expect(listRecordings).toHaveBeenCalledWith({
        workspaceId: '00000000-0000-4000-8000-000000000001',
        statuses: ['transcribed'],
        sources: null,
        search: null,
        studentId: null,
        limit: 10,
        offset: 5,
        order: 'asc',
      });
    });

    it('GET /recordings maps student filter to studentId', async () => {
      const listRecordings = vi.spyOn(listRecordingsModule, 'listRecordingsWithDefaults');
      listRecordings.mockResolvedValue({
        items: [],
        limit: 50,
        offset: 0,
        total: 0,
        order: 'desc',
      });

      const response = await app.inject({
        method: 'GET',
        url: `/recordings?studentId=${deriveStudentId('Anna')}`,
      });

      expect(response.statusCode).toBe(200);
      expect(listRecordings).toHaveBeenCalledWith(
        expect.objectContaining({
          studentId: deriveStudentId('Anna'),
        }),
      );
    });

    it('GET /recordings maps source and query filters', async () => {
      const listRecordings = vi.spyOn(listRecordingsModule, 'listRecordingsWithDefaults');
      listRecordings.mockResolvedValue({
        items: [],
        limit: 50,
        offset: 0,
        total: 0,
        order: 'desc',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/recordings?source=upload&q=lesson',
      });

      expect(response.statusCode).toBe(200);
      expect(listRecordings).toHaveBeenCalledWith(
        expect.objectContaining({
          sources: ['upload'],
          search: 'lesson',
        }),
      );
    });

    it('GET /recordings/:id returns recording payload', async () => {
      const getRecording = vi.spyOn(getRecordingModule, 'getRecording');
      getRecording.mockClear();
      getRecording.mockResolvedValue({
        recordingId: 'recording-1',
        status: 'queued',
        transcriptId: null,
        error: null,
        source: 'upload',
        studentId: null,
        displayName: 'recording-1.opus',
        durationSec: null,
        channels: null,
        bytes: 1234,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:05:00.000Z',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/recordings/recording-1',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        recordingId: 'recording-1',
        status: 'queued',
        transcriptId: null,
        error: null,
        source: 'upload',
        studentId: null,
        displayName: 'recording-1.opus',
        durationSec: null,
        channels: null,
        bytes: 1234,
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:05:00.000Z',
      });
      expect(getRecording).toHaveBeenCalledWith(
        'recording-1',
        '00000000-0000-4000-8000-000000000001',
      );
    });

    it('GET /recordings/:id returns 404 when missing', async () => {
      const getRecording = vi.spyOn(getRecordingModule, 'getRecording');
      getRecording.mockClear();
      getRecording.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/recordings/missing',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'not_found' });
    });

    it('POST /recordings/:id/transcribe rejects terminal normal-user retry', async () => {
      const retryRecording = vi.spyOn(retryRecordingModule, 'retryRecordingTranscription');
      const getRecordingById = vi.spyOn(recordingRepositoryModule, 'getRecordingByIdForWorkspace');
      getRecordingById.mockResolvedValue({
        id: 'recording-1',
        workspaceId: '00000000-0000-4000-8000-000000000001',
        source: 'upload',
        studentId: null,
        sourcePath: 'recording-1.opus',
        storageUri: 'memory://recordings/recording-1.opus',
        sha256: 'recording-sha',
        audioLifecycle: 'retained',
        durationSec: null,
        channels: null,
        audioTopology: 'mixed_recording',
        mediaPreparationVersion: 'recording-media-v1',
        bytes: 1234,
        status: 'failed',
        error: 'previous failure',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:05:00.000Z'),
      });

      try {
        const response = await app.inject({
          method: 'POST',
          url: '/recordings/recording-1/transcribe',
        });

        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({
          error: 'validation_failed',
          code: 'recording_retry_not_supported',
          message:
            'Automatic transcription recovery is platform-managed; upload the recording again after terminal failure.',
        });
        expect(retryRecording).toHaveBeenCalledWith(
          'recording-1',
          expect.objectContaining({
            workspaceId: '00000000-0000-4000-8000-000000000001',
            sttProvider: undefined,
          }),
          expect.objectContaining({ enqueue: expect.any(Function) }),
        );
      } finally {
        retryRecording.mockRestore();
        getRecordingById.mockRestore();
      }
    });

    it('POST /recordings/:id/transcribe does not let a provider override restore normal-user retry', async () => {
      const retryRecording = vi.spyOn(retryRecordingModule, 'retryRecordingTranscription');
      const getRecordingById = vi.spyOn(recordingRepositoryModule, 'getRecordingByIdForWorkspace');
      getRecordingById.mockResolvedValue({
        id: 'recording-1',
        workspaceId: '00000000-0000-4000-8000-000000000001',
        source: 'upload',
        studentId: null,
        sourcePath: 'recording-1.opus',
        storageUri: 'memory://recordings/recording-1.opus',
        sha256: 'recording-sha',
        audioLifecycle: 'retained',
        durationSec: null,
        channels: null,
        audioTopology: 'mixed_recording',
        mediaPreparationVersion: 'recording-media-v1',
        bytes: 1234,
        status: 'failed',
        error: 'previous failure',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:05:00.000Z'),
      });

      try {
        const response = await app.inject({
          method: 'POST',
          url: '/recordings/recording-1/transcribe',
          payload: { sttProvider: 'elevenlabs' },
        });

        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({
          error: 'validation_failed',
          code: 'recording_retry_not_supported',
          message:
            'Automatic transcription recovery is platform-managed; upload the recording again after terminal failure.',
        });
        expect(retryRecording).toHaveBeenCalledWith(
          'recording-1',
          expect.objectContaining({
            workspaceId: '00000000-0000-4000-8000-000000000001',
            sttProvider: 'elevenlabs',
          }),
          expect.objectContaining({ enqueue: expect.any(Function) }),
        );
      } finally {
        retryRecording.mockRestore();
        getRecordingById.mockRestore();
      }
    });

    it('POST /recordings/:id/transcribe rejects an incompatible trusted provider before retry work starts', async () => {
      const retryRecording = vi.spyOn(retryRecordingModule, 'retryRecordingTranscription');
      const getRecordingById = vi.spyOn(recordingRepositoryModule, 'getRecordingByIdForWorkspace');
      getRecordingById.mockResolvedValueOnce({
        id: 'recording-trusted',
        workspaceId: '00000000-0000-4000-8000-000000000001',
        source: 'upload',
        studentId: null,
        sourcePath: 'trusted.wav',
        storageUri: 'memory://recordings/recording-trusted.wav',
        audioLifecycle: 'retained',
        sha256: 'trusted-sha',
        bytes: 1024,
        durationSec: 60,
        channels: 2,
        audioTopology: 'trusted_split_channels',
        mediaPreparationVersion: 'recording-media-v1',
        status: 'failed',
        error: 'previous failure',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      });

      try {
        const response = await app.inject({
          method: 'POST',
          url: '/recordings/recording-trusted/transcribe',
          payload: { sttProvider: 'elevenlabs' },
        });

        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({
          error: 'validation_failed',
          code: 'trusted_split_provider_incompatible',
          message:
            'Trusted split-channel recordings require the Deepgram multichannel route; elevenlabs cannot prove the declared channel contract.',
        });
        expect(retryRecording).not.toHaveBeenCalled();
      } finally {
        retryRecording.mockRestore();
        getRecordingById.mockRestore();
      }
    });

    it('GET /recordings/:id/transcript returns transcript payload', async () => {
      const getRecordingTranscript = vi.spyOn(
        getRecordingTranscriptModule,
        'getRecordingTranscript',
      );
      getRecordingTranscript.mockClear();
      getRecordingTranscript.mockResolvedValue({
        recordingId: 'recording-1',
        transcriptId: 'transcript-1',
        text: 'Hello transcript',
        workingVersion: 1,
        contentHash: 'transcript-hash',
        summaryJson: { channels: 2 },
        sttProvider: 'deepgram',
        model: 'nova-3',
        language: 'en',
        mode: 'timeline',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:10:00.000Z',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/recordings/recording-1/transcript',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        recordingId: 'recording-1',
        transcriptId: 'transcript-1',
        text: 'Hello transcript',
        workingVersion: 1,
        contentHash: 'transcript-hash',
        summaryJson: { channels: 2 },
        sttProvider: 'deepgram',
        model: 'nova-3',
        language: 'en',
        mode: 'timeline',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:10:00.000Z',
      });
      expect(getRecordingTranscript).toHaveBeenCalledWith(
        'recording-1',
        '00000000-0000-4000-8000-000000000001',
      );
    });

    it('GET /recordings/:id/transcript returns 404 when missing', async () => {
      const getRecordingTranscript = vi.spyOn(
        getRecordingTranscriptModule,
        'getRecordingTranscript',
      );
      getRecordingTranscript.mockClear();
      getRecordingTranscript.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/recordings/missing/transcript',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'not_found' });
    });

    it('PUT /recordings/:id/transcript updates transcript text', async () => {
      const updateRecordingTranscript = vi.spyOn(
        updateRecordingTranscriptModule,
        'updateRecordingTranscript',
      );
      updateRecordingTranscript.mockClear();
      updateRecordingTranscript.mockResolvedValue({
        recordingId: 'recording-1',
        transcriptId: 'transcript-1',
        text: 'Updated text',
        workingVersion: 2,
        contentHash: 'updated-hash',
        summaryJson: null,
        sttProvider: 'deepgram',
        model: 'nova-3',
        language: 'en',
        mode: 'timeline',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:20:00.000Z',
      });

      const response = await app.inject({
        method: 'PUT',
        url: '/recordings/recording-1/transcript',
        payload: { text: 'Updated text', expectedWorkingVersion: 1 },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        recordingId: 'recording-1',
        transcriptId: 'transcript-1',
        text: 'Updated text',
        workingVersion: 2,
        contentHash: 'updated-hash',
        summaryJson: null,
        sttProvider: 'deepgram',
        model: 'nova-3',
        language: 'en',
        mode: 'timeline',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:20:00.000Z',
      });
      expect(updateRecordingTranscript).toHaveBeenCalledWith({
        recordingId: 'recording-1',
        workspaceId: '00000000-0000-4000-8000-000000000001',
        text: 'Updated text',
        expectedWorkingVersion: 1,
        speakerRoleMapping: undefined,
      });
    });

    it('PUT /recordings/:id/transcript returns the winning tuple on a stale write', async () => {
      const updateRecordingTranscript = vi.spyOn(
        updateRecordingTranscriptModule,
        'updateRecordingTranscript',
      );
      updateRecordingTranscript.mockRejectedValue({
        code: 'ARTIFACT_WORKING_CONFLICT',
        latest: { workingVersion: 3, contentHash: 'winner-hash' },
      });

      const response = await app.inject({
        method: 'PUT',
        url: '/recordings/recording-1/transcript',
        payload: { text: 'Stale text', expectedWorkingVersion: 1 },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({
        code: 'artifact_working_conflict',
        artifact: { workingVersion: 3, contentHash: 'winner-hash' },
      });
    });

    it('rejects revisionless transcript and draft autosaves', async () => {
      const transcriptResponse = await app.inject({
        method: 'PUT',
        url: '/recordings/recording-1/transcript',
        payload: { text: 'Revisionless transcript' },
      });
      const draftResponse = await app.inject({
        method: 'PUT',
        url: '/drafts/draft-1',
        payload: { text: 'Revisionless draft' },
      });

      expect(transcriptResponse.statusCode).toBe(400);
      expect(draftResponse.statusCode).toBe(400);
    });

    it('PUT /recordings/:id/transcript returns 404 when missing', async () => {
      const updateRecordingTranscript = vi.spyOn(
        updateRecordingTranscriptModule,
        'updateRecordingTranscript',
      );
      updateRecordingTranscript.mockClear();
      updateRecordingTranscript.mockResolvedValue(null);

      const response = await app.inject({
        method: 'PUT',
        url: '/recordings/missing/transcript',
        payload: { text: 'Updated text', expectedWorkingVersion: 1 },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'not_found' });
    });

    it('POST /recordings/:id/prompt-package returns assembled payload', async () => {
      const createPromptPackage = vi.spyOn(createPromptPackageModule, 'createPromptPackage');
      createPromptPackage.mockClear();
      createPromptPackage.mockResolvedValue({
        id: 'prompt-1',
        recordingId: 'recording-1',
        transcriptId: 'transcript-1',
        studentId: null,
        profilePath: '/profiles/p1.md',
        templateVersion: '/templates/t1.md',
        notes: 'Some notes',
        storageUri: 'local://prompt-packages/prompt-1.txt',
        text: 'PROMPT TEXT',
        memory: {
          studentMemorySnapshotId: null,
          studentMemorySnapshotHash: null,
          selectedLessonMemoryIds: [],
          selectedHomeworkMemoryIds: [],
          retrievalPolicyVersion: null,
          layerAvailability: {
            studentMemorySnapshot: 'not_applicable',
            recentLessonMemory: 'not_applicable',
            recentHomeworkMemory: 'not_applicable',
            retrievalPolicy: 'not_applicable',
          },
        },
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:10:00.000Z',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/recordings/recording-1/prompt-package',
        payload: {
          assignmentSessionId: '11111111-1111-4111-8111-111111111111',
          templateId: '/templates/t1.md',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        id: 'prompt-1',
        recordingId: 'recording-1',
        transcriptId: 'transcript-1',
        studentId: null,
        profilePath: '/profiles/p1.md',
        templateVersion: '/templates/t1.md',
        notes: 'Some notes',
        storageUri: 'local://prompt-packages/prompt-1.txt',
        text: 'PROMPT TEXT',
        memory: {
          studentMemorySnapshotId: null,
          studentMemorySnapshotHash: null,
          selectedLessonMemoryIds: [],
          selectedHomeworkMemoryIds: [],
          retrievalPolicyVersion: null,
          layerAvailability: {
            studentMemorySnapshot: 'not_applicable',
            recentLessonMemory: 'not_applicable',
            recentHomeworkMemory: 'not_applicable',
            retrievalPolicy: 'not_applicable',
          },
        },
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:10:00.000Z',
      });
      expect(createPromptPackage).toHaveBeenCalledWith(
        expect.objectContaining({
          recordingId: 'recording-1',
          workspaceId: '00000000-0000-4000-8000-000000000001',
          assignmentSessionId: '11111111-1111-4111-8111-111111111111',
          userId: 'test-user-id',
          templateId: '/templates/t1.md',
        }),
      );
    });

    it('POST /recordings/:id/prompt-package returns 404 when transcript missing', async () => {
      const createPromptPackage = vi.spyOn(createPromptPackageModule, 'createPromptPackage');
      createPromptPackage.mockClear();
      createPromptPackage.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/recordings/missing/prompt-package',
        payload: { assignmentSessionId: '11111111-1111-4111-8111-111111111111' },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'not_found' });
    });

    it('POST /recordings/:id/prompt-package rejects client-supplied confirmed inputs', async () => {
      const createPromptPackage = vi.spyOn(createPromptPackageModule, 'createPromptPackage');
      createPromptPackage.mockClear();

      const response = await app.inject({
        method: 'POST',
        url: '/recordings/recording-1/prompt-package',
        payload: {
          assignmentSessionId: '11111111-1111-4111-8111-111111111111',
          notes: 'client override',
          profileId: 'profile.md',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: 'validation_failed',
        message: 'Invalid request body',
      });
      expect(createPromptPackage).not.toHaveBeenCalled();
    });

    it('GET /prompt-packages/:id returns prompt package payload', async () => {
      const getPromptPackage = vi.spyOn(getPromptPackageModule, 'getPromptPackage');
      getPromptPackage.mockClear();
      getPromptPackage.mockResolvedValue({
        id: 'prompt-1',
        recordingId: 'recording-1',
        transcriptId: 'transcript-1',
        studentId: 'student-1',
        profilePath: '/profiles/p1.md',
        templateVersion: '/templates/t1.md',
        notes: 'Some notes',
        storageUri: 'local://prompt-packages/prompt-1.txt',
        text: 'PROMPT TEXT',
        memory: {
          studentMemorySnapshotId: null,
          studentMemorySnapshotHash: null,
          selectedLessonMemoryIds: [],
          selectedHomeworkMemoryIds: [],
          retrievalPolicyVersion: null,
          layerAvailability: {
            studentMemorySnapshot: 'missing',
            recentLessonMemory: 'missing',
            recentHomeworkMemory: 'missing',
            retrievalPolicy: 'missing',
          },
        },
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:10:00.000Z',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/prompt-packages/prompt-1',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        id: 'prompt-1',
        recordingId: 'recording-1',
        transcriptId: 'transcript-1',
        studentId: 'student-1',
        profilePath: '/profiles/p1.md',
        templateVersion: '/templates/t1.md',
        notes: 'Some notes',
        storageUri: 'local://prompt-packages/prompt-1.txt',
        text: 'PROMPT TEXT',
        memory: {
          studentMemorySnapshotId: null,
          studentMemorySnapshotHash: null,
          selectedLessonMemoryIds: [],
          selectedHomeworkMemoryIds: [],
          retrievalPolicyVersion: null,
          layerAvailability: {
            studentMemorySnapshot: 'missing',
            recentLessonMemory: 'missing',
            recentHomeworkMemory: 'missing',
            retrievalPolicy: 'missing',
          },
        },
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:10:00.000Z',
      });
      expect(getPromptPackage).toHaveBeenCalledWith('prompt-1');
    });

    it('GET /prompt-packages/:id returns 404 when missing', async () => {
      const getPromptPackage = vi.spyOn(getPromptPackageModule, 'getPromptPackage');
      getPromptPackage.mockClear();
      getPromptPackage.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: '/prompt-packages/missing',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'not_found' });
    });

    it('GET /prompt-packages/:id/lineage returns lineage payload', async () => {
      const getPromptPackageLineage = vi.spyOn(getPromptPackageModule, 'getPromptPackageLineage');
      getPromptPackageLineage.mockClear();
      getPromptPackageLineage.mockResolvedValue({
        promptPackageId: 'prompt-1',
        recordingId: 'recording-1',
        transcriptId: 'transcript-1',
        studentId: 'student-1',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:10:00.000Z',
        profile: {
          snapshot: {
            profileId: 'profile.md',
            revisionId: 'revision-1',
            hash: 'hash-1',
            versionLabel: 'v1',
            status: 'active',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
          current: {
            profileId: 'profile.md',
            revisionId: 'revision-2',
            hash: 'hash-2',
            versionLabel: 'v2',
            status: 'active',
            updatedAt: '2024-01-02T00:00:00.000Z',
          },
          drift: {
            detected: true,
            reason: 'profile_content_changed',
            currentProfileHash: 'hash-2',
            currentProfileRevisionId: 'revision-2',
            currentProfileUpdatedAt: '2024-01-02T00:00:00.000Z',
          },
        },
        template: {
          snapshot: {
            templateId: 'template.md',
            revisionId: 'template-revision-1',
            hash: 'template-hash-1',
            versionLabel: 'v1',
            status: 'active',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
          current: {
            templateId: 'template.md',
            revisionId: 'template-revision-1',
            hash: 'template-hash-1',
            versionLabel: 'v1',
            status: 'active',
            updatedAt: '2024-01-01T00:00:00.000Z',
          },
          drift: null,
        },
        memory: {
          studentMemorySnapshotId: null,
          studentMemorySnapshotHash: null,
          selectedLessonMemoryIds: [],
          selectedHomeworkMemoryIds: [],
          retrievalPolicyVersion: null,
          layerAvailability: {
            studentMemorySnapshot: 'missing',
            recentLessonMemory: 'missing',
            recentHomeworkMemory: 'missing',
            retrievalPolicy: 'missing',
          },
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/prompt-packages/prompt-1/lineage',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        promptPackageId: 'prompt-1',
        profile: {
          snapshot: {
            profileId: 'profile.md',
            revisionId: 'revision-1',
          },
        },
        template: {
          snapshot: {
            templateId: 'template.md',
            revisionId: 'template-revision-1',
          },
        },
      });
    });

    it('POST /prompt-packages/:id/draft returns draft payload', async () => {
      const createDraft = vi.spyOn(createDraftModule, 'createDraft');
      createDraft.mockClear();
      createDraft.mockResolvedValue({
        id: 'draft-1',
        promptPackageId: 'prompt-1',
        studentId: 'student-1',
        lessonId: null,
        storageUri: 'local://drafts/draft-1.md',
        workingVersion: 1,
        contentHash: 'draft-hash',
        createdBy: 'test-user-id',
        text: 'DRAFT TEXT',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:10:00.000Z',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/prompt-packages/prompt-1/draft',
        payload: { text: 'DRAFT TEXT' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        id: 'draft-1',
        promptPackageId: 'prompt-1',
        studentId: 'student-1',
        lessonId: null,
        storageUri: 'local://drafts/draft-1.md',
        workingVersion: 1,
        contentHash: 'draft-hash',
        createdBy: 'test-user-id',
        text: 'DRAFT TEXT',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:10:00.000Z',
      });
      expect(createDraft).toHaveBeenCalledWith({
        promptPackageId: 'prompt-1',
        text: 'DRAFT TEXT',
        createdBy: 'test-user-id',
      });
    });

    it('POST /prompt-packages/:id/draft returns 404 when missing', async () => {
      const createDraft = vi.spyOn(createDraftModule, 'createDraft');
      createDraft.mockClear();
      createDraft.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/prompt-packages/missing/draft',
        payload: { text: 'DRAFT TEXT' },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'not_found' });
    });

    it('PUT /drafts/:id returns the winning tuple on a stale write', async () => {
      const updateDraft = vi.spyOn(updateDraftModule, 'updateDraft');
      updateDraft.mockRejectedValue({
        code: 'ARTIFACT_WORKING_CONFLICT',
        latest: { workingVersion: 4, contentHash: 'draft-winner-hash' },
      });

      const response = await app.inject({
        method: 'PUT',
        url: '/drafts/draft-1',
        payload: { text: 'Stale draft', expectedWorkingVersion: 1 },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({
        code: 'artifact_working_conflict',
        artifact: { workingVersion: 4, contentHash: 'draft-winner-hash' },
      });
    });
  },
);
