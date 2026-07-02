import type { StudentFact } from '../domain/lesson-memory-model.js';
import type { StudentProfileCandidateTargetSection } from '../domain/student-profile-candidate-model.js';

export function classifyStudentProfileCandidateTargetSection(
  fact: Pick<StudentFact, 'category' | 'fact'>,
): StudentProfileCandidateTargetSection | null {
  const haystack = `${fact.category} ${fact.fact}`.toLowerCase();

  if (
    matchesAny(haystack, [
      'goal',
      'motivat',
      'wants to',
      'wants',
      'aims to',
      'needs english',
      'career transition',
    ])
  ) {
    return 'goals_motivation';
  }
  if (
    matchesAny(haystack, [
      'prefers',
      'benefits from',
      'study habit',
      'study preference',
      'practices',
      'one-take',
      'notebook',
      'chatgpt',
      'methodical',
      'logical',
      'formula',
      'homework',
      'checklist',
    ])
  ) {
    return 'learning_preferences_study_habits';
  }
  if (
    matchesAny(haystack, [
      'challenge',
      'constraint',
      'struggles',
      'difficulty',
      'under pressure',
      'perfectionist',
      'limited time',
      'persistent',
      'tends to',
    ])
  ) {
    return 'persistent_challenges_constraints';
  }
  if (
    matchesAny(haystack, [
      'profession',
      'job',
      'work',
      'client',
      'meeting',
      'colleague',
      'career',
      'communication context',
    ])
  ) {
    return 'work_communication_context';
  }
  if (
    matchesAny(haystack, [
      'hobby',
      'interest',
      'likes',
      'family',
      'location',
      'lives in',
      'personal',
      'routine',
    ])
  ) {
    return 'interests_personal_context';
  }
  if (
    matchesAny(haystack, [
      'strength',
      'strong at',
      'responds well',
      'retains',
      'comfortable with',
      'benefits from structured',
    ])
  ) {
    return 'long_running_strengths';
  }

  return null;
}

export function buildStudentProfileCandidateKey(
  targetSection: StudentProfileCandidateTargetSection,
  fact: string,
): string {
  return `${targetSection}:${normalizeProfileFactText(fact)}`;
}

export function normalizeProfileFactText(fact: string): string {
  return fact
    .toLowerCase()
    .replaceAll(/[^a-z0-9\s]/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

export function isTransientStudentProfileFact(fact: string): boolean {
  return /\b(today|this lesson|tonight|yesterday|last lesson|this week|recently)\b/i.test(fact);
}

export function isProfileWorthyStudentFact(fact: Pick<StudentFact, 'category' | 'fact'>): boolean {
  return (
    classifyStudentProfileCandidateTargetSection(fact) !== null &&
    !isTransientStudentProfileFact(fact.fact)
  );
}

export function isDurablePreferenceOrConstraintFact(
  fact: Pick<StudentFact, 'category' | 'fact'>,
): boolean {
  const targetSection = classifyStudentProfileCandidateTargetSection(fact);
  return (
    targetSection === 'learning_preferences_study_habits' ||
    targetSection === 'persistent_challenges_constraints'
  );
}

function matchesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => {
    if (/^[a-z0-9]+$/i.test(needle)) {
      return new RegExp(`\\b${needle}\\b`, 'i').test(haystack);
    }
    return haystack.includes(needle);
  });
}
