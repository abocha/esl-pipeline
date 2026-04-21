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

function renderSectionLines(values: readonly string[], emptyMessage: string): string[] {
  return values.length > 0 ? values.map((value) => `- ${value}`) : [`- ${emptyMessage}`];
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return value ?? null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeList(values: readonly string[]): string[] {
  return values.map((value) => value.trim()).filter((value) => value.length > 0);
}

export function normalizeFoundationalProfile(profile: FoundationalProfile): FoundationalProfile {
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

export function createEmptyFoundationalProfile(): FoundationalProfile {
  return {
    schemaVersion: FOUNDATIONAL_PROFILE_SCHEMA_VERSION,
    overallLevel: null,
    primaryGoals: [],
    communicationContexts: [],
    interestsAndUsefulThemes: [],
    stableStrengths: [],
    persistentChallenges: [],
    studyPreferences: [],
    durableConstraints: [],
    teacherNotes: null,
  };
}

export function renderFoundationalProfileContent(profile: FoundationalProfile): string {
  const normalized = normalizeFoundationalProfile(profile);
  const level = normalized.overallLevel ?? 'Unknown';
  const teacherNotesLines = normalized.teacherNotes
    ? normalized.teacherNotes.split('\n').map((line) => line.trimEnd())
    : ['No additional teacher notes yet.'];

  return [
    '# Foundational Profile',
    `**Current Level:** ${level}`,
    '',
    '## Goals & Motivation',
    ...renderSectionLines(normalized.primaryGoals, 'No durable goals recorded yet.'),
    '',
    '## Communication Contexts',
    ...renderSectionLines(
      normalized.communicationContexts,
      'No durable communication contexts recorded yet.',
    ),
    '',
    '## Interests & Useful Themes',
    ...renderSectionLines(
      normalized.interestsAndUsefulThemes,
      'No engagement themes recorded yet.',
    ),
    '',
    '## Stable Strengths',
    ...renderSectionLines(normalized.stableStrengths, 'No stable strengths recorded yet.'),
    '',
    '## Persistent Challenges',
    ...renderSectionLines(
      normalized.persistentChallenges,
      'No persistent challenges recorded yet.',
    ),
    '',
    '## Study Preferences',
    ...renderSectionLines(normalized.studyPreferences, 'No study preferences recorded yet.'),
    '',
    '## Durable Constraints',
    ...renderSectionLines(normalized.durableConstraints, 'No durable constraints recorded yet.'),
    '',
    '## Teacher Notes',
    ...teacherNotesLines,
  ].join('\n');
}
