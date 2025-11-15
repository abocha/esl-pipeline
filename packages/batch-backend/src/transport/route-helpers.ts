import type { FastifyReply, FastifyRequest } from 'fastify';

export type ErrorResponseType = 'validation_failed' | 'not_found' | 'internal_error';

export function errorResponse(
  reply: FastifyReply,
  type: ErrorResponseType,
  extras?: Record<string, any>
) {
  if (type === 'validation_failed') {
    const { message, code } = extras ?? {};
    return reply.code(400).send({
      error: 'validation_failed',
      message: String(message ?? 'Validation failed'),
      code: String(code ?? 'validation_failed'),
    });
  }

  if (type === 'not_found') {
    return reply.code(404).send({ error: 'not_found' });
  }

  return reply.code(500).send({ error: 'internal_error' });
}

export const resolveRoutePath = (request: FastifyRequest, fallback: string): string => {
  return (
    ((request as any).routerPath as string | undefined) ??
    request.routeOptions?.url ??
    request.raw?.url ??
    request.url ??
    fallback
  );
};
