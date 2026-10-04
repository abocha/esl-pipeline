import { assignmentStudySegments, ConfigurationError } from '@esl-pipeline/contracts';

import { resolveAssignmentMetadata } from './assignment-input.js';
import { resolveTtsSelection } from './descriptors.js';
import { hashStudyText } from './hash.js';
import {
  CONTEXTUAL_SPEECH_ANNOTATION_VERSION,
  validateSpeechAnnotationText,
} from './speech-annotation.js';
import { normalizeSpeechCueText } from './speech-plan-analysis.js';
import type {
  BuildStudyTextInput,
  BuildStudyTextOptions,
  PreparedStudyTextSynthesis,
  SpeechPerformancePlan,
  SpeechPerformancePlannerFallbackReason,
  SpeechPerformancePlanSegment,
  SpeechPerformancePlanV1,
  SpeechPerformancePlanV2,
} from './types.js';

export class SpeechPerformancePlannerInvalidOutputError extends Error {
  readonly validationMessage?: string;
  readonly rejectedOutput?: unknown;
  readonly rawText?: string;

  constructor(
    message: string,
    options: ErrorOptions & {
      validationMessage?: string;
      rejectedOutput?: unknown;
      rawText?: string;
    } = {},
  ) {
    super(message, options);
    this.name = 'SpeechPerformancePlannerInvalidOutputError';
    this.validationMessage = options.validationMessage;
    this.rejectedOutput = options.rejectedOutput;
    this.rawText = options.rawText;
  }
}

export class SpeechPerformancePlannerBudgetExceededError extends Error {
  readonly category = 'budget_exceeded' as const;

  constructor(message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = 'SpeechPerformancePlannerBudgetExceededError';
  }
}

export function createPreparedStudyTextSynthesis(
  input: BuildStudyTextInput,
  options: BuildStudyTextOptions,
): PreparedStudyTextSynthesis {
  const selection = resolveTtsSelection({ provider: options.ttsProvider, model: options.ttsModel });
  const frontmatter = resolveAssignmentMetadata(input);
  const segments = assignmentStudySegments(input.assignment);
  const speakerLabels = collectSpeakerLabels(
    frontmatter.speaker_labels,
    frontmatter.speaker_profiles,
    segments,
  );
  return {
    selection,
    sourceHash: hashStudyText(JSON.stringify(segments)),
    segments,
    speakerLabels,
    voices: [],
    voiceAssignments: {},
    enhancementContext: { assignment: input.assignment },
  };
}

export function normalizeStudyTextSpeakerToken(value: string): string | undefined {
  const normalized = value
    .trim()
    .replaceAll(/[*_`~>#\]]/g, '')
    .replaceAll('[', '')
    .replaceAll(/\s+/g, ' ')
    .trim();
  return normalized || undefined;
}

function collectSpeakerLabels(
  labels: unknown,
  profiles: unknown,
  segments: SpeechPerformancePlanSegment[],
): string[] {
  const collected: string[] = [];
  const seen = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== 'string') return;
    const normalized = normalizeStudyTextSpeakerToken(value);
    const key = normalized?.toLocaleLowerCase();
    if (!normalized || !key || seen.has(key)) return;
    seen.add(key);
    collected.push(normalized);
  };

  if (Array.isArray(labels)) {
    for (const label of labels) add(label);
  }
  if (collected.length === 0 && !segments.some((segment) => segment.speaker)) {
    if (Array.isArray(profiles)) {
      const first = profiles.find(
        (profile): profile is { id: string } =>
          typeof profile === 'object' &&
          profile !== null &&
          typeof (profile as { id?: unknown }).id === 'string',
      );
      add(first?.id);
    }
  }
  if (collected.length === 0) add('Narrator');
  return collected;
}

export function createIdentitySpeechPerformancePlan(
  prepared: PreparedStudyTextSynthesis,
  options: { fallbackReason?: SpeechPerformancePlannerFallbackReason } = {},
): SpeechPerformancePlanV1 {
  return {
    schemaVersion: 1,
    mode: 'identity',
    provider: prepared.selection.provider,
    model: prepared.selection.model,
    sourceHash: prepared.sourceHash,
    ...(options.fallbackReason ? { fallbackReason: options.fallbackReason } : {}),
    segments: prepared.segments.map((segment) => ({ ...segment })),
  };
}

export function validateSpeechPerformancePlan(
  prepared: PreparedStudyTextSynthesis,
  plan: SpeechPerformancePlan,
): SpeechPerformancePlan {
  if (plan.schemaVersion === 2) return validateSpeechPerformancePlanV2(prepared, plan);
  if (plan.schemaVersion !== 1) {
    throw new ConfigurationError(
      `Unsupported speech plan schema version "${String((plan as { schemaVersion?: unknown }).schemaVersion)}".`,
    );
  }
  if (
    plan.provider !== prepared.selection.provider ||
    plan.model !== prepared.selection.model ||
    plan.sourceHash !== prepared.sourceHash
  ) {
    throw new ConfigurationError(
      'Speech plan selection or source hash does not match prepared text.',
    );
  }
  if (plan.segments.length !== prepared.segments.length) {
    throw new ConfigurationError('Speech plan segment count does not match prepared text.');
  }

  const segments = plan.segments.map((segment, index) =>
    validateSegment(prepared, prepared.segments[index]!, segment),
  );
  return { ...plan, segments };
}

function validateSpeechPerformancePlanV2(
  prepared: PreparedStudyTextSynthesis,
  plan: SpeechPerformancePlanV2,
): SpeechPerformancePlanV2 {
  if (plan.provider !== 'inworld' || plan.model !== 'inworld-tts-2') {
    throw new ConfigurationError('Contextual speech annotations require Inworld TTS-2.');
  }
  if (plan.mode !== 'prompted') {
    throw new ConfigurationError('Speech annotation plan mode must be "prompted".');
  }
  if (
    plan.provider !== prepared.selection.provider ||
    plan.model !== prepared.selection.model ||
    plan.sourceHash !== prepared.sourceHash
  ) {
    throw new ConfigurationError(
      'Speech plan selection or source hash does not match prepared text.',
    );
  }
  if (plan.enhancerVersion !== CONTEXTUAL_SPEECH_ANNOTATION_VERSION) {
    throw new ConfigurationError(`Unsupported speech enhancer version "${plan.enhancerVersion}".`);
  }
  if (
    !plan.planner ||
    typeof plan.planner.provider !== 'string' ||
    typeof plan.planner.model !== 'string' ||
    typeof plan.planner.generatedAt !== 'string'
  ) {
    throw new ConfigurationError('Speech annotation plan requires planner provenance.');
  }
  if (plan.segments.length !== prepared.segments.length) {
    throw new ConfigurationError('Speech plan segment count does not match prepared text.');
  }

  const segments = plan.segments.map((segment, index) => {
    const source = prepared.segments[index]!;
    if (segment.id !== source.id) {
      throw new ConfigurationError(
        `Speech plan segment "${segment.id}" does not match source segment "${source.id}".`,
      );
    }
    if (segment.text !== source.text) {
      throw new ConfigurationError(
        `Speech plan segment "${segment.id}" changed the authored text.`,
      );
    }
    if (segment.speaker !== source.speaker) {
      throw new ConfigurationError(
        `Speech plan segment "${segment.id}" changed the authored speaker.`,
      );
    }
    const validated = validateSpeechAnnotationText(source.text, segment.synthesisText);
    return { ...segment, synthesisText: validated.synthesisText };
  });
  return { ...plan, segments };
}

function validateSegment(
  prepared: PreparedStudyTextSynthesis,
  source: SpeechPerformancePlanSegment,
  segment: SpeechPerformancePlanSegment,
): SpeechPerformancePlanSegment {
  if (segment.id !== source.id) {
    throw new ConfigurationError(
      `Speech plan segment "${segment.id}" does not match source segment "${source.id}".`,
    );
  }
  if (segment.text !== source.text) {
    throw new ConfigurationError(`Speech plan segment "${segment.id}" changed the authored text.`);
  }
  if (segment.speaker !== source.speaker) {
    throw new ConfigurationError(
      `Speech plan segment "${segment.id}" changed the authored speaker.`,
    );
  }
  const emphasis = (segment.emphasis ?? []).map((phrase) => {
    if (!phrase) {
      throw new ConfigurationError(
        `Speech plan segment "${segment.id}" emphasis phrase must not be empty.`,
      );
    }
    const index = segment.text.toLocaleLowerCase().indexOf(phrase.toLocaleLowerCase());
    if (index === -1) {
      throw new ConfigurationError(
        `Speech plan segment "${segment.id}" emphasis "${phrase}" is not present in authored text.`,
      );
    }
    return segment.text.slice(index, index + phrase.length);
  });
  for (const pause of [segment.pauseBeforeMs, segment.pauseAfterMs]) {
    if (pause !== undefined && (!Number.isInteger(pause) || pause < 0 || pause > 3000)) {
      throw new ConfigurationError(
        `Speech plan segment "${segment.id}" pause must be an integer from 0 to 3000ms.`,
      );
    }
  }
  if (segment.freeFormDirection) {
    const assignment = prepared.voicePlan?.assignments.find(
      (candidate) => candidate.speaker === segment.speaker,
    );
    if (!assignment?.capabilities.supportsFreeFormDirection) {
      throw new ConfigurationError(
        `Speech plan segment "${segment.id}" selected voice does not support free-form direction.`,
      );
    }
  }
  const emotion = normalizeOptionalCue('emotion', segment.emotion);
  const intonation = normalizeOptionalCue('intonation', segment.intonation);
  const freeFormDirection = normalizeOptionalCue('freeFormDirection', segment.freeFormDirection);
  return {
    ...segment,
    emotion,
    intonation,
    freeFormDirection,
    emphasis: emphasis.length > 0 ? [...new Set(emphasis)] : undefined,
  };
}

function normalizeOptionalCue(
  field: 'emotion' | 'intonation' | 'freeFormDirection',
  value: string | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  return normalizeSpeechCueText(field, value) || undefined;
}
