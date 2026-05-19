import type { PipelineLogger } from '@esl-pipeline/contracts';
import {
  extractPronunciationFocus,
  type ParsedMarkdownContext,
  type PronunciationFocus,
} from '@esl-pipeline/pmd';
import type { PronunciationAudioClip } from '@esl-pipeline/shared-infrastructure';
import {
  type BuildPronunciationTextOptions,
  buildPronunciationShadowSentenceMp3,
  buildPronunciationTextMp3,
  type TtsProviderId,
} from '@esl-pipeline/tts-core';

import type { AudioArtifactManifest, PronunciationAudioWarning } from '../manifest.js';
import type { PronunciationAudioArtifact } from './audio-artifacts.js';
import { synthesizeEdgeTtsClip } from './edge-tts.js';

type PronunciationClipRecord = PronunciationAudioClip & AudioArtifactManifest;

interface PronunciationAudioSynthesisOptions {
  context: ParsedMarkdownContext;
  mdPath: string;
  outPath: string;
  title?: string | null;
  preview?: boolean;
  force?: boolean;
  regeneratePrimary?: boolean;
  regenerateItems?: boolean;
  primaryTtsProvider?: TtsProviderId;
  primaryGoogleTtsModel?: BuildPronunciationTextOptions['googleTtsModel'];
  primaryModelId?: string;
  chunkTtsProvider?: TtsProviderId | 'edge-tts';
  chunkGoogleTtsModel?: BuildPronunciationTextOptions['googleTtsModel'];
  chunkModelId?: string;
  logger?: PipelineLogger;
  primaryVoiceId?: string | null;
  chunkVoiceId?: string | null;
  chunkEdgeVoice?: string | null;
}

interface ProviderClipSynthesisConfig {
  ttsProvider?: TtsProviderId;
  googleTtsModel?: BuildPronunciationTextOptions['googleTtsModel'];
  modelId?: string;
  voiceId?: string | null;
}

const EDGE_TTS_PROVIDER_FALLBACK_WARNING: PronunciationAudioWarning = {
  code: 'edge_tts_unavailable_provider_fallback',
  message:
    'edge-tts was unavailable for word/pair pronunciation clips, so provider pronunciation audio was used instead.',
};
const PRONUNCIATION_ITEM_SYNTHESIS_CONCURRENCY = 3;
const IPA_TRANSCRIPTION_ONLY_REGEX = /^\/[^/\n]+\/$/;
const DEFAULT_GOOGLE_CHUNK_MODEL: BuildPronunciationTextOptions['googleTtsModel'] = 'chirp3_hd';
const DEFAULT_GOOGLE_CHUNK_VOICE_BY_MODEL: Record<
  NonNullable<BuildPronunciationTextOptions['googleTtsModel']>,
  string
> = {
  chirp3_hd: 'en-US-Chirp3-HD-Charon',
  studio: 'en-US-Studio-O',
  neural2: 'en-US-Neural2-F',
  wavenet: 'en-US-Wavenet-F',
};

function normalizeSpeechText(value: string): string {
  return String(value || '')
    .replaceAll('**', '')
    .replaceAll('`', '')
    .replaceAll('|', ' ')
    .replaceAll(/["“”]/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

function normalizeConnectedSpeechText(value: string): string {
  return normalizeSpeechText(value).replaceAll(/\s*->\s*/g, ' ');
}

function looksLikeIpaTranscription(value: string): boolean {
  return IPA_TRANSCRIPTION_ONLY_REGEX.test(value.trim());
}

function resolveConnectedSpeechSpeechText(
  line: Extract<PronunciationFocus, { mode: 'connected_speech' }>['lines'][number],
  logger?: PipelineLogger,
): string {
  const connected = normalizeConnectedSpeechText(line.connected);
  if (connected && !looksLikeIpaTranscription(connected)) {
    return connected;
  }

  const careful = normalizeSpeechText(line.careful);
  if (connected && careful) {
    logger?.log({
      level: 'warn',
      stage: 'tts',
      message:
        'Connected-speech pronunciation target was IPA-only; using careful text for provider TTS',
      detail: {
        line: line.line,
        connected,
        careful,
      },
    });
  }
  return careful || connected;
}

function isLongShadowDrill(text: string): boolean {
  const normalized = normalizeSpeechText(text);
  const words = normalized.split(/\s+/).filter(Boolean);
  return words.length >= 3 || normalized.length >= 18;
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (values.length === 0) {
    return [];
  }

  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, values.length);

  async function runWorker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index] as T, index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

function toPrimaryClip(
  base: PronunciationAudioClip,
  artifact: AudioArtifactManifest,
): PronunciationClipRecord {
  return { ...base, ...artifact };
}

async function synthesizeProviderClip(
  clip: PronunciationAudioClip,
  options: PronunciationAudioSynthesisOptions,
  config: ProviderClipSynthesisConfig,
): Promise<PronunciationClipRecord | null> {
  if (!config.voiceId?.trim()) {
    return null;
  }

  const result = await buildPronunciationTextMp3(
    {
      text: clip.text,
      voiceId: config.voiceId.trim(),
      mdPath: options.mdPath,
      title: options.title ?? undefined,
      kind: clip.kind,
    },
    {
      outPath: options.outPath,
      preview: options.preview,
      force: options.force,
      modelId: config.modelId,
      ttsProvider: config.ttsProvider,
      googleTtsModel: config.googleTtsModel,
      logger: options.logger,
      fileStem: clip.id,
      titleSuffix: clip.label ?? 'Pronunciation',
    },
  );

  return toPrimaryClip(clip, {
    path: result.path,
    hash: result.hash,
    voiceId: result.voiceId,
    tts: {
      provider: result.provider,
      modelId: result.modelId,
      generatedCharacters: result.generatedCharacters,
      cachedCharacters: result.cachedCharacters,
    },
  });
}

async function synthesizeEdgeClip(
  clip: PronunciationAudioClip,
  options: PronunciationAudioSynthesisOptions,
): Promise<PronunciationClipRecord> {
  const result = await synthesizeEdgeTtsClip({
    text: clip.text,
    outPath: options.outPath,
    preview: options.preview,
    force: options.force,
    logger: options.logger,
    fileStem: clip.id,
    kind: clip.kind,
    voice: options.chunkEdgeVoice ?? undefined,
  });
  return toPrimaryClip(clip, {
    path: result.path,
    hash: result.hash,
    voiceId: result.voice,
    tts: {
      provider: 'edge',
      generatedCharacters: result.generatedCharacters,
      cachedCharacters: result.cachedCharacters,
    },
  });
}

async function synthesizeEdgeClipWithProviderFallback(params: {
  clip: PronunciationAudioClip;
  options: PronunciationAudioSynthesisOptions;
  providerConfig: ProviderClipSynthesisConfig;
  warnings: PronunciationAudioWarning[];
  state: { fallbackWarningLogged: boolean };
}): Promise<PronunciationClipRecord> {
  const { clip, options, providerConfig, warnings, state } = params;

  try {
    return await synthesizeEdgeClip(clip, options);
  } catch (error) {
    if (!state.fallbackWarningLogged) {
      state.fallbackWarningLogged = true;
      warnings.push({ ...EDGE_TTS_PROVIDER_FALLBACK_WARNING });
      options.logger?.log({
        level: 'warn',
        stage: 'tts',
        message: EDGE_TTS_PROVIDER_FALLBACK_WARNING.message,
        detail: {
          code: EDGE_TTS_PROVIDER_FALLBACK_WARNING.code,
          mode: clip.kind,
          clipId: clip.id,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }

    const providerClip = await synthesizeProviderClip(
      {
        ...clip,
        engine: 'provider',
      },
      options,
      providerConfig,
    );
    if (providerClip) {
      return providerClip;
    }

    throw error;
  }
}

async function synthesizeShadowPrimary(
  focus: Extract<PronunciationFocus, { mode: 'shadow_sentence' }>,
  options: PronunciationAudioSynthesisOptions,
): Promise<PronunciationClipRecord | null> {
  if (!focus.shadowSentence?.trim() || !options.primaryVoiceId?.trim()) {
    return null;
  }

  const result = await buildPronunciationShadowSentenceMp3(
    {
      context: options.context,
      mdPath: options.mdPath,
      voiceId: options.primaryVoiceId.trim(),
    },
    {
      outPath: options.outPath,
      preview: options.preview,
      force: options.force,
      modelId: options.primaryModelId,
      ttsProvider: options.primaryTtsProvider,
      googleTtsModel: options.primaryGoogleTtsModel,
      logger: options.logger,
    },
  );

  return {
    id: 'primary-shadow-sentence',
    kind: 'shadow_sentence',
    engine: 'provider',
    text: normalizeSpeechText(focus.shadowSentence),
    label: 'Sentence',
    path: result.path,
    hash: result.hash,
    voiceId: result.voiceId,
    tts: {
      provider: result.provider,
      modelId: result.modelId,
      generatedCharacters: result.generatedCharacters,
      cachedCharacters: result.cachedCharacters,
    },
  };
}

function buildGenericPrimaryText(focus: PronunciationFocus): string | null {
  switch (focus.mode) {
    case 'shadow_sentence': {
      return focus.shadowSentence ? normalizeSpeechText(focus.shadowSentence) : null;
    }
    case 'minimal_pair': {
      return null;
    }
    case 'connected_speech': {
      return focus.naturalSentence ? normalizeSpeechText(focus.naturalSentence) : null;
    }
    case 'intonation':
    case 'rhythm_chunking':
    case 'sentence_stress': {
      return focus.naturalSentence ? normalizeSpeechText(focus.naturalSentence) : null;
    }
  }
}

function resolveChunkProvider(
  focus: PronunciationFocus,
  requested?: TtsProviderId | 'edge-tts',
): TtsProviderId | 'edge-tts' | null {
  if (requested) return requested;
  switch (focus.mode) {
    case 'shadow_sentence':
    case 'minimal_pair':
    case 'connected_speech':
    case 'intonation':
    case 'rhythm_chunking':
    case 'sentence_stress': {
      return 'google';
    }
  }
}

export async function synthesizePronunciationAudio(
  options: PronunciationAudioSynthesisOptions,
): Promise<PronunciationAudioArtifact | undefined> {
  const focus = extractPronunciationFocus(options.context);
  if (!focus) {
    return undefined;
  }

  let primaryClip: PronunciationClipRecord | null = null;
  const itemClips: PronunciationClipRecord[] = [];
  const warnings: PronunciationAudioWarning[] = [];
  const fallbackState = { fallbackWarningLogged: false };
  const shouldGeneratePrimary = options.regeneratePrimary !== false;
  const shouldGenerateItems = options.regenerateItems !== false;
  const chunkProvider = resolveChunkProvider(focus, options.chunkTtsProvider);
  const googleChunkModel =
    chunkProvider === 'google'
      ? (options.chunkGoogleTtsModel ?? DEFAULT_GOOGLE_CHUNK_MODEL)
      : undefined;
  const resolvedChunkGoogleModel =
    googleChunkModel ?? options.chunkGoogleTtsModel ?? options.primaryGoogleTtsModel;
  const resolvedChunkGoogleVoice =
    googleChunkModel !== undefined
      ? DEFAULT_GOOGLE_CHUNK_VOICE_BY_MODEL[googleChunkModel]
      : undefined;
  const chunkProviderConfig: ProviderClipSynthesisConfig = {
    ttsProvider:
      chunkProvider === 'edge-tts'
        ? options.primaryTtsProvider
        : (chunkProvider ?? options.primaryTtsProvider),
    googleTtsModel: resolvedChunkGoogleModel,
    modelId: options.chunkModelId ?? options.primaryModelId,
    voiceId:
      options.chunkVoiceId ??
      (chunkProvider === 'google' ? resolvedChunkGoogleVoice : undefined) ??
      (chunkProvider === null || chunkProvider === options.primaryTtsProvider
        ? options.primaryVoiceId
        : undefined),
  };
  const primaryProviderConfig: ProviderClipSynthesisConfig = {
    ttsProvider: options.primaryTtsProvider,
    googleTtsModel: options.primaryGoogleTtsModel,
    modelId: options.primaryModelId,
    voiceId: options.primaryVoiceId,
  };
  const synthesizeItemClip = async (
    clip: PronunciationAudioClip,
    useEdgeFallback: boolean,
  ): Promise<PronunciationClipRecord | null> =>
    useEdgeFallback
      ? synthesizeEdgeClipWithProviderFallback({
          clip,
          options,
          providerConfig: chunkProviderConfig,
          warnings,
          state: fallbackState,
        })
      : synthesizeProviderClip(clip, options, chunkProviderConfig);

  switch (focus.mode) {
    case 'shadow_sentence': {
      if (shouldGeneratePrimary) {
        primaryClip = await synthesizeShadowPrimary(focus, options);
      }

      if (!shouldGenerateItems) break;
      const tasks: { clip: PronunciationAudioClip; useEdgeFallback: boolean }[] = [];
      for (const [index, word] of focus.words.entries()) {
        const normalizedWord = normalizeSpeechText(word.text);
        if (!normalizedWord) continue;
        if (chunkProvider === 'edge-tts') {
          tasks.push({
            clip: {
              id: `shadow-word-${index + 1}-edge`,
              itemIndex: index,
              kind: 'word_item',
              engine: 'edge',
              text: normalizedWord,
              label: 'Word',
              note: word.note,
            },
            useEdgeFallback: true,
          });
        } else {
          tasks.push({
            clip: {
              id: `shadow-word-${index + 1}`,
              itemIndex: index,
              kind: 'word_item',
              engine: 'provider',
              text: normalizedWord,
              label: 'Word',
              note: word.note,
            },
            useEdgeFallback: false,
          });
        }

        if (isLongShadowDrill(normalizedWord)) {
          tasks.push({
            clip: {
              id: `shadow-word-${index + 1}-natural`,
              itemIndex: index,
              kind: 'sentence_item',
              engine: 'provider',
              text: normalizedWord,
              label: 'Natural',
              note: word.note,
            },
            useEdgeFallback: false,
          });
        }
      }
      const clips = await mapWithConcurrency(
        tasks,
        PRONUNCIATION_ITEM_SYNTHESIS_CONCURRENCY,
        (task) => synthesizeItemClip(task.clip, task.useEdgeFallback),
      );
      itemClips.push(...clips.filter((clip): clip is PronunciationClipRecord => Boolean(clip)));
      break;
    }
    case 'minimal_pair': {
      if (!shouldGenerateItems) break;
      const tasks = focus.pairs.flatMap((pair, index) => [
        {
          clip: {
            id: `minimal-pair-${index + 1}-left`,
            itemIndex: index,
            kind: 'pair_left' as const,
            engine: chunkProvider === 'edge-tts' ? ('edge' as const) : ('provider' as const),
            text: normalizeSpeechText(pair.left.text),
            label: 'Left',
            note: pair.note,
          },
          useEdgeFallback: chunkProvider === 'edge-tts',
        },
        {
          clip: {
            id: `minimal-pair-${index + 1}-right`,
            itemIndex: index,
            kind: 'pair_right' as const,
            engine: chunkProvider === 'edge-tts' ? ('edge' as const) : ('provider' as const),
            text: normalizeSpeechText(pair.right.text),
            label: 'Right',
            note: pair.note,
          },
          useEdgeFallback: chunkProvider === 'edge-tts',
        },
      ]);
      const clips = await mapWithConcurrency(
        tasks,
        PRONUNCIATION_ITEM_SYNTHESIS_CONCURRENCY,
        (task) => synthesizeItemClip(task.clip, task.useEdgeFallback),
      );
      itemClips.push(...clips.filter((clip): clip is PronunciationClipRecord => Boolean(clip)));
      break;
    }
    case 'connected_speech': {
      const primaryText = shouldGeneratePrimary ? buildGenericPrimaryText(focus) : null;
      if (primaryText) {
        primaryClip = await synthesizeProviderClip(
          {
            id: 'primary-connected-speech',
            kind: 'primary',
            engine: 'provider',
            text: primaryText,
            label: 'Sentence',
          },
          options,
          primaryProviderConfig,
        );
      }
      if (!shouldGenerateItems) break;
      const tasks = focus.lines.flatMap((line, index) => {
        const spokenText = resolveConnectedSpeechSpeechText(line, options.logger);
        if (!spokenText) return [];
        return [
          {
            clip: {
              id: `connected-speech-${index + 1}`,
              itemIndex: index,
              kind: 'connected_target' as const,
              engine: chunkProvider === 'edge-tts' ? ('edge' as const) : ('provider' as const),
              text: spokenText,
              label: 'Play',
              note: line.note,
            },
            useEdgeFallback: chunkProvider === 'edge-tts',
          },
        ];
      });
      const clips = await mapWithConcurrency(
        tasks,
        PRONUNCIATION_ITEM_SYNTHESIS_CONCURRENCY,
        (task) => synthesizeItemClip(task.clip, task.useEdgeFallback),
      );
      itemClips.push(...clips.filter((clip): clip is PronunciationClipRecord => Boolean(clip)));
      break;
    }
    case 'intonation':
    case 'rhythm_chunking':
    case 'sentence_stress': {
      const primaryText = shouldGeneratePrimary ? buildGenericPrimaryText(focus) : null;
      if (primaryText) {
        primaryClip = await synthesizeProviderClip(
          {
            id: `primary-${focus.mode}`,
            kind: 'primary',
            engine: 'provider',
            text: primaryText,
            label: 'Sentence',
          },
          options,
          primaryProviderConfig,
        );
      }
      if (!shouldGenerateItems) break;
      const tasks = focus.drills.map((drill, index) => {
        const normalizedDrill = normalizeSpeechText(drill.text);
        return {
          clip: {
            id: `${focus.mode}-${index + 1}`,
            itemIndex: index,
            kind: 'sentence_item' as const,
            engine: chunkProvider === 'edge-tts' ? ('edge' as const) : ('provider' as const),
            text: normalizedDrill,
            label: 'Play',
            note: drill.note,
          },
          useEdgeFallback: chunkProvider === 'edge-tts',
        };
      });
      const clips = await mapWithConcurrency(
        tasks,
        PRONUNCIATION_ITEM_SYNTHESIS_CONCURRENCY,
        (task) => synthesizeItemClip(task.clip, task.useEdgeFallback),
      );
      itemClips.push(...clips.filter((clip): clip is PronunciationClipRecord => Boolean(clip)));
      break;
    }
  }

  return {
    mode: focus.mode,
    primaryClip,
    itemClips,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
