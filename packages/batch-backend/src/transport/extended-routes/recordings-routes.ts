import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import multipart, { type MultipartFile } from '@fastify/multipart';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { AssignmentArtifactValidationError } from '../../application/assignment-artifact.js';
import { toAssignmentSessionDto } from '../../application/assignment-sessions.js';
import { createDraft } from '../../application/create-draft.js';
import {
  createPromptPackage,
  PromptPackageAssignmentError,
} from '../../application/create-prompt-package.js';
import { getDraft } from '../../application/get-draft.js';
import { getPromptPackage, getPromptPackageLineage } from '../../application/get-prompt-package.js';
import { getRecording } from '../../application/get-recording.js';
import { getRecordingTranscript } from '../../application/get-recording-transcript.js';
import { HistoricalAssignmentReadOnlyError } from '../../application/historical-assignment.js';
import {
  canonicalizeManualTranscriptSource,
  fingerprintManualTranscriptSource,
  ingestManualTranscriptSource,
  ManualTranscriptSourceValidationError,
} from '../../application/ingest-manual-transcript-source.js';
import { ingestRecordingUpload } from '../../application/ingest-recording-upload.js';
import { listRecordingsWithDefaults } from '../../application/list-recordings.js';
import { materializeDraft } from '../../application/materialize-draft.js';
import { PromptOptionError } from '../../application/prompt-options.js';
import {
  collectPublishStudyTextOverrideIssues,
  publishTtsModelSchema,
  publishTtsProviderSchema,
  publishTtsStrategySchema,
} from '../../application/publish-study-text-overrides.js';
import {
  RecordingRetryError,
  retryRecordingTranscription,
} from '../../application/retry-recording-transcription.js';
import { ValidationError } from '../../application/submit-job.js';
import {
  resolveTranscriptionRoute,
  TranscriptionRouteError,
} from '../../application/transcription-routing.js';
import { updateRecordingTranscript } from '../../application/update-recording-transcript.js';
import { resolvePrimaryWorkspaceIdForUser } from '../../application/workspace-context.js';
import {
  getAssignmentSessionByIdForUser,
  getCanonicalAssignmentSessionBySourceIdentity,
} from '../../domain/assignment-session-repository.js';
import { getDraftById } from '../../domain/draft-repository.js';
import { isPromptPackageAccessibleForUser } from '../../domain/prompt-package-repository.js';
import {
  type RecordingRecord,
  RecordingSourceSchema,
  RecordingStatusSchema,
} from '../../domain/recording-model.js';
import {
  getRecordingByIdForWorkspace,
  insertCachedRecordingLineage,
  insertRecording,
  insertRecordingWithQueuedTranscriptionRun,
  listRecordingsBySha256ForWorkspace,
  updateRecordingStatus,
} from '../../domain/recording-repository.js';
import {
  beginRecordingUploadOperation,
  completeRecordingUploadOperationWithCanonicalAssignment,
  getRecordingUploadOperation,
  type RecordingUploadOperation,
  RecordingUploadOperationConflictError,
  recordUploadAttemptCandidate,
} from '../../domain/recording-upload-operation-repository.js';
import { getStudentById } from '../../domain/student-repository.js';
import type { TranscriptRecord } from '../../domain/transcript-model.js';
import {
  getTranscriptByRecordingIdForWorkspace,
  listLatestTranscriptsByRecordingIdsForWorkspace,
} from '../../domain/transcript-repository.js';
import { FileSanitizationError } from '../../infrastructure/file-sanitization-service.js';
import { FileValidationError } from '../../infrastructure/file-validation-service.js';
import { logger } from '../../infrastructure/logger.js';
import {
  ensureRecordingUploadCapacity,
  prepareRecordingMedia,
  RecordingMediaError,
  spoolRecordingUpload,
  validateTrustedSplitChannels,
} from '../../infrastructure/recording-media.js';
import {
  createTranscriptionStorageForUri,
  type TranscriptionStorage,
} from '../../infrastructure/transcription-storage.js';
import { getAuthenticatedUser } from '../auth-middleware.js';
import { errorResponse, resolveRoutePath } from '../route-helpers.js';
import type { ExtendedRoutesContext } from './context.js';
import {
  inferTranscriptSttProvider,
  resolveExpectedSttModelAndLanguage,
  shouldReuseCachedTranscriptForFingerprint,
} from './recording-provider-cache.js';

type RecordingUploadRequest = FastifyRequest & {
  file: (options?: {
    limits?: { fileSize?: number };
    throwFileSizeLimit?: boolean;
  }) => Promise<MultipartFile | undefined>;
};

function isApplicationValidationError(
  error: unknown,
): error is ValidationError & { code?: string } {
  return (
    error instanceof ValidationError ||
    error instanceof AssignmentArtifactValidationError ||
    (typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      error.name === 'ValidationError' &&
      'message' in error &&
      typeof error.message === 'string' &&
      (!('code' in error) || typeof error.code === 'string'))
  );
}

export function registerRecordingRoutes(
  app: FastifyInstance,
  context: ExtendedRoutesContext,
): void {
  const {
    authenticate,
    uploadRateLimitMiddleware,
    config,
    fileValidationService,
    fileSanitizationService,
    fileStorageService,
    storageConfig,
    transcriptionStorage,
    transcribeQueue,
  } = context;

  const resolveCompletedUploadOperation = async (
    operation: RecordingUploadOperation,
    workspaceId: string,
    userId: string,
  ) => {
    if (operation.outcomeKind === 'existing_assignment_resumed') {
      const sessionId = operation.canonicalAssignmentSessionId;
      const session = sessionId ? await getAssignmentSessionByIdForUser(sessionId, userId) : null;
      if (!session) throw new Error('Completed upload operation has no canonical assignment.');
      return {
        outcome: 'existing_assignment_resumed' as const,
        session: toAssignmentSessionDto(session),
      };
    }
    const existing = await getRecording(
      operation.finalRecordingId ?? operation.recordingId,
      workspaceId,
    );
    if (!existing) throw new Error('Completed upload operation has no recording projection.');
    return existing;
  };

  app.post(
    '/recordings/upload',
    {
      preHandler: [authenticate, uploadRateLimitMiddleware],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'POST /recordings/upload');
      const querySchema = z.object({
        studentId: z.string().uuid().optional(),
        sttProvider: z.enum(['deepgram', 'elevenlabs', 'google']).optional(),
        audioTopology: z.enum(['trusted_split_channels']).optional(),
      });
      let authenticatedUser;

      try {
        authenticatedUser = getAuthenticatedUser(request);
        if (!authenticatedUser) {
          return reply.code(401).send({
            error: 'unauthorized',
            message: 'Authentication required',
            code: 'not_authenticated',
          });
        }

        const workspaceId = await resolvePrimaryWorkspaceIdForUser(authenticatedUser.id);
        const rawUploadOperationId = request.headers['x-upload-operation-id'];
        const uploadOperationId =
          typeof rawUploadOperationId === 'string' &&
          z.string().uuid().safeParse(rawUploadOperationId).success
            ? rawUploadOperationId
            : null;
        if (rawUploadOperationId !== undefined && !uploadOperationId) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid upload operation identity.',
            code: 'invalid_upload_operation_id',
          });
        }
        if (!uploadOperationId) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Upload operation identity is required.',
            code: 'upload_operation_id_required',
          });
        }

        // Request identity is query/header metadata, deliberately available before
        // multipart consumption. Do not make ownership depend on form field order.
        const query = querySchema.parse(request.query ?? {});
        if (!query.studentId) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Select a student before uploading.',
            code: 'student_required',
          });
        }
        const student = await getStudentById(query.studentId, { workspaceId });
        if (!student) return errorResponse(reply, 'not_found');
        const studentId = student.id;
        const requestedSttProvider = query.sttProvider;
        const audioTopology = query.audioTopology ?? 'mixed_recording';
        const route = resolveTranscriptionRoute({
          config,
          topology: audioTopology,
          requestedProvider: requestedSttProvider,
        });
        const effectiveSttProvider = route.provider;
        const expectedFingerprint = resolveExpectedSttModelAndLanguage(
          config,
          effectiveSttProvider,
        );
        const operationResult = await beginRecordingUploadOperation({
          workspaceId,
          operationUuid: uploadOperationId,
          studentId,
          audioTopology,
          requestedProvider: requestedSttProvider ?? null,
          requestProfile: route.profile,
        });
        if (operationResult.kind === 'completed') {
          return reply
            .code(200)
            .send(
              await resolveCompletedUploadOperation(
                operationResult.operation,
                workspaceId,
                authenticatedUser.id,
              ),
            );
        }
        if (operationResult.kind === 'active') {
          return reply.code(202).send({
            operationId: uploadOperationId,
            recordingId: operationResult.operation.recordingId,
            status: 'processing',
          });
        }
        // Obsolete candidates are deliberately left to the bounded worker reconciler.
        // It re-checks durable adoption/recording references immediately before every
        // idempotent filesystem/S3 delete and retries after process/storage failure.
        const uploadOperation = operationResult.operation;
        if (!uploadOperation.attemptToken)
          throw new Error('Claimed upload operation lacks attempt token.');

        // This is deliberately before multipart consumption. It is a point-in-time local check,
        // not a concurrent disk reservation; the configured maximum is the admission budget.
        await ensureRecordingUploadCapacity({
          maxBytes: config.recordings.maxFileSize,
          reserveBytes: config.recordings.diskReserveBytes,
        });

        const file = await (request as RecordingUploadRequest).file({
          // The spool remains authoritative. This ceiling only prevents the multipart parser
          // retaining an unbounded remainder after the spool has rejected it.
          limits: { fileSize: config.recordings.maxFileSize + 1 },
          throwFileSizeLimit: false,
        });

        if (!file) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'No file uploaded',
            code: 'no_file',
          });
        }

        const filename = file.filename || '';
        const spooled = await spoolRecordingUpload({
          input: file.file,
          maxBytes: config.recordings.maxFileSize,
          diskReserveBytes: config.recordings.diskReserveBytes,
        });
        let prepared;
        try {
          prepared = await prepareRecordingMedia({
            sourcePath: spooled.path,
            sourceSha256: spooled.sha256,
            sourceBytes: spooled.bytes,
            maxOutputBytes: config.recordings.maxFileSize,
          });
          if (audioTopology === 'trusted_split_channels') {
            validateTrustedSplitChannels({
              channels: prepared.facts.channels,
              channelLayout: prepared.facts.channelLayout,
            });
          }

          const sanitizedFilename = sanitizeRecordingFilename(filename);
          const storageFilename = sanitizedFilename.replaceAll(/[^\w.-]/g, '_');
          const sourcePath = storageFilename || sanitizedFilename || filename;
          const fileSha256 = prepared.sha256;

          const canonicalOwner = await getCanonicalAssignmentSessionBySourceIdentity({
            userId: authenticatedUser.id,
            studentId,
            sourceIdentityKind: 'audio',
            sourceFingerprintScheme: 'prepared-media-sha256-v1',
            sourceFingerprint: fileSha256,
          });
          if (canonicalOwner) {
            const completed = await completeRecordingUploadOperationWithCanonicalAssignment({
              operationId: uploadOperation.id,
              attemptToken: uploadOperation.attemptToken,
              assignmentSessionId: canonicalOwner.id,
            });
            if (completed) {
              return reply.code(200).send({
                outcome: 'existing_assignment_resumed',
                session: toAssignmentSessionDto(canonicalOwner),
              });
            }
            const reconciled = await getRecordingUploadOperation(workspaceId, uploadOperationId);
            if (reconciled?.state === 'completed') {
              return reply
                .code(200)
                .send(
                  await resolveCompletedUploadOperation(
                    reconciled,
                    workspaceId,
                    authenticatedUser.id,
                  ),
                );
            }
            throw new Error('Upload operation ownership expired before canonical reconciliation.');
          }

          const cachedRecordings = await listRecordingsBySha256ForWorkspace(
            fileSha256,
            workspaceId,
          );
          if (cachedRecordings.length > 0) {
            const latestTranscripts = await listLatestTranscriptsByRecordingIdsForWorkspace(
              cachedRecordings.map((recording) => recording.id),
              workspaceId,
            );
            const transcriptByRecordingId = new Map(
              latestTranscripts.map((transcript) => [transcript.recordingId, transcript] as const),
            );
            let transcriptCandidates = 0;
            let providerMatches = 0;
            let providerUnknown = 0;

            for (const cachedRecording of cachedRecordings) {
              if (cachedRecording.audioTopology !== audioTopology) {
                continue;
              }
              const cachedTranscript = transcriptByRecordingId.get(cachedRecording.id);
              if (!cachedTranscript) {
                continue;
              }

              transcriptCandidates += 1;
              const cachedProvider = inferTranscriptSttProvider(cachedTranscript);
              if (cachedProvider === null) {
                providerUnknown += 1;
                continue;
              }

              if (
                !shouldReuseCachedTranscriptForFingerprint({
                  effectiveProvider: effectiveSttProvider,
                  audioTopology,
                  sttRequestProfile: route.profile,
                  mode: config.transcription.mode,
                  model: expectedFingerprint.model,
                  language: expectedFingerprint.language,
                  preparationVersion: prepared.preparationVersion,
                  transcript: cachedTranscript,
                })
              ) {
                continue;
              }

              providerMatches += 1;
              const recordingForResponse = await cloneCachedRecordingForStudent({
                cachedRecording,
                cachedTranscript,
                workspaceId,
                studentId,
                sourcePath,
                sha256: fileSha256,
                bytes: prepared.bytes,
                audioTopology,
                mediaPreparationVersion: prepared.preparationVersion,
                storage: transcriptionStorage,
                recordingId: uploadOperation.recordingId,
                uploadOperation: {
                  id: uploadOperation.id,
                  attemptToken: uploadOperation.attemptToken,
                },
              });
              logger.info('Recording upload cache hit', {
                event: 'recording_upload_cache_hit',
                route: routePath,
                userId: authenticatedUser.id,
                recordingId: recordingForResponse.recording.id,
                transcriptId: recordingForResponse.transcript.id,
                cacheRecordingId: cachedRecording.id,
                clonedForStudent: recordingForResponse.recording.id !== cachedRecording.id,
                filename,
                sha256: fileSha256,
                requestedProvider: requestedSttProvider ?? null,
                effectiveProvider: effectiveSttProvider,
                cachedProvider,
                candidateRecordings: cachedRecordings.length,
                candidateTranscripts: transcriptCandidates,
                providerMatches,
              });

              const projection = await getRecording(recordingForResponse.recording.id, workspaceId);
              if (!projection) throw new Error('Cached recording has no canonical projection.');
              return reply.code(200).send({
                ...projection,
                cacheHit: true,
                cacheReason: 'transcript_reused',
                cacheRecordingId: cachedRecording.id,
              });
            }

            logger.info('Recording upload cache bypassed', {
              event: 'recording_upload_cache_bypassed',
              route: routePath,
              userId: authenticatedUser.id,
              filename,
              sha256: fileSha256,
              requestedProvider: requestedSttProvider ?? null,
              effectiveProvider: effectiveSttProvider,
              candidateRecordings: cachedRecordings.length,
              candidateTranscripts: transcriptCandidates,
              providerMatches,
              providerUnknown,
            });
          }

          const record = await ingestRecordingUpload({
            // Storage naming follows probed/prepared facts, never the untrusted original extension.
            filename: `audio${prepared.extension}`,
            workspaceId,
            recordingId: uploadOperation.recordingId,
            uploadOperation: {
              id: uploadOperation.id,
              attemptToken: uploadOperation.attemptToken,
              recordingId: uploadOperation.recordingId,
              recordCandidate: (candidateUri) =>
                recordUploadAttemptCandidate({
                  operationId: uploadOperation.id,
                  attemptToken: uploadOperation.attemptToken!,
                  candidateUri,
                }),
            },
            inputPath: prepared.path,
            sourcePath,
            studentId,
            sttProvider: requestedSttProvider,
            audioTopology,
            mediaPreparationVersion: prepared.preparationVersion,
            storage: transcriptionStorage,
            repository: {
              getRecordingByIdForWorkspace,
              insertRecordingWithRun: insertRecordingWithQueuedTranscriptionRun,
              insertRecording,
              updateRecordingStatus,
            },
            enqueue: transcribeQueue.enqueue,
          });

          logger.info('Recording uploaded', {
            event: 'recording_uploaded',
            route: routePath,
            userId: authenticatedUser.id,
            recordingId: record.id,
            filename,
            sanitizedFilename,
            bytes: record.bytes,
            storageProvider: storageConfig.getProvider(),
          });

          const projection = await getRecording(record.id, workspaceId);
          if (!projection) throw new Error('Uploaded recording has no canonical projection.');
          return reply.code(201).send(projection);
        } finally {
          // Direct audio and extracted video have exactly one candidate path. Both are local-only
          // after storage and must disappear even when cache cloning or persistence fails.
          await prepared?.cleanup();
          await spooled.cleanup().catch(() => undefined);
        }
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid query parameters',
            details: error.issues,
          });
        }
        if (error instanceof FileValidationError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: error.message,
            code: error.code,
          });
        }
        if (error instanceof TranscriptionRouteError) {
          return errorResponse(reply, 'validation_failed', {
            message: error.message,
            code: error.code,
          });
        }
        if (error instanceof RecordingUploadOperationConflictError) {
          return reply.code(409).send({
            error: 'validation_failed',
            message: 'Upload operation identity was reused with different upload settings.',
            code: 'upload_operation_conflict',
          });
        }
        if (error instanceof RecordingMediaError) {
          const status = error.code === 'file_too_large' ? 413 : 400;
          return reply.code(status).send({
            error: 'validation_failed',
            message: error.message,
            code: error.code,
          });
        }

        logger.error(error instanceof Error ? error : String(error), {
          event: 'recording_upload_failed',
          userId: authenticatedUser?.id,
          route: routePath,
          error: 'internal_error',
        });

        return reply.code(500).send({
          error: 'internal_error',
        });
      }
    },
  );

  app.get(
    '/recording-upload-operations/:operationId',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const operationId = (request.params as { operationId: string }).operationId;
      if (!z.string().uuid().safeParse(operationId).success)
        return errorResponse(reply, 'not_found');
      const authenticatedUser = getAuthenticatedUser(request);
      if (!authenticatedUser) return reply.code(401).send({ error: 'unauthorized' });
      const workspaceId = await resolvePrimaryWorkspaceIdForUser(authenticatedUser.id);
      const operation = await getRecordingUploadOperation(workspaceId, operationId);
      if (!operation) return errorResponse(reply, 'not_found');
      if (operation.state !== 'completed') {
        return reply.code(202).send({
          operationId,
          recordingId: operation.recordingId,
          // The same logical UUID remains valid after lease expiry. Tell the
          // browser it may retransmit that UUID so begin() can durably reclaim
          // the operation, rather than minting a second logical upload.
          status:
            operation.attemptExpiresAt && operation.attemptExpiresAt <= new Date()
              ? 'reclaimable'
              : 'processing',
        });
      }
      return reply.send(
        await resolveCompletedUploadOperation(operation, workspaceId, authenticatedUser.id),
      );
    },
  );

  app.post(
    '/recordings/transcript-source',
    {
      preHandler: [authenticate, uploadRateLimitMiddleware],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'POST /recordings/transcript-source');
      const schema = z.object({
        studentId: z.string().uuid(),
        text: z.string().trim().min(1).max(500_000),
        displayName: z.string().trim().min(1).max(200).optional(),
      });
      const authenticatedUser = getAuthenticatedUser(request);
      if (!authenticatedUser) {
        return reply.code(401).send({
          error: 'unauthorized',
          message: 'Authentication required',
          code: 'not_authenticated',
        });
      }

      try {
        const body = schema.parse(request.body ?? {});
        const workspaceId = await resolvePrimaryWorkspaceIdForUser(authenticatedUser.id);
        const student = await getStudentById(body.studentId, { workspaceId });
        if (!student) return errorResponse(reply, 'not_found');
        const canonicalText = canonicalizeManualTranscriptSource(body.text);
        const canonicalOwner = await getCanonicalAssignmentSessionBySourceIdentity({
          userId: authenticatedUser.id,
          studentId: body.studentId,
          sourceIdentityKind: 'manual_transcript',
          sourceFingerprintScheme: 'manual-transcript-nfc-lf-v1',
          sourceFingerprint: fingerprintManualTranscriptSource(canonicalText),
        });
        if (canonicalOwner) {
          return reply.code(200).send({
            outcome: 'existing_assignment_resumed',
            session: toAssignmentSessionDto(canonicalOwner),
          });
        }
        const result = await ingestManualTranscriptSource({ ...body, workspaceId });

        logger.info('Manual transcript source created', {
          event: 'manual_transcript_source_created',
          route: routePath,
          userId: authenticatedUser.id,
          studentId: body.studentId,
          recordingId: result.recording.id,
          transcriptId: result.transcript.id,
        });

        const projection = await getRecording(result.recording.id, workspaceId);
        if (!projection) throw new Error('Manual transcript source has no canonical projection.');
        return reply.code(201).send(projection);
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request body',
            details: error.issues,
          });
        }
        if (error instanceof ManualTranscriptSourceValidationError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: error.message,
            code: error.code,
          });
        }

        logger.error(error instanceof Error ? error : String(error), {
          event: 'manual_transcript_source_create_failed',
          route: routePath,
          userId: authenticatedUser.id,
          error: 'internal_error',
        });
        return errorResponse(reply, 'internal_error');
      }
    },
  );

  app.get(
    '/recordings',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /recordings');

      const querySchema = z.object({
        status: z.union([z.string(), z.array(z.string())]).optional(),
        source: z.union([z.string(), z.array(z.string())]).optional(),
        q: z.string().min(1).optional(),
        studentId: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
        offset: z.coerce.number().int().min(0).optional(),
        order: z.enum(['asc', 'desc']).optional(),
      });

      try {
        const query = querySchema.parse(request.query ?? {});
        const statuses = normalizeStatusFilter(query.status);
        const sources = normalizeSourceFilter(query.source);
        const authenticatedUser = getAuthenticatedUser(request);
        if (!authenticatedUser) return reply.code(401).send({ error: 'unauthorized' });
        const workspaceId = await resolvePrimaryWorkspaceIdForUser(authenticatedUser.id);
        if (query.studentId && !(await getStudentById(query.studentId, { workspaceId }))) {
          return errorResponse(reply, 'not_found');
        }
        const studentId = query.studentId ?? null;
        const recordings = await listRecordingsWithDefaults({
          workspaceId,
          statuses,
          sources,
          search: query.q ?? null,
          studentId,
          limit: query.limit,
          offset: query.offset,
          order: query.order,
        });

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
        });

        return reply.send(recordings);
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid query parameters',
            details: error.issues,
          });
        }

        logger.error(error instanceof Error ? error : String(error), {
          event: 'http_request',
          route: routePath,
          statusCode: 500,
          error: 'internal_error',
        });

        return errorResponse(reply, 'internal_error');
      }
    },
  );

  app.get(
    '/recordings/:recordingId',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { recordingId } = request.params as { recordingId: string };
      const routePath = resolveRoutePath(request, 'GET /recordings/:recordingId');

      try {
        const authenticatedUser = getAuthenticatedUser(request);
        if (!authenticatedUser) return reply.code(401).send({ error: 'unauthorized' });
        const workspaceId = await resolvePrimaryWorkspaceIdForUser(authenticatedUser.id);
        const recording = await getRecording(recordingId, workspaceId);
        if (!recording) {
          logger.info('Recording not found', {
            event: 'recording_not_found',
            route: routePath,
            recordingId,
          });
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          recordingId,
        });

        return reply.send(recording);
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        logger.error(error instanceof Error ? error : String(error), {
          event: 'http_request',
          route: routePath,
          statusCode: 500,
          error: 'internal_error',
          recordingId,
        });

        return errorResponse(reply, 'internal_error');
      }
    },
  );

  app.get(
    '/recordings/:recordingId/audio',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { recordingId } = request.params as { recordingId: string };
      const routePath = resolveRoutePath(request, 'GET /recordings/:recordingId/audio');

      try {
        const authenticatedUser = getAuthenticatedUser(request);
        if (!authenticatedUser) return reply.code(401).send({ error: 'unauthorized' });
        const workspaceId = await resolvePrimaryWorkspaceIdForUser(authenticatedUser.id);
        const recording = await getRecordingByIdForWorkspace(recordingId, workspaceId);
        if (recording?.audioLifecycle !== 'retained' || !recording.storageUri) {
          logger.info('Recording audio not found', {
            event: 'recording_audio_not_found',
            route: routePath,
            recordingId,
          });
          return errorResponse(reply, 'not_found');
        }

        const totalBytes = Number(recording.bytes ?? 0);
        const rangeHeader = request.headers.range;
        const range = parseRangeHeader(
          typeof rangeHeader === 'string' ? rangeHeader : undefined,
          totalBytes,
        );

        reply.header('Accept-Ranges', 'bytes');
        reply.header('Content-Type', resolveAudioMimeType(recording.storageUri));

        if (range === 'invalid') {
          reply.header('Content-Range', `bytes */${totalBytes}`);
          return reply.code(416).send();
        }

        const storage = createTranscriptionStorageForUri(recording.storageUri, { storageConfig });
        const stream = await storage.getStream(recording.storageUri);

        if (range) {
          const chunkSize = range.end - range.start + 1;
          reply.header('Content-Length', String(chunkSize));
          reply.header('Content-Range', `bytes ${range.start}-${range.end}/${totalBytes}`);

          logger.info('HTTP request handled', {
            event: 'http_request',
            route: routePath,
            statusCode: 206,
            recordingId,
          });

          return reply.code(206).send(createRangeStream(stream, range.start, range.end));
        }

        reply.header('Content-Length', String(totalBytes));

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          recordingId,
        });

        return reply.send(stream);
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        logger.error(error instanceof Error ? error : String(error), {
          event: 'http_request',
          route: routePath,
          statusCode: 500,
          error: 'internal_error',
          recordingId,
        });

        return errorResponse(reply, 'internal_error');
      }
    },
  );

  app.post(
    '/recordings/:recordingId/transcribe',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { recordingId } = request.params as { recordingId: string };
      const routePath = resolveRoutePath(request, 'POST /recordings/:recordingId/transcribe');
      const bodySchema = z
        .object({
          sttProvider: z.enum(['deepgram', 'elevenlabs', 'google']).optional(),
          audioTopology: z.enum(['trusted_split_channels']).optional(),
        })
        .optional();

      try {
        const body = bodySchema.parse(request.body ?? undefined);
        const authenticatedUser = getAuthenticatedUser(request);
        if (!authenticatedUser) return reply.code(401).send({ error: 'unauthorized' });
        const workspaceId = await resolvePrimaryWorkspaceIdForUser(authenticatedUser.id);
        const recording = await getRecordingByIdForWorkspace(recordingId, workspaceId);
        if (recording) {
          resolveTranscriptionRoute({
            config,
            topology: body?.audioTopology ?? recording.audioTopology ?? 'mixed_recording',
            requestedProvider: body?.sttProvider,
          });
        }
        const result = await retryRecordingTranscription(
          recordingId,
          {
            workspaceId,
            sttProvider: body?.sttProvider,
            audioTopology: body?.audioTopology,
          },
          {
            enqueue: transcribeQueue.enqueue,
          },
        );

        if (!result) {
          logger.info('Recording not found for retry', {
            event: 'recording_retry_not_found',
            route: routePath,
            recordingId,
          });
          return errorResponse(reply, 'not_found');
        }

        logger.info('Recording retry requested', {
          event: 'recording_retry_requested',
          route: routePath,
          recordingId,
        });

        return reply.send(result);
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request body',
            details: error.issues,
          });
        }
        if (error instanceof RecordingRetryError) {
          return errorResponse(reply, 'validation_failed', {
            message: error.message,
            code: error.code,
          });
        }
        if (error instanceof TranscriptionRouteError) {
          return errorResponse(reply, 'validation_failed', {
            message: error.message,
            code: error.code,
          });
        }

        logger.error(error instanceof Error ? error : String(error), {
          event: 'recording_retry_failed',
          route: routePath,
          statusCode: 500,
          recordingId,
          error: 'internal_error',
        });

        return errorResponse(reply, 'internal_error');
      }
    },
  );

  app.get(
    '/recordings/:recordingId/transcript',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { recordingId } = request.params as { recordingId: string };
      const routePath = resolveRoutePath(request, 'GET /recordings/:recordingId/transcript');

      try {
        const authenticatedUser = getAuthenticatedUser(request);
        if (!authenticatedUser) return reply.code(401).send({ error: 'unauthorized' });
        const workspaceId = await resolvePrimaryWorkspaceIdForUser(authenticatedUser.id);
        const transcript = await getRecordingTranscript(recordingId, workspaceId);
        if (!transcript) {
          logger.info('Recording transcript not found', {
            event: 'recording_transcript_not_found',
            route: routePath,
            recordingId,
          });
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          recordingId,
        });

        return reply.send(transcript);
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        logger.error(error instanceof Error ? error : String(error), {
          event: 'http_request',
          route: routePath,
          statusCode: 500,
          error: 'internal_error',
          recordingId,
        });

        return errorResponse(reply, 'internal_error');
      }
    },
  );

  app.put(
    '/recordings/:recordingId/transcript',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { recordingId } = request.params as { recordingId: string };
      const routePath = resolveRoutePath(request, 'PUT /recordings/:recordingId/transcript');

      const schema = z.object({
        text: z.string(),
        expectedWorkingVersion: z.number().int().positive(),
        speakerRoleMapping: z
          .object({
            roles: z.array(
              z.object({
                speaker: z.number().int().nonnegative(),
                role: z.enum(['teacher', 'student']),
              }),
            ),
          })
          .optional(),
      });

      try {
        const authenticatedUser = getAuthenticatedUser(request);
        if (!authenticatedUser) return reply.code(401).send({ error: 'unauthorized' });
        const workspaceId = await resolvePrimaryWorkspaceIdForUser(authenticatedUser.id);
        const body = schema.parse(request.body ?? {});
        const updated = await updateRecordingTranscript({
          recordingId,
          workspaceId,
          text: body.text,
          expectedWorkingVersion: body.expectedWorkingVersion,
          speakerRoleMapping: body.speakerRoleMapping,
        });

        if (!updated) {
          logger.info('Recording transcript update skipped; not found', {
            event: 'recording_transcript_update_not_found',
            route: routePath,
            recordingId,
          });
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          recordingId,
        });

        return reply.send(updated);
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        if (isArtifactWorkingConflict(error)) {
          return reply.code(409).send({
            code: 'artifact_working_conflict',
            artifact: {
              workingVersion: error.latest.workingVersion,
              contentHash: error.latest.contentHash,
            },
          });
        }
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request body',
            details: error.issues,
          });
        }
        if (isApplicationValidationError(error)) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: error.message,
            code: error.code,
          });
        }

        logger.error(error instanceof Error ? error : String(error), {
          event: 'http_request',
          route: routePath,
          statusCode: 500,
          error: 'internal_error',
          recordingId,
        });

        return errorResponse(reply, 'internal_error');
      }
    },
  );

  app.post(
    '/recordings/:recordingId/prompt-package',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { recordingId } = request.params as { recordingId: string };
      const routePath = resolveRoutePath(request, 'POST /recordings/:recordingId/prompt-package');

      const schema = z
        .object({
          assignmentSessionId: z.string().uuid(),
          templateId: z.string().min(1).optional(),
        })
        .strict();
      const authenticatedUser = getAuthenticatedUser(request);
      if (!authenticatedUser) {
        return reply.code(401).send({
          error: 'unauthorized',
          message: 'Authentication required',
          code: 'not_authenticated',
        });
      }

      try {
        const body = schema.parse(request.body ?? {});
        const workspaceId = await resolvePrimaryWorkspaceIdForUser(authenticatedUser.id);
        const promptPackage = await createPromptPackage({
          recordingId,
          workspaceId,
          assignmentSessionId: body.assignmentSessionId,
          userId: authenticatedUser.id,
          templateId: body.templateId,
        });

        if (!promptPackage) {
          logger.info('Prompt package creation skipped; transcript missing', {
            event: 'prompt_package_create_not_found',
            route: routePath,
            recordingId,
          });
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          recordingId,
        });

        return reply.send(promptPackage);
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request body',
            details: error.issues,
          });
        }
        if (error instanceof PromptOptionError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: error.message,
            code: error.code,
          });
        }
        if (error instanceof PromptPackageAssignmentError) {
          return reply
            .code(error.code === 'PROMPT_PACKAGE_ASSIGNMENT_SESSION_NOT_FOUND' ? 404 : 409)
            .send({
              error:
                error.code === 'PROMPT_PACKAGE_ASSIGNMENT_SESSION_NOT_FOUND'
                  ? 'not_found'
                  : 'conflict',
              message: error.message,
              code: error.code,
            });
        }

        logger.error(error instanceof Error ? error : String(error), {
          event: 'http_request',
          route: routePath,
          statusCode: 500,
          error: 'internal_error',
          recordingId,
        });

        return errorResponse(reply, 'internal_error');
      }
    },
  );

  app.get(
    '/prompt-packages/:promptPackageId',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { promptPackageId } = request.params as { promptPackageId: string };
      const routePath = resolveRoutePath(request, 'GET /prompt-packages/:promptPackageId');

      try {
        const promptPackage = await getPromptPackage(promptPackageId);
        if (!promptPackage) {
          logger.info('Prompt package not found', {
            event: 'prompt_package_not_found',
            route: routePath,
            promptPackageId,
          });
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          promptPackageId,
        });

        return reply.send(promptPackage);
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        logger.error(error instanceof Error ? error : String(error), {
          event: 'http_request',
          route: routePath,
          statusCode: 500,
          error: 'internal_error',
          promptPackageId,
        });

        return errorResponse(reply, 'internal_error');
      }
    },
  );

  app.get(
    '/prompt-packages/:promptPackageId/lineage',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { promptPackageId } = request.params as { promptPackageId: string };
      const routePath = resolveRoutePath(request, 'GET /prompt-packages/:promptPackageId/lineage');

      try {
        const lineage = await getPromptPackageLineage(promptPackageId);
        if (!lineage) {
          logger.info('Prompt package lineage not found', {
            event: 'prompt_package_lineage_not_found',
            route: routePath,
            promptPackageId,
          });
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          promptPackageId,
        });

        return reply.send(lineage);
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        logger.error(error instanceof Error ? error : String(error), {
          event: 'http_request',
          route: routePath,
          statusCode: 500,
          error: 'internal_error',
          promptPackageId,
        });

        return errorResponse(reply, 'internal_error');
      }
    },
  );

  app.post(
    '/prompt-packages/:promptPackageId/draft',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { promptPackageId } = request.params as { promptPackageId: string };
      const routePath = resolveRoutePath(request, 'POST /prompt-packages/:promptPackageId/draft');

      const schema = z.object({
        text: z.string().min(1),
      });

      try {
        const body = schema.parse(request.body ?? {});
        if (
          !(await isPromptPackageAccessibleForUser(
            promptPackageId,
            getAuthenticatedUser(request)!.id,
          ))
        )
          return errorResponse(reply, 'not_found');
        const draft = await createDraft({
          promptPackageId,
          text: body.text,
          createdBy: getAuthenticatedUser(request)?.id ?? null,
        });

        if (!draft) {
          logger.info('Draft creation skipped; prompt package missing', {
            event: 'draft_create_not_found',
            route: routePath,
            promptPackageId,
          });
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          promptPackageId,
        });

        return reply.send(draft);
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request body',
            details: error.issues,
          });
        }
        if (isApplicationValidationError(error)) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: error.message,
            code: error.code,
          });
        }

        if (error instanceof PromptPackageAssignmentError) {
          return reply.code(409).send({
            error: 'conflict',
            message: error.message,
            code: error.code,
          });
        }

        logger.error(error instanceof Error ? error : String(error), {
          event: 'http_request',
          route: routePath,
          statusCode: 500,
          error: 'internal_error',
          promptPackageId,
        });

        return errorResponse(reply, 'internal_error');
      }
    },
  );

  app.get(
    '/drafts/:draftId',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { draftId } = request.params as { draftId: string };
      const routePath = resolveRoutePath(request, 'GET /drafts/:draftId');

      try {
        const record = await getDraftById(draftId);
        if (
          !record ||
          !(await isPromptPackageAccessibleForUser(
            record.promptPackageId,
            getAuthenticatedUser(request)!.id,
          ))
        )
          return errorResponse(reply, 'not_found');
        const draft = await getDraft(draftId);

        if (!draft) {
          logger.info('Draft retrieval skipped; draft missing', {
            event: 'draft_get_not_found',
            route: routePath,
            draftId,
          });
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          draftId,
        });

        return reply.send(draft);
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        logger.error(error instanceof Error ? error : String(error), {
          event: 'http_request',
          route: routePath,
          statusCode: 500,
          error: 'internal_error',
          draftId,
        });

        return errorResponse(reply, 'internal_error');
      }
    },
  );

  app.post(
    '/drafts/:draftId/materialize',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { draftId } = request.params as { draftId: string };
      const routePath = resolveRoutePath(request, 'POST /drafts/:draftId/materialize');

      const jobOverridesSchema = z
        .object({
          learningPresetId: z.string().min(1).optional(),
          publishTarget: z.literal('html').optional(),
          withTts: z.boolean().optional(),
          forceTts: z.boolean().optional(),
          ttsStrategy: publishTtsStrategySchema.optional(),
          ttsProvider: publishTtsProviderSchema.optional(),
          ttsModel: publishTtsModelSchema.optional(),
          upload: z.enum(['auto', 's3', 'none']).optional(),
          voiceId: z.string().min(1).optional(),
          voiceAccent: z.string().min(1).optional(),
          autoPublish: z.boolean().optional(),
        })
        .superRefine((value, ctx) => {
          const issues = collectPublishStudyTextOverrideIssues({
            ttsStrategy: value.ttsStrategy,
            ttsProvider: value.ttsProvider,
            ttsModel: value.ttsModel,
          });
          for (const issue of issues) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: issue.path,
              message: issue.message,
            });
          }
        });

      const schema = z.object({
        jobId: z.string().min(1).optional(),
        jobOverrides: jobOverridesSchema.optional(),
      });

      try {
        const body = schema.parse(request.body ?? {});
        const record = await getDraftById(draftId);
        if (
          !record ||
          !(await isPromptPackageAccessibleForUser(
            record.promptPackageId,
            getAuthenticatedUser(request)!.id,
          ))
        )
          return errorResponse(reply, 'not_found');
        const materialized = await materializeDraft({
          draftId,
          jobId: body.jobId,
          jobOverrides: body.jobOverrides,
        });

        if (!materialized) {
          logger.info('Draft materialization skipped; draft or job missing', {
            event: 'draft_materialize_not_found',
            route: routePath,
            draftId,
            jobId: body.jobId,
          });
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          draftId,
          jobId: body.jobId,
        });

        return reply.send(materialized);
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request body',
            details: error.issues,
          });
        }
        if (isApplicationValidationError(error)) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: error.message,
            code: error.code,
          });
        }

        if (error instanceof PromptPackageAssignmentError) {
          return reply.code(409).send({
            error: 'conflict',
            message: error.message,
            code: error.code,
          });
        }

        logger.error(error instanceof Error ? error : String(error), {
          event: 'http_request',
          route: routePath,
          statusCode: 500,
          error: 'internal_error',
          draftId,
        });

        return errorResponse(reply, 'internal_error');
      }
    },
  );

  const multipartMaxFileSize = Math.max(config.security.maxFileSize, config.recordings.maxFileSize);
  void app.register(multipart, {
    limits: {
      fileSize: multipartMaxFileSize,
      files: 1,
    },
  });

  app.post(
    '/uploads',
    {
      preHandler: [authenticate, uploadRateLimitMiddleware],
    },
    async (request, reply) => {
      let authenticatedUser;
      try {
        authenticatedUser = getAuthenticatedUser(request);
        if (!authenticatedUser) {
          return reply.code(401).send({
            error: 'unauthorized',
            message: 'Authentication required',
            code: 'not_authenticated',
          });
        }

        const file = await (request as RecordingUploadRequest).file({
          limits: { fileSize: config.security.maxFileSize },
          throwFileSizeLimit: false,
        });
        if (!file) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'No file uploaded',
            code: 'no_file',
          });
        }

        const filename: string = file.filename || '';
        const fileBuffer = await readFileBuffer(file.file);
        if (isStreamTruncated(file.file)) {
          return reply.code(413).send({
            error: 'validation_failed',
            message: `Upload exceeds max size (${formatBytes(config.security.maxFileSize)}).`,
            code: 'file_too_large',
          });
        }

        try {
          let validationResult;
          if (fileValidationService) {
            validationResult = await fileValidationService.validateFile(fileBuffer, filename);
            if (!validationResult.isValid) {
              logger.warn('File validation failed', {
                event: 'file_validation_failed',
                userId: authenticatedUser.id,
                filename,
                errors: validationResult.errors.map((e: { code: string }) => e.code),
                warnings: validationResult.warnings.map((w: { code: string }) => w.code),
              });

              return reply.code(400).send({
                error: 'validation_failed',
                message: 'File validation failed',
                code: 'file_validation_failed',
                details: {
                  errors: validationResult.errors,
                  warnings: validationResult.warnings,
                },
              });
            }
          }

          let sanitizationResult;
          let sanitizedBuffer = fileBuffer;
          let sanitizedFilename = filename;

          if (fileSanitizationService) {
            sanitizationResult = await fileSanitizationService.sanitizeFile(fileBuffer, filename);
            sanitizedBuffer = sanitizationResult.sanitizedContent;
            sanitizedFilename = sanitizationResult.sanitizedFilename;

            if (sanitizationResult.warnings.length > 0) {
              logger.warn('File sanitization completed with warnings', {
                event: 'file_sanitized_with_warnings',
                userId: authenticatedUser.id,
                originalFilename: filename,
                sanitizedFilename: sanitizedFilename,
                warnings: sanitizationResult.warnings.map(
                  (w: { code: string; severity: string }) => ({
                    code: w.code,
                    severity: w.severity,
                  }),
                ),
              });
            }
          }

          const id = randomUUID();
          const storageKey = `${authenticatedUser.id}/${id}_${sanitizedFilename.replaceAll(/[^\w.-]/g, '_')}`;

          const uploadResult = await fileStorageService.uploadFile(
            storageKey,
            sanitizedBuffer,
            validationResult?.mimeType || 'application/octet-stream',
            sanitizedBuffer.length,
          );

          const mdReference =
            fileStorageService.getProvider() === 'filesystem'
              ? buildFilesystemMdReference(
                  storageConfig.getFilesystemConfig().uploadDir,
                  storageKey,
                )
              : storageKey;

          logger.info('Secure upload completed', {
            event: 'secure_upload_completed',
            userId: authenticatedUser.id,
            fileId: id,
            originalFilename: filename,
            sanitizedFilename: sanitizedFilename,
            fileSize: sanitizedBuffer.length,
            mimeType: validationResult?.mimeType,
            storageKey,
            mdReference,
            storageProvider: fileStorageService.getProvider(),
            hasUrl: !!uploadResult.url,
          });

          return reply.code(201).send({
            id,
            md: mdReference,
            url: uploadResult.url,
            originalFilename: filename,
            sanitizedFilename: sanitizedFilename,
            fileSize: sanitizedBuffer.length,
            mimeType: validationResult?.mimeType,
            storageProvider: fileStorageService.getProvider(),
            warnings: [
              ...(validationResult?.warnings || []),
              ...(sanitizationResult?.warnings || []),
            ],
          });
        } catch (securityError: unknown) {
          if (
            securityError instanceof FileValidationError ||
            securityError instanceof FileSanitizationError
          ) {
            logger.warn('File security processing failed', {
              event: 'file_security_processing_failed',
              userId: authenticatedUser.id,
              filename,
              error: securityError.code,
              message: securityError.message,
            });

            return reply.code(400).send({
              error: 'security_validation_failed',
              message: securityError.message,
              code: securityError.code,
            });
          }
          throw securityError;
        }
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        logger.error(error instanceof Error ? error : String(error), {
          event: 'upload_failed',
          userId: authenticatedUser?.id,
          error: 'internal_error',
        });

        return reply.code(500).send({
          error: 'internal_error',
        });
      }
    },
  );

  app.put(
    '/drafts/:id',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'PUT /drafts/:id');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });
      const bodySchema = z.object({
        text: z.string(),
        expectedWorkingVersion: z.number().int().positive(),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const body = bodySchema.parse(request.body ?? {});
        const record = await getDraftById(params.id);
        if (
          !record ||
          !(await isPromptPackageAccessibleForUser(
            record.promptPackageId,
            getAuthenticatedUser(request)!.id,
          ))
        )
          return errorResponse(reply, 'not_found');
        const { updateDraft } = await import('../../application/update-draft.js');
        const updated = await updateDraft({
          id: params.id,
          text: body.text,
          expectedWorkingVersion: body.expectedWorkingVersion,
        });

        if (!updated) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          draftId: params.id,
        });

        return reply.send(updated);
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        if (isArtifactWorkingConflict(error)) {
          return reply.code(409).send({
            code: 'artifact_working_conflict',
            artifact: {
              workingVersion: error.latest.workingVersion,
              contentHash: error.latest.contentHash,
            },
          });
        }
        if (error instanceof AssignmentArtifactValidationError)
          return reply
            .code(400)
            .send({ error: 'validation_failed', code: error.code, message: error.message });
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request',
            details: error.issues,
          });
        }

        logger.error(error instanceof Error ? error : String(error), {
          event: 'http_request',
          route: routePath,
          statusCode: 500,
          error: 'internal_error',
        });

        return errorResponse(reply, 'internal_error');
      }
    },
  );
}

async function cloneCachedRecordingForStudent(params: {
  cachedRecording: RecordingRecord;
  cachedTranscript: TranscriptRecord;
  workspaceId: string;
  studentId: string;
  sourcePath: string;
  sha256: string;
  bytes: number;
  audioTopology: import('@esl-pipeline/contracts').AudioInputTopology;
  mediaPreparationVersion: string;
  storage: TranscriptionStorage;
  recordingId: string;
  uploadOperation: { id: string; attemptToken: string };
}) {
  const recordingId = params.recordingId;
  const transcriptId = randomUUID();
  const readStorage = createTranscriptionStorageForUri(params.cachedTranscript.storageUri);
  const cachedText = await readStorage.getText(params.cachedTranscript.storageUri);
  const storedTranscript = await params.storage.putTranscript({ transcriptId, text: cachedText });
  const createdUris = [storedTranscript.uri];
  try {
    const summaryJson = await cloneSpeakerTrackArtifacts({
      transcriptId,
      summaryJson: params.cachedTranscript.summaryJson ?? null,
      storage: params.storage,
      createdUris,
    });
    return await insertCachedRecordingLineage({
      recording: {
        id: recordingId,
        workspaceId: params.workspaceId,
        source: 'upload',
        studentId: params.studentId,
        sourcePath: params.sourcePath,
        storageUri: null,
        audioLifecycle: 'not_retained',
        sha256: params.sha256,
        bytes: params.bytes,
        durationSec: params.cachedRecording.durationSec,
        channels: params.cachedRecording.channels,
        audioTopology: params.audioTopology,
        mediaPreparationVersion: params.mediaPreparationVersion,
        sourceIdentity: {
          kind: 'audio',
          scheme: 'prepared-media-sha256-v1',
          fingerprint: params.sha256,
        },
        status: 'transcribed',
        error: null,
      },
      transcript: {
        id: transcriptId,
        recordingId,
        storageUri: storedTranscript.uri,
        workingVersion: 1,
        contentHash: storedTranscript.sha256,
        rawResponseUri: null,
        mode: params.cachedTranscript.mode,
        model: params.cachedTranscript.model,
        language: params.cachedTranscript.language,
        sttProvider: params.cachedTranscript.sttProvider,
        fallbackUsed: params.cachedTranscript.fallbackUsed,
        summaryJson,
      },
      uploadOperation: params.uploadOperation,
    });
  } catch (error) {
    const [committedRecording, committedTranscript] = await Promise.all([
      getRecordingByIdForWorkspace(recordingId, params.workspaceId),
      getTranscriptByRecordingIdForWorkspace(recordingId, params.workspaceId),
    ]);
    if (
      committedRecording &&
      committedTranscript?.id === transcriptId &&
      committedTranscript.storageUri === storedTranscript.uri
    ) {
      return { recording: committedRecording, transcript: committedTranscript };
    }
    const failures: string[] = [];
    for (const uri of [...createdUris].reverse()) {
      try {
        await params.storage.delete(uri);
      } catch (cleanupError) {
        failures.push(
          `${uri}: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`,
        );
      }
    }
    if (failures.length > 0) {
      logger.error('Cache clone artifact cleanup failed', {
        event: 'recording_cache_clone_cleanup_failed',
        recordingId,
        transcriptId,
        failures,
      });
      throw new Error(
        'Cache lineage persistence failed and clone artifact cleanup was incomplete',
        {
          cause: error,
        },
      );
    }
    throw error;
  }
}

async function cloneSpeakerTrackArtifacts(params: {
  transcriptId: string;
  summaryJson: Record<string, unknown> | null;
  storage: TranscriptionStorage;
  createdUris: string[];
}): Promise<Record<string, unknown> | null> {
  if (!params.summaryJson) return null;
  const speakerTracks = params.summaryJson.speakerTracks;
  if (!speakerTracks || typeof speakerTracks !== 'object')
    return structuredClone(params.summaryJson);
  const typed = speakerTracks as { transcripts?: unknown; speakers?: unknown };
  if (!Array.isArray(typed.transcripts)) return structuredClone(params.summaryJson);
  const transcripts = [];
  for (const [index, candidate] of typed.transcripts.entries()) {
    if (!candidate || typeof candidate !== 'object') continue;
    const track = candidate as { speaker?: unknown; label?: unknown; uri?: unknown };
    if (typeof track.uri !== 'string') continue;
    const text = await createTranscriptionStorageForUri(track.uri).getText(track.uri);
    const stored = await params.storage.putTranscript({
      transcriptId: `${params.transcriptId}-speaker-${String(track.speaker ?? index)}`,
      text,
    });
    params.createdUris.push(stored.uri);
    transcripts.push({ ...track, uri: stored.uri });
  }
  const aggregate = await params.storage.putRawResponse({
    transcriptId: `${params.transcriptId}-speaker-tracks`,
    json: { transcripts, speakers: typed.speakers ?? [] },
  });
  params.createdUris.push(aggregate.uri);
  return {
    ...structuredClone(params.summaryJson),
    speakerTracks: { ...structuredClone(speakerTracks), uri: aggregate.uri, transcripts },
  };
}

function isArtifactWorkingConflict(error: unknown): error is {
  code: 'ARTIFACT_WORKING_CONFLICT';
  latest: { workingVersion: number; contentHash: string };
} {
  if (!error || typeof error !== 'object' || !('code' in error) || !('latest' in error)) {
    return false;
  }
  const latest = error.latest;
  return (
    error.code === 'ARTIFACT_WORKING_CONFLICT' &&
    !!latest &&
    typeof latest === 'object' &&
    'workingVersion' in latest &&
    typeof latest.workingVersion === 'number' &&
    'contentHash' in latest &&
    typeof latest.contentHash === 'string'
  );
}

function normalizeStatusFilter(status?: string | string[] | null): string[] | null {
  if (!status) return null;
  const values = Array.isArray(status) ? status : status.split(',');
  const trimmed = values.map((value) => value.trim()).filter(Boolean);
  if (trimmed.length === 0) return null;
  return trimmed.map((value) => RecordingStatusSchema.parse(value));
}

function normalizeSourceFilter(source?: string | string[] | null): string[] | null {
  if (!source) return null;
  const values = Array.isArray(source) ? source : source.split(',');
  const trimmed = values.map((value) => value.trim()).filter(Boolean);
  if (trimmed.length === 0) return null;
  return trimmed.map((value) => RecordingSourceSchema.parse(value));
}

async function readFileBuffer(fileStream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];

  return new Promise((resolve, reject) => {
    fileStream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    fileStream.on('end', () => resolve(Buffer.concat(chunks)));
    fileStream.on('error', reject);
  });
}

function isStreamTruncated(fileStream: Readable): boolean {
  return (
    typeof (fileStream as { truncated?: boolean }).truncated === 'boolean' &&
    Boolean((fileStream as { truncated?: boolean }).truncated)
  );
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) {
    return `${mb.toFixed(1)} MB`;
  }
  return `${Math.max(bytes, 0)} bytes`;
}

function sanitizeRecordingFilename(filename: string): string {
  const base = path.basename(filename || '').trim();
  const sanitized = base && base !== '.' && base !== '..' ? base : '';
  const fallback = `recording-${Date.now()}.bin`;
  const candidate = sanitized || fallback;
  const ext = path.extname(candidate);
  return ext ? candidate : `${candidate}.bin`;
}

function buildFilesystemMdReference(uploadDir: string, storageKey: string): string {
  const absoluteRoot = path.resolve(uploadDir || '.');
  const absoluteFilePath = path.join(absoluteRoot, storageKey);
  return absoluteFilePath.split(path.sep).join('/');
}

type RangeParseResult = { start: number; end: number } | 'invalid' | null;

function parseRangeHeader(header: string | undefined, size: number): RangeParseResult {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return 'invalid';

  const startRaw = match[1] ?? '';
  const endRaw = match[2] ?? '';
  if (!(startRaw || endRaw)) return 'invalid';
  if (size <= 0) return 'invalid';

  let start = 0;
  let end = size - 1;

  if (startRaw) {
    start = Number.parseInt(startRaw, 10);
    if (Number.isNaN(start) || start < 0) return 'invalid';
    if (endRaw) {
      end = Number.parseInt(endRaw, 10);
      if (Number.isNaN(end) || end < start) return 'invalid';
      end = Math.min(end, size - 1);
    }
  } else {
    const suffix = Number.parseInt(endRaw, 10);
    if (Number.isNaN(suffix) || suffix <= 0) return 'invalid';
    start = Math.max(size - suffix, 0);
  }

  if (start >= size) return 'invalid';

  return { start, end };
}

function createRangeStream(source: Readable, start: number, end: number): Readable {
  let position = 0;
  let remaining = end - start + 1;
  const transformer = new Transform({
    transform(chunk, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const chunkStart = position;
      const chunkEnd = position + buffer.length - 1;
      position += buffer.length;

      if (chunkEnd < start) {
        return callback();
      }

      if (remaining <= 0) {
        source.destroy();
        this.end();
        return callback();
      }

      let sliceStart = 0;
      if (chunkStart < start) {
        sliceStart = start - chunkStart;
      }

      const available = buffer.length - sliceStart;
      const take = Math.min(remaining, available);
      if (take > 0) {
        this.push(buffer.subarray(sliceStart, sliceStart + take));
        remaining -= take;
      }

      if (remaining <= 0) {
        source.destroy();
        this.end();
      }

      return callback();
    },
  });

  source.on('error', (error) => transformer.destroy(error));
  return source.pipe(transformer);
}

function resolveAudioMimeType(uri: string): string {
  const cleaned = uri.split('?')[0]?.split('#')[0] ?? uri;
  const ext = path.extname(cleaned).toLowerCase();
  switch (ext) {
    case '.opus': {
      return 'audio/ogg';
    }
    case '.mp3': {
      return 'audio/mpeg';
    }
    case '.wav': {
      return 'audio/wav';
    }
    case '.m4a': {
      return 'audio/mp4';
    }
    default: {
      return 'application/octet-stream';
    }
  }
}
