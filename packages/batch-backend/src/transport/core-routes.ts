import type { FastifyInstance, FastifyReply, FastifyRequest, RouteHandlerMethod } from 'fastify';
import { z } from 'zod';

import type { JobEventMessage, RecordingEventMessage } from '@esl-pipeline/contracts';

import { approveJobForPipeline } from '../application/approve-job.js';
import { getJobProvenance } from '../application/get-job-provenance.js';
import { getJobStatus } from '../application/get-job-status.js';
import { HistoricalAssignmentReadOnlyError } from '../application/historical-assignment.js';
import { jobRecordToDto } from '../application/job-dto.js';
import {
  publishTtsModelSchema,
  publishTtsProviderSchema,
  publishTtsStrategySchema,
} from '../application/publish-study-text-overrides.js';
import { recordingToDto } from '../application/recording-dto.js';
import { type SubmitJobRequest, submitJob } from '../application/submit-job.js';
import { getVersionMeta } from '../application/version-meta.js';
import { resolvePrimaryWorkspaceIdForUser } from '../application/workspace-context.js';
import type { BatchBackendConfig } from '../config/env.js';
import { subscribeJobEvents } from '../domain/job-events.js';
import { getJobWorkspaceAuthority } from '../domain/job-repository.js';
import { subscribeRecordingEvents } from '../domain/recording-events.js';
import { getRecordingByIdForWorkspace } from '../domain/recording-repository.js';
import { checkBackendHealth } from '../infrastructure/health-checks.js';
import { logger } from '../infrastructure/logger.js';
import { getAuthenticatedUser } from './auth-middleware.js';
import { errorResponse, resolveRoutePath } from './route-helpers.js';

type AsyncPreHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface CoreRouteOptions {
  config: BatchBackendConfig;
  jobRateLimitMiddleware?: AsyncPreHandler | null;
  authenticate?: AsyncPreHandler;
}

export function registerCoreRoutes(app: FastifyInstance, options: CoreRouteOptions): void {
  const { jobRateLimitMiddleware, authenticate, config } = options;

  app.get('/meta/version', async (request, reply) => {
    const routePath = resolveRoutePath(request, 'GET /meta/version');
    const payload = getVersionMeta();

    logger.info('HTTP request handled', {
      event: 'http_request',
      route: routePath,
      statusCode: 200,
      repoVersion: payload.repoVersion,
    });

    return reply.send(payload);
  });

  app.get('/health', async (request, reply) => {
    const routePath = resolveRoutePath(request, 'GET /health');
    const health = await checkBackendHealth(config);
    const statusCode = health.ok ? 200 : 503;

    logger.info('HTTP request handled', {
      event: 'http_request',
      route: routePath,
      statusCode,
      ok: health.ok,
    });

    return reply.code(statusCode).send(health);
  });

  const handleSubmitJob: RouteHandlerMethod = async (request, reply) => {
    const user = getAuthenticatedUser(request);
    if (!user) throw new Error('Authenticated job owner is required');
    const body = request.body as SubmitJobRequest | undefined;

    const jobSchema = z.object({
      md: z.string().min(1),
      learningPresetId: z.string().min(1).optional(),
      withTts: z.boolean().optional(),
      upload: z.enum(['auto', 's3', 'none']).optional(),
      voiceAccent: z.string().min(1).optional(),
      voiceId: z.string().min(1).optional(),
      forceTts: z.boolean().optional(),
      publishTarget: z.literal('html').optional(),
      ttsStrategy: publishTtsStrategySchema.optional(),
      ttsProvider: publishTtsProviderSchema.optional(),
      ttsModel: publishTtsModelSchema.optional(),
    });

    const validatedData = jobSchema.parse(body);

    const result = await submitJob({
      md: validatedData.md,
      learningPresetId: validatedData.learningPresetId,
      withTts: validatedData.withTts,
      upload: validatedData.upload,
      voiceId: validatedData.voiceId,
      voiceAccent: validatedData.voiceAccent,
      forceTts: validatedData.forceTts,
      publishTarget: validatedData.publishTarget,
      ttsStrategy: validatedData.ttsStrategy,
      ttsProvider: validatedData.ttsProvider,
      ttsModel: validatedData.ttsModel,
      userId: user.id,
    });

    logger.info('HTTP request handled', {
      event: 'http_request',
      route: 'POST /jobs',
      statusCode: 202,
      jobId: result.jobId,
    });

    return reply.code(202).send(result);
  };

  const submitJobPreHandlers = [authenticate, jobRateLimitMiddleware].filter(
    (handler): handler is AsyncPreHandler => Boolean(handler),
  );
  app.post(
    '/jobs',
    submitJobPreHandlers.length > 0 ? { preHandler: submitJobPreHandlers } : {},
    handleSubmitJob,
  );

  const approveJobRouteOptions = authenticate ? { preHandler: [authenticate] } : {};

  app.post('/jobs/:jobId/approve', approveJobRouteOptions, async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const routePath = resolveRoutePath(request, 'POST /jobs/:jobId/approve');

    const body = request.body as { md?: string; mdStorageUri?: string } | undefined;
    const schema = z.object({
      md: z.string().min(1).optional(),
      mdStorageUri: z.string().min(1).optional(),
    });

    try {
      const validated = schema.parse(body ?? {});
      const approved = await approveJobForPipeline(jobId, {
        md: validated.md,
        mdStorageUri: validated.mdStorageUri,
      });

      if (!approved) {
        logger.info('Approval request rejected', {
          event: 'job_approve_not_found',
          route: routePath,
          jobId,
        });
        return errorResponse(reply, 'not_found', {
          message: 'Job not found or not awaiting approval',
          code: 'job_not_awaiting_approval',
        });
      }

      const dto = jobRecordToDto(approved);
      logger.info('Job approved', {
        event: 'job_approved',
        route: routePath,
        jobId,
      });

      return reply.code(202).send(dto);
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

      logger.error(error instanceof Error ? error : String(error), {
        event: 'job_approve_failed',
        route: routePath,
        jobId,
      });

      return errorResponse(reply, 'internal_error');
    }
  });

  async function handleJobStatusRequest(request: FastifyRequest, reply: FastifyReply) {
    const { jobId } = request.params as { jobId: string };
    const routePath = resolveRoutePath(request, 'GET /jobs/:jobId');

    try {
      const authority = await resolveRequestAuthority(request);
      const status = await getWorkspaceOwnedJobStatus(jobId, authority);
      if (!status) {
        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 404,
          jobId,
        });

        return errorResponse(reply, 'not_found');
      }

      logger.info('HTTP request handled', {
        event: 'http_request',
        route: routePath,
        statusCode: 200,
        jobId,
        jobState: status.state,
      });

      return reply.send(status);
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
        jobId,
      });

      return errorResponse(reply, 'internal_error');
    }
  }

  async function handleJobProvenanceRequest(request: FastifyRequest, reply: FastifyReply) {
    const { jobId } = request.params as { jobId: string };
    const routePath = resolveRoutePath(request, 'GET /jobs/:jobId/provenance');

    try {
      const authority = await resolveRequestAuthority(request);
      const provenance = await getJobProvenance(jobId, authority.workspaceId, authority.userId);
      if (!provenance) {
        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 404,
          jobId,
        });
        return errorResponse(reply, 'not_found');
      }

      logger.info('HTTP request handled', {
        event: 'http_request',
        route: routePath,
        statusCode: 200,
        jobId,
      });

      return reply.send(provenance);
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
        jobId,
      });
      return errorResponse(reply, 'internal_error');
    }
  }

  const jobEventsRouteOptions = authenticate ? { preHandler: [authenticate] } : {};

  app.get('/jobs/events', jobEventsRouteOptions, async (request, reply) => {
    const routePath = resolveRoutePath(request, 'GET /jobs/events');
    const query = request.query as { jobId?: unknown; recordingId?: unknown };
    const jobIdParam = query.jobId as string | undefined;
    const recordingIdParam = query.recordingId as string | undefined;
    const rawIds =
      jobIdParam
        ?.split(',')
        .map((id) => id.trim())
        .filter(Boolean) ?? [];
    const rawRecordingIds =
      recordingIdParam
        ?.split(',')
        .map((id) => id.trim())
        .filter(Boolean) ?? [];
    const wantsAll =
      jobIdParam === '*' ||
      recordingIdParam === '*' ||
      rawIds.includes('*') ||
      rawIds.includes('all') ||
      rawRecordingIds.includes('*') ||
      rawRecordingIds.includes('all');
    const jobIds = wantsAll ? [] : rawIds;
    const requestedRecordingIds = wantsAll ? [] : rawRecordingIds;
    const { workspaceId, userId } = await resolveRequestAuthority(request);

    if (!wantsAll && jobIds.length === 0 && requestedRecordingIds.length === 0) {
      return reply.code(400).send({
        error:
          'jobId or recordingId query param is required (use jobId=<id>[,id2], recordingId=<id>[,id2], or jobId=* for all events)',
      });
    }

    const authorizedJobs = wantsAll
      ? []
      : await Promise.all(
          jobIds.map((jobId) => getJobWorkspaceAuthority(jobId, workspaceId, userId)),
        );
    const authorizedRecordings = wantsAll
      ? []
      : await Promise.all(
          requestedRecordingIds.map((id) => getRecordingByIdForWorkspace(id, workspaceId)),
        );
    if (authorizedJobs.some((authority) => !authority) || authorizedRecordings.some((r) => !r)) {
      return errorResponse(reply, 'not_found');
    }

    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');

    reply.raw.flushHeaders?.();
    reply.hijack();

    reply.raw.write(': connected\n\n');

    logger.info('SSE client connected', {
      event: 'job_events_sse_connected',
      route: routePath,
      client: request.ip,
    });

    let closed = false;
    const heartbeat = setInterval(() => {
      if (closed) return;
      try {
        reply.raw.write(':\n\n');
      } catch (error) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        logger.warn('Failed to write SSE heartbeat', {
          event: 'job_events_sse_heartbeat_failed',
          route: routePath,
          error: error instanceof Error ? error.message : String(error),
        });
        cleanup();
      }
    }, 25_000);

    const recordingIds = new Set<string>(requestedRecordingIds);
    const addRecordingId = (recordingId?: string | null) => {
      if (!recordingId || wantsAll) return false;
      if (recordingIds.has(recordingId)) return false;
      recordingIds.add(recordingId);
      return true;
    };

    if (!wantsAll && jobIds.length > 0) {
      try {
        for (const authority of authorizedJobs) {
          if (authority?.recordingId) {
            recordingIds.add(authority.recordingId);
          }
        }
      } catch (error) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        logger.warn('Failed to resolve recording IDs for job SSE subscription', {
          event: 'recording_events_sse_resolve_failed',
          route: routePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    let unsubscribeRecordings = () => {};
    const latestRecordingEventAt = new Map<string, number>();

    const publishCanonicalRecordingEvent = async (
      event: Parameters<Parameters<typeof subscribeRecordingEvents>[0]>[0],
    ) => {
      const recordingId = event.recording.id;
      const recording = recordingToDto(
        { ...event.recording, transcriptId: event.transcriptId ?? null },
        event.run,
      );
      if (closed) return;
      const updatedAt = Date.parse(recording.updatedAt);
      const previousUpdatedAt = latestRecordingEventAt.get(recordingId) ?? Number.NEGATIVE_INFINITY;
      if (Number.isFinite(updatedAt) && updatedAt < previousUpdatedAt) return;
      if (Number.isFinite(updatedAt)) latestRecordingEventAt.set(recordingId, updatedAt);
      const payload: RecordingEventMessage = {
        type: 'recording_state_changed',
        ...recording,
      };
      reply.raw.write(`event: recording_state_changed\n`);
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const subscribeRecordings = () => {
      unsubscribeRecordings();
      if (wantsAll) {
        unsubscribeRecordings = subscribeRecordingEvents(
          (event) => {
            if (!event?.recording || event.recording.workspaceId !== workspaceId) return;
            void publishCanonicalRecordingEvent(event).catch((error: unknown) => {
              logger.warn('Failed to publish SSE recording event', {
                event: 'recording_events_sse_publish_failed',
                route: routePath,
                error: error instanceof Error ? error.message : String(error),
              });
            });
          },
          { allRecordings: true },
        );
        return;
      }

      const ids = [...recordingIds];
      if (ids.length === 0) {
        unsubscribeRecordings = () => {};
        return;
      }

      unsubscribeRecordings = subscribeRecordingEvents(
        (event) => {
          if (!event?.recording || !recordingIds.has(event.recording.id)) return;
          void publishCanonicalRecordingEvent(event).catch((error: unknown) => {
            logger.warn('Failed to publish SSE recording event', {
              event: 'recording_events_sse_publish_failed',
              route: routePath,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        },
        { recordingIds: ids },
      );
    };

    subscribeRecordings();

    const unsubscribeJobs =
      wantsAll || jobIds.length > 0
        ? subscribeJobEvents(
            (event: unknown) => {
              try {
                // Type guard: Check if event has expected structure
                if (
                  !event ||
                  typeof event !== 'object' ||
                  !('job' in event) ||
                  !('type' in event)
                ) {
                  return;
                }
                // Cast to JobEvent-like structure (job-events.ts defines the actual type)
                const typedEvent = event as {
                  job: Parameters<typeof jobRecordToDto>[0];
                  type: string;
                };
                void getJobWorkspaceAuthority(typedEvent.job.id, workspaceId, userId)
                  .then((authority) => {
                    if (!authority || closed) return;
                    const dto = jobRecordToDto(typedEvent.job);
                    if (addRecordingId(dto.recordingId)) {
                      subscribeRecordings();
                    }
                    const payload: JobEventMessage = {
                      type: typedEvent.type as JobEventMessage['type'],
                      jobId: dto.jobId,
                      state: dto.state,
                      payload: {
                        manifestPath: dto.manifestPath,
                        error: dto.error,
                        finishedAt: dto.finishedAt,
                        ttsStrategy: dto.ttsStrategy,
                        learningPresetId: dto.learningPresetId,
                        md: dto.md,
                        mdStorageUri: dto.mdStorageUri,
                        assignmentArtifact: dto.assignmentArtifact,
                        assignmentRendererVersion: dto.assignmentRendererVersion,
                        htmlUrl: dto.htmlUrl,
                        publishTarget: dto.publishTarget,
                        recordingId: dto.recordingId,
                        transcriptId: dto.transcriptId,
                      },
                    };
                    reply.raw.write(`event: ${typedEvent.type}\n`);
                    reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
                  })
                  .catch((error) => {
                    logger.warn('Failed to authorize SSE job event', {
                      event: 'job_events_sse_authorization_failed',
                      route: routePath,
                      error: error instanceof Error ? error.message : String(error),
                    });
                  });
              } catch (error: unknown) {
                if (error instanceof HistoricalAssignmentReadOnlyError)
                  return reply
                    .code(410)
                    .send({ error: error.code, code: error.code, message: error.message });
                logger.warn('Failed to publish SSE job event', {
                  event: 'job_events_sse_publish_failed',
                  route: routePath,
                  error: error instanceof Error ? error.message : String(error),
                });
              }
            },
            wantsAll ? { allJobs: true } : { jobIds },
          )
        : () => {};

    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribeJobs();
      unsubscribeRecordings();
      logger.info('SSE client disconnected', {
        event: 'job_events_sse_disconnected',
        route: routePath,
        client: request.ip,
      });
    };

    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);
  });

  if (authenticate) {
    app.get('/jobs/:jobId', { preHandler: [authenticate] }, handleJobStatusRequest);
  } else {
    app.get('/jobs/:jobId', handleJobStatusRequest);
  }
  if (authenticate) {
    app.get('/jobs/:jobId/provenance', { preHandler: [authenticate] }, handleJobProvenanceRequest);
  } else {
    app.get('/jobs/:jobId/provenance', handleJobProvenanceRequest);
  }
}

interface RequestAuthority {
  userId: string;
  workspaceId: string;
}

async function resolveRequestAuthority(request: FastifyRequest): Promise<RequestAuthority> {
  const user = getAuthenticatedUser(request);
  if (!user) throw new Error('Authenticated workspace authority is required');
  return {
    userId: user.id,
    workspaceId: await resolvePrimaryWorkspaceIdForUser(user.id),
  };
}

async function getWorkspaceOwnedJobStatus(jobId: string, requestAuthority: RequestAuthority) {
  const jobAuthority = await getJobWorkspaceAuthority(
    jobId,
    requestAuthority.workspaceId,
    requestAuthority.userId,
  );
  if (!jobAuthority) return null;
  return getJobStatus(jobId);
}
