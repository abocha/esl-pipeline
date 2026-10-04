import type {
  InworldTtsModel,
  SpeechDeliveryMode,
  SpeechEnhancementVersion,
  SpeechPerformancePlanSegment,
  SpeechPerformancePlanSegmentV2,
  VoiceAssignmentCapabilities,
} from '@esl-pipeline/tts-core';
import {
  normalizePlainSpeechText,
  SPEECH_ANNOTATION_CLOSE,
  SPEECH_ANNOTATION_OPEN,
  validateSpeechAnnotationText,
} from '@esl-pipeline/tts-core';

export interface RenderedInworldSpeechSegment {
  text: string;
  lexicalText: string;
  leadingInstructionTagCount: number;
  language?: string;
  speakingRate?: number;
  temperature?: number;
  deliveryMode?: SpeechDeliveryMode;
  enhancerVersion?: SpeechEnhancementVersion;
}

export function renderInworldSpeechSegment(args: {
  model: InworldTtsModel;
  segment: SpeechPerformancePlanSegment | SpeechPerformancePlanSegmentV2;
  enhancerVersion?: SpeechEnhancementVersion;
  capabilities?: VoiceAssignmentCapabilities;
  language?: string;
}): RenderedInworldSpeechSegment {
  if ('synthesisText' in args.segment) {
    if (args.model !== 'inworld-tts-2' || !args.enhancerVersion) {
      throw new Error(
        'Contextual speech annotations require Inworld TTS-2 and an enhancer version.',
      );
    }
    const validated = validateSpeechAnnotationText(args.segment.text, args.segment.synthesisText);
    const converted = convertSpeechAnnotationsToInworldText(validated.synthesisText);
    return {
      text: converted.text,
      lexicalText: args.segment.text,
      leadingInstructionTagCount: converted.leadingAnnotationCount,
      ...(args.language ? { language: args.language } : {}),
      deliveryMode: 'BALANCED',
      enhancerVersion: args.enhancerVersion,
    };
  }
  const cleanText = normalizePlainSpeechText(args.segment.text);
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
  const beforeCue = capabilities.supportsNonVerbals
    ? args.segment.nonVerbalsBefore?.[0]
    : undefined;
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

function convertSpeechAnnotationsToInworldText(synthesisText: string): {
  text: string;
  leadingAnnotationCount: number;
} {
  let cursor = 0;
  let authoredBefore = '';
  let text = '';
  let leadingAnnotationCount = 0;
  while (cursor < synthesisText.length) {
    const openAt = synthesisText.indexOf(SPEECH_ANNOTATION_OPEN, cursor);
    if (openAt < 0) {
      text += synthesisText.slice(cursor);
      break;
    }
    const authoredChunk = synthesisText.slice(cursor, openAt);
    text += authoredChunk;
    authoredBefore += authoredChunk;
    const bodyStart = openAt + SPEECH_ANNOTATION_OPEN.length;
    const closeAt = synthesisText.indexOf(SPEECH_ANNOTATION_CLOSE, bodyStart);
    const afterMarker = closeAt + SPEECH_ANNOTATION_CLOSE.length;
    const annotation = synthesisText.slice(bodyStart, closeAt);
    const left = Array.from(authoredBefore).at(-1);
    const remainder = synthesisText.slice(afterMarker);
    const nextMarker = remainder.indexOf(SPEECH_ANNOTATION_OPEN);
    const nextAuthored = nextMarker < 0 ? remainder : remainder.slice(0, nextMarker);
    const right = Array.from(nextAuthored)[0];
    if (authoredBefore.trim().length === 0) leadingAnnotationCount += 1;
    text += `${left && !/\s/u.test(left) ? ' ' : ''}[${annotation}]${right && !/\s/u.test(right) ? ' ' : ''}`;
    cursor = afterMarker;
  }
  return { text, leadingAnnotationCount };
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
