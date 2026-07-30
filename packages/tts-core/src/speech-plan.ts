import { ConfigurationError } from '@esl-pipeline/contracts';
import { extractFrontmatter, extractStudyText } from '@esl-pipeline/pmd';

import { resolveTtsSelection } from './descriptors.js';
import { hashStudyText } from './hash.js';
import { normalizeSpeechCueText } from './speech-plan-analysis.js';
import type {
  BuildStudyTextInput,
  BuildStudyTextOptions,
  PreparedStudyTextSynthesis,
  SpeechPerformanceMode,
  SpeechPerformancePlan,
  SpeechPerformancePlannerFallbackReason,
  SpeechPerformancePlanSegment,
  SpeechPerformanceSourceContext,
  TtsStrategy,
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

export function createPreparedStudyTextSynthesis(
  input: BuildStudyTextInput,
  options: BuildStudyTextOptions,
): PreparedStudyTextSynthesis {
  const selection = resolveTtsSelection({ provider: options.ttsProvider, model: options.ttsModel });
  const frontmatter = extractFrontmatter(input.context);
  const studyText = extractStudyText(input.context);
  const segments = studyText.lines
    .map((line, index) => {
      const separator = line.indexOf(':');
      const speaker =
        separator > 0 && separator < 40
          ? normalizeStudyTextSpeakerToken(line.slice(0, separator))
          : undefined;
      const text = (speaker ? line.slice(separator + 1) : line).trim();
      return { id: `segment-${index + 1}`, ...(speaker ? { speaker } : {}), text };
    })
    .filter((segment) => segment.text.length > 0);
  const speakerLabels = collectSpeakerLabels(
    frontmatter.speaker_labels,
    frontmatter.speaker_profiles,
    segments,
  );
  const segmentSpeakers = collectDistinctSpeakers(
    segments.flatMap((segment) => (segment.speaker ? [segment.speaker] : [])),
  );
  const performanceMode = resolveStudyTextPerformanceMode({
    ttsStrategy: options.ttsStrategy,
    studyTextType: studyText.type,
    speakers: segmentSpeakers,
  });
  const performanceSpeakers = resolvePerformanceSpeakers({
    mode: performanceMode,
    ttsStrategy: options.ttsStrategy,
    segmentSpeakers,
    labels: frontmatter.speaker_labels,
    profiles: frontmatter.speaker_profiles,
  });
  const performanceSource: SpeechPerformanceSourceContext = {
    title: frontmatter.title.trim(),
    topics: normalizeTopics(frontmatter.topic),
    studyTextType: studyText.type,
    speakerProfiles: collectPerformanceSpeakerProfiles(
      frontmatter.speaker_profiles,
      performanceSpeakers,
    ),
  };
  const prepared: PreparedStudyTextSynthesis = {
    selection,
    sourceHash: hashStudyText(JSON.stringify(segments)),
    segments,
    speakerLabels,
    performanceMode,
    performanceSpeakers,
    performanceSource,
    voices: [],
    voiceAssignments: {},
  };
  return {
    ...prepared,
    performanceContextHash: computeSpeechPerformanceContextHash(prepared),
  };
}

export function resolveStudyTextPerformanceMode(args: {
  ttsStrategy?: TtsStrategy;
  studyTextType: 'dialogue' | 'monologue';
  speakers: readonly string[];
}): SpeechPerformanceMode {
  if (args.ttsStrategy === 'dialogue') return 'dialogue';
  if (args.ttsStrategy === 'tts') return 'monologue';
  return collectDistinctSpeakers(args.speakers).length >= 2 ? 'dialogue' : 'monologue';
}

export function computeSpeechPerformanceContextHash(
  prepared: Pick<
    PreparedStudyTextSynthesis,
    'performanceMode' | 'performanceSpeakers' | 'performanceSource' | 'voicePlan'
  >,
): string | undefined {
  if (!prepared.performanceMode || !prepared.performanceSpeakers || !prepared.performanceSource) {
    return undefined;
  }
  const assignments = new Map(
    (prepared.voicePlan?.assignments ?? []).map((assignment) => [
      normalizeStudyTextSpeakerToken(assignment.speaker)?.toLocaleLowerCase(),
      assignment,
    ]),
  );
  const voiceContext = prepared.performanceSpeakers.flatMap((speaker) => {
    const assignment = assignments.get(speaker.toLocaleLowerCase());
    if (!assignment) return [];
    return [
      {
        speaker,
        ...(assignment.language ? { language: assignment.language } : {}),
        capabilities: {
          supportsMetadataInstructions: assignment.capabilities.supportsMetadataInstructions,
          supportsNonVerbals: assignment.capabilities.supportsNonVerbals,
          supportsUppercaseEmphasis: assignment.capabilities.supportsUppercaseEmphasis,
          supportsFreeFormDirection: assignment.capabilities.supportsFreeFormDirection,
        },
      },
    ];
  });
  return hashStudyText(
    JSON.stringify({
      performanceMode: prepared.performanceMode,
      performanceSpeakers: prepared.performanceSpeakers,
      performanceSource: prepared.performanceSource,
      voiceContext,
    }),
  );
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

function collectDistinctSpeakers(values: readonly string[]): string[] {
  const collected: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = normalizeStudyTextSpeakerToken(value);
    const key = normalized?.toLocaleLowerCase();
    if (!normalized || !key || seen.has(key)) continue;
    seen.add(key);
    collected.push(normalized);
  }
  return collected;
}

function resolvePerformanceSpeakers(args: {
  mode: SpeechPerformanceMode;
  ttsStrategy?: TtsStrategy;
  segmentSpeakers: string[];
  labels: unknown;
  profiles: unknown;
}): string[] {
  if (args.mode === 'dialogue') {
    if (args.segmentSpeakers.length > 0) return args.segmentSpeakers;
    const labels = Array.isArray(args.labels)
      ? collectDistinctSpeakers(
          args.labels.filter((value): value is string => typeof value === 'string'),
        )
      : [];
    if (labels.length > 0) return labels;
    const profileIds = collectProfileIds(args.profiles);
    return profileIds.length > 0 ? profileIds : ['Narrator'];
  }
  if (args.segmentSpeakers.length > 1) {
    throw new ConfigurationError(
      `${args.ttsStrategy ?? 'auto'} strategy requires one authored study-text speaker; use dialogue/auto or remove speaker labels.`,
    );
  }
  if (args.segmentSpeakers.length === 1) return args.segmentSpeakers;
  const labels = Array.isArray(args.labels)
    ? collectDistinctSpeakers(
        args.labels.filter((value): value is string => typeof value === 'string'),
      )
    : [];
  if (labels.length === 1) return labels;
  const profileIds = collectProfileIds(args.profiles);
  return profileIds.length === 1 ? profileIds : ['Narrator'];
}

function collectProfileIds(profiles: unknown): string[] {
  if (!Array.isArray(profiles)) return [];
  return collectDistinctSpeakers(
    profiles.flatMap((profile) => {
      if (!profile || typeof profile !== 'object') return [];
      const id = (profile as { id?: unknown }).id;
      return typeof id === 'string' ? [id] : [];
    }),
  );
}

function collectPerformanceSpeakerProfiles(
  profiles: unknown,
  performanceSpeakers: readonly string[],
): SpeechPerformanceSourceContext['speakerProfiles'] {
  if (!Array.isArray(profiles)) return [];
  const allowed = new Set(performanceSpeakers.map((speaker) => speaker.toLocaleLowerCase()));
  return profiles.flatMap((profile) => {
    if (!profile || typeof profile !== 'object') return [];
    const cast = profile as Record<string, unknown>;
    if (typeof cast.id !== 'string') return [];
    const id = normalizeStudyTextSpeakerToken(cast.id);
    if (!id || !allowed.has(id.toLocaleLowerCase())) return [];
    return [
      {
        id,
        ...(typeof cast.role === 'string' ? { role: cast.role.trim() } : {}),
        ...(typeof cast.persona === 'string' ? { persona: cast.persona.trim() } : {}),
        ...(typeof cast.voice_direction === 'string'
          ? { voice_direction: cast.voice_direction.trim() }
          : {}),
      },
    ];
  });
}

function normalizeTopics(topic: string | string[]): string[] {
  return (Array.isArray(topic) ? topic : [topic]).map((value) => value.trim()).filter(Boolean);
}

export function createIdentitySpeechPerformancePlan(
  prepared: PreparedStudyTextSynthesis,
  options: { fallbackReason?: SpeechPerformancePlannerFallbackReason } = {},
): SpeechPerformancePlan {
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
  if (plan.schemaVersion !== 1) {
    throw new ConfigurationError(`Unsupported speech plan schema version "${plan.schemaVersion}".`);
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
