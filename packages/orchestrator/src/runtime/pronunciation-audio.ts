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
  ttsProvider?: TtsProviderId;
  googleTtsModel?: BuildPronunciationTextOptions['googleTtsModel'];
  logger?: PipelineLogger;
  providerVoiceId?: string | null;
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
): Promise<PronunciationClipRecord | null> {
  if (!options.providerVoiceId?.trim()) {
    return null;
  }

  const result = await buildPronunciationTextMp3(
    {
      text: clip.text,
      voiceId: options.providerVoiceId.trim(),
      mdPath: options.mdPath,
      title: options.title ?? undefined,
      kind: clip.kind,
    },
    {
      outPath: options.outPath,
      preview: options.preview,
      force: options.force,
      ttsProvider: options.ttsProvider,
      googleTtsModel: options.googleTtsModel,
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
  warnings: PronunciationAudioWarning[];
  state: { fallbackWarningLogged: boolean };
}): Promise<PronunciationClipRecord> {
  const { clip, options, warnings, state } = params;

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
  if (!focus.shadowSentence?.trim() || !options.providerVoiceId?.trim()) {
    return null;
  }

  const result = await buildPronunciationShadowSentenceMp3(
    {
      context: options.context,
      mdPath: options.mdPath,
      voiceId: options.providerVoiceId.trim(),
    },
    {
      outPath: options.outPath,
      preview: options.preview,
      force: options.force,
      ttsProvider: options.ttsProvider,
      googleTtsModel: options.googleTtsModel,
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
      return focus.pairs
        .map((pair) => `${normalizeSpeechText(pair.left.text)}. ${normalizeSpeechText(pair.right.text)}.`)
        .join(' ')
        .trim();
    }
    case 'connected_speech': {
      return focus.lines.map((line) => normalizeConnectedSpeechText(line.connected)).join(' ').trim();
    }
    case 'intonation':
    case 'rhythm_chunking':
    case 'sentence_stress': {
      return focus.drills.map((drill) => normalizeSpeechText(drill.text)).join(' ').trim();
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

  switch (focus.mode) {
    case 'shadow_sentence': {
      primaryClip = await synthesizeShadowPrimary(focus, options);

      for (const [index, word] of focus.words.entries()) {
        const normalizedWord = normalizeSpeechText(word.text);
        if (!normalizedWord) continue;
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
            warnings,
            state: fallbackState,
          }),
        );

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
          );
          if (providerClip) {
            itemClips.push(providerClip);
          }
        }
      }
      break;
    }
    case 'minimal_pair': {
      const primaryText = buildGenericPrimaryText(focus);
      if (primaryText) {
        primaryClip = await synthesizeEdgeClipWithProviderFallback({
          clip: {
            id: 'primary-minimal-pair',
            kind: 'primary',
            engine: 'edge',
            text: primaryText,
            label: 'Practice',
          },
          options,
          warnings,
          state: fallbackState,
        });
      }
      for (const [index, pair] of focus.pairs.entries()) {
        itemClips.push(
          ...(await Promise.all([
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
              warnings,
              state: fallbackState,
            }),
          ])),
        );
      }
      break;
    }
    case 'connected_speech': {
      const spokenLines = focus.lines
        .map((line) => resolveConnectedSpeechSpeechText(line, options.logger))
        .filter(Boolean);
      const primaryText = spokenLines.join(' ').trim();
      if (primaryText) {
        primaryClip = await synthesizeProviderClip(
          {
            id: 'primary-connected-speech',
            kind: 'primary',
            engine: 'provider',
            text: primaryText,
            label: 'Practice',
          },
          options,
        );
      }
      for (const [index, line] of focus.lines.entries()) {
        const spokenText = resolveConnectedSpeechSpeechText(line, options.logger);
        if (!spokenText) continue;
        const clip = await synthesizeProviderClip(
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
        );
        if (clip) itemClips.push(clip);
      }
      break;
    }
    case 'intonation':
    case 'rhythm_chunking':
    case 'sentence_stress': {
      const primaryText = buildGenericPrimaryText(focus);
      if (primaryText) {
        primaryClip = await synthesizeProviderClip(
          {
            id: `primary-${focus.mode}`,
            kind: 'primary',
            engine: 'provider',
            text: primaryText,
            label: 'Practice',
          },
          options,
        );
      }
      for (const [index, drill] of focus.drills.entries()) {
        const clip = await synthesizeProviderClip(
          {
            id: `${focus.mode}-${index + 1}`,
            itemIndex: index,
            kind: 'sentence_item',
            engine: 'provider',
            text: normalizeSpeechText(drill.text),
            label: 'Play',
            note: drill.note,
          },
          options,
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
