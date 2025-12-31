import type { FastifyInstance, FastifyReply, FastifyRequest, RouteHandlerMethod } from 'fastify';
import { z } from 'zod';

import type { JobEventMessage } from '@esl-pipeline/contracts';

import { approveJobForPipeline } from '../application/approve-job.js';
import { getJobStatus } from '../application/get-job-status.js';
import { jobRecordToDto } from '../application/job-dto.js';
import { type SubmitJobRequest, submitJob } from '../application/submit-job.js';
import type { BatchBackendConfig } from '../config/env.js';
import { subscribeJobEvents } from '../domain/job-events.js';
import { logger } from '../infrastructure/logger.js';
import { errorResponse, resolveRoutePath } from './route-helpers.js';

type AsyncPreHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface CoreRouteOptions {
  config: BatchBackendConfig;
  jobRateLimitMiddleware?: AsyncPreHandler | null;
  authenticate?: AsyncPreHandler;
}

export function registerCoreRoutes(app: FastifyInstance, options: CoreRouteOptions): void {
  const { jobRateLimitMiddleware, authenticate, config } = options;

  const handleSubmitJob: RouteHandlerMethod = async (request, reply) => {
    const body = request.body as SubmitJobRequest | undefined;

    const jobSchema = z
      .object({
        md: z.string().min(1).optional(),
        transcribeWorkdir: z.string().min(1).optional(),
        promptNotes: z.string().optional(),
        profilePath: z.string().min(1).optional(),
        preset: z.string().optional(),
        withTts: z.boolean().optional(),
        upload: z.enum(['auto', 's3', 'none']).optional(),
        voiceAccent: z.string().min(1).optional(),
        voiceId: z.string().min(1).optional(),
        forceTts: z.boolean().optional(),
        notionDatabase: z.string().min(1).optional(),
        ttsStrategy: z.enum(['auto', 'dialogue', 'tts']).optional(),
      })
      .superRefine((data, ctx) => {
        const hasMd = typeof data.md === 'string' && data.md.trim().length > 0;
        const hasTranscribe =
          typeof data.transcribeWorkdir === 'string' && data.transcribeWorkdir.trim().length > 0;
        if (!hasMd && !hasTranscribe) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'md or transcribeWorkdir is required',
            path: ['md'],
          });
        }
        if (hasMd && hasTranscribe) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Provide either md or transcribeWorkdir, not both',
            path: ['md'],
          });
        }
      });

    const validatedData = jobSchema.parse(body);

    const result = await submitJob({
      md: validatedData.md,
      transcribeWorkdir: validatedData.transcribeWorkdir,
      promptNotes: validatedData.promptNotes,
      profilePath: validatedData.profilePath,
      preset: validatedData.preset,
      withTts: validatedData.withTts,
      upload: validatedData.upload,
      voiceId: validatedData.voiceId,
      voiceAccent: validatedData.voiceAccent,
      forceTts: validatedData.forceTts,
      notionDatabase: validatedData.notionDatabase,
      ttsStrategy: validatedData.ttsStrategy,
    });

    logger.info('HTTP request handled', {
      event: 'http_request',
      route: 'POST /jobs',
      statusCode: 202,
      jobId: result.jobId,
    });

    return reply.code(202).send(result);
  };

  if (jobRateLimitMiddleware) {
    app.post('/jobs', { preHandler: [jobRateLimitMiddleware] }, handleSubmitJob);
  } else {
    app.post('/jobs', handleSubmitJob);
  }

  const approveJobRouteOptions = authenticate ? { preHandler: [authenticate] } : {};

  app.post('/jobs/:jobId/approve', approveJobRouteOptions, async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const routePath = resolveRoutePath(request, 'POST /jobs/:jobId/approve');

    const body = request.body as { md?: string } | undefined;
    const schema = z.object({
      md: z.string().min(1, 'md is required'),
    });

    try {
      const validated = schema.parse(body);
      const approved = await approveJobForPipeline(jobId, validated.md);

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
      const status = await getJobStatus(jobId);
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

  const jobEventsRouteOptions =
    config.experimental.extendedApiEnabled && authenticate
      ? {
          preHandler: [authenticate],
        }
      : {};

  app.get('/jobs/events', jobEventsRouteOptions, (request, reply) => {
    const routePath = resolveRoutePath(request, 'GET /jobs/events');
    const jobIdParam = (request.query as { jobId?: unknown })?.jobId as string | undefined;
    const rawIds =
      jobIdParam
        ?.split(',')
        .map((id) => id.trim())
        .filter(Boolean) ?? [];
    const wantsAll = jobIdParam === '*' || rawIds.includes('*') || rawIds.includes('all');
    const jobIds = wantsAll ? [] : rawIds;

    if (!wantsAll && jobIds.length === 0) {
      return reply.code(400).send({
        error: 'jobId query param is required (use jobId=<id>[,id2] or jobId=* for all events)',
      });
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
        logger.warn('Failed to write SSE heartbeat', {
          event: 'job_events_sse_heartbeat_failed',
          route: routePath,
          error: error instanceof Error ? error.message : String(error),
        });
        cleanup();
      }
    }, 25_000);

    const unsubscribe = subscribeJobEvents(
      (event: unknown) => {
        try {
          // Type guard: Check if event has expected structure
          if (!event || typeof event !== 'object' || !('job' in event) || !('type' in event)) {
            return;
          }
          // Cast to JobEvent-like structure (job-events.ts defines the actual type)
          const typedEvent = event as { job: unknown; type: string };
          const dto = jobRecordToDto(typedEvent.job as Parameters<typeof jobRecordToDto>[0]);
          const payload: JobEventMessage = {
            type: typedEvent.type as JobEventMessage['type'],
            jobId: dto.jobId,
            state: dto.state,
            payload: {
              manifestPath: dto.manifestPath,
              error: dto.error,
              finishedAt: dto.finishedAt,
              ttsStrategy: dto.ttsStrategy,
              md: dto.md,
              notionUrl: dto.notionUrl,
            },
          };
          reply.raw.write(`event: ${typedEvent.type}\n`);
          reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
        } catch (error: unknown) {
          logger.warn('Failed to publish SSE job event', {
            event: 'job_events_sse_publish_failed',
            route: routePath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
      wantsAll ? { allJobs: true } : { jobIds },
    );

    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      logger.info('SSE client disconnected', {
        event: 'job_events_sse_disconnected',
        route: routePath,
        client: request.ip,
      });
    };

    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);
  });

  app.get('/jobs/:jobId', handleJobStatusRequest);
  app.get('/jobs/:jobId/status', handleJobStatusRequest);
}
