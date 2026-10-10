import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { renderAssignmentToHtml } from '@esl-pipeline/html-publisher';
import { resolveConfigPaths } from '@esl-pipeline/orchestrator';
import {
  type PronunciationAudioPayload,
  resolveHeadingTheme,
} from '@esl-pipeline/shared-infrastructure';

import {
  AssignmentArtifactValidationError,
  admitAssignment,
  assignmentContext,
} from '../../application/assignment-artifact.js';
import { PromptPackageAssignmentError } from '../../application/create-prompt-package.js';
import { GenerateDraftProviderError, generateDraft } from '../../application/generate-draft.js';
import { getJobOptions } from '../../application/get-job-options.js';
import { getPromptOptions } from '../../application/get-prompt-options.js';
import { getStudentProfiles } from '../../application/get-student-profiles.js';
import {
  HistoricalAssignmentReadOnlyError,
  requireTypedAssignment,
} from '../../application/historical-assignment.js';
import { PromptOptionError } from '../../application/prompt-options.js';
import { StudentProfileStoreError } from '../../application/student-profiles-store.js';
import {
  resolvePrimaryWorkspaceIdForUser,
  WorkspaceContextError,
} from '../../application/workspace-context.js';
import {
  getPromptPackageById,
  isPromptPackageAccessibleForUser,
} from '../../domain/prompt-package-repository.js';
import { getDefaultSettings } from '../../domain/settings-model.js';
import { createDefaultSettings, getSettingsByUserId } from '../../domain/settings-repository.js';
import { logger } from '../../infrastructure/logger.js';
import { getAuthenticatedUser } from '../auth-middleware.js';
import { errorResponse, resolveRoutePath } from '../route-helpers.js';
import type { ExtendedRoutesContext } from './context.js';

async function loadPresetFromFile(
  presetName: string,
  presetsPath: string,
): Promise<{ h2?: string; h3?: string } | null> {
  const parsed = JSON.parse(await readFile(presetsPath, 'utf8')) as Record<
    string,
    { h2?: string; h3?: string }
  >;
  return parsed[presetName] ?? null;
}

function resolveHeadingThemeFromPreset(
  preset: { h2?: string; h3?: string } | null | undefined,
): { h2?: string; h3?: string } | undefined {
  return resolveHeadingTheme(preset);
}

export function registerConfigRoutes(app: FastifyInstance, context: ExtendedRoutesContext): void {
  const { authenticate, config } = context;

  app.get(
    '/config/job-options',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /config/job-options');
      try {
        const options = await getJobOptions();
        reply.header('Cache-Control', 'private, max-age=60');

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
        });

        return reply.send(options);
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        if (error instanceof PromptOptionError) {
          return reply.code(400).send({
            error: error.code,
            message: error.message,
            code: error.code,
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
    '/config/students',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /config/students');
      try {
        const authenticatedUser = getAuthenticatedUser(request);
        if (!authenticatedUser) {
          throw new WorkspaceContextError('Authentication required');
        }
        const workspaceId = await resolvePrimaryWorkspaceIdForUser(authenticatedUser.id);
        const students = await getStudentProfiles({ workspaceId });
        reply.header('Cache-Control', 'private, max-age=60');

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
        });

        return reply.send(students);
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        if (error instanceof StudentProfileStoreError) {
          return reply.code(error.status).send({
            error: error.code,
            message: error.message,
            code: error.code,
          });
        }
        if (error instanceof WorkspaceContextError) {
          return reply.code(error.status).send({
            error: error.code,
            message: error.message,
            code: error.code,
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
    '/config/prompts',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /config/prompts');
      try {
        const prompts = await getPromptOptions();
        reply.header('Cache-Control', 'private, max-age=60');

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
        });

        return reply.send(prompts);
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
        });

        return errorResponse(reply, 'internal_error');
      }
    },
  );

  app.post(
    '/generation/drafts',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'POST /generation/drafts');

      const schema = z.object({
        promptPackageId: z.string().min(1),
        provider: z.enum(['openai']).optional(),
        model: z.string().min(1).optional(),
        maxOutputTokens: z.number().int().positive().optional(),
        stream: z.boolean().optional(),
      });

      try {
        const body = schema.parse(request.body ?? {});
        const generated = await generateDraft(body, { config });

        if (!generated) {
          logger.info('Draft generation skipped; prompt package missing', {
            event: 'generation_draft_not_found',
            route: routePath,
            promptPackageId: body.promptPackageId,
          });
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          provider: generated.provider,
          model: generated.model,
        });

        return reply.send(generated);
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

        if (error instanceof GenerateDraftProviderError) {
          return reply.code(error.statusCode).send({
            error: 'internal_error',
            code: error.category,
            message: error.message,
            provider: error.provider,
            model: error.model,
            ...(error.limitType
              ? {
                  limitType: error.limitType,
                  limit: error.limit ?? null,
                  used: error.used ?? null,
                  window: error.window ?? null,
                }
              : {}),
            requestId: String(request.id),
            timestamp: new Date().toISOString(),
          });
        }

        if (error instanceof PromptPackageAssignmentError) {
          return reply.code(409).send({
            error: 'conflict',
            code: error.code,
            message: error.message,
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

  app.post('/validation/markdown', { preHandler: [authenticate] }, async (_request, reply) => {
    const error = new HistoricalAssignmentReadOnlyError();
    return reply
      .code(error.statusCode)
      .send({ error: error.code, code: error.code, message: error.message });
  });

  app.post(
    '/preview/html',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'POST /preview/html');
      const schema = z.object({
        text: z.string().min(1).optional(),
        assignment: z.unknown().optional(),
        promptPackageId: z.string().min(1).optional(),
        title: z.string().trim().min(1).optional(),
        learningPresetId: z.string().trim().min(1).nullable().optional(),
        audioUrl: z.string().trim().nullable().optional(),
        pronunciationAudioUrl: z.string().trim().nullable().optional(),
        pronunciationAudio: z.record(z.string(), z.unknown()).nullable().optional(),
      });

      try {
        const body = schema.parse(request.body ?? {});
        let assignment: import('@esl-pipeline/contracts').AssignmentV1 | undefined;
        if (body.assignment !== undefined) {
          const userId = getAuthenticatedUser(request)?.id;
          if (
            !userId ||
            !body.promptPackageId ||
            !(await isPromptPackageAccessibleForUser(body.promptPackageId, userId))
          )
            return errorResponse(reply, 'not_found');
          const prompt = await getPromptPackageById(body.promptPackageId);
          if (!prompt) return errorResponse(reply, 'not_found');
          assignment = admitAssignment(JSON.stringify(body.assignment), assignmentContext(prompt));
        }
        requireTypedAssignment(assignment);
        let headingTheme: { h2?: string; h3?: string } | undefined;
        let presetName: string | undefined;
        if (body.learningPresetId?.trim()) {
          const defaults = getDefaultSettings();
          presetName = defaults.defaultPreset;
          const authenticatedUser = getAuthenticatedUser(request);
          if (authenticatedUser?.id) {
            let settings = await getSettingsByUserId(authenticatedUser.id);
            if (!settings) {
              settings = await createDefaultSettings(authenticatedUser.id);
            }
            presetName = settings.defaultPreset || presetName;
          }
        }
        if (presetName) {
          const configPaths = resolveConfigPaths({
            configDir: config.orchestrator.configDir,
            cwd: process.env.PIPELINE_CWD || process.cwd(),
          });
          try {
            const preset = await loadPresetFromFile(presetName, configPaths.presetsPath);
            headingTheme = resolveHeadingThemeFromPreset(preset);
          } catch (error) {
            if (error instanceof HistoricalAssignmentReadOnlyError)
              return reply
                .code(410)
                .send({ error: error.code, code: error.code, message: error.message });
            logger.warn(
              'Failed to resolve preset for HTML preview. Falling back to default theme.',
              {
                event: 'preview_preset_fallback',
                route: routePath,
                preset: presetName,
                error: error instanceof Error ? error.message : String(error),
              },
            );
          }
        }

        const html = await renderAssignmentToHtml(assignment, {
          headingTheme,
          studyTextAudioUrl: body.audioUrl,
          pronunciationAudioUrl: body.pronunciationAudioUrl,
          pronunciationAudio: body.pronunciationAudio as
            | PronunciationAudioPayload
            | null
            | undefined,
          preview: true,
        });

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
        });

        return reply.send({ html });
      } catch (error: unknown) {
        if (error instanceof HistoricalAssignmentReadOnlyError)
          return reply
            .code(410)
            .send({ error: error.code, code: error.code, message: error.message });
        if (error instanceof AssignmentArtifactValidationError)
          return reply
            .code(400)
            .send({ error: 'validation_failed', code: error.code, message: error.message });
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request body',
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
