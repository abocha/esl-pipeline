import type {
  InworldTtsModel,
  SpeechDeliveryMode,
  SpeechPerformancePlanSegment,
  VoiceAssignmentCapabilities,
} from '@esl-pipeline/tts-core';

const MARKDOWN_STRIPPERS: [RegExp, string][] = [
  [/\r?\n/g, ' '],
  [/^\s*[-*+]\s+/, ''],
  [/^\s*\d+[.)]\s+/, ''],
  [/\*\*(.+?)\*\*/g, '$1'],
  [/__(.+?)__/g, '$1'],
  [/\*(.+?)\*/g, '$1'],
  [/_([^_]+)_/g, '$1'],
  [/~~(.+?)~~/g, '$1'],
  [/`{1,3}([^`]+)`{1,3}/g, '$1'],
  [/!\[(.*?)\]\([^)]*\)/g, '$1'],
  [/\[(.+?)\]\((.+?)\)/g, '$1'],
  [/<[^>]+>/g, ''],
] as const;

export interface RenderedInworldSpeechSegment {
  text: string;
  speakingRate?: number;
  temperature?: number;
  deliveryMode?: SpeechDeliveryMode;
}

export function cleanSpeechText(text: string): string {
  let sanitized = text;
  for (const [pattern, replacement] of MARKDOWN_STRIPPERS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  sanitized = sanitized.replaceAll(/[*_`~>#]/g, '');
  sanitized = sanitized.replaceAll(/\s+/g, ' ').trim();
  return sanitized;
}

export function renderInworldSpeechSegment(args: {
  model: InworldTtsModel;
  segment: SpeechPerformancePlanSegment;
  capabilities?: VoiceAssignmentCapabilities;
}): RenderedInworldSpeechSegment {
  const cleanText = cleanSpeechText(args.segment.text);
  if (args.model !== 'inworld-tts-2') {
    return {
      text: cleanText,
      ...(resolveSpeakingRate(args.segment.pace) !== undefined
        ? { speakingRate: resolveSpeakingRate(args.segment.pace) }
        : {}),
    };
  }

  const capabilities = args.capabilities ?? {
    supportsMetadataInstructions: true,
    supportsNonVerbals: true,
    supportsUppercaseEmphasis: true,
    supportsFreeFormDirection: false,
  };
  const metadataInstructions = [
    args.segment.emotion ? `emotion: ${args.segment.emotion}` : undefined,
    args.segment.intonation ? `intonation: ${args.segment.intonation}` : undefined,
  ].filter(Boolean);
  const before = capabilities.supportsNonVerbals
    ? (args.segment.nonVerbalsBefore ?? []).map((cue) => `[${cue}]`)
    : [];
  const after = capabilities.supportsNonVerbals
    ? (args.segment.nonVerbalsAfter ?? []).map((cue) => `[${cue}]`)
    : [];
  const spokenText = capabilities.supportsUppercaseEmphasis
    ? applyUppercaseEmphasis(cleanText, args.segment.emphasis)
    : cleanText;
  const text = [
    capabilities.supportsMetadataInstructions && metadataInstructions.length
      ? `[${metadataInstructions.join('; ')}]`
      : undefined,
    capabilities.supportsFreeFormDirection && args.segment.freeFormDirection
      ? `[${args.segment.freeFormDirection}]`
      : undefined,
    ...before,
    args.segment.pauseBeforeMs ? `<break time="${args.segment.pauseBeforeMs}ms" />` : undefined,
    spokenText,
    ...after,
    args.segment.pauseAfterMs ? `<break time="${args.segment.pauseAfterMs}ms" />` : undefined,
  ]
    .filter(Boolean)
    .join(' ');

  const speakingRate =
    args.segment.pace === 'natural' ? undefined : resolveSpeakingRate(args.segment.pace);
  return {
    text,
    ...(speakingRate !== undefined ? { speakingRate } : {}),
    ...(args.segment.deliveryMode ? { deliveryMode: args.segment.deliveryMode } : {}),
  };
}

function applyUppercaseEmphasis(text: string, emphasis: string[] | undefined): string {
  return (emphasis ?? []).reduce((rendered, phrase) => {
    const escaped = phrase.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    return rendered.replace(new RegExp(escaped, 'gi'), (match) => match.toUpperCase());
  }, text);
}

function resolveSpeakingRate(pace: SpeechPerformancePlanSegment['pace']): number | undefined {
  if (pace === 'slow') return 0.85;
  if (pace === 'measured') return 0.95;
  if (pace === 'natural') return 1;
  if (pace === 'brisk') return 1.1;
  return undefined;
}
