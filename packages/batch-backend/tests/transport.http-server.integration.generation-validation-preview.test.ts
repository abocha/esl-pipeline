import { describeHttpServerIntegrationSuite } from './transport.http-server.integration.harness.js';

function extractPronunciationAudioPayload(html: string): Record<string, unknown> | null {
  const match = html.match(
    /<script\b[^>]*\bid="esl-pronunciation-audio"[^>]*>([\s\S]*?)<\/script>/i,
  );
  if (!match?.[1]) {
    return null;
  }
  return JSON.parse(match[1]) as Record<string, unknown>;
}

describeHttpServerIntegrationSuite(
  'transport/http-server - integration (in-process) [generation-validation-preview]',
  ({
    app,
    expect,
    generateDraftModule,
    it,
    materializeDraftModule,
    notionAdapterModule,
    settingsRepositoryModule,
    validateMarkdown,
    vi,
  }) => {
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
          notionDatabase: 'notion-db',
          withTts: true,
          ttsProvider: 'google',
          googleTtsModel: 'chirp3_hd',
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

    it('POST /validation/markdown returns validation payload', async () => {
      const mockValidateMarkdown = vi.mocked(validateMarkdown);
      mockValidateMarkdown.mockResolvedValue({
        ok: false,
        errors: ['Missing header'],
        warnings: ['Minor issue'],
        meta: {
          title: 'Lesson',
          student: 'Anna',
          level: 'B1',
          topic: 'Grammar',
          input_type: 'generate',
          study_text_type: 'dialogue',
          speaker_labels: ['A', 'B'],
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/validation/markdown',
        payload: {
          text: 'raw markdown',
          strict: true,
          learningPresetId: 'general-english',
          learningPresetVersion: 'v1',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        ok: false,
        errors: ['Missing header'],
        warnings: ['Minor issue'],
        meta: {
          title: 'Lesson',
          student: 'Anna',
          level: 'B1',
          topic: 'Grammar',
          input_type: 'generate',
          study_text_type: 'dialogue',
          speaker_labels: ['A', 'B'],
        },
      });
      expect(mockValidateMarkdown).toHaveBeenCalledWith({
        markdown: 'raw markdown',
        strict: true,
        learningPresetId: 'general-english',
        learningPresetVersion: 'v1',
      });
    });

    it('POST /validation/markdown preserves additive ruleset fallback metadata', async () => {
      const mockValidateMarkdown = vi.mocked(validateMarkdown);
      mockValidateMarkdown.mockResolvedValue({
        ok: true,
        errors: [],
        warnings: ['Unknown learning preset "ielts-academic". Falling back to general-english@v1.'],
        issues: [
          {
            code: 'ruleset.unknown_preset_fallback',
            ruleId: 'ruleset-resolution',
            severity: 'warning',
            message:
              'Unknown learning preset "ielts-academic". Falling back to general-english@v1.',
            category: 'contract',
            blockingInStrict: false,
          },
        ],
        ruleset: {
          id: 'general-english',
          version: 'v1',
          requestedId: 'ielts-academic',
          requestedVersion: null,
          fallbackApplied: true,
          fallbackReason: 'unknown_preset',
        },
      });

      const response = await app.inject({
        method: 'POST',
        url: '/validation/markdown',
        payload: {
          text: 'raw markdown',
          strict: true,
          learningPresetId: 'ielts-academic',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        ok: true,
        errors: [],
        warnings: ['Unknown learning preset "ielts-academic". Falling back to general-english@v1.'],
        issues: [
          {
            code: 'ruleset.unknown_preset_fallback',
            ruleId: 'ruleset-resolution',
            severity: 'warning',
            message:
              'Unknown learning preset "ielts-academic". Falling back to general-english@v1.',
            category: 'contract',
            blockingInStrict: false,
          },
        ],
        ruleset: {
          id: 'general-english',
          version: 'v1',
          requestedId: 'ielts-academic',
          requestedVersion: null,
          fallbackApplied: true,
          fallbackReason: 'unknown_preset',
        },
      });
      expect(mockValidateMarkdown).toHaveBeenCalledWith({
        markdown: 'raw markdown',
        strict: true,
        learningPresetId: 'ielts-academic',
        learningPresetVersion: undefined,
      });
    });

    it('POST /preview/html injects audio placeholder when no audio URL is provided', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/preview/html',
        payload: {
          text: [
            '## Warm up',
            '',
            ':::study-text Transcript',
            'Teacher: Hello!',
            'Student: Hi!',
            ':::',
          ].join('\n'),
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(
        expect.objectContaining({
          html: expect.any(String),
        }),
      );

      const payload = response.json() as { html: string };
      expect(payload.html).toContain('Audio track generating...');
      expect(payload.html).toContain('audio-placeholder');
      expect(payload.html).not.toContain('esl-generated-study-text-audio-placeholder');
    });

    it('POST /preview/html renders interactive checklist inputs from task-list markers', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/preview/html',
        payload: {
          text: [
            '- **Checklist:**',
            '  - [ ] Introduce the institution with "**the**".',
            '  - [x] Use the phrase "**had problems [doing something]**".',
          ].join('\n'),
        },
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json() as { html: string };
      expect(payload.html).toContain('task-list-item-checkbox');
      expect(payload.html).toContain(
        '<input type="checkbox" class="task-list-item-checkbox" checked>',
      );
      expect(payload.html).not.toContain('[ ] Introduce the institution');
    });

    it('POST /preview/html includes hybrid table balancing hooks', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/preview/html',
        payload: {
          text: [
            '| Word | Real English Meaning | Structural Formula | Example from Text |',
            '| --- | --- | --- | --- |',
            '| A way | A method to solve a problem. | Problem + Brain = Way | "I found a way." |',
          ].join('\n'),
        },
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json() as { html: string };
      expect(payload.html).toContain('<table>');
      expect(payload.html).toContain('data-generated-colgroup');
      expect(payload.html).toContain('data-balanced-columns');
      expect(payload.html).toContain('instructional_4col');
      expect(payload.html).toContain('data-col-role');
      expect(payload.html).toContain('data-cell-prose');
      expect(payload.html).toContain('if (!isDesktopViewport())');
      expect(payload.html).toContain('structural formula');
    });

    it('POST /preview/html derives title from markdown heading when title is omitted', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/preview/html',
        payload: {
          text: ['# Lesson heading from markdown', '', 'Body text.'].join('\n'),
        },
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json() as { html: string };
      expect(payload.html).toContain('<h1 class="hero-title">Lesson heading from markdown</h1>');
    });

    it('POST /preview/html derives title from frontmatter when heading title is omitted', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/preview/html',
        payload: {
          text: ['---', 'title: "Frontmatter Lesson"', '---', '', 'Body text.'].join('\n'),
        },
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json() as { html: string };
      expect(payload.html).toContain('<h1 class="hero-title">Frontmatter Lesson</h1>');
    });

    it('POST /preview/html derives title from CRLF frontmatter when heading title is omitted', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/preview/html',
        payload: {
          text: ['---', 'title: "CRLF Frontmatter Lesson"', '---', '', 'Body text.'].join('\r\n'),
        },
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json() as { html: string };
      expect(payload.html).toContain('<h1 class="hero-title">CRLF Frontmatter Lesson</h1>');
    });

    it('POST /preview/html derives title from frontmatter at EOF without trailing newline', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/preview/html',
        payload: {
          text: ['---', 'title: "EOF Frontmatter Lesson"', '---'].join('\n'),
        },
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json() as { html: string };
      expect(payload.html).toContain('<h1 class="hero-title">EOF Frontmatter Lesson</h1>');
    });

    it('POST /preview/html resolves heading colors from user default preset when learning preset is selected', async () => {
      const getSettingsSpy = vi
        .spyOn(settingsRepositoryModule, 'getSettingsByUserId')
        .mockResolvedValue({
          defaultPreset: 'b1-default',
        } as Awaited<ReturnType<typeof settingsRepositoryModule.getSettingsByUserId>>);
      const createDefaultSpy = vi.spyOn(settingsRepositoryModule, 'createDefaultSettings');
      const loadPresetSpy = vi.spyOn(notionAdapterModule, 'loadPreset').mockResolvedValue({
        h2: 'blue',
        h3: 'green',
      });

      try {
        const response = await app.inject({
          method: 'POST',
          url: '/preview/html',
          payload: {
            text: '# Theme parity',
            learningPresetId: 'general-english',
          },
        });

        expect(response.statusCode).toBe(200);
        expect(getSettingsSpy).toHaveBeenCalledWith('test-user-id');
        expect(createDefaultSpy).not.toHaveBeenCalled();
        expect(loadPresetSpy).toHaveBeenCalledWith('b1-default', expect.any(String));

        const payload = response.json() as { html: string };
        expect(payload.html).toContain('--theme-h2: #2d9cdb;');
        expect(payload.html).toContain('--theme-h3: #27ae60;');
      } finally {
        getSettingsSpy.mockRestore();
        createDefaultSpy.mockRestore();
        loadPresetSpy.mockRestore();
      }
    });

    it('POST /preview/html injects pronunciation placeholder in shadow_sentence mode', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/preview/html',
        payload: {
          text: [
            '### C. Pronunciation Micro-Focus',
            '',
            '**Mode:** shadow_sentence',
            '**Shadow sentence:** We should review this carefully.',
            '',
            '1. review — /rɪˈvjuː/',
            '2. carefully — /ˈkeə.fəl.i/',
            '3. should — /ʃʊd/',
            '',
            ':::study-text Transcript',
            'Teacher: Hello!',
            ':::',
          ].join('\n'),
        },
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json() as { html: string };
      const placeholderCount = (payload.html.match(/Audio track generating\.\.\./g) ?? []).length;
      expect(placeholderCount).toBeGreaterThanOrEqual(2);
      expect(payload.html).not.toContain('esl-generated-pronunciation-audio-placeholder');
      expect(payload.html.lastIndexOf('Audio track generating...')).toBeGreaterThan(
        payload.html.indexOf('Shadow sentence'),
      );
      expect(payload.html).toContain('esl-pronunciation-audio');
      const pronunciationAudio = extractPronunciationAudioPayload(payload.html);
      expect(pronunciationAudio?.primaryClip).toMatchObject({ id: 'preview-shadow-sentence' });
      expect(pronunciationAudio?.itemClips).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'preview-shadow-word-1' })]),
      );
    });

    it('POST /preview/html places pronunciation audio URL below shadow sentence content', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/preview/html',
        payload: {
          text: [
            '### C. Pronunciation Micro-Focus',
            '',
            '**Mode:** shadow_sentence',
            '**Shadow sentence:** We should review this carefully.',
            '',
            '1. review — /rɪˈvjuː/',
            '2. carefully — /ˈkeə.fəl.i/',
            '3. should — /ʃʊd/',
          ].join('\n'),
          pronunciationAudioUrl: 'https://example.com/pronunciation.mp3',
        },
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json() as { html: string };
      expect(payload.html).toContain('https://example.com/pronunciation.mp3');
      const audioIndex = payload.html.indexOf('Audio recording: Pronunciation Practice');
      expect(audioIndex).toBeGreaterThan(payload.html.indexOf('Shadow sentence'));
      expect(audioIndex).toBeLessThan(payload.html.indexOf('review —'));
    });

    it('POST /preview/html places pronunciation audio below multiline shadow sentence labels', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/preview/html',
        payload: {
          text: [
            '### C. Pronunciation Micro-Focus',
            '',
            '**Mode:** shadow_sentence',
            '**Shadow sentence:**',
            'There was a flood, so the vehicle stopped working.',
            '',
            '1. flood — /flʌd/',
            '2. vehicle — /ˈviː.ɪ.kəl/',
          ].join('\n'),
          pronunciationAudioUrl: 'https://example.com/pronunciation-multiline.mp3',
        },
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json() as { html: string };
      const audioIndex = payload.html.indexOf('Audio recording: Pronunciation Practice');
      expect(audioIndex).toBeGreaterThan(
        payload.html.indexOf('There was a flood, so the vehicle stopped working.'),
      );
      expect(audioIndex).toBeLessThan(payload.html.indexOf('flood —'));
    });

    it('POST /preview/html injects pronunciation placeholder in connected_speech mode', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/preview/html',
        payload: {
          text: [
            '### C. Pronunciation Micro-Focus',
            '',
            '**Mode:** connected_speech',
            '',
            '- 1. "Change helps us." -> Change help-sus.',
            '- 2. "It gives us food." -> It give-sus food.',
            '- 3. "Light feels stronger." -> Light feel-stronger.',
            '',
            '**Natural sentence practice:** The device is as heavy as the old one.',
            '',
            ':::study-text Transcript',
            'Teacher: Hello!',
            ':::',
          ].join('\n'),
        },
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json() as { html: string };
      const placeholderCount = (payload.html.match(/Audio track generating\.\.\./g) ?? []).length;
      expect(placeholderCount).toBeGreaterThanOrEqual(2);
      expect(payload.html.lastIndexOf('Audio track generating...')).toBeGreaterThan(
        payload.html.indexOf('Natural sentence practice'),
      );
      const pronunciationAudio = extractPronunciationAudioPayload(payload.html);
      expect(pronunciationAudio?.primaryClip).toMatchObject({
        id: 'preview-connected-speech-sentence',
      });
      expect(pronunciationAudio?.itemClips).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'preview-connected-1' })]),
      );
    });

    it('POST /preview/html injects pronunciation placeholder in minimal_pair mode', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/preview/html',
        payload: {
          text: [
            '### C. Pronunciation Micro-Focus',
            '',
            '**Mode:** minimal_pair',
            '**Target:** Hear the short /ɪ/ and long /iː/ clearly.',
            '',
            '1. ship /ʃɪp/ — sheep /ʃiːp/',
            '2. live /lɪv/ — leave /liːv/',
            '',
            ':::study-text Transcript',
            'Teacher: Hello!',
            ':::',
          ].join('\n'),
        },
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json() as { html: string };
      const placeholderCount = (payload.html.match(/Audio track generating\.\.\./g) ?? []).length;
      expect(placeholderCount).toBeGreaterThanOrEqual(2);
      const pronunciationAudio = extractPronunciationAudioPayload(payload.html);
      expect(pronunciationAudio?.primaryClip).toBeUndefined();
      expect(pronunciationAudio?.itemClips).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'preview-minimal-pair-1-left' }),
          expect.objectContaining({ id: 'preview-minimal-pair-1-right' }),
        ]),
      );
    });

    it('POST /preview/html preserves user-authored audio directives', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/preview/html',
        payload: {
          text: [
            '## Warm up',
            '',
            ':::audio https://example.com/custom.mp3',
            '',
            ':::study-text Transcript',
            'Teacher: Hello!',
            ':::',
          ].join('\n'),
          audioUrl: 'https://example.com/generated.mp3',
        },
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json() as { html: string };
      expect(payload.html).toContain('https://example.com/custom.mp3');
      expect(payload.html).toContain('https://example.com/generated.mp3');
    });
  },
);
