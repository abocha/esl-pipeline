import multipart from '@fastify/multipart';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { z } from 'zod';

import type { JobState, OpsActionRequest, SttProviderId } from '@esl-pipeline/contracts';
import { createStaticPageHtml } from '@esl-pipeline/html-publisher';
import { validateMarkdown } from '@esl-pipeline/md-validator';
import { loadPreset } from '@esl-pipeline/notion-adapter';
import { resolveConfigPaths } from '@esl-pipeline/orchestrator';
import {
  insertGeneratedAudioLinks,
  resolveHeadingTheme,
  resolveMarkdownTitle,
} from '@esl-pipeline/shared-infrastructure';

import { createDraft } from '../application/create-draft.js';
import { GenerateDraftProviderError, generateDraft } from '../application/generate-draft.js';
import { createPromptPackage } from '../application/create-prompt-package.js';
import { getDraft } from '../application/get-draft.js';
import { getJobOptions } from '../application/get-job-options.js';
import { getPromptOptions } from '../application/get-prompt-options.js';
import { getPromptPackage, getPromptPackageLineage } from '../application/get-prompt-package.js';
import { getRecordingTranscript } from '../application/get-recording-transcript.js';
import { getRecording } from '../application/get-recording.js';
import { getStudentProfiles } from '../application/get-student-profiles.js';
import { ingestRecordingUpload } from '../application/ingest-recording-upload.js';
import { getJobSummaryWithDefaults } from '../application/job-summary.js';
import { listJobsWithDefaults } from '../application/list-jobs.js';
import { listRecordingsWithDefaults } from '../application/list-recordings.js';
import { materializeDraft } from '../application/materialize-draft.js';
import {
  enqueueOpsAction,
  getOpsActionStatus,
  getOpsStatus,
  isValidOpsBotSecret,
  shouldRequireOpsBotSecret,
} from '../application/ops-control.js';
import { getReadinessMetricsWithDefaults } from '../application/readiness-metrics.js';
import {
  activateProfileRevisionForProfile,
  ProfileContentError,
  deleteProfileContent,
  getProfileContent,
  getProfileRevisionForProfile,
  listProfileContents,
  listProfileRevisionsForProfile,
  restoreProfileRevision,
  upsertProfileContent,
} from '../application/profile-content.js';
import { ProfilePathError } from '../application/profile-path.js';
import { PromptOptionError } from '../application/prompt-options.js';
import { recordingToDto } from '../application/recording-dto.js';
import {
  RecordingRetryError,
  retryRecordingTranscription,
} from '../application/retry-recording-transcription.js';
import {
  TemplateContentError,
  deleteTemplateContent,
  activateTemplateRevisionForTemplate,
  getTemplateContent,
  getTemplateRevisionForTemplate,
  listTemplateContents,
  listTemplateRevisionsForTemplate,
  restoreTemplateRevision,
  upsertTemplateContent,
} from '../application/template-content.js';
import {
  StudentProfileStoreError,
  createStudentProfile,
  deleteStudentProfile,
  getStudentProfileById,
  listStudentProfiles,
  updateStudentProfile,
} from '../application/student-profiles-store.js';
import {
  getActiveStudentProfileBindingForStudent,
  listStudentProfileBindingsForStudent,
  resolveStudentProfileBindingAt,
} from '../application/student-profile-bindings.js';
import { getStudentSummaryWithDefaults } from '../application/student-summary.js';
import { type StudentTimelineType, getStudentTimeline } from '../application/student-timeline.js';
import { SubmitJobRequest, ValidationError, submitJob } from '../application/submit-job.js';
import { updateRecordingTranscript } from '../application/update-recording-transcript.js';
import type { BatchBackendConfig } from '../config/env.js';
import { RecordingSourceSchema, RecordingStatusSchema } from '../domain/recording-model.js';
import {
  getRecordingById,
  listRecordingsBySha256,
  insertRecording,
  updateRecordingStatus,
} from '../domain/recording-repository.js';
import type { TranscriptRecord } from '../domain/transcript-model.js';
import { getTranscriptByRecordingId } from '../domain/transcript-repository.js';
import {
  getDefaultSettings,
  UserSettingsInput,
  isValidTtsProvider,
  isValidTtsStrategy,
  sanitizeSettings,
} from '../domain/settings-model.js';
import {
  createDefaultSettings,
  getSettingsByUserId,
  upsertSettings,
} from '../domain/settings-repository.js';
import { deriveStudentId, normalizeStudentName } from '../domain/student-utils.js';
import {
  UserLogin,
  UserRegistration,
  UserRole,
  isValidRole,
  sanitizeUser,
} from '../domain/user-model.js';
import {
  countUsers,
  createUser,
  getAllUsers,
  getUserByEmail,
  getUserById,
  updateUserLastLogin,
} from '../domain/user-repository.js';
import type { AuthService } from '../infrastructure/auth-service.js';
import {
  FileSanitizationError,
  type FileSanitizationService,
} from '../infrastructure/file-sanitization-service.js';
import { FileStorageService } from '../infrastructure/file-storage-service.js';
import {
  FileValidationError,
  type FileValidationService,
} from '../infrastructure/file-validation-service.js';
import { logger } from '../infrastructure/logger.js';
import { metrics } from '../infrastructure/metrics.js';
import { StorageConfigurationService } from '../infrastructure/storage-config.js';
import { createTranscribeQueue } from '../infrastructure/transcribe-queue.js';
import {
  createTranscriptionStorage,
  createTranscriptionStorageForUri,
} from '../infrastructure/transcription-storage.js';
import { getAuthenticatedUser, requireRole } from './auth-middleware.js';
import { errorResponse, resolveRoutePath } from './route-helpers.js';

type AsyncPreHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface ExtendedRouteOptions {
  config: BatchBackendConfig;
  authService: AuthService;
  authenticate: AsyncPreHandler;
  uploadRateLimitMiddleware: AsyncPreHandler;
  fileValidationService: FileValidationService | null;
  recordingUploadValidationService: FileValidationService | null;
  fileSanitizationService: FileSanitizationService | null;
  storageConfig: StorageConfigurationService;
  fileStorageService: FileStorageService;
}

function buildRefreshCookieOptions(
  config: BatchBackendConfig,
  refreshExpiresInSeconds: number,
): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path: string;
  domain?: string;
  expires: Date;
} {
  return {
    httpOnly: true,
    secure: config.auth.refreshCookieSecure,
    sameSite: config.auth.refreshCookieSameSite,
    path: config.auth.refreshCookiePath,
    domain: config.auth.refreshCookieDomain,
    expires: new Date(Date.now() + refreshExpiresInSeconds * 1000),
  };
}

function setRefreshCookie(
  reply: FastifyReply,
  config: BatchBackendConfig,
  refreshToken: string,
  refreshExpiresInSeconds: number,
): void {
  reply.setCookie(
    config.auth.refreshCookieName,
    refreshToken,
    buildRefreshCookieOptions(config, refreshExpiresInSeconds),
  );
}

function clearRefreshCookie(reply: FastifyReply, config: BatchBackendConfig): void {
  reply.clearCookie(config.auth.refreshCookieName, {
    path: config.auth.refreshCookiePath,
    domain: config.auth.refreshCookieDomain,
  });
}

function resolveOpsBotSecretHeader(request: FastifyRequest): string | undefined {
  const value = request.headers['x-ops-bot-secret'];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

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
    const modeMatch =
      /^(?:\*\*)?mode\s*:\s*(?:\*\*)?\s*(.+?)\s*$/i.exec(normalizedLine);
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

function normalizeSttProvider(
  value: unknown,
): SttProviderId | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'deepgram' || normalized === 'elevenlabs' || normalized === 'google') {
    return normalized;
  }
  return null;
}

export function inferTranscriptSttProvider(
  transcript: Pick<TranscriptRecord, 'model' | 'summaryJson'> &
    Partial<Pick<TranscriptRecord, 'sttProvider'>>,
): SttProviderId | null {
  if (transcript.sttProvider) return transcript.sttProvider;

  const summaryJson = transcript.summaryJson;
  const summaryProvider = normalizeSttProvider(
    summaryJson && typeof summaryJson === 'object'
      ? (summaryJson as { provider?: unknown }).provider
      : null,
  );
  if (summaryProvider) return summaryProvider;

  const normalizedModel = transcript.model.trim().toLowerCase();
  if (!normalizedModel) return null;
  if (normalizedModel.includes('scribe') || normalizedModel.includes('eleven')) {
    return 'elevenlabs';
  }
  if (normalizedModel.includes('google')) {
    return 'google';
  }
  if (
    normalizedModel.includes('nova') ||
    normalizedModel.includes('deepgram') ||
    normalizedModel.includes('enhanced')
  ) {
    return 'deepgram';
  }
  return null;
}

function resolveExpectedSttModelAndLanguage(
  config: BatchBackendConfig,
  provider: SttProviderId,
): { model: string; language: string } {
  if (provider === 'elevenlabs') {
    return {
      model: config.stt.providers.elevenlabs.model,
      language: 'auto',
    };
  }
  if (provider === 'google') {
    return {
      model: config.stt.providers.google.model,
      language: config.stt.providers.google.languageCodes[0] ?? 'auto',
    };
  }
  return {
    model: config.stt.providers.deepgram.model,
    language: config.stt.providers.deepgram.language,
  };
}

function shouldReuseCachedTranscriptForFingerprint(args: {
  effectiveProvider: SttProviderId;
  mode: TranscriptRecord['mode'];
  model: string;
  language: string;
  transcript: Pick<TranscriptRecord, 'sttProvider' | 'mode' | 'model' | 'language' | 'summaryJson'>;
}): boolean {
  const inferredProvider = inferTranscriptSttProvider(args.transcript);
  if (inferredProvider === null || inferredProvider !== args.effectiveProvider) {
    return false;
  }
  if (args.transcript.mode !== args.mode) {
    return false;
  }
  if (args.transcript.model.trim().toLowerCase() !== args.model.trim().toLowerCase()) {
    return false;
  }
  if (args.transcript.language.trim().toLowerCase() !== args.language.trim().toLowerCase()) {
    return false;
  }
  return true;
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

export function registerExtendedRoutes(app: FastifyInstance, options: ExtendedRouteOptions): void {
  const {
    config,
    authService,
    authenticate,
    uploadRateLimitMiddleware,
    fileValidationService,
    recordingUploadValidationService,
    fileSanitizationService,
    storageConfig,
    fileStorageService,
  } = options;
  const transcriptionStorage = createTranscriptionStorage({ storageConfig });
  const transcribeQueue = createTranscribeQueue();

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
            logger.warn('Failed to resolve preset for HTML preview. Falling back to default theme.', {
              event: 'preview_preset_fallback',
              route: routePath,
              preset: presetName,
              error: error instanceof Error ? error.message : String(error),
            });
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

  app.get(
    '/students',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /students');
      const querySchema = z.object({
        q: z.string().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
        offset: z.coerce.number().int().min(0).optional(),
        order: z.enum(['asc', 'desc']).optional(),
      });

      try {
        const query = querySchema.parse(request.query ?? {});
        const result = await listStudentProfiles({
          search: query.q,
          limit: query.limit,
          offset: query.offset,
          order: query.order,
        });

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
            message: 'Invalid query parameters',
            details: error.issues,
          });
        }
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
    '/students/summary',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /students/summary');
      const querySchema = z.object({
        limit: z.coerce.number().int().min(1).max(500).optional(),
        offset: z.coerce.number().int().min(0).optional(),
        order: z.enum(['asc', 'desc']).optional(),
      });

      try {
        const query = querySchema.parse(request.query ?? {});
        const result = await getStudentSummaryWithDefaults({
          limit: query.limit,
          offset: query.offset,
          order: query.order,
        });

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
            message: 'Invalid query parameters',
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

  app.get(
    '/students/:id',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /students/:id');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const profile = await getStudentProfileById(params.id);
        if (!profile) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          studentId: params.id,
        });

        return reply.send(profile);
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid student id',
            details: error.issues,
          });
        }
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

  app.post(
    '/students',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'POST /students');
      const schema = z.object({
        student: z.string().min(1),
        dbId: z.string().nullable().optional(),
        pageParentId: z.string().nullable().optional(),
        colorPreset: z.string().nullable().optional(),
        accentPreference: z.string().nullable().optional(),
        voices: z.record(z.string(), z.string()).optional(),
        manifestPreset: z.string().nullable().optional(),
        profileId: z.string().nullable().optional(),
      });

      try {
        const body = schema.parse(request.body ?? {});
        const authenticatedUser = getAuthenticatedUser(request);
        const created = await createStudentProfile(body, {
          bindingAudit: {
            reason: 'student_create',
            changedBy: authenticatedUser?.id ?? null,
          },
        });

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 201,
          studentId: created.id,
        });

        return reply.code(201).send(created);
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request body',
            details: error.issues,
          });
        }
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

  app.put(
    '/students/:id',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'PUT /students/:id');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });
      const schema = z
        .object({
          student: z.string().min(1).optional(),
          dbId: z.string().nullable().optional(),
          pageParentId: z.string().nullable().optional(),
          colorPreset: z.string().nullable().optional(),
          accentPreference: z.string().nullable().optional(),
          voices: z.record(z.string(), z.string()).optional(),
          manifestPreset: z.string().nullable().optional(),
          profileId: z.string().nullable().optional(),
        })
        .partial();

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const body = schema.parse(request.body ?? {});
        const authenticatedUser = getAuthenticatedUser(request);
        const updated = await updateStudentProfile(params.id, body, {
          bindingAudit: {
            reason: 'student_update',
            changedBy: authenticatedUser?.id ?? null,
          },
        });

        if (!updated) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          studentId: params.id,
        });

        return reply.send(updated);
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request body',
            details: error.issues,
          });
        }
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

  app.delete(
    '/students/:id',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'DELETE /students/:id');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const removed = await deleteStudentProfile(params.id);

        if (!removed) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 204,
          studentId: params.id,
        });

        return reply.code(204).send();
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid student id',
            details: error.issues,
          });
        }
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
    '/students/:id/bindings',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /students/:id/bindings');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });
      const querySchema = z.object({
        limit: z.coerce.number().int().min(1).max(500).optional(),
        offset: z.coerce.number().int().min(0).optional(),
        order: z.enum(['asc', 'desc']).optional(),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const query = querySchema.parse(request.query ?? {});
        const bindings = await listStudentProfileBindingsForStudent(params.id, query);

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          studentId: params.id,
        });

        return reply.send(bindings);
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request parameters',
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

  app.get(
    '/students/:id/bindings/active',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /students/:id/bindings/active');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });
      const querySchema = z.object({
        at: z.string().datetime({ offset: true }).optional(),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const query = querySchema.parse(request.query ?? {});
        const binding = query.at
          ? await resolveStudentProfileBindingAt(params.id, new Date(query.at))
          : await getActiveStudentProfileBindingForStudent(params.id);
        if (!binding) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          studentId: params.id,
          ...(query.at ? { effectiveAt: query.at } : {}),
        });

        return reply.send(binding);
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request parameters',
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

  app.get(
    '/students/:id/timeline',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /students/:id/timeline');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });
      const querySchema = z.object({
        type: z.string().optional(),
        status: z.string().optional(),
        from: z.string().datetime({ offset: true }).optional(),
        to: z.string().datetime({ offset: true }).optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
        offset: z.coerce.number().int().min(0).optional(),
        order: z.enum(['asc', 'desc']).optional(),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const query = querySchema.parse(request.query ?? {});
        const types = query.type
          ? (query.type
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean) as StudentTimelineType[])
          : undefined;
        const statuses = query.status
          ? query.status
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean)
          : undefined;

        const timeline = await getStudentTimeline(params.id, {
          types,
          statuses,
          from: query.from ? new Date(query.from) : undefined,
          to: query.to ? new Date(query.to) : undefined,
          limit: query.limit,
          offset: query.offset,
          order: query.order,
        });

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          studentId: params.id,
        });

        return reply.send(timeline);
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid query parameters',
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

  app.get(
    '/profiles',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /profiles');
      try {
        const profiles = await listProfileContents();

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
        });

        return reply.send(profiles);
      } catch (error: unknown) {
        if (error instanceof ProfileContentError) {
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
    '/profiles/:id',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /profiles/:id');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const profile = await getProfileContent(params.id);

        if (!profile) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          profileId: params.id,
        });

        return reply.send(profile);
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid profile id',
            details: error.issues,
          });
        }
        if (error instanceof ProfileContentError) {
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

  app.put(
    '/profiles/:id',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'PUT /profiles/:id');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });
      const schema = z.object({
        content: z.string(),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const body = schema.parse(request.body ?? {});
        const updated = await upsertProfileContent(params.id, body.content, {
          createdBy: getAuthenticatedUser(request)?.id ?? null,
        });

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          profileId: params.id,
        });

        return reply.send(updated);
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request body',
            details: error.issues,
          });
        }
        if (error instanceof ProfileContentError) {
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

  app.delete(
    '/profiles/:id',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'DELETE /profiles/:id');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const removed = await deleteProfileContent(params.id);

        if (!removed) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 204,
          profileId: params.id,
        });

        return reply.code(204).send();
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid profile id',
            details: error.issues,
          });
        }
        if (error instanceof ProfileContentError) {
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
    '/profiles/:id/revisions',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /profiles/:id/revisions');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });
      const querySchema = z.object({
        limit: z.coerce.number().int().min(1).max(500).optional(),
        offset: z.coerce.number().int().min(0).optional(),
        order: z.enum(['asc', 'desc']).optional(),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const query = querySchema.parse(request.query ?? {});
        const revisions = await listProfileRevisionsForProfile(params.id, query);
        if (!revisions) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          profileId: params.id,
        });

        return reply.send(revisions);
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request parameters',
            details: error.issues,
          });
        }
        if (error instanceof ProfileContentError) {
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
    '/profiles/:id/revisions/:revisionId',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /profiles/:id/revisions/:revisionId');
      const paramsSchema = z.object({
        id: z.string().min(1),
        revisionId: z.string().uuid(),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const revision = await getProfileRevisionForProfile(params.id, params.revisionId);
        if (!revision) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          profileId: params.id,
          revisionId: params.revisionId,
        });

        return reply.send(revision);
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request parameters',
            details: error.issues,
          });
        }
        if (error instanceof ProfileContentError) {
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

  app.post(
    '/profiles/:id/revisions/:revisionId/restore',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'POST /profiles/:id/revisions/:revisionId/restore');
      const paramsSchema = z.object({
        id: z.string().min(1),
        revisionId: z.string().uuid(),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const restored = await restoreProfileRevision(params.id, params.revisionId, {
          createdBy: getAuthenticatedUser(request)?.id ?? null,
        });
        if (!restored) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          profileId: params.id,
          revisionId: params.revisionId,
        });

        return reply.send(restored);
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request parameters',
            details: error.issues,
          });
        }
        if (error instanceof ProfileContentError) {
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

  app.post(
    '/profiles/:id/revisions/:revisionId/activate',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'POST /profiles/:id/revisions/:revisionId/activate');
      const paramsSchema = z.object({
        id: z.string().min(1),
        revisionId: z.string().uuid(),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const activated = await activateProfileRevisionForProfile(params.id, params.revisionId);
        if (!activated) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          profileId: params.id,
          revisionId: params.revisionId,
        });

        return reply.send(activated);
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request parameters',
            details: error.issues,
          });
        }
        if (error instanceof ProfileContentError) {
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
    '/templates',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /templates');
      try {
        const templates = await listTemplateContents();

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
        });

        return reply.send(templates);
      } catch (error: unknown) {
        if (error instanceof TemplateContentError) {
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
    '/templates/:id',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /templates/:id');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const template = await getTemplateContent(params.id);
        if (!template) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          templateId: params.id,
        });

        return reply.send(template);
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid template id',
            details: error.issues,
          });
        }
        if (error instanceof TemplateContentError) {
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

  app.put(
    '/templates/:id',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'PUT /templates/:id');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });
      const schema = z.object({
        content: z.string(),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const body = schema.parse(request.body ?? {});
        const updated = await upsertTemplateContent(params.id, body.content, {
          createdBy: getAuthenticatedUser(request)?.id ?? null,
        });

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          templateId: params.id,
        });

        return reply.send(updated);
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request body',
            details: error.issues,
          });
        }
        if (error instanceof TemplateContentError) {
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

  app.delete(
    '/templates/:id',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'DELETE /templates/:id');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const removed = await deleteTemplateContent(params.id);

        if (!removed) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 204,
          templateId: params.id,
        });

        return reply.code(204).send();
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid template id',
            details: error.issues,
          });
        }
        if (error instanceof TemplateContentError) {
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
    '/templates/:id/revisions',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /templates/:id/revisions');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });
      const querySchema = z.object({
        limit: z.coerce.number().int().min(1).max(500).optional(),
        offset: z.coerce.number().int().min(0).optional(),
        order: z.enum(['asc', 'desc']).optional(),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const query = querySchema.parse(request.query ?? {});
        const revisions = await listTemplateRevisionsForTemplate(params.id, query);
        if (!revisions) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          templateId: params.id,
        });

        return reply.send(revisions);
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request parameters',
            details: error.issues,
          });
        }
        if (error instanceof TemplateContentError) {
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
    '/templates/:id/revisions/:revisionId',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /templates/:id/revisions/:revisionId');
      const paramsSchema = z.object({
        id: z.string().min(1),
        revisionId: z.string().uuid(),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const revision = await getTemplateRevisionForTemplate(params.id, params.revisionId);
        if (!revision) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          templateId: params.id,
          revisionId: params.revisionId,
        });

        return reply.send(revision);
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request parameters',
            details: error.issues,
          });
        }
        if (error instanceof TemplateContentError) {
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

  app.post(
    '/templates/:id/revisions/:revisionId/restore',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'POST /templates/:id/revisions/:revisionId/restore');
      const paramsSchema = z.object({
        id: z.string().min(1),
        revisionId: z.string().uuid(),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const restored = await restoreTemplateRevision(params.id, params.revisionId, {
          createdBy: getAuthenticatedUser(request)?.id ?? null,
        });
        if (!restored) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          templateId: params.id,
          revisionId: params.revisionId,
        });

        return reply.send(restored);
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request parameters',
            details: error.issues,
          });
        }
        if (error instanceof TemplateContentError) {
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

  app.post(
    '/templates/:id/revisions/:revisionId/activate',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'POST /templates/:id/revisions/:revisionId/activate');
      const paramsSchema = z.object({
        id: z.string().min(1),
        revisionId: z.string().uuid(),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const activated = await activateTemplateRevisionForTemplate(params.id, params.revisionId);
        if (!activated) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          templateId: params.id,
          revisionId: params.revisionId,
        });

        return reply.send(activated);
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request parameters',
            details: error.issues,
          });
        }
        if (error instanceof TemplateContentError) {
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

  app.post(
    '/recordings/upload',
    {
      preHandler: [authenticate, uploadRateLimitMiddleware],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'POST /recordings/upload');
      const querySchema = z.object({
        studentId: z.string().uuid().optional(),
        student: z.string().min(1).optional(),
        sttProvider: z.enum(['deepgram', 'elevenlabs', 'google']).optional(),
      });
      let authenticatedUser;

      try {
        authenticatedUser = getAuthenticatedUser(request);
        if (!authenticatedUser) {
          return reply.code(401).send({
            error: 'unauthorized',
            message: 'Authentication required',
            code: 'not_authenticated',
          });
        }

        const file = await (
          request as FastifyRequest & {
            file: (options?: {
              limits?: { fileSize?: number };
              throwFileSizeLimit?: boolean;
            }) => Promise<{ filename?: string; file: Readable } | undefined>;
          }
        ).file({
          limits: { fileSize: config.recordings.maxFileSize },
          throwFileSizeLimit: false,
        });

        if (!file) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'No file uploaded',
            code: 'no_file',
          });
        }

        const query = querySchema.parse(request.query ?? {});
        const studentName = query.student ? normalizeStudentName(query.student) : null;
        const studentId = query.studentId ?? (studentName ? deriveStudentId(studentName) : null);
        const requestedSttProvider = query.sttProvider;
        const effectiveSttProvider = requestedSttProvider ?? config.transcription.sttProvider;
        const expectedFingerprint = resolveExpectedSttModelAndLanguage(config, effectiveSttProvider);

        const filename = file.filename || '';
        const fileBuffer = await readFileBuffer(file.file);
        if (isStreamTruncated(file.file)) {
          return reply.code(413).send({
            error: 'validation_failed',
            message: `Recording exceeds max size (${formatBytes(config.recordings.maxFileSize)}).`,
            code: 'file_too_large',
          });
        }

        let validationResult;
        if (recordingUploadValidationService) {
          validationResult = await recordingUploadValidationService.validateFile(
            fileBuffer,
            filename,
          );
          if (!validationResult.isValid) {
            logger.warn('Recording upload validation failed', {
              event: 'recording_upload_validation_failed',
              userId: authenticatedUser.id,
              filename,
              errors: validationResult.errors.map((e: { code: string }) => e.code),
              warnings: validationResult.warnings.map((w: { code: string }) => w.code),
            });

            return reply.code(400).send({
              error: 'validation_failed',
              message: 'File validation failed',
              code: 'file_validation_failed',
              details: {
                errors: validationResult.errors,
                warnings: validationResult.warnings,
              },
            });
          }
        }

        const sanitizedFilename = sanitizeRecordingFilename(filename);
        const storageFilename = sanitizedFilename.replaceAll(/[^\w.-]/g, '_');
        const sourcePath = storageFilename || sanitizedFilename || filename;
        const fileSha256 = createContentSha256(fileBuffer);

        const cachedRecordings = await listRecordingsBySha256(fileSha256);
        if (cachedRecordings.length > 0) {
          let transcriptCandidates = 0;
          let providerMatches = 0;
          let providerUnknown = 0;

          for (const cachedRecording of cachedRecordings) {
            const cachedTranscript = await getTranscriptByRecordingId(cachedRecording.id);
            if (!cachedTranscript) {
              continue;
            }

            transcriptCandidates += 1;
            const cachedProvider = inferTranscriptSttProvider(cachedTranscript);
            if (cachedProvider === null) {
              providerUnknown += 1;
              continue;
            }

            if (
              !shouldReuseCachedTranscriptForFingerprint({
                effectiveProvider: effectiveSttProvider,
                mode: config.transcription.mode,
                model: expectedFingerprint.model,
                language: expectedFingerprint.language,
                transcript: cachedTranscript,
              })
            ) {
              continue;
            }

            providerMatches += 1;
            logger.info('Recording upload cache hit', {
              event: 'recording_upload_cache_hit',
              route: routePath,
              userId: authenticatedUser.id,
              recordingId: cachedRecording.id,
              transcriptId: cachedTranscript.id,
              filename,
              sha256: fileSha256,
              requestedProvider: requestedSttProvider ?? null,
              effectiveProvider: effectiveSttProvider,
              cachedProvider,
              candidateRecordings: cachedRecordings.length,
              candidateTranscripts: transcriptCandidates,
              providerMatches,
            });

            return reply.code(200).send({
              ...recordingToDto({
                ...cachedRecording,
                transcriptId: cachedTranscript.id,
              }),
              cacheHit: true,
              cacheReason: 'transcript_reused',
              cacheRecordingId: cachedRecording.id,
            });
          }

          logger.info('Recording upload cache bypassed', {
            event: 'recording_upload_cache_bypassed',
            route: routePath,
            userId: authenticatedUser.id,
            filename,
            sha256: fileSha256,
            requestedProvider: requestedSttProvider ?? null,
            effectiveProvider: effectiveSttProvider,
            candidateRecordings: cachedRecordings.length,
            candidateTranscripts: transcriptCandidates,
            providerMatches,
            providerUnknown,
          });
        }

        const record = await ingestRecordingUpload({
          filename: storageFilename || sanitizedFilename || filename,
          stream: Readable.from(fileBuffer),
          sourcePath,
          studentId,
          sttProvider: effectiveSttProvider,
          storage: transcriptionStorage,
          repository: {
            insertRecording,
            updateRecordingStatus,
          },
          enqueue: transcribeQueue.enqueue,
        });

        logger.info('Recording uploaded', {
          event: 'recording_uploaded',
          route: routePath,
          userId: authenticatedUser.id,
          recordingId: record.id,
          filename,
          sanitizedFilename,
          bytes: record.bytes,
          storageProvider: storageConfig.getProvider(),
        });

        return reply.code(201).send(recordingToDto(record));
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid query parameters',
            details: error.issues,
          });
        }
        if (error instanceof FileValidationError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: error.message,
            code: error.code,
          });
        }

        logger.error(error instanceof Error ? error : String(error), {
          event: 'recording_upload_failed',
          userId: authenticatedUser?.id,
          route: routePath,
          error: 'internal_error',
        });

        return reply.code(500).send({
          error: 'internal_error',
        });
      }
    },
  );

  app.get(
    '/recordings',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /recordings');

      const querySchema = z.object({
        status: z.union([z.string(), z.array(z.string())]).optional(),
        source: z.union([z.string(), z.array(z.string())]).optional(),
        q: z.string().min(1).optional(),
        studentId: z.string().uuid().optional(),
        student: z.string().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
        offset: z.coerce.number().int().min(0).optional(),
        order: z.enum(['asc', 'desc']).optional(),
      });

      try {
        const query = querySchema.parse(request.query ?? {});
        const statuses = normalizeStatusFilter(query.status);
        const sources = normalizeSourceFilter(query.source);
        const studentName = query.student ? normalizeStudentName(query.student) : null;
        const studentId = query.studentId ?? (studentName ? deriveStudentId(studentName) : null);
        const recordings = await listRecordingsWithDefaults({
          statuses,
          sources,
          search: query.q ?? null,
          studentId,
          limit: query.limit,
          offset: query.offset,
          order: query.order,
        });

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
        });

        return reply.send(recordings);
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid query parameters',
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

  app.get(
    '/recordings/:recordingId',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { recordingId } = request.params as { recordingId: string };
      const routePath = resolveRoutePath(request, 'GET /recordings/:recordingId');

      try {
        const recording = await getRecording(recordingId);
        if (!recording) {
          logger.info('Recording not found', {
            event: 'recording_not_found',
            route: routePath,
            recordingId,
          });
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          recordingId,
        });

        return reply.send(recording);
      } catch (error: unknown) {
        logger.error(error instanceof Error ? error : String(error), {
          event: 'http_request',
          route: routePath,
          statusCode: 500,
          error: 'internal_error',
          recordingId,
        });

        return errorResponse(reply, 'internal_error');
      }
    },
  );

  app.get(
    '/recordings/:recordingId/audio',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { recordingId } = request.params as { recordingId: string };
      const routePath = resolveRoutePath(request, 'GET /recordings/:recordingId/audio');

      try {
        const recording = await getRecordingById(recordingId);
        if (!recording) {
          logger.info('Recording audio not found', {
            event: 'recording_audio_not_found',
            route: routePath,
            recordingId,
          });
          return errorResponse(reply, 'not_found');
        }

        const totalBytes = Number(recording.bytes ?? 0);
        const rangeHeader = request.headers.range;
        const range = parseRangeHeader(
          typeof rangeHeader === 'string' ? rangeHeader : undefined,
          totalBytes,
        );

        reply.header('Accept-Ranges', 'bytes');
        reply.header('Content-Type', resolveAudioMimeType(recording.storageUri));

        if (range === 'invalid') {
          reply.header('Content-Range', `bytes */${totalBytes}`);
          return reply.code(416).send();
        }

        const storage = createTranscriptionStorageForUri(recording.storageUri, { storageConfig });
        const stream = await storage.getStream(recording.storageUri);

        if (range) {
          const chunkSize = range.end - range.start + 1;
          reply.header('Content-Length', String(chunkSize));
          reply.header('Content-Range', `bytes ${range.start}-${range.end}/${totalBytes}`);

          logger.info('HTTP request handled', {
            event: 'http_request',
            route: routePath,
            statusCode: 206,
            recordingId,
          });

          return reply.code(206).send(createRangeStream(stream, range.start, range.end));
        }

        reply.header('Content-Length', String(totalBytes));

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          recordingId,
        });

        return reply.send(stream);
      } catch (error: unknown) {
        logger.error(error instanceof Error ? error : String(error), {
          event: 'http_request',
          route: routePath,
          statusCode: 500,
          error: 'internal_error',
          recordingId,
        });

        return errorResponse(reply, 'internal_error');
      }
    },
  );

  app.post(
    '/recordings/:recordingId/transcribe',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { recordingId } = request.params as { recordingId: string };
      const routePath = resolveRoutePath(request, 'POST /recordings/:recordingId/transcribe');
      const bodySchema = z
        .object({
          sttProvider: z.enum(['deepgram', 'elevenlabs', 'google']).optional(),
        })
        .optional();

      try {
        const body = bodySchema.parse(request.body ?? undefined);
        const result = await retryRecordingTranscription(
          recordingId,
          {
            sttProvider: body?.sttProvider,
          },
          {
            enqueue: transcribeQueue.enqueue,
          },
        );

        if (!result) {
          logger.info('Recording not found for retry', {
            event: 'recording_retry_not_found',
            route: routePath,
            recordingId,
          });
          return errorResponse(reply, 'not_found');
        }

        logger.info('Recording retry requested', {
          event: 'recording_retry_requested',
          route: routePath,
          recordingId,
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
        if (error instanceof RecordingRetryError) {
          return errorResponse(reply, 'validation_failed', {
            message: error.message,
            code: error.code,
          });
        }

        logger.error(error instanceof Error ? error : String(error), {
          event: 'recording_retry_failed',
          route: routePath,
          statusCode: 500,
          recordingId,
          error: 'internal_error',
        });

        return errorResponse(reply, 'internal_error');
      }
    },
  );

  app.get(
    '/recordings/:recordingId/transcript',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { recordingId } = request.params as { recordingId: string };
      const routePath = resolveRoutePath(request, 'GET /recordings/:recordingId/transcript');

      try {
        const transcript = await getRecordingTranscript(recordingId);
        if (!transcript) {
          logger.info('Recording transcript not found', {
            event: 'recording_transcript_not_found',
            route: routePath,
            recordingId,
          });
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          recordingId,
        });

        return reply.send(transcript);
      } catch (error: unknown) {
        logger.error(error instanceof Error ? error : String(error), {
          event: 'http_request',
          route: routePath,
          statusCode: 500,
          error: 'internal_error',
          recordingId,
        });

        return errorResponse(reply, 'internal_error');
      }
    },
  );

  app.put(
    '/recordings/:recordingId/transcript',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { recordingId } = request.params as { recordingId: string };
      const routePath = resolveRoutePath(request, 'PUT /recordings/:recordingId/transcript');

      const schema = z.object({
        text: z.string(),
      });

      try {
        const body = schema.parse(request.body ?? {});
        const updated = await updateRecordingTranscript({
          recordingId,
          text: body.text,
        });

        if (!updated) {
          logger.info('Recording transcript update skipped; not found', {
            event: 'recording_transcript_update_not_found',
            route: routePath,
            recordingId,
          });
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          recordingId,
        });

        return reply.send(updated);
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
          recordingId,
        });

        return errorResponse(reply, 'internal_error');
      }
    },
  );

  app.post(
    '/recordings/:recordingId/prompt-package',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { recordingId } = request.params as { recordingId: string };
      const routePath = resolveRoutePath(request, 'POST /recordings/:recordingId/prompt-package');

      const schema = z.object({
        notes: z.string().optional(),
        profilePath: z.string().min(1).optional(),
        profileId: z.string().min(1).optional(),
        templateId: z.string().min(1).optional(),
        bindingEffectiveAt: z.string().datetime({ offset: true }).optional(),
      });

      try {
        const body = schema.parse(request.body ?? {});
        const promptPackage = await createPromptPackage({
          recordingId,
          notes: body.notes,
          profilePath: body.profilePath,
          profileId: body.profileId,
          templateId: body.templateId,
          bindingEffectiveAt: body.bindingEffectiveAt
            ? new Date(body.bindingEffectiveAt)
            : undefined,
        });

        if (!promptPackage) {
          logger.info('Prompt package creation skipped; transcript missing', {
            event: 'prompt_package_create_not_found',
            route: routePath,
            recordingId,
          });
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          recordingId,
        });

        return reply.send(promptPackage);
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request body',
            details: error.issues,
          });
        }
        if (error instanceof ProfilePathError || error instanceof PromptOptionError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: error.message,
            code: error.code,
          });
        }

        logger.error(error instanceof Error ? error : String(error), {
          event: 'http_request',
          route: routePath,
          statusCode: 500,
          error: 'internal_error',
          recordingId,
        });

        return errorResponse(reply, 'internal_error');
      }
    },
  );

  app.get(
    '/prompt-packages/:promptPackageId',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { promptPackageId } = request.params as { promptPackageId: string };
      const routePath = resolveRoutePath(request, 'GET /prompt-packages/:promptPackageId');

      try {
        const promptPackage = await getPromptPackage(promptPackageId);
        if (!promptPackage) {
          logger.info('Prompt package not found', {
            event: 'prompt_package_not_found',
            route: routePath,
            promptPackageId,
          });
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          promptPackageId,
        });

        return reply.send(promptPackage);
      } catch (error: unknown) {
        logger.error(error instanceof Error ? error : String(error), {
          event: 'http_request',
          route: routePath,
          statusCode: 500,
          error: 'internal_error',
          promptPackageId,
        });

        return errorResponse(reply, 'internal_error');
      }
    },
  );

  app.get(
    '/prompt-packages/:promptPackageId/lineage',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { promptPackageId } = request.params as { promptPackageId: string };
      const routePath = resolveRoutePath(request, 'GET /prompt-packages/:promptPackageId/lineage');

      try {
        const lineage = await getPromptPackageLineage(promptPackageId);
        if (!lineage) {
          logger.info('Prompt package lineage not found', {
            event: 'prompt_package_lineage_not_found',
            route: routePath,
            promptPackageId,
          });
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          promptPackageId,
        });

        return reply.send(lineage);
      } catch (error: unknown) {
        logger.error(error instanceof Error ? error : String(error), {
          event: 'http_request',
          route: routePath,
          statusCode: 500,
          error: 'internal_error',
          promptPackageId,
        });

        return errorResponse(reply, 'internal_error');
      }
    },
  );

  app.post(
    '/prompt-packages/:promptPackageId/draft',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { promptPackageId } = request.params as { promptPackageId: string };
      const routePath = resolveRoutePath(request, 'POST /prompt-packages/:promptPackageId/draft');

      const schema = z.object({
        text: z.string().min(1),
      });

      try {
        const body = schema.parse(request.body ?? {});
        const draft = await createDraft({
          promptPackageId,
          text: body.text,
          createdBy: getAuthenticatedUser(request)?.id ?? null,
        });

        if (!draft) {
          logger.info('Draft creation skipped; prompt package missing', {
            event: 'draft_create_not_found',
            route: routePath,
            promptPackageId,
          });
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          promptPackageId,
        });

        return reply.send(draft);
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
          promptPackageId,
        });

        return errorResponse(reply, 'internal_error');
      }
    },
  );

  app.get(
    '/drafts/:draftId',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { draftId } = request.params as { draftId: string };
      const routePath = resolveRoutePath(request, 'GET /drafts/:draftId');

      try {
        const draft = await getDraft(draftId);

        if (!draft) {
          logger.info('Draft retrieval skipped; draft missing', {
            event: 'draft_get_not_found',
            route: routePath,
            draftId,
          });
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          draftId,
        });

        return reply.send(draft);
      } catch (error: unknown) {
        logger.error(error instanceof Error ? error : String(error), {
          event: 'http_request',
          route: routePath,
          statusCode: 500,
          error: 'internal_error',
          draftId,
        });

        return errorResponse(reply, 'internal_error');
      }
    },
  );

  app.post(
    '/drafts/:draftId/materialize',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { draftId } = request.params as { draftId: string };
      const routePath = resolveRoutePath(request, 'POST /drafts/:draftId/materialize');

      const jobOverridesSchema = z.object({
        learningPresetId: z.string().min(1).optional(),
        notionDatabase: z.string().min(1).optional(),
        publishTarget: z.enum(['notion', 'anytype', 'html']).optional(),
        withTts: z.boolean().optional(),
        forceTts: z.boolean().optional(),
        ttsStrategy: z.enum(['auto', 'dialogue', 'tts']).optional(),
        ttsProvider: z.enum(['elevenlabs', 'google']).optional(),
        googleTtsModel: z.enum(['chirp3_hd', 'studio', 'neural2', 'wavenet']).optional(),
        upload: z.enum(['auto', 's3', 'none']).optional(),
        voiceId: z.string().min(1).optional(),
        voiceAccent: z.string().min(1).optional(),
        autoPublish: z.boolean().optional(),
      });

      const schema = z.object({
        jobId: z.string().min(1).optional(),
        jobOverrides: jobOverridesSchema.optional(),
      });

      try {
        const body = schema.parse(request.body ?? {});
        const materialized = await materializeDraft({
          draftId,
          jobId: body.jobId,
          jobOverrides: body.jobOverrides,
        });

        if (!materialized) {
          logger.info('Draft materialization skipped; draft or job missing', {
            event: 'draft_materialize_not_found',
            route: routePath,
            draftId,
            jobId: body.jobId,
          });
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          draftId,
          jobId: body.jobId,
        });

        return reply.send(materialized);
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
          draftId,
        });

        return errorResponse(reply, 'internal_error');
      }
    },
  );

  function normalizeStatusFilter(status?: string | string[] | null): string[] | null {
    if (!status) return null;
    const values = Array.isArray(status) ? status : status.split(',');
    const trimmed = values.map((value) => value.trim()).filter(Boolean);
    if (trimmed.length === 0) return null;
    return trimmed.map((value) => RecordingStatusSchema.parse(value));
  }

  function normalizeSourceFilter(source?: string | string[] | null): string[] | null {
    if (!source) return null;
    const values = Array.isArray(source) ? source : source.split(',');
    const trimmed = values.map((value) => value.trim()).filter(Boolean);
    if (trimmed.length === 0) return null;
    return trimmed.map((value) => RecordingSourceSchema.parse(value));
  }

  function normalizeJobStateFilter(state?: string | string[] | null): JobState[] | null {
    if (!state) return null;
    const values = Array.isArray(state) ? state : state.split(',');
    const trimmed = values.map((value) => value.trim()).filter(Boolean);
    if (trimmed.length === 0) return null;
    const jobStateSchema = z.enum([
      'queued',
      'running',
      'awaiting_approval',
      'succeeded',
      'failed',
    ]);
    return trimmed.map((value) => jobStateSchema.parse(value)) as JobState[];
  }

  const multipartMaxFileSize = Math.max(config.security.maxFileSize, config.recordings.maxFileSize);
  void app.register(multipart, {
    limits: {
      fileSize: multipartMaxFileSize,
      files: 1,
    },
  });

  app.post(
    '/uploads',
    {
      preHandler: [authenticate, uploadRateLimitMiddleware],
    },
    async (request, reply) => {
      let authenticatedUser;
      try {
        authenticatedUser = getAuthenticatedUser(request);
        if (!authenticatedUser) {
          return reply.code(401).send({
            error: 'unauthorized',
            message: 'Authentication required',
            code: 'not_authenticated',
          });
        }

        const file = await (
          request as FastifyRequest & {
            file: (options?: {
              limits?: { fileSize?: number };
              throwFileSizeLimit?: boolean;
            }) => Promise<{ filename?: string; file: Readable } | undefined>;
          }
        ).file({
          limits: { fileSize: config.security.maxFileSize },
          throwFileSizeLimit: false,
        });
        if (!file) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'No file uploaded',
            code: 'no_file',
          });
        }

        const filename: string = file.filename || '';
        const fileBuffer = await readFileBuffer(file.file);
        if (isStreamTruncated(file.file)) {
          return reply.code(413).send({
            error: 'validation_failed',
            message: `Upload exceeds max size (${formatBytes(config.security.maxFileSize)}).`,
            code: 'file_too_large',
          });
        }

        try {
          let validationResult;
          if (fileValidationService) {
            validationResult = await fileValidationService.validateFile(fileBuffer, filename);
            if (!validationResult.isValid) {
              logger.warn('File validation failed', {
                event: 'file_validation_failed',
                userId: authenticatedUser.id,
                filename,
                errors: validationResult.errors.map((e: { code: string }) => e.code),
                warnings: validationResult.warnings.map((w: { code: string }) => w.code),
              });

              return reply.code(400).send({
                error: 'validation_failed',
                message: 'File validation failed',
                code: 'file_validation_failed',
                details: {
                  errors: validationResult.errors,
                  warnings: validationResult.warnings,
                },
              });
            }
          }

          let sanitizationResult;
          let sanitizedBuffer = fileBuffer;
          let sanitizedFilename = filename;

          if (fileSanitizationService) {
            sanitizationResult = await fileSanitizationService.sanitizeFile(fileBuffer, filename);
            sanitizedBuffer = sanitizationResult.sanitizedContent;
            sanitizedFilename = sanitizationResult.sanitizedFilename;

            if (sanitizationResult.warnings.length > 0) {
              logger.warn('File sanitization completed with warnings', {
                event: 'file_sanitized_with_warnings',
                userId: authenticatedUser.id,
                originalFilename: filename,
                sanitizedFilename: sanitizedFilename,
                warnings: sanitizationResult.warnings.map(
                  (w: { code: string; severity: string }) => ({
                    code: w.code,
                    severity: w.severity,
                  }),
                ),
              });
            }
          }

          const id = randomUUID();
          const storageKey = `${authenticatedUser.id}/${id}_${sanitizedFilename.replaceAll(/[^\w.-]/g, '_')}`;

          const uploadResult = await fileStorageService.uploadFile(
            storageKey,
            sanitizedBuffer,
            validationResult?.mimeType || 'application/octet-stream',
            sanitizedBuffer.length,
          );

          const mdReference =
            fileStorageService.getProvider() === 'filesystem'
              ? buildFilesystemMdReference(
                  storageConfig.getFilesystemConfig().uploadDir,
                  storageKey,
                )
              : storageKey;

          logger.info('Secure upload completed', {
            event: 'secure_upload_completed',
            userId: authenticatedUser.id,
            fileId: id,
            originalFilename: filename,
            sanitizedFilename: sanitizedFilename,
            fileSize: sanitizedBuffer.length,
            mimeType: validationResult?.mimeType,
            storageKey,
            mdReference,
            storageProvider: fileStorageService.getProvider(),
            hasUrl: !!uploadResult.url,
          });

          return reply.code(201).send({
            id,
            md: mdReference,
            url: uploadResult.url,
            originalFilename: filename,
            sanitizedFilename: sanitizedFilename,
            fileSize: sanitizedBuffer.length,
            mimeType: validationResult?.mimeType,
            storageProvider: fileStorageService.getProvider(),
            warnings: [
              ...(validationResult?.warnings || []),
              ...(sanitizationResult?.warnings || []),
            ],
          });
        } catch (securityError: unknown) {
          if (
            securityError instanceof FileValidationError ||
            securityError instanceof FileSanitizationError
          ) {
            logger.warn('File security processing failed', {
              event: 'file_security_processing_failed',
              userId: authenticatedUser.id,
              filename,
              error: securityError.code,
              message: securityError.message,
            });

            return reply.code(400).send({
              error: 'security_validation_failed',
              message: securityError.message,
              code: securityError.code,
            });
          }
          throw securityError;
        }
      } catch (error: unknown) {
        logger.error(error instanceof Error ? error : String(error), {
          event: 'upload_failed',
          userId: authenticatedUser?.id,
          error: 'internal_error',
        });

        return reply.code(500).send({
          error: 'internal_error',
        });
      }
    },
  );

  app.post(
    '/auth/register',
    { preHandler: [uploadRateLimitMiddleware] },
    async (request, reply) => {
      const body = request.body as UserRegistration | undefined;

      try {
        if (!body || !body.email || !body.password) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Email and password are required',
            code: 'missing_fields',
          });
        }

        if (!authService.validateEmail(body.email)) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid email format',
            code: 'invalid_email',
          });
        }

        const passwordValidation = authService.validatePassword(body.password);
        if (!passwordValidation.valid) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Password does not meet requirements',
            code: 'weak_password',
            details: passwordValidation.errors,
          });
        }

        let role: UserRole = 'user';
        if (body.role) {
          if (!isValidRole(body.role)) {
            return reply.code(400).send({
              error: 'validation_failed',
              message: 'Invalid role specified',
              code: 'invalid_role',
            });
          }
          role = body.role;
        }

        const existingUser = await getUserByEmail(body.email);
        if (existingUser) {
          return reply.code(409).send({
            error: 'conflict',
            message: 'User with this email already exists',
            code: 'email_exists',
          });
        }

        const passwordHash = await authService.hashPassword(body.password);
        const user = await createUser({
          email: body.email.toLowerCase(),
          passwordHash,
          role,
          isActive: true,
        });

        logger.info('User registered successfully', {
          userId: user.id,
          email: user.email,
          role: user.role,
        });

        const sanitizedUser = sanitizeUser(user);

        return reply.code(201).send({
          message: 'User registered successfully',
          user: sanitizedUser,
        });
      } catch (error: unknown) {
        logger.error(error instanceof Error ? error : String(error), {
          event: 'http_request',
          route: 'POST /auth/register',
          statusCode: 500,
          error: 'internal_error',
        });

        return reply.code(500).send({
          error: 'internal_error',
        });
      }
    },
  );

  app.post('/auth/login', { preHandler: [uploadRateLimitMiddleware] }, async (request, reply) => {
    const body = request.body as UserLogin | undefined;

    try {
      if (!body || !body.email || !body.password) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'Email and password are required',
          code: 'missing_fields',
        });
      }

      const user = await getUserByEmail(body.email.toLowerCase());
      if (!user || !user.isActive) {
        return reply.code(401).send({
          error: 'unauthorized',
          message: 'Invalid credentials',
          code: 'invalid_credentials',
        });
      }

      const isValidPassword = await authService.verifyPassword(body.password, user.passwordHash);
      if (!isValidPassword) {
        return reply.code(401).send({
          error: 'unauthorized',
          message: 'Invalid credentials',
          code: 'invalid_credentials',
        });
      }

      const tokens = authService.generateTokens(user.id, user.email, user.role);
      await updateUserLastLogin(user.id);

      logger.info('User logged in successfully', {
        userId: user.id,
        email: user.email,
        role: user.role,
      });

      setRefreshCookie(reply, config, tokens.refreshToken, tokens.refreshExpiresIn);

      return reply.code(200).send({
        message: 'Login successful',
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          isActive: user.isActive,
        },
        accessToken: tokens.accessToken,
        expiresIn: tokens.expiresIn,
      });
    } catch (error: unknown) {
      logger.error(error instanceof Error ? error : String(error), {
        event: 'http_request',
        route: 'POST /auth/login',
        statusCode: 500,
        error: 'internal_error',
      });

      return reply.code(500).send({
        error: 'internal_error',
      });
    }
  });

  app.post(
    '/auth/refresh',
    { preHandler: [uploadRateLimitMiddleware] },
    async (request, reply) => {
      const body = request.body as { refreshToken?: string } | undefined;
      const cookies = request.cookies as Record<string, string> | undefined;
      const refreshToken = cookies?.[config.auth.refreshCookieName] ?? body?.refreshToken ?? null;

      try {
        if (!refreshToken) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Refresh token is required',
            code: 'missing_refresh_token',
          });
        }

        let refreshPayload;
        try {
          refreshPayload = authService.verifyRefreshToken(refreshToken);
        } catch (error) {
          logger.warn('Invalid refresh token presented', {
            error: error instanceof Error ? error.message : String(error),
          });
          return reply.code(401).send({
            error: 'unauthorized',
            message: 'Invalid refresh token',
            code: 'invalid_refresh_token',
          });
        }

        const tokens = authService.refreshTokens(refreshToken);
        const user = await getUserById(refreshPayload.sub);
        if (!user || !user.isActive) {
          return reply.code(401).send({
            error: 'unauthorized',
            message: 'User account is inactive or no longer exists',
            code: 'user_inactive',
          });
        }

        logger.info('Token refresh successful', {
          userId: refreshPayload.sub,
          userEmail: refreshPayload.email,
        });

        setRefreshCookie(reply, config, tokens.refreshToken, tokens.refreshExpiresIn);

        return reply.code(200).send({
          message: 'Token refresh successful',
          user: {
            id: user.id,
            email: user.email,
            role: user.role,
            isActive: user.isActive,
          },
          accessToken: tokens.accessToken,
          expiresIn: tokens.expiresIn,
        });
      } catch (error: unknown) {
        logger.error(error instanceof Error ? error : String(error), {
          event: 'http_request',
          route: 'POST /auth/refresh',
          statusCode: 500,
          error: 'internal_error',
        });

        return reply.code(401).send({
          error: 'unauthorized',
          message: 'Token refresh failed',
          code: 'refresh_failed',
        });
      }
    },
  );

  app.post('/auth/logout', { preHandler: [uploadRateLimitMiddleware] }, async (_request, reply) => {
    clearRefreshCookie(reply, config);
    return reply.code(200).send({ message: 'Logout successful' });
  });

  app.get(
    '/admin/users',
    { preHandler: [authenticate, requireRole(['admin'])] },
    async (request, reply) => {
      try {
        const users = await getAllUsers();
        const sanitizedUsers = users.map((user) => sanitizeUser(user));

        logger.info('Admin listed all users', {
          userId: getAuthenticatedUser(request)?.id,
          userCount: users.length,
        });

        return reply.code(200).send({
          users: sanitizedUsers,
          total: users.length,
        });
      } catch (error: unknown) {
        logger.error(error instanceof Error ? error : String(error), {
          event: 'admin_list_users_failed',
          userId: getAuthenticatedUser(request)?.id,
        });

        return reply.code(500).send({
          error: 'internal_error',
        });
      }
    },
  );

  app.get(
    '/admin/jobs',
    { preHandler: [authenticate, requireRole(['admin'])] },
    async (request, reply) => {
      try {
        const jobs: unknown[] = [];

        logger.info('Admin listed all jobs', {
          userId: getAuthenticatedUser(request)?.id,
          jobCount: jobs.length,
        });

        return reply.code(200).send({
          jobs,
          total: jobs.length,
        });
      } catch (error: unknown) {
        logger.error(error instanceof Error ? error : String(error), {
          event: 'admin_list_jobs_failed',
          userId: getAuthenticatedUser(request)?.id,
        });

        return reply.code(500).send({
          error: 'internal_error',
        });
      }
    },
  );

  app.delete(
    '/admin/jobs/:jobId',
    { preHandler: [authenticate, requireRole(['admin'])] },
    async (request, reply) => {
      const { jobId } = request.params as { jobId: string };

      try {
        const deleted = false;

        if (!deleted) {
          return reply.code(404).send({
            error: 'not_found',
            message: 'Job not found',
          });
        }

        logger.info('Admin deleted job', {
          userId: getAuthenticatedUser(request)?.id,
          jobId,
        });

        return reply.code(200).send({
          message: 'Job deleted successfully',
        });
      } catch (error: unknown) {
        logger.error(error instanceof Error ? error : String(error), {
          event: 'admin_delete_job_failed',
          userId: getAuthenticatedUser(request)?.id,
          jobId,
        });

        return reply.code(500).send({
          error: 'internal_error',
        });
      }
    },
  );

  app.get(
    '/admin/stats',
    { preHandler: [authenticate, requireRole(['admin'])] },
    async (request, reply) => {
      try {
        const stats = {
          totalUsers: await countUsers(),
          systemStatus: 'operational',
          timestamp: new Date().toISOString(),
        };

        logger.info('Admin requested system stats', {
          userId: getAuthenticatedUser(request)?.id,
        });

        return reply.code(200).send(stats);
      } catch (error: unknown) {
        logger.error(error instanceof Error ? error : String(error), {
          event: 'admin_stats_failed',
          userId: getAuthenticatedUser(request)?.id,
        });

        return reply.code(500).send({
          error: 'internal_error',
        });
      }
    },
  );

  if (config.opsControl.enabled) {
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

  app.get('/user/profile', { preHandler: authenticate }, async (request, reply) => {
    try {
      const authenticatedUser = getAuthenticatedUser(request);
      if (!authenticatedUser) {
        return reply.code(401).send({
          error: 'unauthorized',
          message: 'Authentication required',
        });
      }

      const user = await getUserById(authenticatedUser.id);
      if (!user) {
        return reply.code(404).send({
          error: 'not_found',
          message: 'User not found',
        });
      }

      return reply.code(200).send({
        user: sanitizeUser(user),
      });
    } catch (error: unknown) {
      logger.error(error instanceof Error ? error : String(error), {
        event: 'get_user_profile_failed',
        userId: getAuthenticatedUser(request)?.id,
      });

      return reply.code(500).send({
        error: 'internal_error',
      });
    }
  });

  app.put('/user/profile', { preHandler: authenticate }, async (request, reply) => {
    const authenticatedUser = getAuthenticatedUser(request);
    if (!authenticatedUser) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Authentication required',
      });
    }

    try {
      const body = request.body as { email?: string; password?: string };

      if (body.email && !body.email.includes('@')) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'Invalid email format',
        });
      }

      logger.info('User profile update attempted', {
        userId: authenticatedUser.id,
        fields: Object.keys(body || {}),
      });

      return reply.code(200).send({
        message: 'Profile update not yet implemented',
      });
    } catch (error: unknown) {
      logger.error(error instanceof Error ? error : String(error), {
        event: 'update_user_profile_failed',
        userId: authenticatedUser.id,
      });

      return reply.code(500).send({
        error: 'internal_error',
      });
    }
  });

  // GET /user/settings - Get current user settings
  app.get('/user/settings', { preHandler: authenticate }, async (request, reply) => {
    const authenticatedUser = getAuthenticatedUser(request);
    if (!authenticatedUser) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Authentication required',
      });
    }

    try {
      let settings = await getSettingsByUserId(authenticatedUser.id);

      // Create default settings if none exist
      if (!settings) {
        settings = await createDefaultSettings(authenticatedUser.id);
      }

      return reply.code(200).send({
        settings: sanitizeSettings(settings),
      });
    } catch (error: unknown) {
      logger.error(error instanceof Error ? error : String(error), {
        event: 'get_user_settings_failed',
        userId: authenticatedUser.id,
      });

      return reply.code(500).send({
        error: 'internal_error',
      });
    }
  });

  // PUT /user/settings - Update user settings
  app.put('/user/settings', { preHandler: authenticate }, async (request, reply) => {
    const authenticatedUser = getAuthenticatedUser(request);
    if (!authenticatedUser) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Authentication required',
      });
    }

    try {
      const body = request.body as UserSettingsInput | undefined;

      if (!body || typeof body !== 'object') {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'Request body is required',
          code: 'missing_body',
        });
      }

      // Validate TTS provider if provided
      if (body.ttsProvider !== undefined && !isValidTtsProvider(body.ttsProvider)) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'Invalid TTS provider. Must be one of: elevenlabs, google',
          code: 'invalid_tts_provider',
        });
      }

      // Validate TTS strategy if provided
      if (body.defaultTtsStrategy !== undefined && !isValidTtsStrategy(body.defaultTtsStrategy)) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'Invalid TTS strategy. Must be one of: auto, dialogue, tts',
          code: 'invalid_tts_strategy',
        });
      }

      // Validate API key formats (basic checks)
      if (
        body.elevenLabsKey !== undefined &&
        body.elevenLabsKey !== null &&
        body.elevenLabsKey !== '' &&
        (typeof body.elevenLabsKey !== 'string' || body.elevenLabsKey.length < 10)
      ) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'Invalid ElevenLabs API key format',
          code: 'invalid_elevenlabs_key',
        });
      }

      if (
        body.notionToken !== undefined &&
        body.notionToken !== null &&
        body.notionToken !== '' &&
        (typeof body.notionToken !== 'string' || body.notionToken.length < 10)
      ) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'Invalid Notion token format',
          code: 'invalid_notion_token',
        });
      }

      const updatedSettings = await upsertSettings(authenticatedUser.id, body);

      logger.info('User settings updated', {
        userId: authenticatedUser.id,
        updatedFields: Object.keys(body).filter(
          (k) => body[k as keyof UserSettingsInput] !== undefined,
        ),
      });

      return reply.code(200).send({
        settings: sanitizeSettings(updatedSettings),
      });
    } catch (error: unknown) {
      logger.error(error instanceof Error ? error : String(error), {
        event: 'update_user_settings_failed',
        userId: authenticatedUser.id,
      });

      return reply.code(500).send({
        error: 'internal_error',
      });
    }
  });

  app.get('/user/jobs/summary', { preHandler: authenticate }, async (request, reply) => {
    const authenticatedUser = getAuthenticatedUser(request);
    if (!authenticatedUser) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Authentication required',
      });
    }

    const routePath = resolveRoutePath(request, 'GET /user/jobs/summary');
    const querySchema = z.object({
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
    });

    try {
      const query = querySchema.parse(request.query ?? {});
      const summary = await getJobSummaryWithDefaults({
        from: query.from ?? null,
        to: query.to ?? null,
        userId: authenticatedUser.id,
      });

      logger.info('HTTP request handled', {
        event: 'http_request',
        route: routePath,
        statusCode: 200,
        userId: authenticatedUser.id,
      });

      return reply.code(200).send(summary);
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'Invalid query parameters',
          details: error.issues,
        });
      }

      logger.error(error instanceof Error ? error : String(error), {
        event: 'get_user_jobs_summary_failed',
        userId: authenticatedUser.id,
      });

      return reply.code(500).send({
        error: 'internal_error',
      });
    }
  });

  app.get('/user/jobs', { preHandler: authenticate }, async (request, reply) => {
    const authenticatedUser = getAuthenticatedUser(request);
    if (!authenticatedUser) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Authentication required',
      });
    }

    const routePath = resolveRoutePath(request, 'GET /user/jobs');
    const querySchema = z.object({
      state: z.union([z.string(), z.array(z.string())]).optional(),
      studentId: z.string().uuid().optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
      offset: z.coerce.number().int().min(0).optional(),
      order: z.enum(['asc', 'desc']).optional(),
    });

    try {
      const query = querySchema.parse(request.query ?? {});
      const states = normalizeJobStateFilter(query.state);
      const jobs = await listJobsWithDefaults({
        states,
        studentId: query.studentId ?? null,
        from: query.from ?? null,
        to: query.to ?? null,
        limit: query.limit,
        offset: query.offset,
        order: query.order,
        userId: authenticatedUser.id,
      });

      logger.info('HTTP request handled', {
        event: 'http_request',
        route: routePath,
        statusCode: 200,
        userId: authenticatedUser.id,
      });

      return reply.code(200).send(jobs);
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'Invalid query parameters',
          details: error.issues,
        });
      }

      logger.error(error instanceof Error ? error : String(error), {
        event: 'get_user_jobs_failed',
        userId: authenticatedUser.id,
      });

      return reply.code(500).send({
        error: 'internal_error',
      });
    }
  });

  app.get(
    '/metrics/readiness',
    { preHandler: [authenticate, requireRole(['admin'])] },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'GET /metrics/readiness');
      const querySchema = z.object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        userId: z.string().uuid().optional(),
      });

      try {
        const query = querySchema.parse(request.query ?? {});
        const readiness = await getReadinessMetricsWithDefaults({
          from: query.from ?? null,
          to: query.to ?? null,
          userId: query.userId ?? null,
        });

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          userId: getAuthenticatedUser(request)?.id,
        });

        return reply.code(200).send(readiness);
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid query parameters',
            details: error.issues,
          });
        }

        logger.error(error instanceof Error ? error : String(error), {
          event: 'get_readiness_metrics_failed',
          userId: getAuthenticatedUser(request)?.id,
        });

        return reply.code(500).send({
          error: 'internal_error',
        });
      }
    },
  );

  app.post('/user/jobs', { preHandler: authenticate }, async (request, reply) => {
    const authenticatedUser = getAuthenticatedUser(request);
    if (!authenticatedUser) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Authentication required',
      });
    }

    const body = request.body as SubmitJobRequest | undefined;

    const jobSchema = z.object({
      md: z.string().min(1),
      learningPresetId: z.string().optional(),
      withTts: z.boolean().optional(),
      upload: z.enum(['auto', 's3', 'none']).optional(),
      voiceAccent: z.string().min(1).optional(),
      voiceId: z.string().min(1).optional(),
      forceTts: z.boolean().optional(),
      notionDatabase: z.string().min(1).optional(),
      ttsStrategy: z.enum(['auto', 'dialogue', 'tts']).optional(),
      ttsProvider: z.enum(['elevenlabs', 'google']).optional(),
      googleTtsModel: z.enum(['chirp3_hd', 'studio', 'neural2', 'wavenet']).optional(),
    });

    try {
      const validatedData = jobSchema.parse(body);

      const result = await submitJob({
        md: validatedData.md,
        learningPresetId: validatedData.learningPresetId,
        withTts: validatedData.withTts,
        upload: validatedData.upload,
        voiceId: validatedData.voiceId,
        voiceAccent: validatedData.voiceAccent,
        forceTts: validatedData.forceTts,
        notionDatabase: validatedData.notionDatabase,
        ttsStrategy: validatedData.ttsStrategy,
        ttsProvider: validatedData.ttsProvider,
        googleTtsModel: validatedData.googleTtsModel,
        userId: authenticatedUser.id,
      });

      logger.info('User submitted job', {
        event: 'user_job_submitted',
        userId: authenticatedUser.id,
        jobId: result.jobId,
      });

      return reply.code(202).send(result);
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'Invalid request body',
          details: error.issues,
        });
      }
      if (error instanceof ValidationError) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: error.message,
          code: error.code,
        });
      }

      logger.error(error instanceof Error ? error : String(error), {
        event: 'user_submit_job_failed',
        userId: authenticatedUser.id,
      });

      return reply.code(500).send({
        error: 'internal_error',
      });
    }
  });

  app.get('/user/files', { preHandler: authenticate }, async (request, reply) => {
    const authenticatedUser = getAuthenticatedUser(request);
    if (!authenticatedUser) {
      return reply.code(401).send({
        error: 'unauthorized',
        message: 'Authentication required',
      });
    }

    try {
      const files: unknown[] = [];

      return reply.code(200).send({
        files,
        total: files.length,
      });
    } catch (error: unknown) {
      logger.error(error instanceof Error ? error : String(error), {
        event: 'get_user_files_failed',
        userId: authenticatedUser.id,
      });

      return reply.code(500).send({
        error: 'internal_error',
      });
    }
  });

  app.get('/auth/me', { preHandler: authenticate }, async (request, reply) => {
    try {
      const authenticatedUser = getAuthenticatedUser(request);
      if (!authenticatedUser) {
        return reply.code(401).send({
          error: 'unauthorized',
          message: 'Authentication required',
          code: 'not_authenticated',
        });
      }

      const user = await getUserById(authenticatedUser.id);
      if (!user || !user.isActive) {
        return reply.code(401).send({
          error: 'unauthorized',
          message: 'User account is inactive or no longer exists',
          code: 'user_inactive',
        });
      }

      logger.info('User profile retrieved', {
        userId: user.id,
        email: user.email,
        role: user.role,
      });

      return reply.code(200).send({
        user: sanitizeUser(user),
      });
    } catch (error: unknown) {
      logger.error(error instanceof Error ? error : String(error), {
        event: 'http_request',
        route: 'GET /auth/me',
        statusCode: 500,
        error: 'internal_error',
      });

      return reply.code(500).send({
        error: 'internal_error',
      });
    }
  });

  // Job actions endpoint
  app.post('/jobs/:jobId/actions', { preHandler: authenticate }, async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const body = request.body as { type?: string; payload?: unknown };

    try {
      // Validate action type
      const validActionTypes = ['rerun_audio', 'rerun_publish', 'cancel', 'edit_metadata'];
      if (!body || !body.type || !validActionTypes.includes(body.type)) {
        return reply.code(400).send({
          error: 'validation_failed',
          message: 'Invalid or missing action type',
          code: 'invalid_action_type',
        });
      }

      // Dynamically import to avoid circular dependencies
      const { executeJobAction } = await import('../application/job-actions/action-handler.js');

      const authenticatedUser = getAuthenticatedUser(request);

      // Construct action object
      const action: { type: string; requestedAt: Date; requestedBy?: string; payload: unknown } = {
        type: body.type,
        requestedAt: new Date(),
        requestedBy: authenticatedUser?.id,
        payload: body.payload || {},
      };

      // Execute action (cast to expected type per action-handler contract)
      const result = await executeJobAction(
        jobId,
        action as unknown as Parameters<typeof executeJobAction>[1],
      );

      if (result.error === 'not_found') {
        return reply.code(404).send({
          error: 'not_found',
          message: result.message,
        });
      }

      if (result.error === 'not_implemented') {
        return reply.code(501).send({
          error: 'not_implemented',
          message: result.message,
          actionType: result.actionType,
        });
      }

      if (result.error === 'invalid_state') {
        return reply.code(409).send({
          error: 'invalid_state',
          message: result.message,
          actionType: result.actionType,
        });
      }

      if (result.error === 'validation_failed') {
        return reply.code(400).send({
          error: 'validation_failed',
          message: result.message,
          actionType: result.actionType,
        });
      }

        logger.info('Job action executed', {
          event: 'job_action_executed',
          userId: authenticatedUser?.id,
          jobId,
          actionType: result.actionType,
          success: result.success,
        });

      return reply.send({
        success: result.success,
        message: result.message,
        jobId: result.jobId,
        actionType: result.actionType,
        timestamp: result.timestamp.toISOString(),
      });
    } catch (error: unknown) {
      logger.error(error instanceof Error ? error : String(error), {
        event: 'job_action_failed',
        userId: getAuthenticatedUser(request)?.id,
        jobId,
        error: 'internal_error',
      });

      return reply.code(500).send({
        error: 'internal_error',
      });
    }
  });

  app.put(
    '/drafts/:id',
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const routePath = resolveRoutePath(request, 'PUT /drafts/:id');
      const paramsSchema = z.object({
        id: z.string().min(1),
      });
      const bodySchema = z.object({
        text: z.string(),
      });

      try {
        const params = paramsSchema.parse(request.params ?? {});
        const body = bodySchema.parse(request.body ?? {});
        // Lazy import to avoid circular dependencies if any
        const { updateDraft } = await import('../application/update-draft.js');
        const updated = await updateDraft({
          id: params.id,
          text: body.text,
        });

        if (!updated) {
          return errorResponse(reply, 'not_found');
        }

        logger.info('HTTP request handled', {
          event: 'http_request',
          route: routePath,
          statusCode: 200,
          draftId: params.id,
        });

        return reply.send(updated);
      } catch (error: unknown) {
        if (error instanceof z.ZodError) {
          return reply.code(400).send({
            error: 'validation_failed',
            message: 'Invalid request',
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

async function readFileBuffer(fileStream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];

  return new Promise((resolve, reject) => {
    fileStream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    fileStream.on('end', () => resolve(Buffer.concat(chunks)));
    fileStream.on('error', reject);
  });
}

function isStreamTruncated(fileStream: Readable): boolean {
  return (
    typeof (fileStream as { truncated?: boolean }).truncated === 'boolean' &&
    Boolean((fileStream as { truncated?: boolean }).truncated)
  );
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) {
    return `${mb.toFixed(1)} MB`;
  }
  return `${Math.max(bytes, 0)} bytes`;
}

function sanitizeRecordingFilename(filename: string): string {
  const base = path.basename(filename || '').trim();
  const sanitized = base && base !== '.' && base !== '..' ? base : '';
  const fallback = `recording-${Date.now()}.bin`;
  const candidate = sanitized || fallback;
  const ext = path.extname(candidate);
  return ext ? candidate : `${candidate}.bin`;
}

function createContentSha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function buildFilesystemMdReference(uploadDir: string, storageKey: string): string {
  const absoluteRoot = path.resolve(uploadDir || '.');
  const absoluteFilePath = path.join(absoluteRoot, storageKey);
  return absoluteFilePath.split(path.sep).join('/');
}

type RangeParseResult = { start: number; end: number } | 'invalid' | null;

function parseRangeHeader(header: string | undefined, size: number): RangeParseResult {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return 'invalid';

  const startRaw = match[1] ?? '';
  const endRaw = match[2] ?? '';
  if (!(startRaw || endRaw)) return 'invalid';
  if (size <= 0) return 'invalid';

  let start = 0;
  let end = size - 1;

  if (startRaw) {
    start = Number.parseInt(startRaw, 10);
    if (Number.isNaN(start) || start < 0) return 'invalid';
    if (endRaw) {
      end = Number.parseInt(endRaw, 10);
      if (Number.isNaN(end) || end < start) return 'invalid';
      end = Math.min(end, size - 1);
    }
  } else {
    const suffix = Number.parseInt(endRaw, 10);
    if (Number.isNaN(suffix) || suffix <= 0) return 'invalid';
    start = Math.max(size - suffix, 0);
  }

  if (start >= size) return 'invalid';

  return { start, end };
}

function createRangeStream(source: Readable, start: number, end: number): Readable {
  let position = 0;
  let remaining = end - start + 1;
  const transformer = new Transform({
    transform(chunk, _encoding, callback) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const chunkStart = position;
      const chunkEnd = position + buffer.length - 1;
      position += buffer.length;

      if (chunkEnd < start) {
        return callback();
      }

      if (remaining <= 0) {
        source.destroy();
        this.end();
        return callback();
      }

      let sliceStart = 0;
      if (chunkStart < start) {
        sliceStart = start - chunkStart;
      }

      const available = buffer.length - sliceStart;
      const take = Math.min(remaining, available);
      if (take > 0) {
        this.push(buffer.subarray(sliceStart, sliceStart + take));
        remaining -= take;
      }

      if (remaining <= 0) {
        source.destroy();
        this.end();
      }

      return callback();
    },
  });

  source.on('error', (error) => transformer.destroy(error));
  return source.pipe(transformer);
}

function resolveAudioMimeType(uri: string): string {
  const cleaned = uri.split('?')[0]?.split('#')[0] ?? uri;
  const ext = path.extname(cleaned).toLowerCase();
  switch (ext) {
    case '.opus': {
      return 'audio/ogg';
    }
    case '.mp3': {
      return 'audio/mpeg';
    }
    case '.wav': {
      return 'audio/wav';
    }
    case '.m4a': {
      return 'audio/mp4';
    }
    default: {
      return 'application/octet-stream';
    }
  }
}
