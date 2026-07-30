import { ConfigurationError } from '@esl-pipeline/contracts';
import { extractFrontmatter, extractStudyText } from '@esl-pipeline/pmd';

import { resolveTtsSelection } from './descriptors.js';
import { hashStudyText } from './hash.js';
import { normalizeSpeechCueText } from './speech-plan-analysis.js';
import { resolveEffectiveSpeechDirection } from './speech-plan-direction.js';
import type {
  BuildStudyTextInput,
  BuildStudyTextOptions,
  PreparedStudyTextSynthesis,
  SpeechPerformanceMode,
  SpeechPerformancePlan,
  SpeechPerformancePlannerFallbackReason,
  SpeechPerformancePlanSegment,
  SpeechPerformancePlanSegmentV2,
  SpeechPerformancePlanV2,
  SpeechPerformanceSourceContext,
  SpeechTurnEvidence,
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
  if (plan.schemaVersion === 2) return validateSpeechPerformancePlanV2(prepared, plan);
  if (plan.schemaVersion !== 1)
    throw new ConfigurationError('Unsupported speech plan schema version.');
  return validateSpeechPerformancePlanV1(prepared, plan);
}

function validateSpeechPerformancePlanV1(
  prepared: PreparedStudyTextSynthesis,
  plan: Extract<SpeechPerformancePlan, { schemaVersion: 1 }>,
): SpeechPerformancePlan {
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
  if (
    !prepared.performanceMode ||
    !prepared.performanceSpeakers ||
    !prepared.performanceSource ||
    !prepared.performanceContextHash
  ) {
    throw new ConfigurationError('Schema-v2 speech plans require prepared performance context.');
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
  if (plan.performanceContextHash !== prepared.performanceContextHash) {
    throw new ConfigurationError(
      'Speech plan performance context hash does not match preparation.',
    );
  }
  if (plan.resolvedPerformanceMode !== prepared.performanceMode) {
    throw new ConfigurationError('Speech plan performance mode does not match preparation.');
  }
  validateSpeakerEnvelopes(prepared, plan);
  const overallDirection = validateDirectionEnvelope(
    prepared,
    plan.performanceContext.overallDirection,
    'overall direction',
  );
  const speakerEnvelopes = plan.performanceContext.speakerEnvelopes.map((envelope) => ({
    speaker: canonicalPerformanceSpeaker(prepared, envelope.speaker),
    baselineDirection: validateDirectionEnvelope(
      prepared,
      envelope.baselineDirection,
      `speaker envelope ${envelope.speaker}`,
    ),
  }));
  if (plan.segments.length !== prepared.segments.length) {
    throw new ConfigurationError('Speech plan segment count does not match prepared text.');
  }
  const segments = plan.segments.map((segment, index) =>
    validateSegmentV2(prepared, prepared.segments[index]!, segment, index),
  );
  const validated: SpeechPerformancePlanV2 = {
    ...plan,
    performanceContext: { overallDirection, speakerEnvelopes },
    segments,
  };
  for (const segment of validated.segments) {
    const instruction = resolveEffectiveSpeechDirection(validated, segment).instruction;
    if (instruction) normalizeSpeechCueText('freeFormDirection', instruction);
  }
  return validated;
}

function validateSpeakerEnvelopes(
  prepared: PreparedStudyTextSynthesis,
  plan: SpeechPerformancePlanV2,
): void {
  const expected = new Map(
    prepared.performanceSpeakers!.map((speaker) => [speaker.toLocaleLowerCase(), speaker]),
  );
  const seen = new Set<string>();
  for (const envelope of plan.performanceContext.speakerEnvelopes) {
    const key = normalizeStudyTextSpeakerToken(envelope.speaker)?.toLocaleLowerCase();
    if (!key || !expected.has(key)) {
      throw new ConfigurationError(
        `Speech plan has unknown speaker envelope "${envelope.speaker}".`,
      );
    }
    if (seen.has(key)) {
      throw new ConfigurationError(
        `Speech plan has duplicate speaker envelope "${envelope.speaker}".`,
      );
    }
    seen.add(key);
  }
  const missing = [...expected].find(([key]) => !seen.has(key));
  if (missing) {
    throw new ConfigurationError(`Speech plan is missing speaker envelope "${missing[1]}".`);
  }
}

function canonicalPerformanceSpeaker(
  prepared: PreparedStudyTextSynthesis,
  speaker: string,
): string {
  const key = normalizeStudyTextSpeakerToken(speaker)?.toLocaleLowerCase();
  return (
    prepared.performanceSpeakers?.find((candidate) => candidate.toLocaleLowerCase() === key) ??
    speaker
  );
}

function validateDirectionEnvelope(
  prepared: PreparedStudyTextSynthesis,
  envelope: SpeechPerformancePlanV2['performanceContext']['overallDirection'],
  label: string,
): SpeechPerformancePlanV2['performanceContext']['overallDirection'] {
  if (!Array.isArray(envelope.components) || !Array.isArray(envelope.basis)) {
    throw new ConfigurationError(`Speech plan ${label} must contain components and basis arrays.`);
  }
  const seen = new Set<string>();
  const components = envelope.components.map((component) => {
    if (!SPEECH_DIRECTION_DIMENSIONS.has(component.dimension)) {
      throw new ConfigurationError(`Speech plan ${label} uses an unknown direction dimension.`);
    }
    if (seen.has(component.dimension)) {
      throw new ConfigurationError(`Speech plan ${label} has a duplicate direction dimension.`);
    }
    seen.add(component.dimension);
    const direction = normalizeSpeechCueText('freeFormDirection', component.direction);
    if (!direction) {
      throw new ConfigurationError(`Speech plan ${label} has an empty direction component.`);
    }
    return {
      dimension: component.dimension,
      direction,
    };
  });
  const basis = envelope.basis.map((reference) => validateBasisReference(prepared, reference));
  if (components.length > 0 && basis.length === 0) {
    throw new ConfigurationError(`Speech plan ${label} is missing a basis reference.`);
  }
  return { components, basis };
}

const SPEECH_DIRECTION_DIMENSIONS = new Set([
  'relationship',
  'energy',
  'formality',
  'emotion',
  'articulation',
  'intonation',
  'volume',
  'pitch',
  'range',
  'tempo',
  'style',
]);

function validateBasisReference(prepared: PreparedStudyTextSynthesis, reference: string): string {
  const normalized = reference.normalize('NFKC').trim();
  if (
    (normalized === 'frontmatter:title' && prepared.performanceSource!.title) ||
    (normalized === 'frontmatter:topic' && prepared.performanceSource!.topics.length > 0) ||
    normalized === 'frontmatter:study_text_type'
  ) {
    return normalized;
  }
  if (normalized.startsWith('segment:')) {
    const segmentId = normalized.slice('segment:'.length);
    if (prepared.segments.some((segment) => segment.id === segmentId)) return normalized;
  }
  const profileMatch = /^speaker_profile:([^:]+):(role|persona|voice_direction)$/u.exec(normalized);
  if (profileMatch) {
    const [, speaker, field] = profileMatch;
    const profile = prepared.performanceSource!.speakerProfiles.find(
      (candidate) => candidate.id.toLocaleLowerCase() === speaker!.toLocaleLowerCase(),
    );
    if (profile && typeof profile[field as 'role' | 'persona' | 'voice_direction'] === 'string') {
      return `speaker_profile:${profile.id}:${field}`;
    }
  }
  throw new ConfigurationError(`Speech plan basis reference "${normalized}" is not grounded.`);
}

function validateSegmentV2(
  prepared: PreparedStudyTextSynthesis,
  source: SpeechPerformancePlanSegment,
  segment: SpeechPerformancePlanSegmentV2,
  segmentIndex: number,
): SpeechPerformancePlanSegmentV2 {
  if (
    segment.pace !== undefined &&
    !['slow', 'measured', 'natural', 'brisk'].includes(segment.pace)
  ) {
    throw new ConfigurationError(`Speech plan segment "${segment.id}" has an invalid pace.`);
  }
  if (
    segment.deliveryMode !== undefined &&
    !['STABLE', 'BALANCED', 'CREATIVE'].includes(segment.deliveryMode)
  ) {
    throw new ConfigurationError(
      `Speech plan segment "${segment.id}" has an invalid delivery mode.`,
    );
  }
  const nonverbals = [...(segment.nonVerbalsBefore ?? []), ...(segment.nonVerbalsAfter ?? [])];
  if (nonverbals.some((cue) => !['sigh', 'laugh', 'chuckle', 'breath'].includes(cue))) {
    throw new ConfigurationError(`Speech plan segment "${segment.id}" has an invalid non-verbal.`);
  }
  const common = validateSegment(prepared, source, segment) as SpeechPerformancePlanSegmentV2;
  const pace = common.pace === 'natural' ? undefined : common.pace;
  const pauseBeforeMs = (common.pauseBeforeMs ?? 0) > 0 ? common.pauseBeforeMs : undefined;
  const pauseAfterMs = (common.pauseAfterMs ?? 0) > 0 ? common.pauseAfterMs : undefined;
  const deliveryMode = common.deliveryMode === 'BALANCED' ? undefined : common.deliveryMode;
  const turnAdjustment = segment.turnAdjustment
    ? (() => {
        const reason = normalizeSpeechCueText('freeFormDirection', segment.turnAdjustment!.reason);
        if (!reason) {
          throw new ConfigurationError(
            `Speech plan turn adjustment "${segment.id}" requires a reason.`,
          );
        }
        return {
          components: validateDirectionEnvelope(
            prepared,
            { components: segment.turnAdjustment.components, basis: ['frontmatter:title'] },
            `turn adjustment ${segment.id}`,
          ).components,
          reason,
          evidence: validateEvidence(
            prepared,
            segment,
            segment.turnAdjustment.evidence,
            segmentIndex,
          ),
        };
      })()
    : undefined;
  if (
    turnAdjustment &&
    (turnAdjustment.components.length === 0 || turnAdjustment.evidence.length === 0)
  ) {
    throw new ConfigurationError(`Speech plan turn adjustment "${segment.id}" requires evidence.`);
  }
  const activeControls = new Set<string>();
  if (pace) activeControls.add('pace');
  if ((common.emphasis?.length ?? 0) > 0) activeControls.add('emphasis');
  if (pauseBeforeMs) activeControls.add('pause_before');
  if (pauseAfterMs) activeControls.add('pause_after');
  if ((common.nonVerbalsBefore?.length ?? 0) + (common.nonVerbalsAfter?.length ?? 0) > 0)
    activeControls.add('nonverbal');
  if (deliveryMode) activeControls.add('delivery_mode');
  if ((common.nonVerbalsBefore?.length ?? 0) + (common.nonVerbalsAfter?.length ?? 0) > 1) {
    throw new ConfigurationError(`Speech plan segment "${segment.id}" exceeds one non-verbal.`);
  }
  const controlEvidence = (segment.controlEvidence ?? [])
    .filter((entry) => activeControls.has(entry.control))
    .map((entry) => {
      if (typeof entry.learnerMeaningRequired !== 'boolean') {
        throw new ConfigurationError(
          `Speech plan segment "${segment.id}" has invalid control evidence.`,
        );
      }
      const reason = normalizeSpeechCueText('freeFormDirection', entry.reason);
      if (!reason) {
        throw new ConfigurationError(
          `Speech plan segment "${segment.id}" control evidence requires a reason.`,
        );
      }
      return {
        control: entry.control,
        reason,
        learnerMeaningRequired: entry.learnerMeaningRequired,
        evidence: validateEvidence(prepared, segment, entry.evidence, segmentIndex),
      };
    });
  for (const control of activeControls) {
    if (!controlEvidence.some((entry) => entry.control === control && entry.evidence.length > 0)) {
      throw new ConfigurationError(
        `Speech plan segment "${segment.id}" is missing control evidence for ${control}.`,
      );
    }
  }
  if (
    pace &&
    (common.emphasis?.length ?? 0) > 0 &&
    !controlEvidence.some((entry) => entry.control === 'emphasis' && entry.learnerMeaningRequired)
  ) {
    throw new ConfigurationError(
      `Speech plan segment "${segment.id}" requires learner-meaning evidence for pace plus emphasis.`,
    );
  }
  const canonical: SpeechPerformancePlanSegmentV2 = {
    ...common,
    ...(pace ? { pace } : {}),
    ...(pauseBeforeMs ? { pauseBeforeMs } : {}),
    ...(pauseAfterMs ? { pauseAfterMs } : {}),
    ...(deliveryMode ? { deliveryMode } : {}),
    ...(turnAdjustment ? { turnAdjustment } : {}),
    ...(controlEvidence.length > 0 ? { controlEvidence } : {}),
  };
  if (!pace) delete canonical.pace;
  if (!pauseBeforeMs) delete canonical.pauseBeforeMs;
  if (!pauseAfterMs) delete canonical.pauseAfterMs;
  if (!deliveryMode) delete canonical.deliveryMode;
  if (!turnAdjustment) delete canonical.turnAdjustment;
  if (controlEvidence.length === 0) delete canonical.controlEvidence;
  return canonical;
}

function validateEvidence(
  prepared: PreparedStudyTextSynthesis,
  current: SpeechPerformancePlanSegment,
  evidence: SpeechTurnEvidence[],
  currentIndex: number,
): SpeechTurnEvidence[] {
  if (!Array.isArray(evidence)) return [];
  return evidence.map((entry) => {
    const referencedIndex = prepared.segments.findIndex(
      (segment) => segment.id === entry.segmentId,
    );
    if (referencedIndex < 0) {
      throw new ConfigurationError(`Speech plan evidence references an unknown segment.`);
    }
    if (entry.kind === 'authored_substring' && entry.segmentId !== current.id) {
      throw new ConfigurationError(
        `Speech plan authored evidence must reference its current segment.`,
      );
    }
    if (entry.kind === 'adjacent_segment' && Math.abs(referencedIndex - currentIndex) !== 1) {
      throw new ConfigurationError(
        `Speech plan adjacent evidence must reference an adjacent segment.`,
      );
    }
    if (entry.kind !== 'authored_substring' && entry.kind !== 'adjacent_segment') {
      throw new ConfigurationError(`Speech plan evidence kind is unsupported.`);
    }
    const source = prepared.segments[referencedIndex]!;
    const quote = entry.quote.normalize('NFKC').trim();
    if (!quote || !source.text.toLocaleLowerCase().includes(quote.toLocaleLowerCase())) {
      throw new ConfigurationError(`Speech plan evidence quote is not present in authored text.`);
    }
    return { kind: entry.kind, segmentId: source.id, quote };
  });
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
