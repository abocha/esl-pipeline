import { createHash } from 'node:crypto';

import type { StudentFact } from '../domain/lesson-memory-model.js';
import type { StudentMemorySnapshotRecord } from '../domain/student-memory-snapshot-model.js';
import {
  isDurablePreferenceOrConstraintFact,
  normalizeProfileFactText,
} from './student-profile-candidate-facts.js';

type SnapshotContentLike = Partial<
  Pick<
    StudentMemorySnapshotRecord,
    | 'stableStrengths'
    | 'recurringIssues'
    | 'activeReviewBacklog'
    | 'recentProgress'
    | 'personalFacts'
    | 'recommendedAssignmentDirections'
    | 'unresolvedIssues'
    | 'snapshotSummary'
  >
>;

export function hashStudentMemorySnapshotPersonalFacts(
  facts: readonly StudentFact[] | null | undefined,
): string {
  return sha256Stable((facts ?? []).map(normalizeStudentFact).sort(compareStableValues));
}

export function hashStudentMemorySnapshotDurablePreferencesConstraints(
  facts: readonly StudentFact[] | null | undefined,
): string {
  return sha256Stable(
    (facts ?? [])
      .filter(isDurablePreferenceOrConstraintFact)
      .map(normalizeStudentFact)
      .sort(compareStableValues),
  );
}

export function hashStudentMemorySnapshotContent(
  content: SnapshotContentLike | null | undefined,
): string {
  const normalized = {
    stableStrengths: normalizeLabeledNotes(content?.stableStrengths),
    recurringIssues: normalizeObjects(content?.recurringIssues),
    activeReviewBacklog: normalizeLabeledNotes(content?.activeReviewBacklog),
    recentProgress: normalizeLabeledNotes(content?.recentProgress),
    personalFacts: (content?.personalFacts ?? [])
      .map(normalizeStudentFact)
      .sort(compareStableValues),
    recommendedAssignmentDirections: normalizeObjects(content?.recommendedAssignmentDirections),
    unresolvedIssues: normalizeObjects(content?.unresolvedIssues),
    snapshotSummary: normalizeString(content?.snapshotSummary ?? ''),
  };
  return sha256Stable(normalized);
}

function normalizeStudentFact(fact: StudentFact): Record<string, unknown> {
  return {
    fact: normalizeProfileFactText(fact.fact),
    category: normalizeString(fact.category),
    authority: fact.authority,
    confidence: fact.confidence,
    reviewNeeded: Boolean(fact.reviewNeeded),
    evidence: normalizeObjects(fact.evidence),
  };
}

function normalizeLabeledNotes(
  values: readonly { label: string; note: string }[] | null | undefined,
): Record<string, unknown>[] {
  return (values ?? [])
    .map((value) => ({
      label: normalizeString(value.label),
      note: normalizeString(value.note),
    }))
    .sort(compareStableValues);
}

function normalizeObjects(values: readonly unknown[] | null | undefined): unknown[] {
  return (values ?? []).map(normalizeValue).sort(compareStableValues);
}

function normalizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return normalizeString(value);
  }
  if (Array.isArray(value)) {
    return value.map(normalizeValue).sort(compareStableValues);
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return Object.fromEntries(
      entries.map(([key, entryValue]) => [key, normalizeValue(entryValue)]),
    );
  }
  return value ?? null;
}

function normalizeString(value: string): string {
  return value.toLowerCase().replaceAll(/\s+/g, ' ').trim();
}

function sha256Stable(value: unknown): string {
  return createHash('sha256').update(stableStringify(value), 'utf8').digest('hex');
}

function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeValue(value));
}

function compareStableValues(left: unknown, right: unknown): number {
  return stableStringify(left).localeCompare(stableStringify(right));
}
