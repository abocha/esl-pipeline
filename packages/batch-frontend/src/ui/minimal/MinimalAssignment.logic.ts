import type {
  ElevenLabsTtsModelId,
  GenerateDraftResponse,
  GoogleTtsModel,
  JobConfigOverrides,
  RerunJobPayload,
} from '../../utils/api';

export type MinimalPublishTarget = 'notion' | 'anytype' | 'html';

export interface PublishJobOverridesInput {
  publishTarget: MinimalPublishTarget;
  selectedTtsProvider: 'elevenlabs' | 'google';
  selectedTtsStrategy: 'auto' | 'dialogue' | 'tts';
  selectedTtsModel: string;
  selectedPreset: string;
  validPresetIds: readonly string[];
  learningPresetCatalogEnabled: boolean;
}

export type PublishJobOverrides = Pick<
  JobConfigOverrides,
  | 'publishTarget'
  | 'withTts'
  | 'ttsProvider'
  | 'ttsStrategy'
  | 'studyTextElevenlabsModel'
  | 'googleTtsModel'
  | 'learningPresetId'
>;

export interface DraftPreviewGate {
  draftHash: string;
  hasDraftText: boolean;
  previewReady: boolean;
  previewRequired: boolean;
}

export type RerunPayload = RerunJobPayload;

export interface CustomRerunInput {
  rerunStudyTextAudio: boolean;
  rerunPronunciationMainAudio: boolean;
  rerunPronunciationChunkAudio: boolean;
  rerunStudyTextProvider: 'elevenlabs' | 'google';
  rerunStudyTextModel: string;
  rerunStudyTextVoiceId: string;
  rerunStudyTextVoiceAccent: string;
  rerunStudyTextStrategy: 'auto' | 'dialogue' | 'tts';
  rerunStudyTextDialogueLanguage: string;
  rerunStudyTextDialogueStability: string;
  rerunStudyTextDialogueSeed: string;
  rerunPronunciationMainProvider: 'elevenlabs' | 'google';
  rerunPronunciationMainModel: string;
  rerunPronunciationMainVoiceId: string;
  rerunPronunciationMainVoiceAccent: string;
  rerunPronunciationChunkProvider: 'edge-tts' | 'elevenlabs' | 'google';
  rerunPronunciationChunkModel: string;
  rerunPronunciationChunkVoiceId: string;
  rerunPronunciationChunkVoiceAccent: string;
  rerunPronunciationChunkEdgeVoice: string;
}

export type CustomRerunPayloadResult =
  | { ok: true; payload: RerunPayload }
  | { ok: false; error: string };

export type GenerationQuotaSnapshot = GenerateDraftResponse['quota'] | null;

export type GenerationQuotaUpdate =
  | { kind: 'success'; quota: GenerateDraftResponse['quota'] | null | undefined }
  | { kind: 'failure' };

export function hashDraftText(value: string): string {
  let hash = 2166136261;
  for (const char of value) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }
    hash ^= codePoint;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function getDraftPreviewGate(params: {
  draftText: string;
  previewHtml: string | null;
  lastPreviewedDraftHash: string | null;
}): DraftPreviewGate {
  const normalizedDraft = params.draftText.trim();
  const draftHash = hashDraftText(normalizedDraft);
  const hasDraftText = normalizedDraft.length > 0;
  const previewReady =
    hasDraftText && Boolean(params.previewHtml) && params.lastPreviewedDraftHash === draftHash;

  return {
    draftHash,
    hasDraftText,
    previewReady,
    previewRequired: hasDraftText && !previewReady,
  };
}

export function buildPublishJobOverrides(input: PublishJobOverridesInput): PublishJobOverrides {
  const overrides: PublishJobOverrides = {
    publishTarget: input.publishTarget,
    withTts: true,
    ttsProvider: input.selectedTtsProvider,
    ttsStrategy: input.selectedTtsStrategy,
  };

  if (input.selectedTtsProvider === 'google' && input.selectedTtsModel.trim()) {
    overrides.googleTtsModel = input.selectedTtsModel.trim() as GoogleTtsModel;
  } else if (input.selectedTtsStrategy !== 'auto' && input.selectedTtsModel.trim()) {
    overrides.studyTextElevenlabsModel = input.selectedTtsModel.trim() as ElevenLabsTtsModelId;
  }

  if (
    input.learningPresetCatalogEnabled &&
    input.selectedPreset &&
    input.validPresetIds.includes(input.selectedPreset)
  ) {
    overrides.learningPresetId = input.selectedPreset;
  }

  return overrides;
}

export function buildPresetRerunPayload(
  kind: 'republish' | 'pronunciation' | 'studyText' | 'allAudio',
): RerunPayload {
  if (kind === 'republish') {
    return { republishOnly: true };
  }
  if (kind === 'pronunciation') {
    return {
      regeneratePronunciationMainAudio: true,
      regeneratePronunciationChunkAudio: true,
    };
  }
  if (kind === 'studyText') {
    return { regenerateStudyTextAudio: true };
  }
  return {
    regenerateStudyTextAudio: true,
    regeneratePronunciationMainAudio: true,
    regeneratePronunciationChunkAudio: true,
  };
}

export function buildCustomRerunPayload(input: CustomRerunInput): CustomRerunPayloadResult {
  const payload: RerunPayload = {};

  if (input.rerunStudyTextAudio) {
    payload.regenerateStudyTextAudio = true;
    payload.studyTextTtsProvider = input.rerunStudyTextProvider;
    payload.studyTextVoiceId = input.rerunStudyTextVoiceId.trim() || undefined;
    payload.studyTextVoiceAccent = input.rerunStudyTextVoiceAccent.trim() || undefined;
    payload.studyTextTtsStrategy = input.rerunStudyTextStrategy;
    payload.studyTextDialogueLanguage = input.rerunStudyTextDialogueLanguage.trim() || undefined;

    const stabilityInput = input.rerunStudyTextDialogueStability.trim();
    if (stabilityInput) {
      const parsed = Number(stabilityInput);
      if (Number.isNaN(parsed) || parsed < 0 || parsed > 1) {
        return { ok: false, error: 'Dialogue stability must be a number between 0 and 1.' };
      }
      payload.studyTextDialogueStability = parsed;
    }

    const seedInput = input.rerunStudyTextDialogueSeed.trim();
    if (seedInput) {
      const parsed = Number(seedInput);
      if (!Number.isInteger(parsed)) {
        return { ok: false, error: 'Dialogue seed must be an integer.' };
      }
      payload.studyTextDialogueSeed = parsed;
    }

    if (input.rerunStudyTextProvider === 'google') {
      if (input.rerunStudyTextModel.trim()) {
        payload.studyTextGoogleTtsModel = input.rerunStudyTextModel.trim() as GoogleTtsModel;
      }
    } else if (input.rerunStudyTextModel.trim()) {
      payload.studyTextElevenlabsModel = input.rerunStudyTextModel.trim() as
        | 'eleven_v3'
        | 'eleven_multilingual_v2'
        | 'eleven_flash_v2_5'
        | 'eleven_flash_v2';
    }
  }

  if (input.rerunPronunciationMainAudio) {
    payload.regeneratePronunciationMainAudio = true;
    payload.pronunciationMainTtsProvider = input.rerunPronunciationMainProvider;
    payload.pronunciationMainVoiceId = input.rerunPronunciationMainVoiceId.trim() || undefined;
    payload.pronunciationMainVoiceAccent =
      input.rerunPronunciationMainVoiceAccent.trim() || undefined;
    if (input.rerunPronunciationMainProvider === 'google') {
      if (input.rerunPronunciationMainModel.trim()) {
        payload.pronunciationMainGoogleTtsModel =
          input.rerunPronunciationMainModel.trim() as GoogleTtsModel;
      }
    } else if (input.rerunPronunciationMainModel.trim()) {
      payload.pronunciationMainElevenlabsModel = input.rerunPronunciationMainModel.trim() as
        | 'eleven_v3'
        | 'eleven_multilingual_v2'
        | 'eleven_flash_v2_5'
        | 'eleven_flash_v2';
    }
  }

  if (input.rerunPronunciationChunkAudio) {
    payload.regeneratePronunciationChunkAudio = true;
    payload.pronunciationChunkTtsProvider = input.rerunPronunciationChunkProvider;
    payload.pronunciationChunkVoiceId = input.rerunPronunciationChunkVoiceId.trim() || undefined;
    payload.pronunciationChunkVoiceAccent =
      input.rerunPronunciationChunkVoiceAccent.trim() || undefined;
    if (input.rerunPronunciationChunkProvider === 'google') {
      if (input.rerunPronunciationChunkModel.trim()) {
        payload.pronunciationChunkGoogleTtsModel =
          input.rerunPronunciationChunkModel.trim() as GoogleTtsModel;
      }
    } else if (input.rerunPronunciationChunkProvider === 'elevenlabs') {
      if (input.rerunPronunciationChunkModel.trim()) {
        payload.pronunciationChunkElevenlabsModel = input.rerunPronunciationChunkModel.trim() as
          | 'eleven_v3'
          | 'eleven_multilingual_v2'
          | 'eleven_flash_v2_5'
          | 'eleven_flash_v2';
      }
    } else {
      payload.pronunciationChunkEdgeVoice =
        input.rerunPronunciationChunkEdgeVoice.trim() || undefined;
    }
  }

  return { ok: true, payload };
}

export function getNextGenerationQuotaSnapshot(
  current: GenerationQuotaSnapshot,
  outcome: GenerationQuotaUpdate,
): GenerationQuotaSnapshot {
  if (outcome.kind === 'success') {
    return outcome.quota ?? current;
  }
  return current;
}

export function hasActiveGenerationQuotaSelection(params: {
  generationRuntimeQuotaSnapshot: GenerationQuotaSnapshot;
  generationRuntimeSelection: { provider: string; model: string } | null;
  selectedGenerationProvider: string;
  selectedGenerationModel: string;
  generationDefaultProvider: string | undefined;
  generationDefaultModelForSelection: string | undefined;
  generationOptionsLoaded: boolean;
}): boolean {
  const {
    generationRuntimeQuotaSnapshot,
    generationRuntimeSelection,
    selectedGenerationProvider,
    selectedGenerationModel,
    generationDefaultProvider,
    generationDefaultModelForSelection,
    generationOptionsLoaded,
  } = params;

  if (generationRuntimeQuotaSnapshot) {
    return (
      generationRuntimeSelection?.provider === selectedGenerationProvider &&
      generationRuntimeSelection?.model === selectedGenerationModel
    );
  }

  return Boolean(
    generationOptionsLoaded &&
      selectedGenerationProvider === generationDefaultProvider &&
      selectedGenerationModel === generationDefaultModelForSelection,
  );
}
