import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { VoiceCapabilitiesSnapshot } from '@esl-pipeline/contracts';

const VOICE_CATALOG_RELATIVE_PATH = 'packages/orchestrator/configs/elevenlabs.voices.json';
const CAPABILITY_BLOCK_PATTERN = /```yaml\s*\n# CAPABILITY SNAPSHOT[^\n]*\n[\s\S]*?\n```/m;
const CANONICAL_ROLE: VoiceCapabilitiesSnapshot['role'] = ['narrator', 'teacher', 'student', 'system'];
const CANONICAL_GENDER: VoiceCapabilitiesSnapshot['gender'] = ['male', 'female', 'neutral', 'child'];
const CANONICAL_AGE: VoiceCapabilitiesSnapshot['age'] = [
  'child',
  'teen',
  'young',
  'adult',
  'middle_aged',
  'senior',
  'universal',
];

interface VoiceCatalogLike {
  generatedAt?: unknown;
  capabilities?: unknown;
  voices?: {
    labels?: Record<string, unknown>;
    useCase?: unknown;
  }[];
}

export interface PromptVoiceCapabilitiesResolution {
  materializedTemplate: string;
  capabilitiesSnapshot: VoiceCapabilitiesSnapshot | null;
  capabilitiesHash: string | null;
  capabilitiesGeneratedAt: Date | null;
}

export async function materializePromptTemplateWithCapabilities(params: {
  templateId: string;
  templateContent: string;
}): Promise<PromptVoiceCapabilitiesResolution> {
  const isVoiceAlignedTemplate = params.templateId.includes('hw_prompt_v4-3_voice-aligned');
  if (!isVoiceAlignedTemplate) {
    return {
      materializedTemplate: params.templateContent,
      capabilitiesSnapshot: null,
      capabilitiesHash: null,
      capabilitiesGeneratedAt: null,
    };
  }

  const snapshot = await loadVoiceCapabilitiesSnapshot();
  if (!snapshot) {
    throw new Error(
      'Prompt template hw_prompt_v4-3_voice-aligned requires a voice capabilities snapshot. ' +
        'Sync voices first or set ELEVENLABS_VOICES_PATH.',
    );
  }

  const materializedTemplate = injectCapabilitiesBlock(params.templateContent, snapshot);
  const capabilitiesHash = createHash('sha256')
    .update(JSON.stringify(snapshot), 'utf8')
    .digest('hex');
  const generatedAt = new Date(snapshot.generatedAt);

  return {
    materializedTemplate,
    capabilitiesSnapshot: snapshot,
    capabilitiesHash,
    capabilitiesGeneratedAt: Number.isNaN(generatedAt.getTime()) ? null : generatedAt,
  };
}

async function loadVoiceCapabilitiesSnapshot(): Promise<VoiceCapabilitiesSnapshot | null> {
  const candidates = getVoiceCatalogCandidates();
  for (const candidate of candidates) {
    try {
      const raw = await readFile(candidate, 'utf8');
      const parsed = JSON.parse(raw) as VoiceCatalogLike;
      if (!parsed || typeof parsed !== 'object') continue;

      const snapshot = parseCapabilitiesSnapshot(parsed);
      if (snapshot) return snapshot;
    } catch (error: unknown) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code === 'ENOENT' || err?.code === 'EISDIR') continue;
      continue;
    }
  }
  return null;
}

function parseCapabilitiesSnapshot(catalog: VoiceCatalogLike): VoiceCapabilitiesSnapshot | null {
  if (catalog.capabilities && typeof catalog.capabilities === 'object') {
    const parsed = catalog.capabilities as Partial<VoiceCapabilitiesSnapshot>;
    if (
      Array.isArray(parsed.role) &&
      Array.isArray(parsed.gender) &&
      Array.isArray(parsed.age) &&
      Array.isArray(parsed.accent) &&
      Array.isArray(parsed.style)
    ) {
      return normalizeSnapshot({
        generatedAt:
          typeof parsed.generatedAt === 'string'
            ? parsed.generatedAt
            : typeof catalog.generatedAt === 'string'
              ? catalog.generatedAt
              : new Date().toISOString(),
        role: parsed.role as VoiceCapabilitiesSnapshot['role'],
        gender: parsed.gender as VoiceCapabilitiesSnapshot['gender'],
        age: parsed.age as VoiceCapabilitiesSnapshot['age'],
        accent: parsed.accent as string[],
        style: parsed.style as string[],
      });
    }
  }

  if (!Array.isArray(catalog.voices)) return null;

  const accents = new Set<string>();
  const styles = new Set<string>();
  const ages = new Set<VoiceCapabilitiesSnapshot['age'][number]>();
  const genders = new Set<VoiceCapabilitiesSnapshot['gender'][number]>();
  for (const voice of catalog.voices) {
    const labels = voice.labels ?? {};
    for (const value of splitValues(labels.accent)) {
      const normalized = normalizeAccent(value);
      if (normalized) accents.add(normalized);
    }
    for (const value of [
      ...splitValues(labels.descriptive),
      ...splitValues(labels.style),
      ...splitValues(labels.use_case),
      ...splitValues(voice.useCase),
    ]) {
      const normalized = normalizeStyle(value);
      if (normalized) styles.add(normalized);
    }
    for (const value of splitValues(labels.age)) {
      const normalized = normalizeEnum(value);
      if (CANONICAL_AGE.includes(normalized as VoiceCapabilitiesSnapshot['age'][number])) {
        ages.add(normalized as VoiceCapabilitiesSnapshot['age'][number]);
      }
    }
    for (const value of splitValues(labels.gender)) {
      const normalized = normalizeEnum(value);
      if (CANONICAL_GENDER.includes(normalized as VoiceCapabilitiesSnapshot['gender'][number])) {
        genders.add(normalized as VoiceCapabilitiesSnapshot['gender'][number]);
      }
    }
  }

  return normalizeSnapshot({
    generatedAt: typeof catalog.generatedAt === 'string' ? catalog.generatedAt : new Date().toISOString(),
    role: [...CANONICAL_ROLE],
    gender: [...(genders.size > 0 ? genders : CANONICAL_GENDER)],
    age: [...(ages.size > 0 ? ages : CANONICAL_AGE)],
    accent: [...accents],
    style: [...styles],
  });
}

function normalizeSnapshot(snapshot: VoiceCapabilitiesSnapshot): VoiceCapabilitiesSnapshot {
  const generatedAt = new Date(snapshot.generatedAt);
  return {
    generatedAt: Number.isNaN(generatedAt.getTime())
      ? new Date().toISOString()
      : generatedAt.toISOString(),
    role: [...new Set(snapshot.role.map((value) => normalizeEnum(value)))].sort() as VoiceCapabilitiesSnapshot['role'],
    gender: [...new Set(snapshot.gender.map((value) => normalizeEnum(value)))].sort() as VoiceCapabilitiesSnapshot['gender'],
    age: [...new Set(snapshot.age.map((value) => normalizeEnum(value)))].sort() as VoiceCapabilitiesSnapshot['age'],
    accent: [...new Set(snapshot.accent.map((value) => normalizeAccent(value)).filter(Boolean))].sort(),
    style: [...new Set(snapshot.style.map((value) => normalizeStyle(value)).filter(Boolean))].sort(),
  };
}

function injectCapabilitiesBlock(templateContent: string, snapshot: VoiceCapabilitiesSnapshot): string {
  if (!templateContent.includes('# CAPABILITY SNAPSHOT')) {
    throw new Error(
      'Prompt template hw_prompt_v4-3_voice-aligned is missing the capability snapshot marker.',
    );
  }

  const replacement = [
    '```yaml',
    '# CAPABILITY SNAPSHOT (injected dynamically per voice catalog refresh)',
    `role: ${formatInlineList(snapshot.role)}`,
    `gender: ${formatInlineList(snapshot.gender)}`,
    `age: ${formatInlineList(snapshot.age)}`,
    `accent: ${formatInlineList(snapshot.accent)}`,
    `style: ${formatInlineList(snapshot.style)}`,
    '```',
  ].join('\n');

  if (CAPABILITY_BLOCK_PATTERN.test(templateContent)) {
    return templateContent.replace(CAPABILITY_BLOCK_PATTERN, replacement);
  }

  throw new Error(
    'Prompt template hw_prompt_v4-3_voice-aligned capability snapshot block format is invalid.',
  );
}

function formatInlineList(values: readonly string[]): string {
  if (values.length === 0) return '[]';
  return `[${values.join(', ')}]`;
}

function normalizeToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[\s-]+/g, '_')
    .replaceAll(/[^a-z0-9_]/g, '');
}

function normalizeEnum(value: string): string {
  return normalizeToken(value);
}

function normalizeAccent(value: string): string {
  const normalized = normalizeToken(value);
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
  const normalized = normalizeToken(value);
  if (!normalized) return '';
  if (normalized.includes('conversation')) return 'conversational';
  if (normalized.includes('narrat')) return 'narration';
  if (normalized.includes('character')) return 'characters';
  return normalized;
}

function splitValues(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(/[;,/|]/g)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function getVoiceCatalogCandidates(): string[] {
  const cwd = process.cwd();
  const roots = [cwd, resolve(cwd, '..'), resolve(cwd, '..', '..')];
  const overridePath = process.env.ELEVENLABS_VOICES_PATH
    ? resolve(process.env.ELEVENLABS_VOICES_PATH)
    : null;
  const repoRootEnv = process.env.REPO_ROOT || process.env.APP_ROOT || process.env.PROJECT_ROOT;
  if (repoRootEnv) {
    roots.push(resolve(repoRootEnv));
  }
  const paths = [
    overridePath,
    ...roots.map((root) => resolve(root, VOICE_CATALOG_RELATIVE_PATH)),
  ].filter(Boolean);

  return [...new Set(paths)] as string[];
}
