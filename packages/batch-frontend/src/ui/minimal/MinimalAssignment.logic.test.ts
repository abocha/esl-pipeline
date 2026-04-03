import { describe, expect, it } from 'vitest';

import {
  buildCustomRerunPayload,
  buildPresetRerunPayload,
  buildPublishJobOverrides,
  getDraftPreviewGate,
  getNextGenerationQuotaSnapshot,
  hasActiveGenerationQuotaSelection,
  hashDraftText,
} from './MinimalAssignment.logic';

describe('MinimalAssignment logic helpers', () => {
  it('builds publish overrides for google tts and learning presets', () => {
    expect(
      buildPublishJobOverrides({
        publishTarget: 'html',
        selectedTtsProvider: 'google',
        selectedTtsModel: 'studio',
        selectedPreset: 'general-english-intensive',
        validPresetIds: ['general-english-intensive'],
        learningPresetCatalogEnabled: true,
      }),
    ).toEqual({
      publishTarget: 'html',
      withTts: true,
      ttsProvider: 'google',
      googleTtsModel: 'studio',
      learningPresetId: 'general-english-intensive',
    });
  });

  it('omits invalid preset and blank google model overrides', () => {
    expect(
      buildPublishJobOverrides({
        publishTarget: 'notion',
        selectedTtsProvider: 'elevenlabs',
        selectedTtsModel: '  ',
        selectedPreset: 'legacy',
        validPresetIds: ['general-english-intensive'],
        learningPresetCatalogEnabled: true,
      }),
    ).toEqual({
      publishTarget: 'notion',
      withTts: true,
      ttsProvider: 'elevenlabs',
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
        rerunPronunciationChunkProvider: 'edge-tts',
        rerunPronunciationChunkModel: '',
        rerunPronunciationChunkVoiceId: ' chunk-voice ',
        rerunPronunciationChunkVoiceAccent: ' australian ',
        rerunPronunciationChunkEdgeVoice: 'en-US-JennyNeural',
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
        studyTextGoogleTtsModel: 'studio',
        regeneratePronunciationMainAudio: true,
        pronunciationMainTtsProvider: 'elevenlabs',
        pronunciationMainVoiceId: 'main-voice',
        pronunciationMainVoiceAccent: 'american',
        pronunciationMainElevenlabsModel: 'eleven_flash_v2_5',
        regeneratePronunciationChunkAudio: true,
        pronunciationChunkTtsProvider: 'edge-tts',
        pronunciationChunkVoiceId: 'chunk-voice',
        pronunciationChunkVoiceAccent: 'australian',
        pronunciationChunkEdgeVoice: 'en-US-JennyNeural',
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
        rerunPronunciationChunkProvider: 'edge-tts',
        rerunPronunciationChunkModel: '',
        rerunPronunciationChunkVoiceId: '',
        rerunPronunciationChunkVoiceAccent: '',
        rerunPronunciationChunkEdgeVoice: '',
      }),
    ).toEqual({
      ok: false,
      error: 'Dialogue stability must be a number between 0 and 1.',
    });
  });

  it('tracks preview readiness and draft hash deterministically', () => {
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
