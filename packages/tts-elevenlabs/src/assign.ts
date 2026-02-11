import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ConfigurationError, InfrastructureError } from '@esl-pipeline/contracts';
import type { VoiceCapabilitiesSnapshot } from '@esl-pipeline/contracts';
import { getVoiceCapabilities } from './voiceCapabilities.js';

export interface VoiceCatalog {
  generatedAt?: string;
  capabilities?: VoiceCapabilitiesSnapshot;
  voices: Voice[];
}

export interface Voice {
  id: string;
  name: string;
  category?: string | null;
  labels?: Record<string, unknown>;
  useCase?: string;
  verifiedLanguages?: { language?: string; locale?: string }[];
  previewUrl?: string | null;
  preview_url?: string | null;
}

export interface SpeakerMeta {
  gender?: 'male' | 'female' | 'child' | 'neutral';
  role?: 'narrator' | 'teacher' | 'student' | 'system';
  age?: 'child' | 'teen' | 'young' | 'adult' | 'middle_aged' | 'senior' | 'universal';
  accent?: string;
  style?: string;
}

export interface PickedVoice {
  id: string;
  score: number;
}

let cachedCatalog: VoiceCatalog | null = null;

export async function loadVoicesCatalog(
  file = 'packages/orchestrator/configs/elevenlabs.voices.json',
): Promise<VoiceCatalog> {
  if (cachedCatalog) return cachedCatalog;

  const candidates = getVoiceCatalogCandidates(file);
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const raw = await readFile(candidate, 'utf8');
      try {
        const parsed = JSON.parse(raw) as VoiceCatalog;
        const voices = Array.isArray(parsed?.voices) ? parsed.voices : undefined;
        if (!voices) {
          throw new ConfigurationError(
            `Invalid ElevenLabs voices catalog JSON at "${candidate}": missing "voices" array`,
          );
        }
        cachedCatalog = {
          generatedAt: parsed.generatedAt,
          capabilities: parsed.capabilities,
          voices,
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new ConfigurationError(
          `Invalid ElevenLabs voices catalog JSON at "${candidate}": ${message}`,
        );
      }
      return cachedCatalog;
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code === 'ENOENT') {
        continue;
      }
      if (error instanceof ConfigurationError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new InfrastructureError(
        `Failed to read ElevenLabs voices catalog at "${candidate}": ${message}`,
      );
    }
  }

  return { voices: [] };
}

export async function loadVoiceCapabilities(
  file = 'packages/orchestrator/configs/elevenlabs.voices.json',
): Promise<VoiceCapabilitiesSnapshot> {
  const catalog = await loadVoicesCatalog(file);
  return getVoiceCapabilities(catalog);
}

function getVoiceCatalogCandidates(file: string): (string | null)[] {
  const override = process.env.ELEVENLABS_VOICES_PATH;
  const cwd = process.cwd();
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const pipelineCwd = process.env.PIPELINE_CWD;

  const roots = [
    cwd,
    resolve(cwd, '..'),
    resolve(cwd, '..', '..'),
    moduleDir,
    resolve(moduleDir, '..'),
    resolve(moduleDir, '..', '..'),
  ];

  if (pipelineCwd) {
    roots.unshift(pipelineCwd);
  }

  const resolvedRoots = roots.map((root) => resolve(root, file));

  return [
    ...new Set<string | null>([
      override ? resolve(override) : null,
      resolve(file),
      ...resolvedRoots,
    ]),
  ];
}

// crude heuristic for gender from speaker name if user didn't provide metadata
function guessGenderFromName(name: string): SpeakerMeta['gender'] {
  const n = name.trim().toLowerCase();
  if (!n) return 'neutral';
  // simple heuristic: names ending with 'a' or common female markers
  if (/[ae]$/.test(n) || /(anna|maria|olga|mara|sofia|eva|lisa|emma)$/.test(n)) return 'female';
  if (/(alex|john|mike|jack|dan|peter|paul|martin)$/.test(n)) return 'male';
  return 'neutral';
}

function getLabel(voice: Voice, key: string): string {
  const candidates = [key];
  if (key === 'use_case') candidates.push('useCase');
  if (key === 'preview_url') candidates.push('previewUrl');

  for (const candidate of candidates) {
    const direct = voice?.labels?.[candidate];
    if (typeof direct === 'string') return direct.toLowerCase();
  }

  if (key === 'use_case' && typeof voice.useCase === 'string') {
    return voice.useCase.toLowerCase();
  }

  if (key === 'language' && Array.isArray(voice.verifiedLanguages)) {
    const language = voice.verifiedLanguages
      .map((entry) => (entry.language ?? entry.locale ?? '').trim().toLowerCase())
      .find((entry) => entry.length > 0);
    if (language) return language;
  }

  return '';
}

const ROLE_USE_CASE_HINTS: Record<NonNullable<SpeakerMeta['role']>, string[]> = {
  narrator: ['narration', 'narrative', 'audiobook', 'news'],
  teacher: ['narration', 'news', 'conversational', 'audiobook'],
  student: ['conversational', 'social', 'social_media', 'characters', 'dialogue'],
  system: ['narration', 'news', 'conversational'],
};

const STYLE_HINTS: Record<string, string[]> = {
  professional: ['professional', 'narration', 'news'],
  social: ['social', 'conversational', 'casual'],
  calm: ['calm', 'relaxed', 'soothing'],
  energetic: ['energetic', 'hyped', 'excited'],
  creative: ['creative', 'expressive'],
  practical: ['practical', 'clear', 'confident'],
  thoughtful: ['thoughtful', 'calm', 'narration'],
};

function score(voice: Voice, need: SpeakerMeta): number {
  // higher is better
  let s = 0;

  const gender = (need.gender || '').toLowerCase();
  const role = (need.role || '').toLowerCase();
  const desiredAge = (need.age || '').toLowerCase();
  const accent = (need.accent || '').toLowerCase();
  const style = (need.style || '').toLowerCase();

  const vGender = getLabel(voice, 'gender'); // "male"|"female"|...
  const vUse = getLabel(voice, 'use_case'); // e.g. "narration", "news", etc.
  const vCat = (voice.category || '').toLowerCase();
  const vAccent = getLabel(voice, 'accent');
  const vAge = getLabel(voice, 'age');
  const vDesc = getLabel(voice, 'descriptive');

  if (gender) {
    if (vGender === gender) s += 40;
    else if (vGender && vGender !== gender) s -= 15;
    else if (!vGender) s += 5; // no gender tag, still acceptable
  }

  if (desiredAge) {
    if (vAge === desiredAge) s += 20;
    else if (vAge && vAge !== desiredAge) s -= 5;
  }

  if (accent) {
    if (vAccent === accent) s += 20;
    else if (vAccent && vAccent !== accent) s -= 5;
  }

  switch (role) {
    case 'narrator': {
      if (vUse.includes('narration') || vCat.includes('narration')) s += 30;
      if (vUse.includes('news')) s += 10;

      break;
    }
    case 'teacher': {
      // prefer “narration”, “news” or “conversational” tones for clarity
      if (vUse.includes('narration') || vUse.includes('news') || vUse.includes('conversation'))
        s += 20;

      break;
    }
    case 'student': {
      // neutral/conversational is fine
      if (vUse.includes('conversation')) s += 10;
      if (vUse.includes('social')) s += 5;

      break;
    }
    // No default
  }

  // small bonus if there's an accent label (variety), but not critical
  if (getLabel(voice, 'accent')) s += 3;

  if (role && ROLE_USE_CASE_HINTS[role as keyof typeof ROLE_USE_CASE_HINTS]) {
    const hints = ROLE_USE_CASE_HINTS[role as keyof typeof ROLE_USE_CASE_HINTS];
    if (hints.some((h) => vUse.includes(h))) s += 10;
  }

  if (style) {
    if (vDesc === style) s += 15;
    else if (vDesc.includes(style)) s += 10;
    else if (STYLE_HINTS[style]) {
      const hints = STYLE_HINTS[style]!;
      if (hints.some((h) => vDesc.includes(h) || vUse.includes(h))) s += 8;
    }
  }

  return s;
}

type NormalizedGender = 'male' | 'female' | 'neutral' | 'child' | '';

function normalizeGender(gender: unknown): NormalizedGender {
  const normalized = typeof gender === 'string' ? gender.trim().toLowerCase() : '';
  if (normalized === 'male') return 'male';
  if (normalized === 'female') return 'female';
  if (normalized === 'neutral') return 'neutral';
  if (normalized === 'child') return 'child';
  return '';
}

function getVoiceGender(voice: Voice): NormalizedGender {
  return normalizeGender(getLabel(voice, 'gender'));
}

export async function pickVoiceForSpeaker(
  speakerName: string,
  meta: SpeakerMeta = {},
  opts: { catalog?: VoiceCatalog; exclude?: Set<string>; requireGenderMatch?: boolean } = {},
): Promise<PickedVoice | null> {
  const catalog = opts.catalog ?? (await loadVoicesCatalog());
  if (catalog.voices.length === 0) return null;

  const explicitGender = normalizeGender(meta.gender);
  const guessedGender = explicitGender || guessGenderFromName(speakerName);
  const guessed: SpeakerMeta = {
    gender: guessedGender || undefined,
    role: meta.role ?? (speakerName.toLowerCase() === 'narrator' ? 'narrator' : undefined),
    age: meta.age,
    accent: meta.accent,
    style: meta.style,
  };

  const considerList = (voices: VoiceCatalog['voices']) => {
    let best = { id: '', score: -Infinity };
    for (const v of voices) {
      if (opts.exclude?.has(v.id)) continue;
      const sc = score(v, guessed);
      if (sc > best.score) best = { id: v.id, score: sc };
    }
    return best.id ? best : null;
  };

  // Gender selection policy (when explicit gender is provided by the user/profile):
  // - male -> prefer male; fallback to neutral; avoid female unless no other option exists.
  // - female -> prefer female; fallback to neutral; avoid male unless no other option exists.
  // - neutral -> prefer neutral; fallback to any gender.
  //
  // If gender is inferred (not explicit), keep "best score" behavior.
  if (explicitGender === 'male' || explicitGender === 'female') {
    const opposite = explicitGender === 'male' ? 'female' : 'male';
    const preferred = catalog.voices.filter(
      (v) => getVoiceGender(v) === explicitGender && !opts.exclude?.has(v.id),
    );
    const neutral = catalog.voices.filter((v) => {
      const g = getVoiceGender(v);
      return (g === 'neutral' || g === '') && !opts.exclude?.has(v.id);
    });
    const notOpposite = catalog.voices.filter(
      (v) => getVoiceGender(v) !== opposite && !opts.exclude?.has(v.id),
    );

    const strict = opts.requireGenderMatch === true;
    if (strict) {
      // Strict policy: never return the opposite gender when the user explicitly set male/female.
      // Neutral is allowed only as a fallback.
      return considerList(preferred) ?? considerList(neutral) ?? null;
    }

    return considerList(preferred) ?? considerList(neutral) ?? considerList(notOpposite) ?? null;
  }

  if (explicitGender === 'neutral') {
    const neutral = catalog.voices.filter((v) => {
      const g = getVoiceGender(v);
      return (g === 'neutral' || g === '') && !opts.exclude?.has(v.id);
    });
    return considerList(neutral) ?? considerList(catalog.voices) ?? null;
  }

  const pick = considerList(catalog.voices);
  return pick ?? null;
}
