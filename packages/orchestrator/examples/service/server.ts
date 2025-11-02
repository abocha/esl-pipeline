import Fastify from 'fastify';
import { resolve } from 'node:path';
import {
  createPipeline,
  type PipelineNewAssignmentOptions,
  noopLogger,
  noopMetrics,
} from '../../src/index.js';

const fastify = Fastify({ logger: true });

const pipelineRoot = process.env.PIPELINE_CWD ?? process.cwd();
const pipeline = createPipeline({
  cwd: pipelineRoot,
  defaultOutDir: resolve(pipelineRoot, '.pipeline-out'),
  logger: noopLogger,
  metrics: noopMetrics,
});

type JobRequestBody = PipelineNewAssignmentOptions & { jobId?: string };

fastify.post('/jobs', async (request, reply) => {
  const body = request.body as Partial<JobRequestBody>;
  if (!body?.md) {
    reply.code(400);
    return { error: 'Missing md path' };
  }
  try {
    const mdPath = resolve(pipelineRoot, body.md);
    const result = await pipeline.newAssignment({
      ...body,
      md: mdPath,
      withTts: false,
      dryRun: true,
      skipImport: true,
      skipUpload: true,
      skipTts: true,
    });
    return {
      jobId: body.jobId ?? body.md,
      result,
    };
  } catch (error) {
    request.log.error({ err: error }, 'pipeline error');
    reply.code(500);
    return { error: (error as Error).message };
  }
});

const port = Number(process.env.PORT ?? 8080);
fastify.listen({ port, host: '0.0.0.0' }).then(() => {
  fastify.log.info(`service listening on ${port}`);
});
