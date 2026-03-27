import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

import type {
  ContentSource,
  MarkdownValidationResponse,
  SpeakerProfile,
  StudyTextType,
  VoiceCapabilitiesSnapshot,
} from '@esl-pipeline/contracts';
import { normalizeSpeakerRole } from '@esl-pipeline/contracts';
import type {
  ParsedMarkdownContext,
  PmdBlock,
  PmdDirectiveBlock,
  PmdDirectiveLeaf,
  PmdHeading,
} from '@esl-pipeline/pmd';
import {
  extractPronunciationFocus,
  findDirectiveBlocks,
  parseMarkdownContext,
} from '@esl-pipeline/pmd';

export type GeneralEnglishValidateInput =
  | {
      path: string;
      strict?: boolean;
    }
  | {
      markdown: string;
      strict?: boolean;
      path?: string;
    }
  | {
      context: ParsedMarkdownContext;
      strict?: boolean;
      path?: string;
    };

interface ResolvedValidateInput {
  context: ParsedMarkdownContext;
  strict: boolean;
  path?: string;
}

export interface GeneralEnglishValidateOptions {
  strict?: boolean;
  /**
   * @deprecated Use validateMarkdown with `{ markdown: ... }` or `{ context: ... }`.
   */
  content?: string;
}

export type GeneralEnglishValidateResult = MarkdownValidationResponse;

const SpeakerProfileSchema = z
  .object({
    id: z.string().trim().min(1),
    display_name: z.string().trim().min(1).optional(),
    role: z.string().trim().min(1).optional(),
    gender: z.enum(['male', 'female', 'neutral', 'child']).optional(),
    age: z
      .enum(['child', 'teen', 'young', 'adult', 'middle_aged', 'senior', 'universal'])
      .optional(),
    accent: z.string().trim().min(1).optional(),
    style: z.string().trim().min(1).optional(),
    voice: z.string().trim().min(1).optional(),
  })
  .catchall(z.unknown());

const FrontInputTypeSchema = z.enum(['generate', 'authentic', 'dialogue', 'monologue']);
const StudyTextTypeSchema = z.enum(['monologue', 'dialogue']);

const FrontSchema = z.object({
  title: z.string().min(1),
  student: z.string().min(1),
  level: z.string().min(1),
  // Topic is always a single string (preprocess arrays to join with commas)
  topic: z.string().min(1),
  input_type: FrontInputTypeSchema,
  study_text_type: StudyTextTypeSchema.optional(),
  speaker_labels: z.array(z.string().trim().min(1)).optional(),
  // New fields for advanced Notion features
  icon: z.emoji().optional(),
  cover: z.url().optional(),
  properties: z.record(z.string(), z.unknown()).optional(),
  speaker_profiles: z.array(SpeakerProfileSchema).optional(),
});

type LegacyInputType = 'dialogue' | 'monologue';
type FrontInputType = ContentSource | LegacyInputType;
type ValidationMeta = NonNullable<GeneralEnglishValidateResult['meta']>;
type RawMeta = z.infer<typeof FrontSchema>;

interface VoiceCatalogLike {
  voices: { id?: string; name?: string; labels?: Record<string, unknown> }[];
  capabilities?: VoiceCapabilitiesSnapshot;
}

const DEFAULT_VOICES_PATH = 'packages/orchestrator/configs/elevenlabs.voices.json';
const WORKSPACE_MARKER = 'pnpm-workspace.yaml';
const CANONICAL_ROLES = ['narrator', 'teacher', 'student', 'system'] as const;
const CANONICAL_GENDERS = ['male', 'female', 'neutral', 'child'] as const;
const CANONICAL_AGES = [
  'child',
  'teen',
  'young',
  'adult',
  'middle_aged',
  'senior',
  'universal',
] as const;

interface HeadingRule {
  label: string;
  groups: string[][];
  minTokenHits?: number;
}

const H2_RULES: HeadingRule[] = [
  {
    label: "This Week's Mission Briefing",
    groups: [['mission', 'briefing', 'overview', 'summary', 'recap', 'lesson']],
  },
  {
    label: 'Your Homework Roadmap',
    groups: [['homework', 'assignment', 'roadmap', 'plan', 'overview']],
  },
  {
    label: 'Input Material: The Source',
    groups: [['input', 'material', 'source', 'text', 'story', 'reading', 'audio']],
  },
  {
    label: 'Language Toolkit: Useful Language',
    groups: [
      ['language', 'toolkit', 'tools', 'toolbox', 'grammar', 'useful', 'vocab', 'vocabulary'],
    ],
    minTokenHits: 2,
  },
  {
    label: 'Practice & Pronunciation',
    groups: [['practice', 'pronunciation', 'speaking', 'exercises']],
    minTokenHits: 2,
  },
  {
    label: 'Your Turn: Complete the Mission!',
    groups: [['your', 'turn', 'mission', 'task', 'story', 'practice', 'challenge']],
    minTokenHits: 2,
  },
  {
    label: 'Why This Mission Helps You',
    groups: [['why', 'benefit', 'benefits', 'help', 'helps', 'value', 'reason', 'purpose']],
    minTokenHits: 2,
  },
  {
    label: 'Answer Key & Sample Mission',
    groups: [['answer', 'answers', 'key', 'solutions', 'sample', 'example']],
    minTokenHits: 2,
  },
  {
    label: "Teacher's Follow-up Plan",
    groups: [
      [
        'teacher',
        'teachers',
        'tutor',
        'coach',
        'instructor',
        'follow',
        'followup',
        'plan',
        'next',
        'lesson',
      ],
    ],
    minTokenHits: 2,
  },
];

const NON_BLOCKING_WARNING_PREFIXES = [
  'Additional H2 sections after section 9 are ignored',
  'Controlled Practice has ',
  'Comprehension Check has ',
  'Missing "### <letter>. Pronunciation Micro-Focus" section under H2 #5.',
  'Pronunciation Micro-Focus is missing a supported ',
  'Pronunciation Micro-Focus (line ',
  'Line ',
  'Front matter: speaker_profiles role "',
];

function normalizeHeadingText(s: string): string {
  // strip emoji
  const noEmoji = s.replaceAll(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '');
  // strip zero-width: ZWSP, ZWNJ, ZWJ, WJ, VS15/VS16
  const noZW = noEmoji.replaceAll(/[\u200B\u200C\u200D\u2060\uFE0E\uFE0F]/g, '');
  // collapse any whitespace incl NBSP into a single space
  const oneSpace = noZW.replaceAll(/[\s\u00A0]+/g, ' ');
  return (
    oneSpace
      // keep letters/digits/space/._- quotes & colon; drop the rest
      .replaceAll(/[^\w\s\.\-’'&:]/g, '')
      .trim()
      .toLowerCase()
  );
}

const CONTROLLED_PRACTICE_HEADING_PREFIX = normalizeHeadingText('A. Controlled Practice');
const COMPREHENSION_CHECK_HEADING_PREFIX = normalizeHeadingText('B. Comprehension Check');

function isControlledPracticeHeading(text: string): boolean {
  const normalized = normalizeHeadingText(text);
  return normalized.startsWith(CONTROLLED_PRACTICE_HEADING_PREFIX);
}

function isComprehensionCheckHeading(text: string): boolean {
  const normalized = normalizeHeadingText(text);
  return normalized.startsWith(COMPREHENSION_CHECK_HEADING_PREFIX);
}

function isPronunciationMicroFocusHeading(text: string): boolean {
  const normalized = normalizeHeadingText(text);
  return (
    /\bpronunciation\b/.test(normalized) &&
    (/\bmicro(?:\s+|-)?focus\b/.test(normalized) || /\bmicrofocus\b/.test(normalized))
  );
}

function tokenizeHeading(text: string): string[] {
  const normalized = normalizeHeadingText(text);
  const withoutNumber = normalized.replace(/^\d+\s*[\.\-:]?\s*/, '');
  return withoutNumber
    .split(/\s+/)
    .map((token) => token.replaceAll(/[^a-z0-9]/g, ''))
    .filter((token) => token.length > 0);
}

function matchesHeadingRule(tokens: string[], rule: HeadingRule): boolean {
  const tokenSet = new Set(tokens);
  for (const group of rule.groups) {
    const matches = group.some((candidate) => tokenSet.has(candidate));
    if (!matches) return false;
  }

  const vocabulary = new Set(rule.groups.flat());
  const hitCount = [...tokenSet].filter((token) => vocabulary.has(token)).length;
  return hitCount >= (rule.minTokenHits ?? 1);
}

function collectHeadings(body: PmdBlock[], depth: 2 | 3): PmdHeading[] {
  return body.filter((block) => block.type === 'heading' && block.depth === depth) as PmdHeading[];
}

function sectionSlice(body: PmdBlock[], startHeading: PmdHeading): PmdBlock[] {
  const idx = body.indexOf(startHeading);
  if (idx === -1) return [];
  const rel = body
    .slice(idx + 1)
    .findIndex((n) => n.type === 'heading' && n.depth <= startHeading.depth);
  const endIdx = rel === -1 ? body.length : idx + 1 + rel;
  return body.slice(idx + 1, endIdx);
}

function collectDirectiveLeaves(blocks: PmdBlock[], out: PmdDirectiveLeaf[]): void {
  for (const block of blocks) {
    if (block.type === 'directive_leaf') {
      out.push(block);
      continue;
    }
    if (block.type === 'directive_block') {
      collectDirectiveLeaves(block.children, out);
      continue;
    }
    if (block.type === 'list') {
      for (const item of block.items) {
        collectDirectiveLeaves(item.children, out);
      }
      continue;
    }
    if (block.type === 'list_item') {
      collectDirectiveLeaves(block.children, out);
      continue;
    }
    if (block.type === 'blockquote') {
      collectDirectiveLeaves(block.children, out);
    }
  }
}

function findFirstDirective(blocks: PmdDirectiveBlock[]): PmdDirectiveBlock | null {
  if (blocks.length === 0) return null;
  const sorted = [...blocks].sort((a, b) => {
    const aLine = a.position?.start.line ?? 0;
    const bLine = b.position?.start.line ?? 0;
    return aLine - bLine;
  });
  return sorted[0] ?? null;
}

function normalizeLabel(value: string): string {
  return value
    .replaceAll(/[\u2018\u2019]/g, "'")
    .trim()
    .toLowerCase();
}

function directiveLabel(block: PmdDirectiveBlock, markerLine: string): string {
  if (block.label && block.label.trim().length > 0) {
    return block.label.trim();
  }
  const match = /^:::\S+\s+(.+)$/.exec(markerLine.trim());
  return match?.[1]?.trim() ?? '';
}

function escapeRegExp(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function directiveLeafLabel(leaf: PmdDirectiveLeaf, contentLines: string[]): string {
  if (leaf.label && leaf.label.trim().length > 0) {
    return leaf.label.trim();
  }

  const startLine = leaf.position?.start.line ?? 0;
  if (!startLine) return '';
  const markerLine = (contentLines[startLine - 1] ?? '').trim();
  if (!markerLine) return '';

  const escapedName = escapeRegExp(leaf.name);
  const bracketPattern = new RegExp(String.raw`^:{2,3}${escapedName}\[(.+)\]\s*$`, 'i');
  const bracketMatch = bracketPattern.exec(markerLine);
  if (bracketMatch?.[1]) {
    return bracketMatch[1].trim();
  }

  const spacedPattern = new RegExp(String.raw`^:{2,3}${escapedName}\s+(.+)$`, 'i');
  const spacedMatch = spacedPattern.exec(markerLine);
  return spacedMatch?.[1]?.trim() ?? '';
}

function getDirectiveBounds(
  block: PmdDirectiveBlock,
  contentLines: string[],
): {
  startLine: number;
  endLine: number;
  markerLine: string;
  closingLine: string;
  innerLines: string[];
} | null {
  const startLine = block.position?.start.line ?? 0;
  const endLine = block.position?.end.line ?? 0;
  if (!startLine || !endLine) return null;
  const markerLine = contentLines[startLine - 1] ?? '';
  const closingLine = contentLines[endLine - 1] ?? '';
  const innerLines = contentLines.slice(startLine, Math.max(startLine, endLine - 1));
  return { startLine, endLine, markerLine, closingLine, innerLines };
}

function hasNonEmptyLine(lines: string[]): boolean {
  return lines.some((line) => line.trim().length > 0);
}

function applyLineOffset(line: number, lineOffset: number): number {
  if (!line) return line;
  return line + lineOffset;
}

function hasCodeBlocks(blocks: PmdBlock[]): boolean {
  for (const block of blocks) {
    if (block.type === 'code_block') return true;
    if (block.type === 'directive_block' && hasCodeBlocks(block.children)) return true;
    if (block.type === 'list') {
      for (const item of block.items) {
        if (hasCodeBlocks(item.children)) return true;
      }
    }
    if (block.type === 'list_item' && hasCodeBlocks(block.children)) return true;
    if (block.type === 'blockquote' && hasCodeBlocks(block.children)) return true;
  }
  return false;
}

function countListItems(blocks: PmdBlock[]): number {
  let count = 0;
  for (const block of blocks) {
    if (block.type === 'list') {
      count += block.items.length;
      continue;
    }
    if (block.type === 'paragraph') {
      const txt = block.text;
      if (/^\s*\d+\)/.test(txt) || /^\s*-\s+/.test(txt) || /^\s*\*\s+/.test(txt)) {
        count += 1;
      }
    }
  }
  return count;
}

function pushPronunciationWarnings(
  warnings: string[],
  pronunciationFocus: NonNullable<ReturnType<typeof extractPronunciationFocus>>,
  lineOffset: number,
): void {
  const displayLine = applyLineOffset(pronunciationFocus.sectionStartLine, lineOffset);
  const missingSharedFields: [key: string, value: string | undefined][] = [
    ['Target', pronunciationFocus.target],
    ['Focus', pronunciationFocus.focus],
    ['Action', pronunciationFocus.action],
    ['Deliverable', pronunciationFocus.deliverable],
  ];

  for (const [label, value] of missingSharedFields) {
    if (!value?.trim()) {
      warnings.push(
        `Pronunciation Micro-Focus (line ${displayLine}): missing "**${label}:** <value>" for ${pronunciationFocus.mode} mode.`,
      );
    }
  }

  switch (pronunciationFocus.mode) {
    case 'shadow_sentence': {
      if (!pronunciationFocus.shadowSentence?.trim()) {
        warnings.push(
          `Pronunciation Micro-Focus (line ${displayLine}): missing "**Shadow sentence:** <sentence>" for shadow_sentence mode.`,
        );
      }
      if (pronunciationFocus.words.length < 3 || pronunciationFocus.words.length > 5) {
        warnings.push(
          `Pronunciation Micro-Focus (line ${displayLine}): shadow_sentence mode requires 3-5 word drill lines in "1. word — /transcription/" or "1. word /transcription/" format.`,
        );
      }
      break;
    }
    case 'minimal_pair': {
      if (pronunciationFocus.pairs.length < 2 || pronunciationFocus.pairs.length > 5) {
        warnings.push(
          `Pronunciation Micro-Focus (line ${displayLine}): minimal_pair mode recommends 2-5 lines in "1. word /ipa/ — word /ipa/" format.`,
        );
      }
      break;
    }
    case 'connected_speech': {
      if (pronunciationFocus.lines.length < 2 || pronunciationFocus.lines.length > 4) {
        warnings.push(
          `Pronunciation Micro-Focus (line ${displayLine}): connected_speech mode recommends 2-4 lines in "1. \"careful form\" -> connected form" format.`,
        );
      }
      break;
    }
    case 'intonation': {
      if (pronunciationFocus.drills.length < 2 || pronunciationFocus.drills.length > 4) {
        warnings.push(
          `Pronunciation Micro-Focus (line ${displayLine}): intonation mode recommends 2-4 numbered drill lines.`,
        );
      }
      break;
    }
    case 'rhythm_chunking': {
      if (pronunciationFocus.drills.length < 2 || pronunciationFocus.drills.length > 4) {
        warnings.push(
          `Pronunciation Micro-Focus (line ${displayLine}): rhythm_chunking mode recommends 2-4 numbered drill lines.`,
        );
      }
      if (
        pronunciationFocus.drills.length > 0 &&
        !pronunciationFocus.drills.some((item) => item.text.includes('|'))
      ) {
        warnings.push(
          `Pronunciation Micro-Focus (line ${displayLine}): rhythm_chunking mode should show chunk boundaries with "|" in the numbered drill lines.`,
        );
      }
      break;
    }
    case 'sentence_stress': {
      if (pronunciationFocus.drills.length < 2 || pronunciationFocus.drills.length > 4) {
        warnings.push(
          `Pronunciation Micro-Focus (line ${displayLine}): sentence_stress mode recommends 2-4 numbered drill lines.`,
        );
      }
      break;
    }
  }

  for (const issue of pronunciationFocus.issues) {
    warnings.push(`Line ${applyLineOffset(issue.line, lineOffset)}: ${issue.message}`);
  }
}

function isNonBlockingWarning(message: string): boolean {
  return NON_BLOCKING_WARNING_PREFIXES.some((prefix) => message.startsWith(prefix));
}

function isTruthyFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function isVoiceAlignmentStrictValidationEnabled(): boolean {
  return (
    isTruthyFlag(process.env.VOICE_ALIGNMENT_V2_ENABLED) &&
    isTruthyFlag(process.env.VOICE_ALIGNMENT_V2_STRICT_VALIDATION)
  );
}

function isVoiceAlignmentEnabled(): boolean {
  return isTruthyFlag(process.env.VOICE_ALIGNMENT_V2_ENABLED);
}

function classifyShadowMismatch(message: string): string | null {
  const normalized = message.toLowerCase();
  if (normalized.includes('input_type') && normalized.includes('legacy'))
    return 'legacy_input_type';
  if (normalized.includes('study_text_type is required')) return 'missing_study_text_type';
  if (normalized.includes('study_text_type') && normalized.includes('conflicts with legacy')) {
    return 'study_text_type_conflict';
  }
  if (normalized.includes('study_text_type') && normalized.includes('does not match study-text')) {
    return 'study_text_content_mismatch';
  }
  if (normalized.includes('speaker_labels are set but speaker_profiles are missing')) {
    return 'missing_speaker_profiles';
  }
  if (normalized.includes('speaker_profiles are set but speaker_labels are missing')) {
    return 'missing_speaker_labels';
  }
  if (normalized.includes('has no matching speaker_profile'))
    return 'missing_speaker_profile_for_label';
  if (
    normalized.includes('speaker_profiles id') &&
    normalized.includes('not present in speaker_labels')
  ) {
    return 'unmatched_speaker_profile';
  }
  if (normalized.includes('does not exist in the current voice catalog'))
    return 'invalid_speaker_voice';
  if (normalized.includes('unsupported accent')) return 'unsupported_accent';
  if (normalized.includes('unsupported style')) return 'unsupported_style';
  if (normalized.includes('voice catalog') && normalized.includes('unavailable'))
    return 'catalog_unavailable';
  return null;
}

function buildShadowModeDiagnostics(messages: string[]): {
  enabled: boolean;
  mismatchClasses: Record<string, number>;
  mismatchTotal: number;
} {
  const mismatchClasses: Record<string, number> = {};
  for (const message of messages) {
    const mismatchClass = classifyShadowMismatch(message);
    if (!mismatchClass) continue;
    mismatchClasses[mismatchClass] = (mismatchClasses[mismatchClass] ?? 0) + 1;
  }
  const mismatchTotal = Object.values(mismatchClasses).reduce((sum, count) => sum + count, 0);
  return {
    enabled: true,
    mismatchClasses,
    mismatchTotal,
  };
}

function normalizeCapabilityToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[\s-]+/g, '_');
}

function splitCapabilityValues(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(/[;,/|]/g)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeAccent(value: string): string {
  const normalized = normalizeCapabilityToken(value);
  if (!normalized) return '';
  if (normalized.includes('american')) return 'american';
  if (normalized.includes('british')) return 'british';
  if (normalized.includes('australian')) return 'australian';
  if (normalized.includes('canadian')) return 'canadian';
  if (normalized.includes('irish')) return 'irish';
  if (normalized.includes('scottish')) return 'scottish';
  if (normalized.includes('indian')) return 'indian';
  if (normalized.includes('south_african')) return 'south_african';
  return normalized;
}

function normalizeStyle(value: string): string {
  const normalized = normalizeCapabilityToken(value);
  if (!normalized) return '';
  if (normalized.includes('conversation')) return 'conversational';
  if (normalized.includes('narrat')) return 'narration';
  if (normalized.includes('character')) return 'characters';
  return normalized;
}

function normalizeVoiceCapabilities(
  capabilities: VoiceCapabilitiesSnapshot,
): VoiceCapabilitiesSnapshot {
  return {
    generatedAt: capabilities.generatedAt,
    role: [
      ...new Set(capabilities.role.map((value) => normalizeCapabilityToken(value))),
    ].sort() as VoiceCapabilitiesSnapshot['role'],
    gender: [
      ...new Set(capabilities.gender.map((value) => normalizeCapabilityToken(value))),
    ].sort() as VoiceCapabilitiesSnapshot['gender'],
    age: [
      ...new Set(capabilities.age.map((value) => normalizeCapabilityToken(value))),
    ].sort() as VoiceCapabilitiesSnapshot['age'],
    accent: [
      ...new Set(
        capabilities.accent
          .map((value) => normalizeAccent(value))
          .filter((value) => value.length > 0),
      ),
    ].sort(),
    style: [
      ...new Set(
        capabilities.style
          .map((value) => normalizeStyle(value))
          .filter((value) => value.length > 0),
      ),
    ].sort(),
  };
}

function deriveVoiceCapabilities(catalog: VoiceCatalogLike): VoiceCapabilitiesSnapshot {
  if (catalog.capabilities) {
    return normalizeVoiceCapabilities(catalog.capabilities);
  }

  const accents = new Set<string>();
  const styles = new Set<string>();
  const ages = new Set<string>();
  const genders = new Set<string>();

  for (const voice of catalog.voices) {
    const labels = voice.labels ?? {};
    for (const rawAccent of splitCapabilityValues(labels.accent)) {
      const accent = normalizeAccent(rawAccent);
      if (accent) accents.add(accent);
    }
    for (const rawStyle of [
      ...splitCapabilityValues(labels.descriptive),
      ...splitCapabilityValues(labels.style),
      ...splitCapabilityValues(labels.use_case),
      ...splitCapabilityValues(labels.useCase),
    ]) {
      const style = normalizeStyle(rawStyle);
      if (style) styles.add(style);
    }
    for (const rawAge of splitCapabilityValues(labels.age)) {
      const age = normalizeCapabilityToken(rawAge);
      if (CANONICAL_AGES.includes(age as (typeof CANONICAL_AGES)[number])) {
        ages.add(age);
      }
    }
    for (const rawGender of splitCapabilityValues(labels.gender)) {
      const gender = normalizeCapabilityToken(rawGender);
      if (CANONICAL_GENDERS.includes(gender as (typeof CANONICAL_GENDERS)[number])) {
        genders.add(gender);
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    role: [...CANONICAL_ROLES],
    gender: [
      ...(genders.size > 0 ? genders : CANONICAL_GENDERS),
    ].sort() as VoiceCapabilitiesSnapshot['gender'],
    age: [...(ages.size > 0 ? ages : CANONICAL_AGES)].sort() as VoiceCapabilitiesSnapshot['age'],
    accent: [...accents].sort(),
    style: [...styles].sort(),
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function findWorkspaceRoot(startDir: string): Promise<string | null> {
  let current = resolve(startDir);
  while (true) {
    const markerPath = resolve(current, WORKSPACE_MARKER);
    if (await fileExists(markerPath)) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function resolveVoiceCatalogCandidates(rawFile: string): Promise<string[]> {
  const overridePath = process.env.ELEVENLABS_VOICES_PATH?.trim();
  const absoluteRawFile = resolve(rawFile);
  const workspaceRoot = await findWorkspaceRoot(dirname(absoluteRawFile));

  return [
    ...new Set(
      [
        overridePath ? resolve(overridePath) : null,
        workspaceRoot ? resolve(workspaceRoot, DEFAULT_VOICES_PATH) : null,
        resolve(process.cwd(), DEFAULT_VOICES_PATH),
        resolve(dirname(absoluteRawFile), DEFAULT_VOICES_PATH),
      ].filter(Boolean) as string[],
    ),
  ];
}

async function loadVoiceCatalog(rawFile: string): Promise<{
  catalog?: VoiceCatalogLike;
  diagnosticsWarnings: string[];
}> {
  const diagnosticsWarnings: string[] = [];
  const candidates = await resolveVoiceCatalogCandidates(rawFile);

  for (const candidate of candidates) {
    try {
      const raw = await readFile(candidate, 'utf8');
      const parsed = JSON.parse(raw) as VoiceCatalogLike;
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.voices)) {
        diagnosticsWarnings.push(
          `Voice catalog at "${candidate}" is invalid (missing "voices" array); voice override checks skipped.`,
        );
        continue;
      }
      return { catalog: parsed, diagnosticsWarnings };
    } catch (error: unknown) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code === 'ENOENT') continue;
      const message = error instanceof Error ? error.message : String(error);
      diagnosticsWarnings.push(
        `Unable to load voice catalog from "${candidate}" (${message}); voice override checks may be incomplete.`,
      );
    }
  }

  diagnosticsWarnings.push(
    'Voice catalog not found; voice override and capability checks were skipped.',
  );
  return { diagnosticsWarnings };
}

function normalizeSpeakerToken(value: string): string {
  return value.trim().toLowerCase();
}

function pushVoiceValidationMessage(
  message: string,
  strictValidation: boolean,
  errors: string[],
  warnings: string[],
  diagnosticsErrors: string[],
  diagnosticsWarnings: string[],
): void {
  if (strictValidation) {
    errors.push(message);
    diagnosticsErrors.push(message);
  } else {
    warnings.push(message);
    diagnosticsWarnings.push(message);
  }
}

function normalizeMeta(
  rawMeta: RawMeta,
  strictValidation: boolean,
  errors: string[],
  warnings: string[],
  diagnosticsErrors: string[],
  diagnosticsWarnings: string[],
): ValidationMeta {
  const rawInputType = rawMeta.input_type as FrontInputType;
  const isLegacyType = rawInputType === 'dialogue' || rawInputType === 'monologue';

  const inputType: ContentSource =
    rawInputType === 'generate' || rawInputType === 'authentic' ? rawInputType : 'generate';
  let studyTextType: StudyTextType | undefined = rawMeta.study_text_type;

  if (isLegacyType) {
    const message =
      `Front matter: input_type "${rawInputType}" is legacy. ` +
      'Use input_type "generate"|"authentic" and study_text_type "monologue"|"dialogue".';
    pushVoiceValidationMessage(
      message,
      strictValidation,
      errors,
      warnings,
      diagnosticsErrors,
      diagnosticsWarnings,
    );
    if (!studyTextType) {
      studyTextType = rawInputType;
    }
  }

  if (!studyTextType) {
    pushVoiceValidationMessage(
      'Front matter: study_text_type is required ("monologue"|"dialogue").',
      strictValidation,
      errors,
      warnings,
      diagnosticsErrors,
      diagnosticsWarnings,
    );
  }

  if (isLegacyType && rawMeta.study_text_type && rawMeta.study_text_type !== rawInputType) {
    pushVoiceValidationMessage(
      `Front matter: study_text_type "${rawMeta.study_text_type}" conflicts with legacy input_type "${rawInputType}".`,
      strictValidation,
      errors,
      warnings,
      diagnosticsErrors,
      diagnosticsWarnings,
    );
  }

  const speakerProfiles = Array.isArray(rawMeta.speaker_profiles)
    ? rawMeta.speaker_profiles.map((profile) => {
        const rawRole = typeof profile.role === 'string' ? profile.role.trim() : '';
        const normalizedRole = normalizeSpeakerRole(rawRole);
        if (rawRole && !normalizedRole) {
          const message =
            `Front matter: speaker_profiles role "${rawRole}" for "${profile.id}" is unknown. ` +
            `Allowed canonical roles: [${CANONICAL_ROLES.join(', ')}]. Role score will be 0.`;
          warnings.push(message);
          diagnosticsWarnings.push(message);
        }
        return {
          ...profile,
          role: normalizedRole,
        };
      })
    : undefined;

  return {
    title: rawMeta.title,
    student: rawMeta.student,
    level: rawMeta.level,
    topic: rawMeta.topic,
    input_type: inputType,
    study_text_type: studyTextType,
    speaker_labels: rawMeta.speaker_labels,
    speaker_profiles: speakerProfiles as SpeakerProfile[] | undefined,
  };
}

function classifyStudyTextType(rawLines: string[]): StudyTextType {
  let dialogueLines = 0;
  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(
      /^\s*(?:\[([^\]]+)\]|(?:\*\*)?([A-Za-zА-Яа-яЁё0-9 _.\-]{1,32})(?:\*\*)?)\s*:(?:\*\*)?\s+.+$/,
    );
    if (match) dialogueLines += 1;
  }
  return dialogueLines >= 2 ? 'dialogue' : 'monologue';
}

function validateSpeakerMetadataAlignment(
  meta: ValidationMeta,
  strictValidation: boolean,
  capabilities: VoiceCapabilitiesSnapshot | undefined,
  knownVoices: Set<string> | undefined,
  errors: string[],
  warnings: string[],
  diagnosticsErrors: string[],
  diagnosticsWarnings: string[],
): void {
  const labels = Array.isArray(meta.speaker_labels) ? meta.speaker_labels : [];
  const profiles = Array.isArray(meta.speaker_profiles) ? meta.speaker_profiles : [];
  if (labels.length === 0 && profiles.length === 0) return;

  const normalizedLabels = labels.map((label) => normalizeSpeakerToken(label));
  const duplicateLabels = normalizedLabels.filter(
    (label, idx) => normalizedLabels.indexOf(label) !== idx,
  );
  if (duplicateLabels.length > 0) {
    warnings.push(
      `Front matter: speaker_labels contains duplicates: [${[...new Set(duplicateLabels)].join(', ')}].`,
    );
  }

  const normalizedIds = profiles.map((profile) => normalizeSpeakerToken(profile.id));
  const duplicateIds = normalizedIds.filter((id, idx) => normalizedIds.indexOf(id) !== idx);
  if (duplicateIds.length > 0) {
    warnings.push(
      `Front matter: speaker_profiles contains duplicate ids: [${[...new Set(duplicateIds)].join(', ')}].`,
    );
  }

  if (labels.length > 0 && profiles.length === 0) {
    pushVoiceValidationMessage(
      'Front matter: speaker_labels are set but speaker_profiles are missing.',
      strictValidation,
      errors,
      warnings,
      diagnosticsErrors,
      diagnosticsWarnings,
    );
    return;
  }

  if (labels.length === 0 && profiles.length > 0) {
    pushVoiceValidationMessage(
      'Front matter: speaker_profiles are set but speaker_labels are missing.',
      strictValidation,
      errors,
      warnings,
      diagnosticsErrors,
      diagnosticsWarnings,
    );
    return;
  }

  const labelSet = new Set(normalizedLabels);
  const profileSet = new Set(normalizedIds);

  for (const profile of profiles) {
    if (!labelSet.has(normalizeSpeakerToken(profile.id))) {
      warnings.push(
        `Front matter: speaker_profiles id "${profile.id}" is not present in speaker_labels.`,
      );
    }
  }

  for (const label of labels) {
    if (!profileSet.has(normalizeSpeakerToken(label))) {
      pushVoiceValidationMessage(
        `Front matter: speaker label "${label}" has no matching speaker_profile.`,
        strictValidation,
        errors,
        warnings,
        diagnosticsErrors,
        diagnosticsWarnings,
      );
    }
  }

  for (const profile of profiles) {
    if (profile.voice && profile.voice.trim().length > 0) {
      if (!knownVoices) {
        diagnosticsWarnings.push(
          `Front matter: unable to verify speaker_profiles.voice "${profile.voice}" because voice catalog is unavailable.`,
        );
      } else if (!knownVoices.has(normalizeSpeakerToken(profile.voice))) {
        pushVoiceValidationMessage(
          `Front matter: speaker_profiles voice "${profile.voice}" for "${profile.id}" does not exist in the current voice catalog.`,
          strictValidation,
          errors,
          warnings,
          diagnosticsErrors,
          diagnosticsWarnings,
        );
      }
    }

    if (!capabilities) continue;
    if (profile.accent && profile.accent.trim().length > 0) {
      const accent = normalizeAccent(profile.accent);
      if (!capabilities.accent.includes(accent)) {
        pushVoiceValidationMessage(
          `Front matter: unsupported accent "${profile.accent}" for "${profile.id}". Allowed accents: [${capabilities.accent.join(', ')}].`,
          strictValidation,
          errors,
          warnings,
          diagnosticsErrors,
          diagnosticsWarnings,
        );
      }
    }
    if (profile.style && profile.style.trim().length > 0) {
      const style = normalizeStyle(profile.style);
      if (!capabilities.style.includes(style)) {
        pushVoiceValidationMessage(
          `Front matter: unsupported style "${profile.style}" for "${profile.id}". Allowed styles: [${capabilities.style.join(', ')}].`,
          strictValidation,
          errors,
          warnings,
          diagnosticsErrors,
          diagnosticsWarnings,
        );
      }
    }
  }
}

async function resolveValidateInput(
  input: GeneralEnglishValidateInput,
): Promise<ResolvedValidateInput> {
  const strict = input.strict ?? false;
  if ('context' in input) {
    return {
      context: input.context,
      strict,
      path: input.path,
    };
  }

  if ('markdown' in input) {
    return {
      context: parseMarkdownContext(input.markdown),
      strict,
      path: input.path,
    };
  }

  const markdown = await readFile(input.path, 'utf8');
  return {
    context: parseMarkdownContext(markdown),
    strict,
    path: input.path,
  };
}

export async function validateGeneralEnglishRuleset(
  input: GeneralEnglishValidateInput,
): Promise<GeneralEnglishValidateResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const voiceDiagnosticsErrors: string[] = [];
  const voiceDiagnosticsWarnings: string[] = [];
  let strict = false;
  let markdownPath: string | undefined;
  const voiceAlignmentEnabled = isVoiceAlignmentEnabled();
  const strictVoiceAlignment = isVoiceAlignmentStrictValidationEnabled();

  let parsedContext: ParsedMarkdownContext | null = null;
  let doc: ParsedMarkdownContext['document'];
  let contentLines: string[] = [];
  let lineOffset = 0;
  try {
    const resolved = await resolveValidateInput(input);
    strict = resolved.strict;
    markdownPath = resolved.path;
    parsedContext = resolved.context;
    doc = parsedContext.document;
    contentLines = parsedContext.contentLines;
    lineOffset = parsedContext.contentLineOffset;
    warnings.push(...doc.warnings.map((warning) => warning.message));
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return { ok: false, errors: [msg], warnings };
  }

  const frontmatter = { ...doc.frontmatter } as Record<string, unknown>;
  if (frontmatter.topic && Array.isArray(frontmatter.topic)) {
    frontmatter.topic = frontmatter.topic.join(', ');
  }

  const voiceCatalogLoad =
    typeof markdownPath === 'string' && markdownPath.length > 0
      ? await loadVoiceCatalog(markdownPath)
      : { diagnosticsWarnings: ['Voice catalog checks skipped (no markdown path provided).'] };
  voiceDiagnosticsWarnings.push(...voiceCatalogLoad.diagnosticsWarnings);
  const capabilities = voiceCatalogLoad.catalog
    ? deriveVoiceCapabilities(voiceCatalogLoad.catalog)
    : undefined;
  const knownVoices = voiceCatalogLoad.catalog
    ? new Set(
        voiceCatalogLoad.catalog.voices.flatMap((voice) => {
          const names = [voice.id, voice.name]
            .filter(
              (value): value is string => typeof value === 'string' && value.trim().length > 0,
            )
            .map((value) => normalizeSpeakerToken(value));
          return names;
        }),
      )
    : undefined;

  const metaParse = FrontSchema.safeParse(frontmatter);
  if (!metaParse.success) {
    for (const issue of metaParse.error.issues) {
      errors.push(`Front matter: ${issue.path.join('.')} - ${issue.message}`);
    }
  }
  const meta = metaParse.success
    ? normalizeMeta(
        metaParse.data as RawMeta,
        strictVoiceAlignment,
        errors,
        warnings,
        voiceDiagnosticsErrors,
        voiceDiagnosticsWarnings,
      )
    : undefined;
  if (meta) {
    validateSpeakerMetadataAlignment(
      meta,
      strictVoiceAlignment,
      capabilities,
      knownVoices,
      errors,
      warnings,
      voiceDiagnosticsErrors,
      voiceDiagnosticsWarnings,
    );
  }

  // a) H2 order check
  const h2 = collectHeadings(doc.body, 2);
  if (h2.length < H2_RULES.length) {
    warnings.push(`Expected at least ${H2_RULES.length} H2 sections, found ${h2.length}.`);
  }
  for (const [index, rule] of H2_RULES.entries()) {
    const heading = h2[index];
    if (!heading) continue;
    const tokens = tokenizeHeading(heading.text);
    if (!matchesHeadingRule(tokens, rule)) {
      warnings.push(
        `H2 #${index + 1} mismatch. Expected wording similar to "${rule.label}", found: "${heading.text}".`,
      );
    }
  }
  if (h2.length > H2_RULES.length) {
    warnings.push('Additional H2 sections after section 9 are ignored by structure validation.');
  }

  // b) markers
  const toggles = [
    ...findDirectiveBlocks(doc, 'toggle'),
    ...findDirectiveBlocks(doc, 'toggle-heading'),
    ...findDirectiveBlocks(doc, 'toggle-h2'),
    ...findDirectiveBlocks(doc, 'toggle-h3'),
  ];

  const hasAnswerKeyToggle = toggles.some((block) => {
    const bounds = getDirectiveBounds(block, contentLines);
    const label = bounds ? directiveLabel(block, bounds.markerLine) : (block.label ?? '');
    return normalizeLabel(label) === 'answer key';
  });

  const hasTeacherPlanToggle = toggles.some((block) => {
    const bounds = getDirectiveBounds(block, contentLines);
    const label = bounds ? directiveLabel(block, bounds.markerLine) : (block.label ?? '');
    return normalizeLabel(label) === "teacher's follow-up plan";
  });

  if (!hasAnswerKeyToggle) {
    warnings.push(
      'Missing marker: ":::toggle Answer Key" (preferred) or ":::toggle-heading Answer Key" / ":::toggle-h2 Answer Key"',
    );
  }
  if (!hasTeacherPlanToggle) {
    warnings.push(
      'Missing marker: ":::toggle Teacher\'s Follow-up Plan" (preferred) or ":::toggle-heading Teacher\'s Follow-up Plan" / ":::toggle-h2/h3 Teacher\'s Follow-up Plan"',
    );
  }

  const studyBlock = findFirstDirective(findDirectiveBlocks(doc, 'study-text'));
  if (studyBlock === null) {
    const markerIdx = contentLines.findIndex((line) =>
      line.toLowerCase().includes(':::study-text'),
    );
    if (markerIdx === -1) {
      errors.push('Missing ":::study-text ... :::" block.');
    } else {
      const raw = contentLines[markerIdx] ?? '';
      if (/^\s+:::study-text\b/i.test(raw)) {
        errors.push(
          `Line ${markerIdx + 1 + lineOffset}: study-text marker must start at column 1 with ":::study-text".`,
        );
      } else {
        errors.push(
          `Line ${markerIdx + 1 + lineOffset}: malformed study-text marker. Use ":::study-text" (case-insensitive) on its own line.`,
        );
      }
    }
  } else {
    const bounds = getDirectiveBounds(studyBlock, contentLines);
    if (bounds === null) {
      errors.push('Missing ":::study-text ... :::" block.');
    } else {
      const { startLine, markerLine, closingLine, innerLines } = bounds;
      const displayStartLine = applyLineOffset(startLine, lineOffset);
      const displayEndLine = applyLineOffset(bounds.endLine, lineOffset);
      let studyOk = true;
      if (!markerLine.startsWith(':::study-text')) {
        errors.push(
          `Line ${displayStartLine}: study-text marker must start at column 1 with ":::study-text".`,
        );
        studyOk = false;
      }

      if (closingLine.trim() !== ':::') {
        errors.push(
          `study-text block starting at line ${displayStartLine} is missing a closing ":::" on its own line.`,
        );
        studyOk = false;
      } else if (closingLine !== ':::') {
        warnings.push(
          `Line ${displayEndLine}: study-text closing marker must be ":::" with no leading spaces.`,
        );
      }

      if (studyOk) {
        const rawLines = innerLines.map((line) => line.trim());
        const lines = rawLines.filter(Boolean);
        const observedStudyTextType = classifyStudyTextType(rawLines);

        if (meta?.study_text_type && meta.study_text_type !== observedStudyTextType) {
          pushVoiceValidationMessage(
            `Front matter: study_text_type "${meta.study_text_type}" does not match study-text content (detected "${observedStudyTextType}").`,
            strictVoiceAlignment,
            errors,
            warnings,
            voiceDiagnosticsErrors,
            voiceDiagnosticsWarnings,
          );
        }

        const hasSpeakerLabels = Boolean(meta?.speaker_labels && meta.speaker_labels.length > 0);
        let enforceExplicitSpeakers = false;
        if (hasSpeakerLabels) {
          const labelSet = new Set(
            meta!.speaker_labels!.map((s: string) => s.trim().toLowerCase()),
          );
          const onlyNarrator = labelSet.size === 1 && labelSet.has('narrator');
          if (!onlyNarrator) {
            enforceExplicitSpeakers = true;
            let currentSpeaker: string | null = null;
            for (const [i, raw] of rawLines.entries()) {
              const line = raw.trim();
              if (!line) continue;
              // Relaxed regex: allow markdown like **Name**: or [Name]: or **Name:**
              const m = line.match(
                /^\s*(?:\[([^\]]+)\]|(?:\*\*)?([A-Za-zА-Яа-яЁё0-9 _.\-]{1,32})(?:\*\*)?)\s*:(?:\*\*)?\s+.+$/,
              );
              if (m) {
                const who = (m[1] ?? m[2] ?? '').trim();
                if (!who) {
                  warnings.push(
                    `study-text line ${i + 1}: could not extract speaker from line: "${line}".`,
                  );
                  currentSpeaker = null;
                  continue;
                }
                // Strip markdown from the extracted name for validation
                const cleanWho = who.replaceAll('**', '').trim();
                if (!labelSet.has(cleanWho.toLowerCase())) {
                  warnings.push(
                    `study-text line ${i + 1}: unknown speaker "${cleanWho}". Allowed: [${meta!.speaker_labels!.join(
                      ', ',
                    )}].`,
                  );
                }
                currentSpeaker = cleanWho;
                continue;
              }
              if (!currentSpeaker) {
                warnings.push(
                  `study-text line ${i + 1}: expected "Speaker: text" or continuation, got "${line}".`,
                );
              }
            }
          }
        }

        if (!enforceExplicitSpeakers) {
          // monologue: soft check — at least 3 paragraphs or 10 short lines
          const paras = innerLines
            .join('\n')
            .split(/\n\s*\n/)
            .filter((p) => p.trim().length > 0);
          const lineCount = lines.length;
          if (paras.length < 3 && lineCount < 10) {
            warnings.push('study-text looks short. Aim for 3–5 paragraphs or 10–15 lines.');
          }
        }
      }
    }
  }

  // c) Controlled Practice item count (soft check)
  const practiceBlocks = h2[4] ? sectionSlice(doc.body, h2[4]) : doc.body;
  const practiceH3 = collectHeadings(practiceBlocks, 3);
  const cp = practiceH3.find((heading) => isControlledPracticeHeading(heading.text));
  if (cp) {
    const nodes = sectionSlice(practiceBlocks, cp);
    const count = countListItems(nodes);
    if (count && (count < 8 || count > 12)) {
      warnings.push(`Controlled Practice has ${count} items (recommended 8–10).`);
    }
  } else {
    warnings.push('No "### A. Controlled Practice" section found under H2 #5.');
  }

  // d) Comprehension Check items (soft check)
  const cc = practiceH3.find((heading) => isComprehensionCheckHeading(heading.text));
  if (cc) {
    const nodes = sectionSlice(practiceBlocks, cc);
    const count = countListItems(nodes);
    if (count && count < 2) {
      warnings.push(`Comprehension Check has ${count} item(s) (recommended 2–3).`);
    }
  } else {
    warnings.push('No "### B. Comprehension Check" section found under H2 #5.');
  }

  const pronunciationHeading = practiceH3.find((heading) =>
    isPronunciationMicroFocusHeading(heading.text),
  );
  if (!pronunciationHeading) {
    warnings.push('Missing "### <letter>. Pronunciation Micro-Focus" section under H2 #5.');
  }

  const pronunciationFocus = parsedContext ? extractPronunciationFocus(parsedContext) : null;
  if (pronunciationHeading && !pronunciationFocus) {
    warnings.push(
      'Pronunciation Micro-Focus is missing a supported "**Mode:** <shadow_sentence | intonation | rhythm_chunking | sentence_stress | connected_speech | minimal_pair>" line.',
    );
  }
  if (pronunciationFocus) {
    pushPronunciationWarnings(warnings, pronunciationFocus, lineOffset);
  }

  // e) no nested code blocks inside the doc
  if (hasCodeBlocks(doc.body)) {
    warnings.push('Found code block(s) inside the main document. Avoid nested ``` blocks.');
  }

  // f) advanced directives sanity checks (callout, audio/video, synced-block, tables)
  for (const callout of findDirectiveBlocks(doc, 'callout')) {
    const bounds = getDirectiveBounds(callout, contentLines);
    if (!bounds) continue;
    const displayStartLine = applyLineOffset(bounds.startLine, lineOffset);
    if (bounds.closingLine.trim() !== ':::') {
      warnings.push(
        `callout starting at line ${displayStartLine} is missing a closing ":::" after its content.`,
      );
      continue;
    }
    const icon = directiveLabel(callout, bounds.markerLine).trim();
    if (!icon) {
      warnings.push(
        `callout starting at line ${displayStartLine} must provide an emoji/icon after ":::callout".`,
      );
    }
    if (!hasNonEmptyLine(bounds.innerLines)) {
      warnings.push(
        `callout starting at line ${displayStartLine} must contain content before the closing ":::" marker.`,
      );
    }
  }

  for (const columnList of findDirectiveBlocks(doc, 'column-list')) {
    const bounds = getDirectiveBounds(columnList, contentLines);
    if (!bounds) continue;
    const displayStartLine = applyLineOffset(bounds.startLine, lineOffset);
    if (bounds.closingLine.trim() !== ':::') {
      warnings.push(
        `column-list starting at line ${displayStartLine} is missing a closing ":::" after its contents.`,
      );
      continue;
    }
    const columns = columnList.children.filter(
      (child) => child.type === 'directive_block' && child.name === 'column',
    ) as PmdDirectiveBlock[];
    if (columns.length === 0) {
      const hasIndentedColumns = bounds.innerLines.some((line) => /^\s+:::column\b/i.test(line));
      if (hasIndentedColumns) {
        warnings.push(
          'Hint: found indented ":::column" markers inside a column-list. Directives must be flush-left (no indentation).',
        );
      }
      warnings.push(
        `column-list starting at line ${displayStartLine} must contain at least one ":::column" section with content.`,
      );
      continue;
    }
    const emptyIdx = columns.findIndex((col) => {
      const colBounds = getDirectiveBounds(col, contentLines);
      if (!colBounds) return true;
      return !hasNonEmptyLine(colBounds.innerLines);
    });
    if (emptyIdx !== -1) {
      warnings.push(
        `column-list starting at line ${displayStartLine} has an empty column #${emptyIdx + 1}; add content or remove it.`,
      );
    }
  }

  for (const syncedBlock of findDirectiveBlocks(doc, 'synced-block')) {
    const bounds = getDirectiveBounds(syncedBlock, contentLines);
    if (!bounds) continue;
    const displayStartLine = applyLineOffset(bounds.startLine, lineOffset);
    if (bounds.closingLine.trim() !== ':::') {
      warnings.push(
        `synced-block starting at line ${displayStartLine} is missing a closing ":::" after its contents.`,
      );
      continue;
    }
    const syncId = directiveLabel(syncedBlock, bounds.markerLine).trim();
    if (!syncId && !hasNonEmptyLine(bounds.innerLines)) {
      warnings.push(
        `synced-block starting at line ${displayStartLine} must include content when no source block id is provided.`,
      );
    }
  }

  const leafs: PmdDirectiveLeaf[] = [];
  collectDirectiveLeaves(doc.body, leafs);
  for (const leaf of leafs) {
    if (leaf.name !== 'audio' && leaf.name !== 'video') continue;
    const label = directiveLeafLabel(leaf, contentLines);
    if (!label) {
      const line = applyLineOffset(leaf.position?.start.line ?? 0, lineOffset);
      if (leaf.name === 'audio') {
        warnings.push(`Line ${line}: audio directive requires a URL after ":::audio".`);
      } else {
        warnings.push(`Line ${line}: video directive requires a URL after ":::video".`);
      }
    }
  }

  for (const table of doc.body) {
    if (table.type !== 'table') continue;
    const rows = table.rows;
    if (rows.length === 0) {
      const line = applyLineOffset(table.position?.start.line ?? 1, lineOffset);
      warnings.push(`Table starting at line ${line} must have at least one column.`);
      continue;
    }
    const width = rows[0]?.length ?? 0;
    if (width === 0) {
      const line = applyLineOffset(table.position?.start.line ?? 1, lineOffset);
      warnings.push(`Table starting at line ${line} must have at least one column.`);
      continue;
    }
    const ragged = rows.findIndex((row) => row.length !== width);
    if (ragged !== -1) {
      const line = applyLineOffset(table.position?.start.line ?? 1, lineOffset);
      warnings.push(
        `Table starting at line ${line} has inconsistent column counts (row ${
          ragged + 1
        } differs). Make all rows the same length.`,
      );
    }
    if (rows.length < 2) {
      const line = applyLineOffset(table.position?.start.line ?? 1, lineOffset);
      warnings.push(`Table starting at line ${line} must include at least one data row.`);
    }
  }

  const blockingWarnings = warnings.filter((warning) => !isNonBlockingWarning(warning));

  // In strict mode, only blocking warnings should surface to callers that expect actionable feedback.
  if (strict && blockingWarnings.length > 0 && errors.length === 0) {
    errors.push(...blockingWarnings);
  }

  const ok = errors.length === 0 && (!strict || blockingWarnings.length === 0);
  const shadowMode =
    voiceAlignmentEnabled && !strictVoiceAlignment
      ? buildShadowModeDiagnostics([...voiceDiagnosticsErrors, ...voiceDiagnosticsWarnings])
      : undefined;
  const voiceDiagnostics: GeneralEnglishValidateResult['voiceDiagnostics'] = {
    capabilities,
    errors: voiceDiagnosticsErrors.length > 0 ? voiceDiagnosticsErrors : undefined,
    warnings: voiceDiagnosticsWarnings.length > 0 ? voiceDiagnosticsWarnings : undefined,
    compatibilityMode: strictVoiceAlignment
      ? { enabled: false }
      : {
          enabled: true,
          reason: voiceAlignmentEnabled
            ? 'VOICE_ALIGNMENT_V2_ENABLED is set but strict validation is disabled.'
            : 'VOICE_ALIGNMENT_V2_ENABLED and VOICE_ALIGNMENT_V2_STRICT_VALIDATION are not both enabled.',
        },
    shadowMode,
  };

  return { ok, errors, warnings, meta, voiceDiagnostics };
}
