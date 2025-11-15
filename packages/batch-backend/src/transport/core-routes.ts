import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  RouteHandlerMethod,
} from 'fastify';
import { z } from 'zod';
import type { JobEventMessage } from '@esl-pipeline/contracts';
import type { BatchBackendConfig } from '../config/env';
import { submitJob, type SubmitJobRequest } from '../application/submit-job';
import { getJobStatus } from '../application/get-job-status';
import { jobRecordToDto } from '../application/job-dto';
import { subscribeJobEvents } from '../domain/job-events';
import { logger } from '../infrastructure/logger';
import { errorResponse, resolveRoutePath } from './route-helpers';

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

    const jobSchema = z.object({
      md: z.string().min(1, 'md is required'),
      preset: z.string().optional(),
      withTts: z.boolean().optional(),
      upload: z.enum(['auto', 's3', 'none']).optional(),
      voiceAccent: z.string().min(1).optional(),
      voiceId: z.string().min(1).optional(),
      forceTts: z.boolean().optional(),
      notionDatabase: z.string().min(1).optional(),
      mode: z.enum(['auto', 'dialogue', 'monologue']).optional(),
    });

    const validatedData = jobSchema.parse(body);

    const result = await submitJob({
      md: validatedData.md,
      preset: validatedData.preset,
      withTts: validatedData.withTts,
      upload: validatedData.upload,
      voiceId: validatedData.voiceId,
      voiceAccent: validatedData.voiceAccent,
      forceTts: validatedData.forceTts,
      notionDatabase: validatedData.notionDatabase,
      mode: validatedData.mode,
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
    } catch (err: any) {
      logger.error(err instanceof Error ? err : String(err), {
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
      } catch (err) {
        logger.warn('Failed to write SSE heartbeat', {
          event: 'job_events_sse_heartbeat_failed',
          route: routePath,
          error: err instanceof Error ? err.message : String(err),
        });
        cleanup();
      }
    }, 25000);

    const unsubscribe = subscribeJobEvents(event => {
      try {
        const dto = jobRecordToDto(event.job);
        const payload: JobEventMessage = {
          type: event.type,
          jobId: dto.jobId,
          state: dto.state,
          payload: {
            manifestPath: dto.manifestPath,
            error: dto.error,
            finishedAt: dto.finishedAt,
            mode: dto.mode,
            md: dto.md,
            notionUrl: dto.notionUrl,
          },
        };
        reply.raw.write(`event: ${event.type}\n`);
        reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
      } catch (err: any) {
        logger.warn('Failed to publish SSE job event', {
          event: 'job_events_sse_publish_failed',
          route: routePath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

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
