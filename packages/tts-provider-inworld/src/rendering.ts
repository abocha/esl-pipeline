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
  lexicalText: string;
  leadingInstructionTagCount: number;
  language?: string;
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
  language?: string;
}): RenderedInworldSpeechSegment {
  const cleanText = cleanSpeechText(args.segment.text);
  if (args.model !== 'inworld-tts-2') {
    return {
      text: cleanText,
      lexicalText: cleanText,
      leadingInstructionTagCount: 0,
      ...(args.language ? { language: args.language } : {}),
      ...(resolveSpeakingRate(args.segment.pace) !== undefined
        ? { speakingRate: resolveSpeakingRate(args.segment.pace) }
        : {}),
    };
  }

  const capabilities = args.capabilities ?? {
    supportsMetadataInstructions: true,
    supportsNonVerbals: true,
    supportsUppercaseEmphasis: true,
    supportsFreeFormDirection: true,
  };
  const instruction = compileInworldSteeringInstruction(args.segment, capabilities);
  const beforeCue = capabilities.supportsNonVerbals ? args.segment.nonVerbalsBefore?.[0] : undefined;
  const afterCue = capabilities.supportsNonVerbals ? args.segment.nonVerbalsAfter?.[0] : undefined;
  const before = beforeCue ? [`[${beforeCue}]`] : [];
  const after = !beforeCue && afterCue ? [`[${afterCue}]`] : [];
  const spokenText = capabilities.supportsUppercaseEmphasis
    ? applyUppercaseEmphasis(cleanText, args.segment.emphasis)
    : cleanText;
  const text = [
    instruction ? `[${instruction}]` : undefined,
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
    lexicalText: spokenText,
    leadingInstructionTagCount: instruction ? 1 : 0,
    ...(args.language ? { language: args.language } : {}),
    ...(speakingRate !== undefined ? { speakingRate } : {}),
    ...(args.segment.deliveryMode ? { deliveryMode: args.segment.deliveryMode } : {}),
  };
}

export function compileInworldSteeringInstruction(
  segment: SpeechPerformancePlanSegment,
  capabilities: VoiceAssignmentCapabilities = {
    supportsMetadataInstructions: true,
    supportsNonVerbals: true,
    supportsUppercaseEmphasis: true,
    supportsFreeFormDirection: true,
  },
): string | undefined {
  const freeFormDirection = segment.freeFormDirection?.trim();
  if (capabilities.supportsFreeFormDirection && freeFormDirection) return freeFormDirection;
  if (!capabilities.supportsMetadataInstructions) return undefined;
  const qualities = [segment.emotion?.trim(), segment.intonation?.trim()].filter(
    (quality): quality is string => Boolean(quality),
  );
  return qualities.length > 0 ? `speak with ${qualities.join(' and ')}` : undefined;
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
