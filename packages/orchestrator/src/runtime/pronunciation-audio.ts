import type { PipelineLogger } from '@esl-pipeline/contracts';
import {
  extractPronunciationFocus,
  type ParsedMarkdownContext,
  type PronunciationFocus,
} from '@esl-pipeline/pmd';
import type { PronunciationAudioClip } from '@esl-pipeline/shared-infrastructure';
import {
  buildPronunciationShadowSentenceMp3,
  buildPronunciationTextMp3,
  type BuildPronunciationTextOptions,
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
const IPA_TRANSCRIPTION_ONLY_REGEX = /^\/[^/\n]+\/$/;

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
      message: 'Connected-speech pronunciation target was IPA-only; using careful text for provider TTS',
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
      return 'edge-tts';
    case 'connected_speech':
    case 'intonation':
    case 'rhythm_chunking':
    case 'sentence_stress':
      return null;
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
  const chunkProviderConfig: ProviderClipSynthesisConfig = {
    ttsProvider:
      chunkProvider === 'edge-tts'
        ? options.primaryTtsProvider
        : chunkProvider ?? options.primaryTtsProvider,
    googleTtsModel: options.chunkGoogleTtsModel ?? options.primaryGoogleTtsModel,
    modelId: options.chunkModelId ?? options.primaryModelId,
    voiceId: options.chunkVoiceId ?? options.primaryVoiceId,
  };
  const primaryProviderConfig: ProviderClipSynthesisConfig = {
    ttsProvider: options.primaryTtsProvider,
    googleTtsModel: options.primaryGoogleTtsModel,
    modelId: options.primaryModelId,
    voiceId: options.primaryVoiceId,
  };

  switch (focus.mode) {
    case 'shadow_sentence': {
      if (shouldGeneratePrimary) {
        primaryClip = await synthesizeShadowPrimary(focus, options);
      }

      if (!shouldGenerateItems) break;
      for (const [index, word] of focus.words.entries()) {
        const normalizedWord = normalizeSpeechText(word.text);
        if (!normalizedWord) continue;
        if (chunkProvider === 'edge-tts') {
          itemClips.push(
            await synthesizeEdgeClipWithProviderFallback({
              clip: {
                id: `shadow-word-${index + 1}-edge`,
                itemIndex: index,
                kind: 'word_item',
                engine: 'edge',
                text: normalizedWord,
                label: 'Word',
                note: word.note,
              },
              options,
              providerConfig: chunkProviderConfig,
              warnings,
              state: fallbackState,
            }),
          );
        } else {
          const providerClip = await synthesizeProviderClip(
            {
              id: `shadow-word-${index + 1}`,
              itemIndex: index,
              kind: 'word_item',
              engine: 'provider',
              text: normalizedWord,
              label: 'Word',
              note: word.note,
            },
            options,
            chunkProviderConfig,
          );
          if (providerClip) itemClips.push(providerClip);
        }

        if (isLongShadowDrill(normalizedWord)) {
          const providerClip = await synthesizeProviderClip(
            {
              id: `shadow-word-${index + 1}-natural`,
              itemIndex: index,
              kind: 'sentence_item',
              engine: 'provider',
              text: normalizedWord,
              label: 'Natural',
              note: word.note,
            },
            options,
            chunkProviderConfig,
          );
          if (providerClip) {
            itemClips.push(providerClip);
          }
        }
      }
      break;
    }
    case 'minimal_pair': {
      if (!shouldGenerateItems) break;
      for (const [index, pair] of focus.pairs.entries()) {
        const clips =
          chunkProvider === 'edge-tts'
            ? await Promise.all([
                synthesizeEdgeClipWithProviderFallback({
                  clip: {
                    id: `minimal-pair-${index + 1}-left`,
                    itemIndex: index,
                    kind: 'pair_left',
                    engine: 'edge',
                    text: normalizeSpeechText(pair.left.text),
                    label: 'Left',
                    note: pair.note,
                  },
                  options,
                  providerConfig: chunkProviderConfig,
                  warnings,
                  state: fallbackState,
                }),
                synthesizeEdgeClipWithProviderFallback({
                  clip: {
                    id: `minimal-pair-${index + 1}-right`,
                    itemIndex: index,
                    kind: 'pair_right',
                    engine: 'edge',
                    text: normalizeSpeechText(pair.right.text),
                    label: 'Right',
                    note: pair.note,
                  },
                  options,
                  providerConfig: chunkProviderConfig,
                  warnings,
                  state: fallbackState,
                }),
              ])
            : (
                await Promise.all([
                  synthesizeProviderClip(
                    {
                      id: `minimal-pair-${index + 1}-left`,
                      itemIndex: index,
                      kind: 'pair_left',
                      engine: 'provider',
                      text: normalizeSpeechText(pair.left.text),
                      label: 'Left',
                      note: pair.note,
                    },
                    options,
                    chunkProviderConfig,
                  ),
                  synthesizeProviderClip(
                    {
                      id: `minimal-pair-${index + 1}-right`,
                      itemIndex: index,
                      kind: 'pair_right',
                      engine: 'provider',
                      text: normalizeSpeechText(pair.right.text),
                      label: 'Right',
                      note: pair.note,
                    },
                    options,
                    chunkProviderConfig,
                  ),
                ])
              ).filter((clip): clip is PronunciationClipRecord => Boolean(clip));
        itemClips.push(...clips);
      }
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
      for (const [index, line] of focus.lines.entries()) {
        const spokenText = resolveConnectedSpeechSpeechText(line, options.logger);
        if (!spokenText) continue;
        const clip =
          chunkProvider === 'edge-tts'
            ? await synthesizeEdgeClipWithProviderFallback({
                clip: {
                  id: `connected-speech-${index + 1}`,
                  itemIndex: index,
                  kind: 'connected_target',
                  engine: 'edge',
                  text: spokenText,
                  label: 'Play',
                  note: line.note,
                },
                options,
                providerConfig: chunkProviderConfig,
                warnings,
                state: fallbackState,
              })
            : await synthesizeProviderClip(
                {
                  id: `connected-speech-${index + 1}`,
                  itemIndex: index,
                  kind: 'connected_target',
                  engine: 'provider',
                  text: spokenText,
                  label: 'Play',
                  note: line.note,
                },
                options,
                chunkProviderConfig,
              );
        if (clip) itemClips.push(clip);
      }
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
      for (const [index, drill] of focus.drills.entries()) {
        const normalizedDrill = normalizeSpeechText(drill.text);
        const clip =
          chunkProvider === 'edge-tts'
            ? await synthesizeEdgeClipWithProviderFallback({
                clip: {
                  id: `${focus.mode}-${index + 1}`,
                  itemIndex: index,
                  kind: 'sentence_item',
                  engine: 'edge',
                  text: normalizedDrill,
                  label: 'Play',
                  note: drill.note,
                },
                options,
                providerConfig: chunkProviderConfig,
                warnings,
                state: fallbackState,
              })
            : await synthesizeProviderClip(
                {
                  id: `${focus.mode}-${index + 1}`,
                  itemIndex: index,
                  kind: 'sentence_item',
                  engine: 'provider',
                  text: normalizedDrill,
                  label: 'Play',
                  note: drill.note,
                },
                options,
                chunkProviderConfig,
              );
        if (clip) itemClips.push(clip);
      }
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
