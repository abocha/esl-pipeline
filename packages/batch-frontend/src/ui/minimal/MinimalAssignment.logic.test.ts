import { describe, expect, it } from 'vitest';

import {
  buildCustomRerunPayload,
  buildPresetRerunPayload,
  buildPublishJobOverrides,
  getDraftPreviewGate,
  getNextGenerationQuotaSnapshot,
  getPresetRerunActions,
  hasActiveGenerationQuotaSelection,
  hashDraftText,
} from './MinimalAssignment.logic';

describe('MinimalAssignment logic helpers', () => {
  it('builds publish overrides for google tts and learning presets', () => {
    expect(
      buildPublishJobOverrides({
        publishTarget: 'html',
        selectedTtsProvider: 'google',
        selectedTtsStrategy: 'tts',
        selectedTtsModel: 'studio',
        selectedPreset: 'general-english-intensive',
        validPresetIds: ['general-english-intensive'],
        learningPresetCatalogEnabled: true,
      }),
    ).toEqual({
      publishTarget: 'html',
      withTts: true,
      ttsProvider: 'google',
      ttsStrategy: 'tts',
      ttsModel: 'studio',
      learningPresetId: 'general-english-intensive',
    });
  });

  it('builds publish overrides for inworld tts', () => {
    expect(
      buildPublishJobOverrides({
        publishTarget: 'html',
        selectedTtsProvider: 'inworld',
        selectedTtsStrategy: 'tts',
        selectedTtsModel: 'inworld-tts-2',
        selectedPreset: '',
        validPresetIds: [],
        learningPresetCatalogEnabled: false,
      }),
    ).toEqual({
      publishTarget: 'html',
      withTts: true,
      ttsProvider: 'inworld',
      ttsStrategy: 'tts',
      ttsModel: 'inworld-tts-2',
    });
  });

  it('omits invalid preset and blank elevenlabs model overrides in auto mode', () => {
    expect(
      buildPublishJobOverrides({
        publishTarget: 'html',
        selectedTtsProvider: 'elevenlabs',
        selectedTtsStrategy: 'auto',
        selectedTtsModel: '  ',
        selectedPreset: 'legacy',
        validPresetIds: ['general-english-intensive'],
        learningPresetCatalogEnabled: true,
      }),
    ).toEqual({
      publishTarget: 'html',
      withTts: true,
      ttsProvider: 'elevenlabs',
      ttsStrategy: 'auto',
    });
  });

  it('includes explicit elevenlabs study-text model outside auto mode', () => {
    expect(
      buildPublishJobOverrides({
        publishTarget: 'html',
        selectedTtsProvider: 'elevenlabs',
        selectedTtsStrategy: 'dialogue',
        selectedTtsModel: 'eleven_v3',
        selectedPreset: '',
        validPresetIds: [],
        learningPresetCatalogEnabled: false,
      }),
    ).toEqual({
      publishTarget: 'html',
      withTts: true,
      ttsProvider: 'elevenlabs',
      ttsStrategy: 'dialogue',
      ttsModel: 'eleven_v3',
    });
  });

  it('builds preset rerun payloads', () => {
    expect(buildPresetRerunPayload('republish')).toEqual({ republishOnly: true });
    expect(buildPresetRerunPayload('pronunciation')).toEqual({
      regeneratePronunciationMainAudio: true,
      regeneratePronunciationChunkAudio: true,
    });
    expect(buildPresetRerunPayload('studyText')).toEqual({ regenerateStudyTextAudio: true });
    expect(buildPresetRerunPayload('allAudio')).toEqual({
      regenerateStudyTextAudio: true,
      regeneratePronunciationMainAudio: true,
      regeneratePronunciationChunkAudio: true,
    });
  });

  it('builds contextual pronunciation preset payloads with the custom rerun provider defaults', () => {
    const customDefaults = {
      rerunStudyTextAudio: false,
      rerunPronunciationMainAudio: false,
      rerunPronunciationChunkAudio: false,
      rerunStudyTextProvider: 'elevenlabs' as const,
      rerunStudyTextModel: '',
      rerunStudyTextVoiceId: '',
      rerunStudyTextVoiceAccent: '',
      rerunStudyTextStrategy: 'auto' as const,
      rerunStudyTextDialogueLanguage: '',
      rerunStudyTextDialogueStability: '',
      rerunStudyTextDialogueSeed: '',
      rerunPronunciationMainProvider: 'elevenlabs' as const,
      rerunPronunciationMainModel: 'eleven_multilingual_v2',
      rerunPronunciationMainVoiceId: '',
      rerunPronunciationMainVoiceAccent: '',
      rerunPronunciationChunkProvider: 'google' as const,
      rerunPronunciationChunkModel: 'chirp3_hd',
      rerunPronunciationChunkVoiceId: '',
      rerunPronunciationChunkVoiceAccent: '',
    };

    expect(buildPresetRerunPayload('pronunciation', customDefaults)).toEqual({
      regeneratePronunciationMainAudio: true,
      pronunciationMainTtsProvider: 'elevenlabs',
      pronunciationMainTtsModel: 'eleven_multilingual_v2',
      regeneratePronunciationChunkAudio: true,
      pronunciationChunkTtsProvider: 'google',
      pronunciationChunkTtsModel: 'chirp3_hd',
    });
  });

  it('describes preset rerun actions with labels that match their payloads', () => {
    expect(getPresetRerunActions()).toEqual([
      {
        kind: 'republish',
        label: 'Republish published version',
        description: 'Refresh the HTML page without regenerating any audio.',
        payload: { republishOnly: true },
      },
      {
        kind: 'studyText',
        label: 'Regenerate study-text audio',
        description: 'Replace only the study-text narration.',
        payload: { regenerateStudyTextAudio: true },
      },
      {
        kind: 'pronunciation',
        label: 'Regenerate pronunciation audio',
        description: 'Replace main pronunciation and pronunciation chunk clips.',
        payload: {
          regeneratePronunciationMainAudio: true,
          regeneratePronunciationChunkAudio: true,
        },
      },
      {
        kind: 'allAudio',
        label: 'Regenerate all audio',
        description: 'Replace study-text, main pronunciation, and pronunciation chunk audio.',
        payload: {
          regenerateStudyTextAudio: true,
          regeneratePronunciationMainAudio: true,
          regeneratePronunciationChunkAudio: true,
        },
      },
    ]);
  });

  it('builds custom rerun payloads and validates dialogue controls', () => {
    expect(
      buildCustomRerunPayload({
        rerunStudyTextAudio: true,
        rerunPronunciationMainAudio: true,
        rerunPronunciationChunkAudio: true,
        rerunStudyTextProvider: 'google',
        rerunStudyTextModel: 'studio',
        rerunStudyTextVoiceId: ' voice-a ',
        rerunStudyTextVoiceAccent: ' british ',
        rerunStudyTextStrategy: 'dialogue',
        rerunStudyTextDialogueLanguage: ' es ',
        rerunStudyTextDialogueStability: '0.42',
        rerunStudyTextDialogueSeed: '7',
        rerunPronunciationMainProvider: 'elevenlabs',
        rerunPronunciationMainModel: 'eleven_flash_v2_5',
        rerunPronunciationMainVoiceId: ' main-voice ',
        rerunPronunciationMainVoiceAccent: ' american ',
        rerunPronunciationChunkProvider: 'google',
        rerunPronunciationChunkModel: '',
        rerunPronunciationChunkVoiceId: ' chunk-voice ',
        rerunPronunciationChunkVoiceAccent: ' australian ',
      }),
    ).toEqual({
      ok: true,
      payload: {
        regenerateStudyTextAudio: true,
        studyTextTtsProvider: 'google',
        studyTextVoiceId: 'voice-a',
        studyTextVoiceAccent: 'british',
        studyTextTtsStrategy: 'dialogue',
        studyTextDialogueLanguage: 'es',
        studyTextDialogueStability: 0.42,
        studyTextDialogueSeed: 7,
        studyTextTtsModel: 'studio',
        regeneratePronunciationMainAudio: true,
        pronunciationMainTtsProvider: 'elevenlabs',
        pronunciationMainVoiceId: 'main-voice',
        pronunciationMainVoiceAccent: 'american',
        pronunciationMainTtsModel: 'eleven_flash_v2_5',
        regeneratePronunciationChunkAudio: true,
        pronunciationChunkTtsProvider: 'google',
        pronunciationChunkVoiceId: 'chunk-voice',
        pronunciationChunkVoiceAccent: 'australian',
      },
    });
  });

  it('rejects invalid dialogue stability and seed values', () => {
    expect(
      buildCustomRerunPayload({
        rerunStudyTextAudio: true,
        rerunPronunciationMainAudio: false,
        rerunPronunciationChunkAudio: false,
        rerunStudyTextProvider: 'google',
        rerunStudyTextModel: '',
        rerunStudyTextVoiceId: '',
        rerunStudyTextVoiceAccent: '',
        rerunStudyTextStrategy: 'auto',
        rerunStudyTextDialogueLanguage: '',
        rerunStudyTextDialogueStability: '2',
        rerunStudyTextDialogueSeed: '',
        rerunPronunciationMainProvider: 'elevenlabs',
        rerunPronunciationMainModel: '',
        rerunPronunciationMainVoiceId: '',
        rerunPronunciationMainVoiceAccent: '',
        rerunPronunciationChunkProvider: 'google',
        rerunPronunciationChunkModel: '',
        rerunPronunciationChunkVoiceId: '',
        rerunPronunciationChunkVoiceAccent: '',
      }),
    ).toEqual({
      ok: false,
      error: 'Dialogue stability must be a number between 0 and 1.',
    });
  });

  it('tracks preview readiness and invalidates it after draft edits', () => {
    const hash = hashDraftText('# Draft');
    expect(hash).toBe(hashDraftText('# Draft'));
    expect(
      getDraftPreviewGate({
        draftText: '  # Draft  ',
        previewHtml: '<html></html>',
        lastPreviewedDraftHash: hash,
      }),
    ).toEqual({
      draftHash: hash,
      hasDraftText: true,
      previewReady: true,
      previewRequired: false,
    });
    expect(
      getDraftPreviewGate({
        draftText: '# Draft\nOne more line',
        previewHtml: '<html></html>',
        lastPreviewedDraftHash: hash,
      }),
    ).toEqual({
      draftHash: hashDraftText('# Draft\nOne more line'),
      hasDraftText: true,
      previewReady: false,
      previewRequired: true,
    });
  });

  it('retains quota snapshots on failure and updates on success', () => {
    const snapshot = {
      source: 'hybrid' as const,
      lastUpdatedAt: '2026-02-18T00:00:00.000Z',
      requestsPerMinute: 5,
    };
    expect(getNextGenerationQuotaSnapshot(snapshot, { kind: 'failure' })).toEqual(snapshot);
    expect(
      getNextGenerationQuotaSnapshot(snapshot, {
        kind: 'success',
        quota: { ...snapshot, requestsPerMinute: 42 },
      }),
    ).toEqual({ ...snapshot, requestsPerMinute: 42 });
  });

  it('detects the active generation quota selection', () => {
    expect(
      hasActiveGenerationQuotaSelection({
        generationRuntimeQuotaSnapshot: null,
        generationRuntimeSelection: null,
        selectedGenerationProvider: 'openai',
        selectedGenerationModel: 'gpt-5.2',
        generationDefaultProvider: 'openai',
        generationDefaultModelForSelection: 'gpt-5.2',
        generationOptionsLoaded: true,
      }),
    ).toBe(true);

    expect(
      hasActiveGenerationQuotaSelection({
        generationRuntimeQuotaSnapshot: null,
        generationRuntimeSelection: null,
        selectedGenerationProvider: 'openai',
        selectedGenerationModel: 'gpt-5.1',
        generationDefaultProvider: 'openai',
        generationDefaultModelForSelection: 'gpt-5.2',
        generationOptionsLoaded: true,
      }),
    ).toBe(false);

    expect(
      hasActiveGenerationQuotaSelection({
        generationRuntimeQuotaSnapshot: {
          source: 'provider',
          lastUpdatedAt: '2026-02-18T00:00:00.000Z',
        },
        generationRuntimeSelection: { provider: 'openai', model: 'gpt-5.2' },
        selectedGenerationProvider: 'openai',
        selectedGenerationModel: 'gpt-5.2',
        generationDefaultProvider: 'openai',
        generationDefaultModelForSelection: 'gpt-5.2',
        generationOptionsLoaded: true,
      }),
    ).toBe(true);
  });
});
