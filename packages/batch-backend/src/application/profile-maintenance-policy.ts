import { createHash } from 'node:crypto';

import type { ProfileMaintenanceField } from '@esl-pipeline/contracts';

import type { StudentFact } from '../domain/lesson-memory-model.js';
import {
  classifyStudentProfileCandidateTargetSection,
  isTransientStudentProfileFact,
} from './student-profile-candidate-facts.js';

export interface ProfileFactSource {
  id: string;
  sourceLessonId: string | null;
  sourceLessonStartedAt: string | null;
  sourceContentHash: string;
  facts: StudentFact[];
}

export interface MaintenanceAddition {
  field: ProfileMaintenanceField;
  value: string;
  factKey: string;
  sources: ProfileFactSource[];
}

export function normalizeMaintenanceFact(value: string): string {
  return value.normalize('NFC').toLowerCase().replaceAll(/\s+/g, ' ').trim();
}

export function maintenanceFactKey(field: string, value: string): string {
  return createHash('sha256')
    .update(`deterministic_v1:${field}:${normalizeMaintenanceFact(value)}`)
    .digest('hex');
}

export function maintenanceField(target: string): ProfileMaintenanceField | null {
  switch (target) {
    case 'work_communication_context':
      return 'communicationContexts';
    case 'interests_personal_context':
      return 'interestsAndUsefulThemes';
    case 'learning_preferences_study_habits':
      return 'studyPreferences';
    case 'long_running_strengths':
      return 'stableStrengths';
    default:
      return null;
  }
}

/** Each observation qualifies independently; aggregated candidate confidence is not authority. */
export function deriveMaintenanceAdditions(
  sources: ProfileFactSource[],
  selectedSourceIds: readonly string[],
): MaintenanceAddition[] {
  const groups = new Map<
    string,
    { addition: MaintenanceAddition; direct: boolean; selected: boolean }
  >();
  for (const source of sources) {
    for (const fact of source.facts) {
      // The review classifier prioritizes broad preference words (e.g. "homework")
      // ahead of constraints. Automatic writes must exclude the ambiguity first.
      if (
        /\b(goal|motivation|wants?|aims?|constraints?|challenges?|limited time|struggles?|difficulty|under pressure|teacher notes?|cefr|level)\b/i.test(
          `${fact.category} ${fact.fact}`,
        )
      )
        continue;
      const target = classifyStudentProfileCandidateTargetSection(fact);
      const field = target ? maintenanceField(target) : null;
      if (
        !field ||
        fact.confidence !== 'high' ||
        fact.reviewNeeded ||
        !fact.fact.trim() ||
        isTransientStudentProfileFact(fact.fact)
      )
        continue;
      if (!fact.evidence.some((e) => e.quote.trim())) continue;
      const direct =
        fact.authority === 'student_stated'
          ? fact.evidence.some((e) => e.quote.trim() && e.speakerRole === 'student')
          : fact.authority === 'teacher_confirmed' &&
            fact.evidence.some((e) => e.quote.trim() && e.speakerRole === 'teacher');
      const key = maintenanceFactKey(field, fact.fact);
      const group = groups.get(key) ?? {
        addition: { field, value: fact.fact.trim(), factKey: key, sources: [] },
        direct: false,
        selected: false,
      };
      // Freeze just this observation, not unrelated facts from the source.
      group.addition.sources.push({ ...source, facts: [fact] });
      group.direct ||= direct;
      group.selected ||= selectedSourceIds.includes(source.id);
      groups.set(key, group);
    }
  }
  return [...groups.values()]
    .filter(({ addition, direct, selected }) => {
      const independentLessons = new Set(
        addition.sources
          .filter((s) => s.sourceLessonId && s.sourceLessonStartedAt)
          .map((s) => s.sourceLessonId),
      );
      return (
        selected &&
        (addition.field === 'stableStrengths'
          ? independentLessons.size >= 2
          : direct || independentLessons.size >= 2)
      );
    })
    .map(({ addition }) => addition);
}
