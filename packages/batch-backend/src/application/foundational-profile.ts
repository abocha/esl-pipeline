export const FOUNDATIONAL_PROFILE_SCHEMA_VERSION = 'foundational_profile_v1';

export interface FoundationalProfile {
  schemaVersion: typeof FOUNDATIONAL_PROFILE_SCHEMA_VERSION;
  overallLevel: string | null;
  primaryGoals: string[];
  communicationContexts: string[];
  interestsAndUsefulThemes: string[];
  stableStrengths: string[];
  persistentChallenges: string[];
  studyPreferences: string[];
  durableConstraints: string[];
  teacherNotes: string | null;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return value ?? null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeList(values: readonly string[]): string[] {
  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export function normalizeFoundationalProfile(
  profile: FoundationalProfile,
): FoundationalProfile {
  return {
    schemaVersion: FOUNDATIONAL_PROFILE_SCHEMA_VERSION,
    overallLevel: normalizeOptionalText(profile.overallLevel),
    primaryGoals: normalizeList(profile.primaryGoals),
    communicationContexts: normalizeList(profile.communicationContexts),
    interestsAndUsefulThemes: normalizeList(profile.interestsAndUsefulThemes),
    stableStrengths: normalizeList(profile.stableStrengths),
    persistentChallenges: normalizeList(profile.persistentChallenges),
    studyPreferences: normalizeList(profile.studyPreferences),
    durableConstraints: normalizeList(profile.durableConstraints),
    teacherNotes: normalizeOptionalText(profile.teacherNotes),
  };
}

export function splitStructuredProfileItems(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/^[-*]\s+/, '').trim())
    .filter((line) => line.length > 0);
}
