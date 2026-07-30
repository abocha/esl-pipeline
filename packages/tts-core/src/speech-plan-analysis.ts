import { ConfigurationError } from '@esl-pipeline/contracts';

import { getTtsModelCapabilities } from './descriptors.js';
import { resolveEffectiveSpeechDirection } from './speech-plan-direction.js';
import type {
  PreparedStudyTextSynthesis,
  SpeechPerformancePlan,
  SpeechPerformancePlanSegment,
} from './types.js';

const SAFE_CUE_TEXT = /^[\p{L}\p{N}\p{M}\p{Zs},.!?;:'"()–—-]+$/u;
const UNSAFE_MARKUP_DELIMITERS = new Set(['[', ']', '<', '>', '{', '}']);

export type SpeechCueTextField = 'emotion' | 'intonation' | 'freeFormDirection';

class SpeechCueTextValidationError extends ConfigurationError {
  constructor(
    message: string,
    readonly issueCode: 'unsafe_cue_text' | 'cue_text_too_long',
    readonly issueDetail: Record<string, string | number | boolean>,
  ) {
    super(message);
  }
}

export interface SpeechPlanQualityIssue {
  severity: 'hard_failure' | 'warning';
  code: string;
  segmentId?: string;
  detail?: Record<string, string | number | boolean>;
}

export interface SpeechPlanCandidateAnalysis {
  hardFailures: SpeechPlanQualityIssue[];
  warnings: SpeechPlanQualityIssue[];
}

export interface RenderedSpeechSegmentSummary {
  id: string;
  text: string;
  lexicalText: string;
  leadingInstructionTagCount?: number;
}

export interface SpeechPlanQualityMetrics {
  segmentCount: number;
  paceCount: number;
  pauseCount: number;
  pauseValuesMs: number[];
  nonverbalCount: number;
  emphasisCount: number;
  freeFormDirectionCount: number;
  instructionCount: number;
  nonDefaultDeliveryModeCount: number;
  deliveryModeCounts: Record<string, number>;
  cueCount: number;
  cueRate: number;
}

export interface ValidatedSpeechPlanAnalysis extends SpeechPlanCandidateAnalysis {
  metrics: SpeechPlanQualityMetrics;
}

export function normalizeSpeechCueText(field: SpeechCueTextField, input: string): string {
  const normalized = input.normalize('NFKC');
  if ([...normalized].some(isUnsafeControlCharacter)) {
    throw new SpeechCueTextValidationError(
      `${field} contains a control character or newline.`,
      'unsafe_cue_text',
      { field },
    );
  }
  if ([...normalized].some((character) => UNSAFE_MARKUP_DELIMITERS.has(character))) {
    throw new SpeechCueTextValidationError(
      `${field} contains an unsafe markup delimiter.`,
      'unsafe_cue_text',
      { field },
    );
  }
  const compact = normalized.trim().replaceAll(/\s+/gu, ' ');
  const maximum = field === 'freeFormDirection' ? 200 : 80;
  const observedCodePoints = [...compact].length;
  if (observedCodePoints > maximum) {
    throw new SpeechCueTextValidationError(
      `${field} must not exceed ${maximum} code points.`,
      'cue_text_too_long',
      { field, limit: maximum, observedCodePoints },
    );
  }
  if (compact && !SAFE_CUE_TEXT.test(compact)) {
    throw new SpeechCueTextValidationError(
      `${field} contains an unsupported character.`,
      'unsafe_cue_text',
      { field },
    );
  }
  return compact;
}

function isUnsafeControlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0)!;
  return (
    codePoint <= 0x1f ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x2028 ||
    codePoint === 0x2029
  );
}

function containsUnsafeMarkupDelimiter(value: string): boolean {
  return [...value].some((character) => UNSAFE_MARKUP_DELIMITERS.has(character));
}

export function analyzeSpeechPlanCandidate(
  prepared: PreparedStudyTextSynthesis,
  candidate: unknown,
  options: { schemaVersion?: 1 | 2 } = {},
): SpeechPlanCandidateAnalysis {
  if (options.schemaVersion === 2) return analyzeSpeechPlanCandidateV2(prepared, candidate);
  const hardFailures: SpeechPlanQualityIssue[] = [];
  const warnings: SpeechPlanQualityIssue[] = [];
  const parsed = asRecord(candidate);
  const segments = parsed?.segments;
  if (!Array.isArray(segments)) {
    hardFailures.push(issue('candidate_shape_invalid'));
    return { hardFailures, warnings };
  }

  const sourceIds = new Set(prepared.segments.map((segment) => segment.id));
  const seen = new Set<string>();
  for (const rawSegment of segments) {
    const segment = asRecord(rawSegment);
    if (!segment) {
      hardFailures.push(issue('candidate_segment_shape_invalid'));
      continue;
    }
    const id = typeof segment.id === 'string' && segment.id ? segment.id : undefined;
    if (!id) {
      hardFailures.push(issue('missing_segment_id'));
      continue;
    }
    if (seen.has(id)) hardFailures.push(issue('duplicate_segment_id', id));
    seen.add(id);
    if (!sourceIds.has(id)) hardFailures.push(issue('unknown_segment_id', id));

    const allowedFields = new Set([
      'id',
      'emotion',
      'intonation',
      'pace',
      'emphasis',
      'pauseBeforeMs',
      'pauseAfterMs',
      'nonVerbalsBefore',
      'nonVerbalsAfter',
      'deliveryMode',
      'freeFormDirection',
    ]);
    for (const field of Object.keys(segment)) {
      if (!allowedFields.has(field)) {
        hardFailures.push(issue('candidate_field_unknown', id, { field }));
      }
    }

    for (const field of ['emotion', 'intonation', 'freeFormDirection'] as const) {
      const value = segment[field];
      if (value === undefined) continue;
      if (typeof value !== 'string') {
        hardFailures.push(issue('candidate_cue_type_invalid', id, { field }));
        continue;
      }
      try {
        normalizeSpeechCueText(field, value);
      } catch (error) {
        hardFailures.push(cueTextIssue(error, id, field));
      }
    }
    for (const field of ['pauseBeforeMs', 'pauseAfterMs'] as const) {
      const value = segment[field];
      if (value !== undefined && (!Number.isInteger(value) || Number(value) < 0)) {
        hardFailures.push(issue('candidate_pause_invalid', id, { field }));
      } else if (typeof value === 'number' && value > 1000) {
        hardFailures.push(issue('planner_pause_exceeds_cap', id, { field, value }));
      }
    }
    if (
      segment.pace !== undefined &&
      !['slow', 'measured', 'natural', 'brisk'].includes(String(segment.pace))
    ) {
      hardFailures.push(issue('candidate_pace_invalid', id));
    }
    if (
      segment.deliveryMode !== undefined &&
      !['STABLE', 'BALANCED', 'CREATIVE'].includes(String(segment.deliveryMode))
    ) {
      hardFailures.push(issue('candidate_delivery_mode_invalid', id));
    }
    if (
      segment.emphasis !== undefined &&
      (!Array.isArray(segment.emphasis) ||
        segment.emphasis.some((phrase) => typeof phrase !== 'string'))
    ) {
      hardFailures.push(issue('candidate_emphasis_invalid', id));
    }
    const supportedNonverbals = new Set(['sigh', 'laugh', 'chuckle', 'breath']);
    for (const field of ['nonVerbalsBefore', 'nonVerbalsAfter'] as const) {
      const value = segment[field];
      if (
        value !== undefined &&
        (!Array.isArray(value) ||
          value.some((cue) => typeof cue !== 'string' || !supportedNonverbals.has(cue)))
      ) {
        hardFailures.push(issue('candidate_nonverbal_invalid', id, { field }));
      }
    }
    const nonverbalCount =
      arrayLength(segment.nonVerbalsBefore) + arrayLength(segment.nonVerbalsAfter);
    if (nonverbalCount > 1) {
      hardFailures.push(issue('planner_nonverbal_cap_exceeded', id, { count: nonverbalCount }));
    }
  }
  for (const sourceId of sourceIds) {
    if (!seen.has(sourceId)) hardFailures.push(issue('missing_source_segment', sourceId));
  }
  return { hardFailures, warnings };
}

function analyzeSpeechPlanCandidateV2(
  prepared: PreparedStudyTextSynthesis,
  candidate: unknown,
): SpeechPlanCandidateAnalysis {
  const hardFailures: SpeechPlanQualityIssue[] = [];
  const warnings: SpeechPlanQualityIssue[] = [];
  const parsed = asRecord(candidate);
  const context = asRecord(parsed?.performanceContext);
  const overall = asRecord(context?.overallDirection);
  const envelopes = context?.speakerEnvelopes;
  const segments = parsed?.segments;
  if (!parsed || !context || !overall || !Array.isArray(envelopes) || !Array.isArray(segments)) {
    return { hardFailures: [issue('candidate_shape_invalid')], warnings };
  }
  for (const basis of collectBasisReferences(overall, envelopes)) {
    if (!candidateBasisIsGrounded(prepared, basis)) {
      hardFailures.push(issue('invalid_basis_reference'));
    }
  }
  const sourceIds = new Set(prepared.segments.map((segment) => segment.id));
  const seen = new Set<string>();
  for (const [index, value] of segments.entries()) {
    const segment = asRecord(value);
    if (!segment) {
      hardFailures.push(issue('candidate_segment_shape_invalid'));
      continue;
    }
    const id = typeof segment.id === 'string' && segment.id ? segment.id : undefined;
    if (!id) {
      hardFailures.push(issue('missing_segment_id'));
      continue;
    }
    if (seen.has(id)) hardFailures.push(issue('duplicate_segment_id', id));
    seen.add(id);
    if (!sourceIds.has(id)) hardFailures.push(issue('unknown_segment_id', id));
    const pace = segment.pace;
    if (!['omit', 'slow', 'measured', 'brisk'].includes(String(pace))) {
      hardFailures.push(issue('candidate_pace_invalid', id));
    }
    if (!Array.isArray(segment.emphasis)) {
      hardFailures.push(issue('candidate_emphasis_invalid', id));
    } else if (pace !== 'omit' && segment.emphasis.length > 0) {
      warnings.push(issue('pace_with_emphasis', id, {}, 'warning'));
    }
    if (!['DEFAULT', 'STABLE', 'CREATIVE'].includes(String(segment.deliveryMode))) {
      hardFailures.push(issue('candidate_delivery_mode_invalid', id));
    }
    for (const field of ['pauseBeforeMs', 'pauseAfterMs'] as const) {
      const pause = segment[field];
      if (!Number.isInteger(pause) || Number(pause) < 0 || Number(pause) > 1000) {
        hardFailures.push(issue('candidate_pause_invalid', id, { field }));
      }
    }
    const turn = asRecord(segment.turnAdjustment);
    if (!turn || !Array.isArray(turn.components) || !Array.isArray(turn.evidence)) {
      hardFailures.push(issue('candidate_turn_adjustment_invalid', id));
    } else {
      validateCandidateEvidence(prepared, id, index, turn.evidence, hardFailures);
      if (turn.components.length > 0 && turn.evidence.length === 0) {
        hardFailures.push(issue('invalid_turn_provenance', id));
        warnings.push(issue('missing_turn_evidence', id, {}, 'warning'));
      }
    }
    const controlEvidence = Array.isArray(segment.controlEvidence) ? segment.controlEvidence : [];
    for (const entry of controlEvidence) {
      const evidenceRecord = asRecord(entry);
      if (!evidenceRecord || !Array.isArray(evidenceRecord.evidence)) {
        hardFailures.push(issue('invalid_control_provenance', id));
        continue;
      }
      validateCandidateEvidence(prepared, id, index, evidenceRecord.evidence, hardFailures);
    }
    const requiredControls = new Set<string>();
    if (pace !== 'omit') requiredControls.add('pace');
    if (Array.isArray(segment.emphasis) && segment.emphasis.length > 0)
      requiredControls.add('emphasis');
    if (Number(segment.pauseBeforeMs) > 0) requiredControls.add('pause_before');
    if (Number(segment.pauseAfterMs) > 0) requiredControls.add('pause_after');
    if (arrayLength(segment.nonVerbalsBefore) + arrayLength(segment.nonVerbalsAfter) > 0)
      requiredControls.add('nonverbal');
    if (segment.deliveryMode !== 'DEFAULT') requiredControls.add('delivery_mode');
    for (const control of requiredControls) {
      const found = controlEvidence.some((entry) => {
        const record = asRecord(entry);
        return (
          record?.control === control &&
          Array.isArray(record.evidence) &&
          record.evidence.length > 0
        );
      });
      if (!found) {
        hardFailures.push(issue('invalid_control_provenance', id, { control }));
        warnings.push(issue('missing_control_evidence', id, { control }, 'warning'));
      }
    }
  }
  for (const sourceId of sourceIds) {
    if (!seen.has(sourceId)) hardFailures.push(issue('missing_source_segment', sourceId));
  }
  return { hardFailures, warnings };
}

function collectBasisReferences(overall: Record<string, unknown>, envelopes: unknown[]): string[] {
  const references = Array.isArray(overall.basis)
    ? overall.basis.filter((value): value is string => typeof value === 'string')
    : [];
  for (const envelope of envelopes) {
    const baseline = asRecord(asRecord(envelope)?.baselineDirection);
    if (!Array.isArray(baseline?.basis)) continue;
    references.push(
      ...baseline.basis.filter((value): value is string => typeof value === 'string'),
    );
  }
  return references;
}

function candidateBasisIsGrounded(
  prepared: PreparedStudyTextSynthesis,
  reference: string,
): boolean {
  if (reference === 'frontmatter:title') return Boolean(prepared.performanceSource?.title);
  if (reference === 'frontmatter:topic')
    return (prepared.performanceSource?.topics.length ?? 0) > 0;
  if (reference === 'frontmatter:study_text_type') return Boolean(prepared.performanceSource);
  if (reference.startsWith('segment:')) {
    return prepared.segments.some((segment) => segment.id === reference.slice('segment:'.length));
  }
  const match = /^speaker_profile:([^:]+):(role|persona|voice_direction)$/u.exec(reference);
  if (!match) return false;
  const profile = prepared.performanceSource?.speakerProfiles.find(
    (candidate) => candidate.id.toLocaleLowerCase() === match[1]!.toLocaleLowerCase(),
  );
  return Boolean(profile?.[match[2] as 'role' | 'persona' | 'voice_direction']);
}

function validateCandidateEvidence(
  prepared: PreparedStudyTextSynthesis,
  currentId: string,
  currentIndex: number,
  evidence: unknown[],
  hardFailures: SpeechPlanQualityIssue[],
): void {
  for (const value of evidence) {
    const entry = asRecord(value);
    const referencedIndex = prepared.segments.findIndex(
      (segment) => segment.id === entry?.segmentId,
    );
    if (
      !entry ||
      typeof entry.quote !== 'string' ||
      referencedIndex < 0 ||
      (entry.kind === 'authored_substring' && entry.segmentId !== currentId) ||
      (entry.kind === 'adjacent_segment' && Math.abs(referencedIndex - currentIndex) !== 1) ||
      (entry.kind !== 'authored_substring' && entry.kind !== 'adjacent_segment') ||
      !prepared.segments[referencedIndex]!.text.toLocaleLowerCase().includes(
        entry.quote.toLocaleLowerCase(),
      )
    ) {
      hardFailures.push(issue('invalid_evidence_reference', currentId));
    }
  }
}

export function analyzeValidatedSpeechPlan(
  prepared: PreparedStudyTextSynthesis,
  plan: SpeechPerformancePlan,
  renderedSegments: readonly RenderedSpeechSegmentSummary[] = [],
): ValidatedSpeechPlanAnalysis {
  const hardFailures: SpeechPlanQualityIssue[] = [];
  const warnings: SpeechPlanQualityIssue[] = [];
  const capabilities = getTtsModelCapabilities(plan.provider, plan.model);
  const renderedById = new Map(renderedSegments.map((segment) => [segment.id, segment]));
  const deliveryModeCounts: Record<string, number> = {};
  const pauseValuesMs: number[] = [];
  let paceCount = 0;
  let nonverbalCount = 0;
  let emphasisCount = 0;
  let freeFormDirectionCount = 0;
  let instructionCount = 0;
  let nonDefaultDeliveryModeCount = 0;
  let cueCount = 0;

  for (let index = 0; index < plan.segments.length; index += 1) {
    const segment = plan.segments[index]!;
    const source = prepared.segments[index];
    if (!source || segment.id !== source.id || segment.text !== source.text) {
      hardFailures.push(issue('authored_words_changed', segment.id));
    }
    if (source && containsUnsafeMarkupDelimiter(source.text)) {
      hardFailures.push(issue('authored_markup_delimiter', segment.id));
    }
    const effectiveDirection = resolveEffectiveSpeechDirection(plan, segment);
    if (plan.schemaVersion === 2 && effectiveDirection.instruction) {
      instructionCount += 1;
      cueCount += 1;
      try {
        normalizeSpeechCueText('freeFormDirection', effectiveDirection.instruction);
      } catch (error) {
        hardFailures.push(cueTextIssue(error, segment.id, 'freeFormDirection'));
      }
      if (!capabilities.naturalLanguageSteering) {
        hardFailures.push(issue('unsupported_free_form_direction', segment.id));
      }
    }
    for (const field of ['emotion', 'intonation', 'freeFormDirection'] as const) {
      const value = segment[field];
      if (!value) continue;
      try {
        normalizeSpeechCueText(field, value);
      } catch (error) {
        hardFailures.push(cueTextIssue(error, segment.id, field));
      }
    }
    const hasMetadata = Boolean(segment.emotion || segment.intonation);
    if (hasMetadata && !capabilities.metadataInstructions) {
      hardFailures.push(issue('unsupported_metadata_instruction', segment.id));
    }
    if (segment.freeFormDirection) {
      freeFormDirectionCount += 1;
      cueCount += 1;
      if (!capabilities.naturalLanguageSteering) {
        hardFailures.push(issue('unsupported_free_form_direction', segment.id));
      }
      if (hasMetadata)
        warnings.push(issue('redundant_instruction_components', segment.id, {}, 'warning'));
    }
    if (segment.pace && (plan.schemaVersion === 1 || segment.pace !== 'natural')) {
      paceCount += 1;
      cueCount += 1;
      if (!capabilities.speakingRate) hardFailures.push(issue('unsupported_pace', segment.id));
    }
    const pauses = [segment.pauseBeforeMs, segment.pauseAfterMs].filter(
      (value): value is number => value !== undefined && (plan.schemaVersion === 1 || value > 0),
    );
    pauseValuesMs.push(...pauses);
    cueCount += pauses.length;
    if (pauses.some((value) => value > 1000)) {
      hardFailures.push(issue('planner_pause_exceeds_cap', segment.id));
    }
    if (pauses.length && !capabilities.ssmlBreaks) {
      hardFailures.push(issue('unsupported_pause', segment.id));
    }
    const segmentNonverbals =
      (segment.nonVerbalsBefore?.length ?? 0) + (segment.nonVerbalsAfter?.length ?? 0);
    nonverbalCount += segmentNonverbals;
    cueCount += segmentNonverbals;
    if (segmentNonverbals > 1) {
      hardFailures.push(issue('planner_nonverbal_cap_exceeded', segment.id));
    }
    if (segmentNonverbals && !capabilities.nonVerbals) {
      hardFailures.push(issue('unsupported_nonverbal', segment.id));
    }
    const segmentEmphasis = segment.emphasis?.length ?? 0;
    emphasisCount += segmentEmphasis;
    cueCount += segmentEmphasis;
    if (segmentEmphasis && !capabilities.uppercaseEmphasis) {
      hardFailures.push(issue('unsupported_uppercase_emphasis', segment.id));
    }
    if (segment.deliveryMode && (plan.schemaVersion === 1 || segment.deliveryMode !== 'BALANCED')) {
      deliveryModeCounts[segment.deliveryMode] =
        (deliveryModeCounts[segment.deliveryMode] ?? 0) + 1;
      if (plan.schemaVersion === 2) nonDefaultDeliveryModeCount += 1;
      cueCount += 1;
      if (!capabilities.deliveryModes?.includes(segment.deliveryMode)) {
        hardFailures.push(issue('unsupported_delivery_mode', segment.id));
      }
    }
    if (hasMetadata)
      cueCount += Number(Boolean(segment.emotion)) + Number(Boolean(segment.intonation));
    if (segment.pace && segment.pace !== 'natural' && (segment.emphasis?.length ?? 0) > 0) {
      warnings.push(issue('pace_with_emphasis', segment.id, {}, 'warning'));
    }
    if (effectiveCueCountForSegment(plan, segment) > 5)
      warnings.push(issue('high_cue_density', segment.id, {}, 'warning'));

    if (renderedSegments.length > 0) {
      const rendered = renderedById.get(segment.id);
      if (!rendered) {
        hardFailures.push(issue('segment_not_rendered', segment.id));
      } else {
        if (containsUnsafeMarkupDelimiter(rendered.lexicalText)) {
          hardFailures.push(issue('rendered_markup_delimiter', segment.id));
        }
        if (
          renderedLexicalSignature(rendered.lexicalText) !==
          authoredLexicalSignature(source?.text ?? '')
        ) {
          hardFailures.push(issue('rendered_words_changed', segment.id));
        }
        const instructionCount =
          rendered.leadingInstructionTagCount ?? countLeadingInstructionTags(rendered.text);
        if (instructionCount > 1) {
          hardFailures.push(
            issue('leading_instruction_tag_count_exceeded', segment.id, {
              count: instructionCount,
            }),
          );
        }
      }
    }
  }

  if (plan.schemaVersion === 2) {
    for (let index = 1; index < plan.segments.length; index += 1) {
      const previous = plan.segments[index - 1]!.pace;
      const current = plan.segments[index]!.pace;
      if (
        (previous === 'slow' && current === 'brisk') ||
        (previous === 'brisk' && current === 'slow')
      ) {
        warnings.push(
          issue('abrupt_adjacent_pace_change', plan.segments[index]!.id, {}, 'warning'),
        );
      }
    }
    const bySpeaker = new Map<string, typeof plan.segments>();
    for (const segment of plan.segments) {
      const speaker =
        segment.speaker ??
        (plan.resolvedPerformanceMode === 'monologue'
          ? plan.performanceContext.speakerEnvelopes[0]?.speaker
          : undefined);
      if (!speaker) continue;
      const key = speaker.toLocaleLowerCase();
      bySpeaker.set(key, [...(bySpeaker.get(key) ?? []), segment]);
    }
    for (const turns of bySpeaker.values()) {
      if (turns.length >= 2 && turns.every((turn) => turn.turnAdjustment)) {
        warnings.push(
          issue('excessive_same_speaker_changes', turns[0]!.id, { turns: turns.length }, 'warning'),
        );
      }
    }
  }

  return {
    hardFailures,
    warnings,
    metrics: {
      segmentCount: plan.segments.length,
      paceCount,
      pauseCount: pauseValuesMs.length,
      pauseValuesMs,
      nonverbalCount,
      emphasisCount,
      freeFormDirectionCount,
      instructionCount,
      nonDefaultDeliveryModeCount,
      deliveryModeCounts,
      cueCount,
      cueRate: plan.segments.length > 0 ? cueCount / plan.segments.length : 0,
    },
  };
}

export function assertSpeechPlanSafeForSynthesis(analysis: SpeechPlanCandidateAnalysis): void {
  if (analysis.hardFailures.length === 0) return;
  const summary = analysis.hardFailures
    .map((failure) => `${failure.code}${failure.segmentId ? `:${failure.segmentId}` : ''}`)
    .join(',');
  throw new ConfigurationError(`Speech plan is unsafe for synthesis (${summary}).`);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function issue(
  code: string,
  segmentId?: string,
  detail?: Record<string, string | number | boolean>,
  severity: SpeechPlanQualityIssue['severity'] = 'hard_failure',
): SpeechPlanQualityIssue {
  return {
    severity,
    code,
    ...(segmentId ? { segmentId } : {}),
    ...(detail && Object.keys(detail).length > 0 ? { detail } : {}),
  };
}

function cueTextIssue(
  error: unknown,
  segmentId: string,
  field: SpeechCueTextField,
): SpeechPlanQualityIssue {
  if (error instanceof SpeechCueTextValidationError) {
    return issue(error.issueCode, segmentId, error.issueDetail);
  }
  return issue('unsafe_cue_text', segmentId, { field });
}

function effectiveCueCountForSegment(
  plan: SpeechPerformancePlan,
  segment: SpeechPerformancePlanSegment,
): number {
  if (plan.schemaVersion === 2) {
    return (
      Number(Boolean(resolveEffectiveSpeechDirection(plan, segment).instruction)) +
      Number(Boolean(segment.pace && segment.pace !== 'natural')) +
      (segment.emphasis?.length ?? 0) +
      Number((segment.pauseBeforeMs ?? 0) > 0) +
      Number((segment.pauseAfterMs ?? 0) > 0) +
      (segment.nonVerbalsBefore?.length ?? 0) +
      (segment.nonVerbalsAfter?.length ?? 0) +
      Number(Boolean(segment.deliveryMode && segment.deliveryMode !== 'BALANCED'))
    );
  }
  return (
    Number(Boolean(segment.emotion)) +
    Number(Boolean(segment.intonation)) +
    Number(Boolean(segment.pace)) +
    (segment.emphasis?.length ?? 0) +
    Number(segment.pauseBeforeMs !== undefined) +
    Number(segment.pauseAfterMs !== undefined) +
    (segment.nonVerbalsBefore?.length ?? 0) +
    (segment.nonVerbalsAfter?.length ?? 0) +
    Number(Boolean(segment.deliveryMode)) +
    Number(Boolean(segment.freeFormDirection))
  );
}

function countLeadingInstructionTags(text: string): number {
  let remaining = text.trimStart();
  let count = 0;
  while (remaining.startsWith('[')) {
    const end = remaining.indexOf(']');
    if (end < 0) break;
    count += 1;
    remaining = remaining.slice(end + 1).trimStart();
  }
  return count;
}

function authoredLexicalSignature(text: string): string {
  const withoutMarkdownStructure = text
    .normalize('NFC')
    .replace(/^\s*#{1,6}\s+/u, '')
    .replace(/^\s*>\s?/u, '')
    .replace(/^\s*[-*+]\s+/u, '')
    .replace(/^\s*\d+[.)]\s+/u, '')
    .replace(/!\[(.*?)\]\([^)]*\)/gu, '$1')
    .replace(/\[(.+?)\]\((.+?)\)/gu, '$1')
    .replace(/<[^>]+>/gu, '')
    .replace(/\*\*(.+?)\*\*/gu, '$1')
    .replace(/__(.+?)__/gu, '$1')
    .replace(/\*(.+?)\*/gu, '$1')
    .replace(/_([^_]+)_/gu, '$1')
    .replace(/~~(.+?)~~/gu, '$1')
    .replace(/`{1,3}([^`]+)`{1,3}/gu, '$1');
  return renderedLexicalSignature(withoutMarkdownStructure);
}

function renderedLexicalSignature(text: string): string {
  return text.normalize('NFC').toLocaleLowerCase().replaceAll(/\s+/gu, ' ').trim();
}
