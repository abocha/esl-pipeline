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
  type GoogleTtsModel,
  isTtsModelForProvider,
  resolveDefaultTtsModel,
  throwIfTtsCancelled,
  type TtsRequestControl,
  type TtsModelId,
  type TtsProviderId,
} from '@esl-pipeline/tts-core';

import type { AudioArtifactManifest, PronunciationAudioWarning } from '../manifest.js';
import type { PronunciationAudioArtifact } from './audio-artifacts.js';

type PronunciationClipRecord = PronunciationAudioClip & AudioArtifactManifest;

interface PronunciationAudioSynthesisOptions extends TtsRequestControl {
  context: ParsedMarkdownContext;
  mdPath: string;
  outPath: string;
  title?: string | null;
  preview?: boolean;
  force?: boolean;
  regeneratePrimary?: boolean;
  regenerateItems?: boolean;
  primaryTtsProvider?: TtsProviderId;
  primaryTtsModel?: TtsModelId;
  chunkTtsProvider?: TtsProviderId;
  chunkTtsModel?: TtsModelId;
  logger?: PipelineLogger;
  primaryVoiceId?: string | null;
  chunkVoiceId?: string | null;
  previousAudio?: PronunciationAudioArtifact;
}

interface ProviderClipSynthesisConfig {
  ttsProvider?: TtsProviderId;
  ttsModel?: BuildPronunciationTextOptions['ttsModel'];
  voiceId?: string | null;
}

const PRONUNCIATION_ITEM_SYNTHESIS_CONCURRENCY = 3;
const IPA_TRANSCRIPTION_ONLY_REGEX = /^\/[^/\n]+\/$/;
const DEFAULT_ELEVENLABS_PRONUNCIATION_MODEL = 'eleven_flash_v2_5' satisfies TtsModelId;
const DEFAULT_GOOGLE_CHUNK_MODEL = 'chirp3_hd' satisfies GoogleTtsModel;
const DEFAULT_GOOGLE_CHUNK_VOICE_BY_MODEL: Record<GoogleTtsModel, string> = {
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
  const careful = normalizeSpeechText(line.careful);
  const connected = normalizeConnectedSpeechText(line.connected);

  if (careful) {
    if (connected && looksLikeIpaTranscription(connected)) {
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
    return careful;
  }

  if (connected && looksLikeIpaTranscription(connected)) {
    logger?.log({
      level: 'warn',
      stage: 'tts',
      message:
        'Connected-speech pronunciation target was IPA-only and no careful text was available',
      detail: {
        line: line.line,
        connected,
      },
    });
  }
  return connected;
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

  const settled = await Promise.allSettled(Array.from({ length: workerCount }, () => runWorker()));
  const rejected = settled.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (rejected) throw rejected.reason;
  return results;
}

function toPrimaryClip(
  base: PronunciationAudioClip,
  artifact: AudioArtifactManifest,
): PronunciationClipRecord {
  return { ...base, ...artifact };
}

function hasReusableAudioPayload(clip: PronunciationClipRecord): boolean {
  return Boolean(clip.url || clip.path || clip.hash);
}

function findPreviousClip(
  previousAudio: PronunciationAudioArtifact | undefined,
  clip: PronunciationAudioClip,
): PronunciationClipRecord | undefined {
  const clips = [
    ...(previousAudio?.primaryClip ? [previousAudio.primaryClip] : []),
    ...(previousAudio?.itemClips ?? []),
  ];
  return clips.find(
    (candidate) =>
      candidate.id === clip.id &&
      candidate.kind === clip.kind &&
      candidate.itemIndex === clip.itemIndex,
  );
}

function ttsConfigMatchesPreviousClip(
  previous: PronunciationClipRecord,
  config: ProviderClipSynthesisConfig,
): boolean {
  const voiceId = config.voiceId?.trim();
  if (voiceId && previous.voiceId !== voiceId) {
    return false;
  }

  if (config.ttsProvider && previous.tts?.provider !== config.ttsProvider) {
    return false;
  }

  if (config.ttsModel && previous.tts?.modelId !== config.ttsModel) {
    return false;
  }

  return true;
}

function canReusePreviousClip(
  clip: PronunciationAudioClip,
  previous: PronunciationClipRecord | undefined,
  config: ProviderClipSynthesisConfig,
): previous is PronunciationClipRecord {
  return Boolean(
    previous &&
      hasReusableAudioPayload(previous) &&
      previous.engine === clip.engine &&
      previous.kind === clip.kind &&
      previous.itemIndex === clip.itemIndex &&
      previous.text === clip.text &&
      ttsConfigMatchesPreviousClip(previous, config),
  );
}

function buildReusedClip(
  clip: PronunciationAudioClip,
  previous: PronunciationClipRecord,
): PronunciationClipRecord {
  const previousTts = previous.tts
    ? {
        ...(previous.tts.provider !== undefined ? { provider: previous.tts.provider } : {}),
        ...(previous.tts.modelId !== undefined ? { modelId: previous.tts.modelId } : {}),
        ...(previous.tts.costPer1kCharsUsd !== undefined
          ? { costPer1kCharsUsd: previous.tts.costPer1kCharsUsd }
          : {}),
        ...(previous.tts.estimatedSpendUsd !== undefined
          ? { estimatedSpendUsd: previous.tts.estimatedSpendUsd }
          : {}),
      }
    : undefined;

  return {
    ...clip,
    ...(previous.path !== undefined ? { path: previous.path } : {}),
    ...(previous.url !== undefined ? { url: previous.url } : {}),
    ...(previous.hash !== undefined ? { hash: previous.hash } : {}),
    ...(previous.key !== undefined ? { key: previous.key } : {}),
    ...(previous.etag !== undefined ? { etag: previous.etag } : {}),
    ...(previous.sizeBytes !== undefined ? { sizeBytes: previous.sizeBytes } : {}),
    ...(previous.reused !== undefined ? { reused: previous.reused } : {}),
    ...(previous.voiceId !== undefined ? { voiceId: previous.voiceId } : {}),
    ...(previousTts && Object.keys(previousTts).length > 0 ? { tts: previousTts } : {}),
  };
}

async function synthesizeProviderClip(
  clip: PronunciationAudioClip,
  options: PronunciationAudioSynthesisOptions,
  config: ProviderClipSynthesisConfig,
): Promise<PronunciationClipRecord | null> {
  throwIfTtsCancelled(options);
  const previous = findPreviousClip(options.previousAudio, clip);
  if (canReusePreviousClip(clip, previous, config)) {
    return buildReusedClip(clip, previous);
  }

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
      ttsProvider: config.ttsProvider,
      ttsModel: config.ttsModel,
      logger: options.logger,
      fileStem: clip.id,
      titleSuffix: clip.label ?? 'Pronunciation',
      signal: options.signal,
      deadlineAtMs: options.deadlineAtMs,
    },
  );
  throwIfTtsCancelled(options);

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

async function synthesizeShadowPrimary(
  focus: Extract<PronunciationFocus, { mode: 'shadow_sentence' }>,
  options: PronunciationAudioSynthesisOptions,
): Promise<PronunciationClipRecord | null> {
  throwIfTtsCancelled(options);
  const normalizedText = focus.shadowSentence ? normalizeSpeechText(focus.shadowSentence) : '';
  const baseClip: PronunciationAudioClip = {
    id: 'primary-shadow-sentence',
    kind: 'shadow_sentence',
    engine: 'provider',
    text: normalizedText,
    label: 'Sentence',
  };
  const primaryConfig: ProviderClipSynthesisConfig = {
    ttsProvider: options.primaryTtsProvider,
    ttsModel: options.primaryTtsModel,
    voiceId: options.primaryVoiceId,
  };
  const previous = findPreviousClip(options.previousAudio, baseClip);
  if (canReusePreviousClip(baseClip, previous, primaryConfig)) {
    return buildReusedClip(baseClip, previous);
  }

  if (!normalizedText || !options.primaryVoiceId?.trim()) {
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
      ttsProvider: options.primaryTtsProvider,
      ttsModel: options.primaryTtsModel,
      logger: options.logger,
      signal: options.signal,
      deadlineAtMs: options.deadlineAtMs,
    },
  );
  throwIfTtsCancelled(options);

  return {
    ...baseClip,
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
  requested?: TtsProviderId,
): TtsProviderId | null {
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

function resolveDefaultPronunciationModel(provider: TtsProviderId): TtsModelId {
  if (provider === 'elevenlabs') {
    return DEFAULT_ELEVENLABS_PRONUNCIATION_MODEL;
  }
  return resolveDefaultTtsModel(provider);
}

export async function synthesizePronunciationAudio(
  options: PronunciationAudioSynthesisOptions,
): Promise<PronunciationAudioArtifact | undefined> {
  throwIfTtsCancelled(options);
  const focus = extractPronunciationFocus(options.context);
  if (!focus) {
    return undefined;
  }

  let primaryClip: PronunciationClipRecord | null = null;
  const itemClips: PronunciationClipRecord[] = [];
  const warnings: PronunciationAudioWarning[] = [];
  const shouldGeneratePrimary = options.regeneratePrimary !== false;
  const shouldGenerateItems = options.regenerateItems !== false;
  const resolvedPrimaryModel =
    options.primaryTtsModel ??
    (options.primaryTtsProvider
      ? resolveDefaultPronunciationModel(options.primaryTtsProvider)
      : undefined);
  const chunkProvider = resolveChunkProvider(focus, options.chunkTtsProvider);
  const fallbackChunkProvider = chunkProvider ?? options.primaryTtsProvider;
  const resolvedChunkModel =
    options.chunkTtsModel ??
    (fallbackChunkProvider === 'google'
      ? DEFAULT_GOOGLE_CHUNK_MODEL
      : fallbackChunkProvider
        ? resolveDefaultPronunciationModel(fallbackChunkProvider)
        : resolvedPrimaryModel);
  const googleChunkModel =
    fallbackChunkProvider === 'google' &&
    resolvedChunkModel &&
    isTtsModelForProvider('google', resolvedChunkModel)
      ? (resolvedChunkModel as GoogleTtsModel)
      : undefined;
  const resolvedChunkGoogleVoice =
    googleChunkModel !== undefined
      ? DEFAULT_GOOGLE_CHUNK_VOICE_BY_MODEL[googleChunkModel]
      : undefined;
  const chunkProviderConfig: ProviderClipSynthesisConfig = {
    ttsProvider: fallbackChunkProvider,
    ttsModel: resolvedChunkModel,
    voiceId:
      options.chunkVoiceId ??
      (chunkProvider === 'google' ? resolvedChunkGoogleVoice : undefined) ??
      (chunkProvider === null || chunkProvider === options.primaryTtsProvider
        ? options.primaryVoiceId
        : undefined),
  };
  const primaryProviderConfig: ProviderClipSynthesisConfig = {
    ttsProvider: options.primaryTtsProvider,
    ttsModel: resolvedPrimaryModel,
    voiceId: options.primaryVoiceId,
  };
  const synthesizeItemClip = async (
    clip: PronunciationAudioClip,
  ): Promise<PronunciationClipRecord | null> =>
    synthesizeProviderClip(clip, options, chunkProviderConfig);

  switch (focus.mode) {
    case 'shadow_sentence': {
      if (shouldGeneratePrimary) {
        primaryClip = await synthesizeShadowPrimary(focus, {
          ...options,
          primaryTtsModel: resolvedPrimaryModel,
        });
      }

      if (!shouldGenerateItems) break;
      const tasks: PronunciationAudioClip[] = [];
      for (const [index, word] of focus.words.entries()) {
        const normalizedWord = normalizeSpeechText(word.text);
        if (!normalizedWord) continue;
        tasks.push({
          id: `shadow-word-${index + 1}`,
          itemIndex: index,
          kind: 'word_item',
          engine: 'provider',
          text: normalizedWord,
          label: 'Word',
          note: word.note,
        });
      }
      const clips = await mapWithConcurrency(
        tasks,
        PRONUNCIATION_ITEM_SYNTHESIS_CONCURRENCY,
        (clip) => synthesizeItemClip(clip),
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
            engine: 'provider' as const,
            text: normalizeSpeechText(pair.left.text),
            label: 'Left',
            note: pair.note,
          },
        },
        {
          clip: {
            id: `minimal-pair-${index + 1}-right`,
            itemIndex: index,
            kind: 'pair_right' as const,
            engine: 'provider' as const,
            text: normalizeSpeechText(pair.right.text),
            label: 'Right',
            note: pair.note,
          },
        },
      ]);
      const clips = await mapWithConcurrency(
        tasks,
        PRONUNCIATION_ITEM_SYNTHESIS_CONCURRENCY,
        (task) => synthesizeItemClip(task.clip),
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
              engine: 'provider' as const,
              text: spokenText,
              label: 'Play',
              note: line.note,
            },
          },
        ];
      });
      const clips = await mapWithConcurrency(
        tasks,
        PRONUNCIATION_ITEM_SYNTHESIS_CONCURRENCY,
        (task) => synthesizeItemClip(task.clip),
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
            engine: 'provider' as const,
            text: normalizedDrill,
            label: 'Play',
            note: drill.note,
          },
        };
      });
      const clips = await mapWithConcurrency(
        tasks,
        PRONUNCIATION_ITEM_SYNTHESIS_CONCURRENCY,
        (task) => synthesizeItemClip(task.clip),
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
