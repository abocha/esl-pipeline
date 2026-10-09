import { resolve } from 'node:path';
import Fastify from 'fastify';

import { createPipeline, noopLogger, noopMetrics } from '../../dist/index.js';

/** @param {{ pipelineRoot?: string; logger?: boolean }} options */
export function createService(options = {}) {
  const fastify = Fastify({ logger: options.logger ?? true });
  const pipelineRoot = options.pipelineRoot ?? process.env.PIPELINE_CWD ?? process.cwd();
  const pipeline = createPipeline({
    cwd: pipelineRoot,
    defaultOutDir: resolve(pipelineRoot, '.pipeline-out'),
    logger: noopLogger,
    metrics: noopMetrics,
  });

  fastify.post('/jobs', async (request, reply) => {
    const body = request.body;
    if (!body?.md || !body.assignment) {
      reply.code(400);
      return { error: 'Missing md locator or AssignmentV1 payload' };
    }
    try {
      const mdPath = resolve(pipelineRoot, body.md);
      const result = await pipeline.newAssignment({
        ...body,
        assignment: body.assignment,
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
      return { error: error.message };
    }
  });

  return fastify;
}
