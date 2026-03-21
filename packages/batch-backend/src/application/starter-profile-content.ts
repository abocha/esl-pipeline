export interface StarterProfileInput {
  level?: string | null;
  goals: string;
  professionOrContext: string;
  interests: string;
  longRunningChallenges: string;
  studyPreferencesOrConstraints: string;
  teacherNotes?: string | null;
}

export interface NormalizedStarterProfileInput {
  level: string | null;
  goals: string;
  professionOrContext: string;
  interests: string;
  longRunningChallenges: string;
  studyPreferencesOrConstraints: string;
  teacherNotes: string | null;
}

function normalizeRequiredField(value: string, fieldName: string): string {
  const normalized = value
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();

  if (!normalized) {
    throw new Error(`${fieldName} is required`);
  }

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
    level: normalizeOptionalField(input.level),
    goals: normalizeRequiredField(input.goals, 'starterProfile.goals'),
    professionOrContext: normalizeRequiredField(
      input.professionOrContext,
      'starterProfile.professionOrContext',
    ),
    interests: normalizeRequiredField(input.interests, 'starterProfile.interests'),
    longRunningChallenges: normalizeRequiredField(
      input.longRunningChallenges,
      'starterProfile.longRunningChallenges',
    ),
    studyPreferencesOrConstraints: normalizeRequiredField(
      input.studyPreferencesOrConstraints,
      'starterProfile.studyPreferencesOrConstraints',
    ),
    teacherNotes: normalizeOptionalField(input.teacherNotes),
  };
}

function renderMultilineBlock(text: string): string[] {
  return text.split('\n').map((line) => (line.trim().length > 0 ? line : ''));
}

export function renderStarterProfileContent(args: {
  studentName: string;
  starterProfile: StarterProfileInput;
}): string {
  const normalized = normalizeStarterProfileInput(args.starterProfile);
  const level = normalized.level ?? 'Unknown';
  const teacherNotesLines = normalized.teacherNotes
    ? renderMultilineBlock(normalized.teacherNotes)
    : ['No additional teacher-authored notes yet.'];

  return [
    `# Foundational Student Profile: ${args.studentName}`,
    `**Profile Origin:** Starter profile form | **Current Level:** ${level}`,
    '',
    '## 1. Goals And Motivation',
    ...renderMultilineBlock(normalized.goals),
    '',
    '## 2. Work And Communication Context',
    ...renderMultilineBlock(normalized.professionOrContext),
    '',
    '## 3. Interests And Personal Context',
    ...renderMultilineBlock(normalized.interests),
    '',
    '## 4. Long-Running Challenges',
    ...renderMultilineBlock(normalized.longRunningChallenges),
    '',
    '## 5. Study Preferences And Constraints',
    ...renderMultilineBlock(normalized.studyPreferencesOrConstraints),
    '',
    '## 6. Teacher Notes',
    ...teacherNotesLines,
    '',
    '## 7. Profile Governance Notes',
    '- This is the teacher-authored foundational profile baseline for this student.',
    '- Recent lesson continuity, homework continuity, and unresolved short-term issues belong in canonical student memory rather than this profile.',
  ].join('\n');
}
