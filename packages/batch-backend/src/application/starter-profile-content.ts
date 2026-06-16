import {
  FOUNDATIONAL_PROFILE_SCHEMA_VERSION,
  type FoundationalProfile,
  normalizeFoundationalProfile,
  splitStructuredProfileItems,
} from './foundational-profile.js';

export interface StarterProfileInput {
  overallLevel?: string | null;
  primaryGoals?: string | null;
  communicationContexts?: string | null;
  interestsAndUsefulThemes?: string | null;
  stableStrengths?: string | null;
  persistentChallenges?: string | null;
  studyPreferences?: string | null;
  durableConstraints?: string | null;
  teacherNotes?: string | null;
  /**
   * Legacy compact starter-profile aliases accepted for compatibility.
   * New public write paths should use the canonical foundational fields above.
   */
  level?: string | null;
  goals?: string | null;
  professionOrContext?: string | null;
  interests?: string | null;
  longRunningChallenges?: string | null;
  studyPreferencesOrConstraints?: string | null;
}

export interface NormalizedStarterProfileInput {
  overallLevel: string | null;
  primaryGoals: string;
  communicationContexts: string;
  interestsAndUsefulThemes: string;
  stableStrengths: string;
  persistentChallenges: string;
  studyPreferences: string;
  durableConstraints: string;
  teacherNotes: string | null;
}

function normalizeTextBlock(value?: string | null): string {
  if (typeof value !== 'string') {
    return '';
  }

  const normalized = value
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();

  return normalized;
}

function normalizeOptionalField(value?: string | null): string | null {
  if (typeof value !== 'string') {
    return value ?? null;
  }

  const normalized = value
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();

  return normalized.length > 0 ? normalized : null;
}

export function normalizeStarterProfileInput(
  input: StarterProfileInput,
): NormalizedStarterProfileInput {
  return {
    overallLevel: normalizeOptionalField(input.overallLevel ?? input.level),
    primaryGoals: normalizeTextBlock(input.primaryGoals ?? input.goals),
    communicationContexts: normalizeTextBlock(
      input.communicationContexts ?? input.professionOrContext,
    ),
    interestsAndUsefulThemes: normalizeTextBlock(input.interestsAndUsefulThemes ?? input.interests),
    stableStrengths: normalizeTextBlock(input.stableStrengths),
    persistentChallenges: normalizeTextBlock(
      input.persistentChallenges ?? input.longRunningChallenges,
    ),
    studyPreferences: normalizeTextBlock(
      input.studyPreferences ?? input.studyPreferencesOrConstraints,
    ),
    durableConstraints: normalizeTextBlock(input.durableConstraints),
    teacherNotes: normalizeOptionalField(input.teacherNotes),
  };
}

function renderMultilineBlock(text: string): string[] {
  return text.split('\n').map((line) => (line.trim().length > 0 ? line : ''));
}

function renderStarterSectionLines(text: string, emptyMessage: string): string[] {
  return text.length > 0 ? renderMultilineBlock(text) : [emptyMessage];
}

export function renderStarterProfileContent(args: {
  studentName: string;
  starterProfile: StarterProfileInput;
}): string {
  const normalized = normalizeStarterProfileInput(args.starterProfile);
  const level = normalized.overallLevel ?? 'Unknown';
  const teacherNotesLines = normalized.teacherNotes
    ? renderMultilineBlock(normalized.teacherNotes)
    : ['No additional teacher-authored notes yet.'];

  return [
    `# Foundational Student Profile: ${args.studentName}`,
    `**Profile Origin:** Starter profile form | **Current Level:** ${level}`,
    '',
    '## 1. Goals And Motivation',
    ...renderStarterSectionLines(normalized.primaryGoals, 'No durable goals recorded yet.'),
    '',
    '## 2. Communication Contexts',
    ...renderStarterSectionLines(
      normalized.communicationContexts,
      'No durable communication contexts recorded yet.',
    ),
    '',
    '## 3. Interests And Useful Themes',
    ...renderStarterSectionLines(
      normalized.interestsAndUsefulThemes,
      'No engagement themes recorded yet.',
    ),
    '',
    '## 4. Stable Strengths',
    ...renderStarterSectionLines(normalized.stableStrengths, 'No stable strengths recorded yet.'),
    '',
    '## 5. Persistent Challenges',
    ...renderStarterSectionLines(
      normalized.persistentChallenges,
      'No persistent challenges recorded yet.',
    ),
    '',
    '## 6. Study Preferences',
    ...renderStarterSectionLines(normalized.studyPreferences, 'No study preferences recorded yet.'),
    '',
    '## 7. Durable Constraints',
    ...renderStarterSectionLines(
      normalized.durableConstraints,
      'No durable constraints recorded yet.',
    ),
    '',
    '## 8. Teacher Notes',
    ...teacherNotesLines,
    '',
    '## 9. Profile Governance Notes',
    '- This is the teacher-authored foundational profile baseline for this student.',
    '- Recent lesson continuity, homework continuity, and unresolved short-term issues belong in canonical student memory rather than this profile.',
  ].join('\n');
}

export function buildStarterProfileStructuredContent(
  starterProfile: StarterProfileInput,
): FoundationalProfile {
  const normalized = normalizeStarterProfileInput(starterProfile);

  return normalizeFoundationalProfile({
    schemaVersion: FOUNDATIONAL_PROFILE_SCHEMA_VERSION,
    overallLevel: normalized.overallLevel,
    primaryGoals: splitStructuredProfileItems(normalized.primaryGoals),
    communicationContexts: splitStructuredProfileItems(normalized.communicationContexts),
    interestsAndUsefulThemes: splitStructuredProfileItems(normalized.interestsAndUsefulThemes),
    stableStrengths: splitStructuredProfileItems(normalized.stableStrengths),
    persistentChallenges: splitStructuredProfileItems(normalized.persistentChallenges),
    studyPreferences: splitStructuredProfileItems(normalized.studyPreferences),
    durableConstraints: splitStructuredProfileItems(normalized.durableConstraints),
    teacherNotes: normalized.teacherNotes,
  });
}
