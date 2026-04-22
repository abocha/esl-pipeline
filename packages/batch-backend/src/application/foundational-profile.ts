import { z } from 'zod';

export const FOUNDATIONAL_PROFILE_SCHEMA_VERSION = 'foundational_profile_v1';
export const FOUNDATIONAL_PROFILE_RESPONSE_SCHEMA_NAME = 'foundational_profile_v1';
export const FOUNDATIONAL_PROFILE_RESPONSE_SCHEMA_DESCRIPTION =
  'Canonical structured foundational learner profile for durable teaching context.';

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

const EMPTY_SECTION_MESSAGES = new Set([
  'No durable goals recorded yet.',
  'No durable communication contexts recorded yet.',
  'No engagement themes recorded yet.',
  'No stable strengths recorded yet.',
  'No persistent challenges recorded yet.',
  'No study preferences recorded yet.',
  'No durable constraints recorded yet.',
]);

const EMPTY_TEACHER_NOTE_MESSAGES = new Set([
  'No additional teacher notes yet.',
  'No additional teacher-authored notes yet.',
]);

const IGNORED_UNKNOWN_SECTION_HEADINGS = new Set(['profile governance notes']);

const FoundationalProfileSchema = z.object({
  schemaVersion: z.literal(FOUNDATIONAL_PROFILE_SCHEMA_VERSION),
  overallLevel: z.string().nullable(),
  primaryGoals: z.array(z.string()),
  communicationContexts: z.array(z.string()),
  interestsAndUsefulThemes: z.array(z.string()),
  stableStrengths: z.array(z.string()),
  persistentChallenges: z.array(z.string()),
  studyPreferences: z.array(z.string()),
  durableConstraints: z.array(z.string()),
  teacherNotes: z.string().nullable(),
});

export const FOUNDATIONAL_PROFILE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'overallLevel',
    'primaryGoals',
    'communicationContexts',
    'interestsAndUsefulThemes',
    'stableStrengths',
    'persistentChallenges',
    'studyPreferences',
    'durableConstraints',
    'teacherNotes',
  ],
  properties: {
    schemaVersion: {
      type: 'string',
      const: FOUNDATIONAL_PROFILE_SCHEMA_VERSION,
    },
    overallLevel: {
      type: ['string', 'null'],
    },
    primaryGoals: {
      type: 'array',
      items: { type: 'string' },
    },
    communicationContexts: {
      type: 'array',
      items: { type: 'string' },
    },
    interestsAndUsefulThemes: {
      type: 'array',
      items: { type: 'string' },
    },
    stableStrengths: {
      type: 'array',
      items: { type: 'string' },
    },
    persistentChallenges: {
      type: 'array',
      items: { type: 'string' },
    },
    studyPreferences: {
      type: 'array',
      items: { type: 'string' },
    },
    durableConstraints: {
      type: 'array',
      items: { type: 'string' },
    },
    teacherNotes: {
      type: ['string', 'null'],
    },
  },
} as const satisfies Record<string, unknown>;

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

function normalizeHeadingLabel(line: string): string {
  return line
    .replace(/^##\s+/, '')
    .replace(/^\d+[.)]?\s+/, '')
    .replace(/&/g, 'and')
    .replace(/-/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function getStructuredSectionKey(
  heading: string,
):
  | 'primaryGoals'
  | 'communicationContexts'
  | 'interestsAndUsefulThemes'
  | 'stableStrengths'
  | 'persistentChallenges'
  | 'studyPreferences'
  | 'durableConstraints'
  | 'teacherNotes'
  | null {
  switch (heading) {
    case 'goals and motivation':
      return 'primaryGoals';
    case 'communication contexts':
    case 'work and communication context':
      return 'communicationContexts';
    case 'interests and useful themes':
    case 'interests and personal context':
      return 'interestsAndUsefulThemes';
    case 'stable strengths':
      return 'stableStrengths';
    case 'persistent challenges':
    case 'long running challenges':
      return 'persistentChallenges';
    case 'study preferences':
    case 'study preferences and constraints':
      return 'studyPreferences';
    case 'durable constraints':
      return 'durableConstraints';
    case 'teacher notes':
      return 'teacherNotes';
    default:
      return null;
  }
}

function normalizeParsedItems(lines: readonly string[]): string[] {
  return splitStructuredProfileItems(lines.join('\n')).filter(
    (item) => !EMPTY_SECTION_MESSAGES.has(item),
  );
}

function normalizeTeacherNotes(lines: readonly string[]): string | null {
  const normalized = lines
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();

  if (!normalized || EMPTY_TEACHER_NOTE_MESSAGES.has(normalized)) {
    return null;
  }

  return normalized;
}

export function deriveFoundationalProfileFromMarkdown(content: string): FoundationalProfile | null {
  const normalizedContent = content.trim();
  if (!normalizedContent) {
    return null;
  }

  const lines = normalizedContent.split('\n');
  const sectionBuckets = new Map<string, string[]>();
  const unknownSectionBlocks: string[] = [];
  let currentSection: ReturnType<typeof getStructuredSectionKey> = null;
  let currentUnknownSectionHeading: string | null = null;
  let currentUnknownSectionLines: string[] = [];

  function flushUnknownSection(): void {
    if (!currentUnknownSectionHeading) {
      currentUnknownSectionLines = [];
      return;
    }

    const block = [currentUnknownSectionHeading, ...currentUnknownSectionLines]
      .join('\n')
      .trim();
    if (block.length > 0) {
      unknownSectionBlocks.push(block);
    }

    currentUnknownSectionHeading = null;
    currentUnknownSectionLines = [];
  }

  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      flushUnknownSection();
      currentSection = getStructuredSectionKey(normalizeHeadingLabel(line));
      if (currentSection && !sectionBuckets.has(currentSection)) {
        sectionBuckets.set(currentSection, []);
      } else if (!currentSection) {
        const normalizedHeading = normalizeHeadingLabel(line);
        if (IGNORED_UNKNOWN_SECTION_HEADINGS.has(normalizedHeading)) {
          currentUnknownSectionHeading = null;
          continue;
        }
        currentUnknownSectionHeading = line.replace(/^##\s+/, '').trim();
      }
      continue;
    }

    if (currentUnknownSectionHeading) {
      currentUnknownSectionLines.push(line);
      continue;
    }

    if (!currentSection) {
      continue;
    }

    sectionBuckets.get(currentSection)?.push(line);
  }

  flushUnknownSection();

  const currentLevelMatch =
    normalizedContent.match(/\*\*Current Level:\*\*\s*([^\n|]+)/i) ??
    normalizedContent.match(/Current Level:\s*([^\n|]+)/i);
  const overallLevel = currentLevelMatch?.[1]?.trim() ?? null;
  const teacherNotesLines = [
    ...(sectionBuckets.get('teacherNotes') ?? []),
    ...(unknownSectionBlocks.length > 0 ? ['', ...unknownSectionBlocks] : []),
  ];

  const derived = normalizeFoundationalProfile({
    schemaVersion: FOUNDATIONAL_PROFILE_SCHEMA_VERSION,
    overallLevel: overallLevel && overallLevel.toLowerCase() !== 'unknown' ? overallLevel : null,
    primaryGoals: normalizeParsedItems(sectionBuckets.get('primaryGoals') ?? []),
    communicationContexts: normalizeParsedItems(sectionBuckets.get('communicationContexts') ?? []),
    interestsAndUsefulThemes: normalizeParsedItems(
      sectionBuckets.get('interestsAndUsefulThemes') ?? [],
    ),
    stableStrengths: normalizeParsedItems(sectionBuckets.get('stableStrengths') ?? []),
    persistentChallenges: normalizeParsedItems(sectionBuckets.get('persistentChallenges') ?? []),
    studyPreferences: normalizeParsedItems(sectionBuckets.get('studyPreferences') ?? []),
    durableConstraints: normalizeParsedItems(sectionBuckets.get('durableConstraints') ?? []),
    teacherNotes: normalizeTeacherNotes(teacherNotesLines),
  });

  const hasMeaningfulContent =
    Boolean(derived.overallLevel) ||
    derived.primaryGoals.length > 0 ||
    derived.communicationContexts.length > 0 ||
    derived.interestsAndUsefulThemes.length > 0 ||
    derived.stableStrengths.length > 0 ||
    derived.persistentChallenges.length > 0 ||
    derived.studyPreferences.length > 0 ||
    derived.durableConstraints.length > 0 ||
    Boolean(derived.teacherNotes);

  return hasMeaningfulContent ? derived : null;
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

function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }
  return trimmed;
}

function extractJsonObject(text: string): string {
  const stripped = stripJsonFences(text);
  const firstBrace = stripped.indexOf('{');
  const lastBrace = stripped.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return stripped;
  }
  return stripped.slice(firstBrace, lastBrace + 1);
}

export function parseFoundationalProfileJson(text: string): FoundationalProfile {
  const candidate = extractJsonObject(text);
  const parsed = JSON.parse(candidate) as unknown;
  return validateFoundationalProfileOutput(parsed);
}

export function validateFoundationalProfileOutput(output: unknown): FoundationalProfile {
  return normalizeFoundationalProfile(FoundationalProfileSchema.parse(output));
}
