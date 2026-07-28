import { ConfigurationError } from '@esl-pipeline/contracts';

import { getTtsModelCapabilities } from './descriptors.js';
import type {
  PreparedStudyTextSynthesis,
  SpeechPerformancePlan,
  SpeechPerformancePlanSegment,
} from './types.js';

const SAFE_CUE_TEXT = /^[\p{L}\p{N}\p{M}\p{Zs},.!?;:'"()–—-]+$/u;
const UNSAFE_MARKUP_DELIMITERS = new Set(['[', ']', '<', '>', '{', '}']);

export type SpeechCueTextField = 'emotion' | 'intonation' | 'freeFormDirection';

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
    throw new ConfigurationError(`${field} contains a control character or newline.`);
  }
  if ([...normalized].some((character) => UNSAFE_MARKUP_DELIMITERS.has(character))) {
    throw new ConfigurationError(`${field} contains an unsafe markup delimiter.`);
  }
  const compact = normalized.trim().replaceAll(/\s+/gu, ' ');
  const maximum = field === 'freeFormDirection' ? 200 : 80;
  if ([...compact].length > maximum) {
    throw new ConfigurationError(`${field} must not exceed ${maximum} code points.`);
  }
  if (compact && !SAFE_CUE_TEXT.test(compact)) {
    throw new ConfigurationError(`${field} contains an unsupported character.`);
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

export function analyzeSpeechPlanCandidate(
  prepared: PreparedStudyTextSynthesis,
  candidate: unknown,
): SpeechPlanCandidateAnalysis {
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
      } catch {
        hardFailures.push(issue('unsafe_cue_text', id, { field }));
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
  let cueCount = 0;

  for (let index = 0; index < plan.segments.length; index += 1) {
    const segment = plan.segments[index]!;
    const source = prepared.segments[index];
    if (!source || segment.id !== source.id || segment.text !== source.text) {
      hardFailures.push(issue('authored_words_changed', segment.id));
    }
    for (const field of ['emotion', 'intonation', 'freeFormDirection'] as const) {
      const value = segment[field];
      if (!value) continue;
      try {
        normalizeSpeechCueText(field, value);
      } catch {
        hardFailures.push(issue('unsafe_cue_text', segment.id, { field }));
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
    if (segment.pace) {
      paceCount += 1;
      cueCount += 1;
      if (!capabilities.speakingRate) hardFailures.push(issue('unsupported_pace', segment.id));
    }
    const pauses = [segment.pauseBeforeMs, segment.pauseAfterMs].filter(
      (value): value is number => value !== undefined,
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
    if (segment.deliveryMode) {
      deliveryModeCounts[segment.deliveryMode] =
        (deliveryModeCounts[segment.deliveryMode] ?? 0) + 1;
      cueCount += 1;
      if (!capabilities.deliveryModes?.includes(segment.deliveryMode)) {
        hardFailures.push(issue('unsupported_delivery_mode', segment.id));
      }
    }
    if (hasMetadata)
      cueCount += Number(Boolean(segment.emotion)) + Number(Boolean(segment.intonation));
    if (cueCountForSegment(segment) > 5)
      warnings.push(issue('high_cue_density', segment.id, {}, 'warning'));

    if (renderedSegments.length > 0) {
      const rendered = renderedById.get(segment.id);
      if (!rendered) {
        hardFailures.push(issue('segment_not_rendered', segment.id));
      } else {
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

function cueCountForSegment(segment: SpeechPerformancePlanSegment): number {
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
