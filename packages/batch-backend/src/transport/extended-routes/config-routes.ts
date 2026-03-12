import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { createStaticPageHtml } from '@esl-pipeline/html-publisher';
import { validateMarkdown } from '@esl-pipeline/md-validator';
import { loadPreset } from '@esl-pipeline/notion-adapter';
import { resolveConfigPaths } from '@esl-pipeline/orchestrator';
import {
  insertGeneratedAudioLinks,
  resolveHeadingTheme,
  resolveMarkdownTitle,
} from '@esl-pipeline/shared-infrastructure';

import { GenerateDraftProviderError, generateDraft } from '../../application/generate-draft.js';
import { getJobOptions } from '../../application/get-job-options.js';
import { getPromptOptions } from '../../application/get-prompt-options.js';
import { getStudentProfiles } from '../../application/get-student-profiles.js';
import { PromptOptionError } from '../../application/prompt-options.js';
import { StudentProfileStoreError } from '../../application/student-profiles-store.js';
import { getDefaultSettings } from '../../domain/settings-model.js';
import { createDefaultSettings, getSettingsByUserId } from '../../domain/settings-repository.js';
import { logger } from '../../infrastructure/logger.js';
import { metrics } from '../../infrastructure/metrics.js';
import { getAuthenticatedUser } from '../auth-middleware.js';
import { errorResponse, resolveRoutePath } from '../route-helpers.js';
import type { ExtendedRoutesContext } from './context.js';

const PRONUNCIATION_HEADING_REGEX = /^###\s+.*pronunciation.*micro.*focus/i;
const GENERATED_STUDY_PLACEHOLDER_MARKER = '<!-- esl-generated-study-text-audio-placeholder -->';
const GENERATED_PRONUNCIATION_PLACEHOLDER_MARKER =
  '<!-- esl-generated-pronunciation-audio-placeholder -->';

function parsePronunciationMode(markdown: string): string | null {
  const lines = markdown.split('\n');
  let inPronunciationSection = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (PRONUNCIATION_HEADING_REGEX.test(trimmed)) {
      inPronunciationSection = true;
      continue;
    }
    if (inPronunciationSection && /^#{2,3}\s+/.test(trimmed)) {
      return null;
    }
    if (!inPronunciationSection) {
      continue;
    }
    const withoutBullet = trimmed.replace(/^\s*(?:[-*]\s+)?/, '').trim();
    const normalizedLine = /^`[^`]+`$/.test(withoutBullet)
      ? withoutBullet.slice(1, -1).trim()
      : withoutBullet;
    const modeMatch = /^(?:\*\*)?mode\s*:\s*(?:\*\*)?\s*(.+?)\s*$/i.exec(normalizedLine);
    if (!modeMatch?.[1]) {
      continue;
    }
    const rawMode = modeMatch[1].trim();
    const unwrappedMode = /^`[^`]+`$/.test(rawMode) ? rawMode.slice(1, -1).trim() : rawMode;
    return unwrappedMode.toLowerCase();
  }

  return null;
}

function hasPronunciationReferenceMode(markdown: string): boolean {
  const mode = parsePronunciationMode(markdown);
  if (!mode) return false;
  return mode === 'shadow_sentence' || mode === 'connected_speech';
}

function resolveHeadingThemeFromPreset(
  preset: { h2?: string; h3?: string } | null | undefined,
): { h2?: string; h3?: string } | undefined {
  return resolveHeadingTheme(preset);
}

function resolvePreviewTitle(markdown: string, explicitTitle?: string): string {
  return resolveMarkdownTitle({
    markdown,
    fallback: 'Assignment Preview',
    explicitTitle,
    preferFrontmatterTitle: true,
  });
}

function insertGeneratedPreviewAudio(
  markdown: string,
  options: {
    studyTextAudioUrl?: string | null;
    pronunciationAudioUrl?: string | null;
    includePronunciation: boolean;
  },
): string {
  return insertGeneratedAudioLinks(markdown, {
    studyTextUrl: options.studyTextAudioUrl,
    pronunciationShadowSentenceUrl: options.pronunciationAudioUrl,
    includePronunciation: options.includePronunciation,
    insertStudyPlaceholderWhenMissing: true,
    insertPronunciationPlaceholderWhenMissing: options.includePronunciation,
    removeGeneratedPlaceholderMarkers: {
      study: GENERATED_STUDY_PLACEHOLDER_MARKER,
      pronunciation: GENERATED_PRONUNCIATION_PLACEHOLDER_MARKER,
    },
  });
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
        const students = await getStudentProfiles();
        reply.header('Cache-Control', 'private, max-age=60');

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
        });

        return reply.send(students);
      } catch (error: unknown) {
        if (error instanceof StudentProfileStoreError) {
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
        provider: z.enum(['openai', 'google_ai_studio', 'openrouter']).optional(),
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
    '/validation/markdown',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'POST /validation/markdown');
      const schema = z.object({
        text: z.string().min(1),
        strict: z.boolean().optional(),
        learningPresetId: z.string().trim().min(1).optional(),
        learningPresetVersion: z.string().trim().min(1).optional(),
      });

      try {
        const body = schema.parse(request.body ?? {});
        const result = await validateMarkdown({
          markdown: body.text,
          strict: body.strict,
          learningPresetId: body.learningPresetId,
          learningPresetVersion: body.learningPresetVersion,
        });
        const diagnostics = result.voiceDiagnostics;
        if (diagnostics?.errors && diagnostics.errors.length > 0) {
          metrics.increment('esl.voice_alignment.validation_failures', diagnostics.errors.length, {
            route: 'validation_markdown',
          });
        }
        const shadowMismatches = diagnostics?.shadowMode?.mismatchClasses;
        if (diagnostics?.shadowMode?.enabled && shadowMismatches) {
          for (const [mismatchClass, count] of Object.entries(shadowMismatches)) {
            metrics.increment('esl.voice_alignment.shadow_mismatch', count, {
              route: 'validation_markdown',
              mismatchClass,
            });
          }
          const total =
            diagnostics.shadowMode.mismatchTotal ??
            Object.values(shadowMismatches).reduce((sum, value) => sum + value, 0);
          if (total > 0) {
            metrics.increment('esl.voice_alignment.shadow_mismatch_total', total, {
              route: 'validation_markdown',
            });
            logger.info('Voice alignment shadow mismatches observed', {
              event: 'voice_alignment_shadow_mismatch',
              route: routePath,
              mismatchClasses: shadowMismatches,
              mismatchTotal: total,
            });
          }
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
        });

        return reply.send(result);
      } catch (error: unknown) {
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

  app.post(
    '/preview/html',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'POST /preview/html');
      const schema = z.object({
        text: z.string().min(1),
        title: z.string().trim().min(1).optional(),
        learningPresetId: z.string().trim().min(1).nullable().optional(),
        audioUrl: z.string().trim().nullable().optional(),
        pronunciationAudioUrl: z.string().trim().nullable().optional(),
      });

      try {
        const body = schema.parse(request.body ?? {});
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
            const preset = await loadPreset(presetName, configPaths.presetsPath);
            headingTheme = resolveHeadingThemeFromPreset(preset);
          } catch (error) {
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

        const markdown = insertGeneratedPreviewAudio(body.text, {
          studyTextAudioUrl: body.audioUrl,
          pronunciationAudioUrl: body.pronunciationAudioUrl,
          includePronunciation: hasPronunciationReferenceMode(body.text),
        });
        const html = await createStaticPageHtml(markdown, resolvePreviewTitle(body.text, body.title), {
          headingTheme,
        });

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
        });

        return reply.send({ html });
      } catch (error: unknown) {
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
