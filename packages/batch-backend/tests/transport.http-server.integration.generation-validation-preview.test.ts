import { beforeEach } from 'vitest';

import * as draftRepository from '../src/domain/draft-repository.js';
import * as promptRepository from '../src/domain/prompt-package-repository.js';
import { assignmentFixture, promptPackageFixture } from './assignment-v1.test-harness.js';
import { describeHttpServerIntegrationSuite } from './transport.http-server.integration.harness.js';

describeHttpServerIntegrationSuite(
  'transport/http-server - integration (in-process) [generation-validation-preview]',
  ({
    app,
    expect,
    generateDraftModule,
    it,
    materializeDraftModule,
    settingsRepositoryModule,
    vi,
  }) => {
    beforeEach(() => {
      vi.spyOn(promptRepository, 'isPromptPackageAccessibleForUser').mockResolvedValue(true);
      vi.spyOn(draftRepository, 'getDraftById').mockResolvedValue({
        id: 'draft-1',
        promptPackageId: 'prompt-1',
      } as never);
    });
    it('previews validated typed input through native rendering and rejects invalid domains', async () => {
      vi.spyOn(promptRepository, 'getPromptPackageById').mockResolvedValue(
        promptPackageFixture() as never,
      );
      const valid = await app.inject({
        method: 'POST',
        url: '/preview/html',
        payload: { assignment: assignmentFixture(), promptPackageId: 'prompt-1' },
      });
      expect(valid.statusCode).toBe(200);
      expect(valid.json().html).toContain('Clear demos');
      expect(valid.json().html).toContain('data-assignment-pronunciation');
      expect(valid.json().html).not.toContain('assignment_projection');
      const invalid = await app.inject({
        method: 'POST',
        url: '/preview/html',
        payload: {
          assignment: { ...assignmentFixture(), practice: [] },
          promptPackageId: 'prompt-1',
        },
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json().message).toContain('practice must not be empty');
    });
    it('authorizes typed preview before reading the pinned prompt or rendering', async () => {
      vi.spyOn(promptRepository, 'isPromptPackageAccessibleForUser').mockResolvedValue(false);
      const read = vi.spyOn(promptRepository, 'getPromptPackageById').mockClear();
      const response = await app.inject({
        method: 'POST',
        url: '/preview/html',
        payload: { assignment: assignmentFixture(), promptPackageId: 'foreign' },
      });
      expect(response.statusCode).toBe(404);
      expect(read).not.toHaveBeenCalled();
    });
    it('POST /generation/drafts returns generated payload', async () => {
      const generateDraft = vi.spyOn(generateDraftModule, 'generateDraft');
      generateDraft.mockClear();
      generateDraft.mockResolvedValue({
        text: '# Generated draft',
        provider: 'openai',
        model: 'gpt-5.2',
        quota: {
          source: 'hybrid',
          lastUpdatedAt: '2026-02-18T00:00:00.000Z',
        },
        usage: {
          inputTokens: 123,
          outputTokens: 456,
          totalTokens: 579,
        },
        providerRequestId: 'resp-1',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/generation/drafts',
        payload: {
          promptPackageId: 'prompt-1',
          provider: 'openai',
          model: 'gpt-5.2',
          maxOutputTokens: 800,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        text: '# Generated draft',
        provider: 'openai',
        model: 'gpt-5.2',
        quota: {
          source: 'hybrid',
        },
        usage: {
          totalTokens: 579,
        },
      });
      expect(generateDraft).toHaveBeenCalledWith(
        {
          promptPackageId: 'prompt-1',
          provider: 'openai',
          model: 'gpt-5.2',
          maxOutputTokens: 800,
        },
        expect.any(Object),
      );
    });

    it.each(['google_ai_studio', 'openrouter'])(
      'rejects fresh %s draft requests before generation',
      async (provider: string) => {
        const generateDraft = vi.spyOn(generateDraftModule, 'generateDraft').mockClear();
        const response = await app.inject({
          method: 'POST',
          url: '/generation/drafts',
          payload: { promptPackageId: 'prompt-1', provider, model: 'frozen-model' },
        });
        expect(response.statusCode).toBe(400);
        expect(generateDraft).not.toHaveBeenCalled();
      },
    );

    it('POST /generation/drafts returns 404 when prompt package is missing', async () => {
      const generateDraft = vi.spyOn(generateDraftModule, 'generateDraft');
      generateDraft.mockClear();
      generateDraft.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/generation/drafts',
        payload: {
          promptPackageId: 'missing',
        },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'not_found' });
    });

    it('POST /generation/drafts maps provider errors to category-specific status and payload', async () => {
      const generateDraft = vi.spyOn(generateDraftModule, 'generateDraft');
      generateDraft.mockClear();
      generateDraft.mockRejectedValue(
        new generateDraftModule.GenerateDraftProviderError({
          category: 'provider_timeout',
          provider: 'google_ai_studio',
          model: 'gemini-3-flash-preview',
          message: 'Provider request timed out',
        }),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/generation/drafts',
        payload: {
          promptPackageId: 'prompt-1',
        },
      });

      expect(response.statusCode).toBe(504);
      expect(response.json()).toEqual({
        error: 'internal_error',
        code: 'provider_timeout',
        message: 'Provider request timed out',
        provider: 'google_ai_studio',
        model: 'gemini-3-flash-preview',
        requestId: expect.any(String),
        timestamp: expect.any(String),
      });
    });

    it('POST /generation/drafts maps rate-limit provider errors to 429', async () => {
      const generateDraft = vi.spyOn(generateDraftModule, 'generateDraft');
      generateDraft.mockClear();
      generateDraft.mockRejectedValue(
        new generateDraftModule.GenerateDraftProviderError({
          category: 'provider_rate_limit',
          provider: 'openai',
          model: 'gpt-5.2',
          message: 'Rate limit exceeded',
        }),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/generation/drafts',
        payload: {
          promptPackageId: 'prompt-1',
        },
      });

      expect(response.statusCode).toBe(429);
      expect(response.json()).toEqual({
        error: 'internal_error',
        code: 'provider_rate_limit',
        message: 'Rate limit exceeded',
        provider: 'openai',
        model: 'gpt-5.2',
        requestId: expect.any(String),
        timestamp: expect.any(String),
      });
    });

    it('POST /generation/drafts maps contract provider errors to 502', async () => {
      const generateDraft = vi.spyOn(generateDraftModule, 'generateDraft');
      generateDraft.mockClear();
      generateDraft.mockRejectedValue(
        new generateDraftModule.GenerateDraftProviderError({
          category: 'provider_contract_error',
          provider: 'openrouter',
          model: 'openrouter/test-primary',
          message: 'Invalid provider payload',
        }),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/generation/drafts',
        payload: {
          promptPackageId: 'prompt-1',
        },
      });

      expect(response.statusCode).toBe(502);
      expect(response.json()).toEqual({
        error: 'internal_error',
        code: 'provider_contract_error',
        message: 'Invalid provider payload',
        provider: 'openrouter',
        model: 'openrouter/test-primary',
        requestId: expect.any(String),
        timestamp: expect.any(String),
      });
    });

    it('POST /generation/drafts maps budget errors to 429 with limit details', async () => {
      const generateDraft = vi.spyOn(generateDraftModule, 'generateDraft');
      generateDraft.mockClear();
      generateDraft.mockRejectedValue(
        new generateDraftModule.GenerateDraftProviderError({
          category: 'budget_exceeded',
          provider: 'openai',
          model: 'gpt-5.2',
          message: 'Generation blocked by daily_tokens safety limit (120000/120000).',
          limitType: 'daily_tokens',
          limit: 120000,
          used: 120000,
          window: 'day',
        }),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/generation/drafts',
        payload: {
          promptPackageId: 'prompt-1',
        },
      });

      expect(response.statusCode).toBe(429);
      expect(response.json()).toEqual({
        error: 'internal_error',
        code: 'budget_exceeded',
        message: 'Generation blocked by daily_tokens safety limit (120000/120000).',
        provider: 'openai',
        model: 'gpt-5.2',
        limitType: 'daily_tokens',
        limit: 120000,
        used: 120000,
        window: 'day',
        requestId: expect.any(String),
        timestamp: expect.any(String),
      });
    });

    it('POST /generation/drafts validates request body', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/generation/drafts',
        payload: {
          promptPackageId: '',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: 'validation_failed',
        message: 'Invalid request body',
        details: expect.any(Array),
      });
    });

    it('POST /drafts/:id/materialize returns md path', async () => {
      const materializeDraft = vi.spyOn(materializeDraftModule, 'materializeDraft');
      materializeDraft.mockClear();
      materializeDraft.mockResolvedValue({
        draftId: 'draft-1',
        jobId: 'job-1',
        mdPath: '/uploads/drafts/draft-1.md',
        mdStorageUri: 'local://drafts/draft-1.md',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/drafts/draft-1/materialize',
        payload: { jobId: 'job-1' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        draftId: 'draft-1',
        jobId: 'job-1',
        mdPath: '/uploads/drafts/draft-1.md',
        mdStorageUri: 'local://drafts/draft-1.md',
      });
      expect(materializeDraft).toHaveBeenCalledWith({
        draftId: 'draft-1',
        jobId: 'job-1',
        jobOverrides: undefined,
      });
    });

    it('POST /drafts/:id/materialize accepts missing jobId', async () => {
      const materializeDraft = vi.spyOn(materializeDraftModule, 'materializeDraft');
      materializeDraft.mockClear();
      materializeDraft.mockResolvedValue({
        draftId: 'draft-2',
        jobId: 'job-2',
        mdPath: '/uploads/drafts/draft-2.md',
        mdStorageUri: 'local://drafts/draft-2.md',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/drafts/draft-2/materialize',
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        draftId: 'draft-2',
        jobId: 'job-2',
        mdPath: '/uploads/drafts/draft-2.md',
        mdStorageUri: 'local://drafts/draft-2.md',
      });
      expect(materializeDraft).toHaveBeenCalledWith({
        draftId: 'draft-2',
        jobId: undefined,
        jobOverrides: undefined,
      });
    });

    it('POST /drafts/:id/materialize forwards jobOverrides', async () => {
      const materializeDraft = vi.spyOn(materializeDraftModule, 'materializeDraft');
      materializeDraft.mockClear();
      materializeDraft.mockResolvedValue({
        draftId: 'draft-3',
        jobId: 'job-3',
        mdPath: '/uploads/drafts/draft-3.md',
        mdStorageUri: 'local://drafts/draft-3.md',
      });

      const payload = {
        jobOverrides: {
          learningPresetId: 'general-english',
          publishTarget: 'html',
          withTts: true,
          ttsProvider: 'elevenlabs',
          ttsModel: 'eleven_v3',
          forceTts: true,
          ttsStrategy: 'dialogue',
          upload: 's3',
          voiceId: 'voice-1',
          voiceAccent: 'american_female',
        },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/drafts/draft-3/materialize',
        payload,
      });

      expect(response.statusCode).toBe(200);
      expect(materializeDraft).toHaveBeenCalledWith({
        draftId: 'draft-3',
        jobId: undefined,
        jobOverrides: payload.jobOverrides,
      });
    });

    it('POST /drafts/:id/materialize rejects invalid study-text elevenlabs override combinations', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/drafts/draft-3/materialize',
        payload: {
          jobOverrides: {
            withTts: true,
            ttsProvider: 'elevenlabs',
            ttsStrategy: 'auto',
            ttsModel: 'eleven_v3',
          },
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: 'validation_failed',
        message: 'Invalid request body',
        details: expect.arrayContaining([
          expect.objectContaining({
            message: 'Automatic ElevenLabs publish jobs must use strategy-default model selection.',
            path: ['jobOverrides', 'ttsModel'],
          }),
        ]),
      });
    });

    it('POST /drafts/:id/materialize maps ValidationError from defaulted publish overrides to 400', async () => {
      const { ValidationError } = await import('../src/application/submit-job.js');
      const materializeDraft = vi.spyOn(materializeDraftModule, 'materializeDraft');
      materializeDraft.mockClear();
      materializeDraft.mockRejectedValue(
        new ValidationError(
          'Automatic ElevenLabs publish jobs must use strategy-default model selection.',
          'invalid_study_text_elevenlabs_model_for_strategy',
        ),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/drafts/draft-3/materialize',
        payload: {
          jobOverrides: {
            ttsProvider: 'elevenlabs',
            ttsModel: 'eleven_multilingual_v2',
          },
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({
        error: 'validation_failed',
        message: 'Automatic ElevenLabs publish jobs must use strategy-default model selection.',
        code: 'invalid_study_text_elevenlabs_model_for_strategy',
      });
    });

    it('POST /drafts/:id/materialize maps lost assignment source authority to 409', async () => {
      const { PromptPackageAssignmentError } = await import(
        '../src/application/create-prompt-package.js'
      );
      const materializeDraft = vi.spyOn(materializeDraftModule, 'materializeDraft');
      materializeDraft.mockClear();
      materializeDraft.mockRejectedValue(
        new PromptPackageAssignmentError(
          'PROMPT_PACKAGE_SOURCE_NOT_CANONICAL',
          'Assignment source is no longer canonical',
        ),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/drafts/draft-stale/materialize',
        payload: { jobOverrides: { autoPublish: true } },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toEqual({
        error: 'conflict',
        message: 'Assignment source is no longer canonical',
        code: 'PROMPT_PACKAGE_SOURCE_NOT_CANONICAL',
      });
    });

    it('POST /drafts/:id/materialize returns 404 when missing', async () => {
      const materializeDraft = vi.spyOn(materializeDraftModule, 'materializeDraft');
      materializeDraft.mockClear();
      materializeDraft.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: '/drafts/missing/materialize',
        payload: { jobId: 'job-1' },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: 'not_found' });
    });

    it.each(['/validation/markdown', '/preview/html'])(
      'retires Markdown processing at %s',
      async (url: string) => {
        const response = await app.inject({
          method: 'POST',
          url,
          payload: { text: '# Historical assignment' },
        });
        expect(response.statusCode).toBe(410);
        expect(response.json().code).toBe('legacy_assignment_read_only');
      },
    );
  },
);
