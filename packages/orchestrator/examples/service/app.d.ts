import type { FastifyInstance } from 'fastify';

export function createService(options?: {
  pipelineRoot?: string;
  logger?: boolean;
}): FastifyInstance;
