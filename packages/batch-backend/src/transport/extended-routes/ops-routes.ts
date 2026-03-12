import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { OpsActionRequest } from '@esl-pipeline/contracts';

import {
  enqueueOpsAction,
  getOpsActionStatus,
  getOpsStatus,
  isValidOpsBotSecret,
  shouldRequireOpsBotSecret,
} from '../../application/ops-control.js';
import { logger } from '../../infrastructure/logger.js';
import { getAuthenticatedUser, requireRole } from '../auth-middleware.js';
import type { ExtendedRoutesContext } from './context.js';

export function registerOpsRoutes(app: FastifyInstance, context: ExtendedRoutesContext): void {
  if (!context.config.opsControl.enabled) {
    return;
  }

  const { authenticate } = context;
  const ensureOpsBotSecret = (request: FastifyRequest, reply: FastifyReply): boolean => {
    if (!shouldRequireOpsBotSecret()) return true;
    const presentedSecret = resolveOpsBotSecretHeader(request);
    if (isValidOpsBotSecret(presentedSecret)) return true;
    void reply.code(403).send({
      error: 'forbidden',
      message: 'Missing or invalid x-ops-bot-secret header',
      code: 'ops_bot_secret_invalid',
    });
    return false;
  };

  app.get(
    '/ops/status',
    { preHandler: [authenticate, requireRole(['admin'])] },
    async (request, reply) => {
      if (!ensureOpsBotSecret(request, reply)) return;
      try {
        const status = await getOpsStatus();
        return reply.code(200).send(status);
      } catch (error: unknown) {
        logger.error(error instanceof Error ? error : String(error), {
          event: 'ops_status_failed',
          userId: getAuthenticatedUser(request)?.id,
        });
        return reply.code(500).send({
          error: 'internal_error',
          message: 'Failed to collect ops status',
        });
      }
    },
  );

  app.post(
    '/ops/actions',
    { preHandler: [authenticate, requireRole(['admin'])] },
    async (request, reply) => {
      if (!ensureOpsBotSecret(request, reply)) return;
      const bodySchema = z.object({
        action: z.enum(['backup_upload', 'restore_drill_download_only']),
        label: z.string().trim().min(1).max(120).optional(),
      });

      try {
        const body = bodySchema.parse(request.body ?? {}) as OpsActionRequest;
        const authenticatedUser = getAuthenticatedUser(request);
        const status = await enqueueOpsAction(body, {
          requestedBy: authenticatedUser ? `${authenticatedUser.email}` : null,
          requestedByUserId: authenticatedUser?.id ?? null,
        });
        return reply.code(202).send(status);
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid ops action payload',
            details: error.issues,
          });
        }

        logger.error(error instanceof Error ? error : String(error), {
          event: 'ops_action_enqueue_failed',
          userId: getAuthenticatedUser(request)?.id,
        });
        return reply.code(500).send({
          error: 'internal_error',
          message: 'Failed to enqueue ops action',
        });
      }
    },
  );

  app.get(
    '/ops/actions/:operationId',
    { preHandler: [authenticate, requireRole(['admin'])] },
    async (request, reply) => {
      if (!ensureOpsBotSecret(request, reply)) return;
      const paramsSchema = z.object({
        operationId: z.string().min(1),
      });

      try {
        const { operationId } = paramsSchema.parse(request.params ?? {});
        const status = getOpsActionStatus(operationId);
        if (!status) {
          return reply.code(404).send({
            error: 'not_found',
            message: 'Ops action not found',
            code: 'ops_action_not_found',
          });
        }
        return reply.code(200).send(status);
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid operation id',
            details: error.issues,
          });
        }
        logger.error(error instanceof Error ? error : String(error), {
          event: 'ops_action_status_failed',
          userId: getAuthenticatedUser(request)?.id,
        });
        return reply.code(500).send({
          error: 'internal_error',
          message: 'Failed to fetch ops action status',
        });
      }
    },
  );
}

function resolveOpsBotSecretHeader(request: FastifyRequest): string | undefined {
  const value = request.headers['x-ops-bot-secret'];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}
