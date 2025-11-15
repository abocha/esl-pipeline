import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type VoiceCatalog = {
  voices: {
    id: string;
    name: string;
    category?: string | null;
    labels?: Record<string, any>;
    preview_url?: string | null;
  }[];
};

export type SpeakerMeta = {
  gender?: 'male' | 'female' | 'child' | 'neutral';
  role?: 'narrator' | 'teacher' | 'student' | 'system';
  age?: 'child' | 'teen' | 'young' | 'adult' | 'middle_aged' | 'senior' | 'universal';
  accent?: string;
  style?: string;
};

export type PickedVoice = {
  id: string;
  score: number;
};

let cachedCatalog: VoiceCatalog | null = null;

export async function loadVoicesCatalog(
  file = 'configs/elevenlabs.voices.json'
): Promise<VoiceCatalog> {
  if (cachedCatalog) return cachedCatalog;

  const candidates = getVoiceCatalogCandidates(file);
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const raw = await readFile(candidate, 'utf8');
      cachedCatalog = JSON.parse(raw) as VoiceCatalog;
      return cachedCatalog;
    } catch (error: any) {
      if (error?.code === 'ENOENT' || error?.code === 'EISDIR') {
        continue;
      }
      continue;
    }
  }

  return { voices: [] };
}

function getVoiceCatalogCandidates(file: string): Array<string | null> {
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

  const resolvedRoots = roots.map(root => resolve(root, file));

  return Array.from(
    new Set<string | null>([override ? resolve(override) : null, resolve(file), ...resolvedRoots])
  );
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

function getLabel(voice: any, key: string): string {
  const v = voice?.labels?.[key];
  return typeof v === 'string' ? v.toLowerCase() : '';
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

function score(voice: any, need: SpeakerMeta): number {
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

  if (role === 'narrator') {
    if (vUse.includes('narration') || vCat.includes('narration')) s += 30;
    if (vUse.includes('news')) s += 10;
  } else if (role === 'teacher') {
    // prefer “narration”, “news” or “conversational” tones for clarity
    if (vUse.includes('narration') || vUse.includes('news') || vUse.includes('conversation'))
      s += 20;
  } else if (role === 'student') {
    // neutral/conversational is fine
    if (vUse.includes('conversation')) s += 10;
    if (vUse.includes('social')) s += 5;
  }

  // small bonus if there's an accent label (variety), but not critical
  if (getLabel(voice, 'accent')) s += 3;

  if (role && ROLE_USE_CASE_HINTS[role as keyof typeof ROLE_USE_CASE_HINTS]) {
    const hints = ROLE_USE_CASE_HINTS[role as keyof typeof ROLE_USE_CASE_HINTS];
    if (hints.some(h => vUse.includes(h))) s += 10;
  }

  if (style) {
    if (vDesc === style) s += 15;
    else if (vDesc.includes(style)) s += 10;
    else if (STYLE_HINTS[style]) {
      const hints = STYLE_HINTS[style]!;
      if (hints.some(h => vDesc.includes(h) || vUse.includes(h))) s += 8;
    }
  }

  return s;
}

export async function pickVoiceForSpeaker(
  speakerName: string,
  meta: SpeakerMeta = {},
  opts: { catalog?: VoiceCatalog; exclude?: Set<string>; requireGenderMatch?: boolean } = {}
): Promise<PickedVoice | null> {
  const catalog = opts.catalog ?? (await loadVoicesCatalog());
  if (!catalog.voices.length) return null;

  const guessedGender = meta.gender ?? guessGenderFromName(speakerName);
  const guessed: SpeakerMeta = {
    gender: guessedGender,
    role: meta.role ?? (speakerName.toLowerCase() === 'narrator' ? 'narrator' : undefined),
    age: meta.age,
    accent: meta.accent,
    style: meta.style,
  };

  const normalizedGender = (guessed.gender || '').toLowerCase();
  const requireGender = opts.requireGenderMatch && Boolean(meta.gender);

  const considerList = (voices: VoiceCatalog['voices']) => {
    let best = { id: '', score: -Infinity };
    for (const v of voices) {
      if (opts.exclude?.has(v.id)) continue;
      const sc = score(v, guessed);
      if (sc > best.score) best = { id: v.id, score: sc };
    }
    return best.id ? best : null;
  };

  if (requireGender && normalizedGender) {
    const matching = catalog.voices.filter(
      v => getLabel(v, 'gender') === normalizedGender && !opts.exclude?.has(v.id)
    );
    if (matching.length) {
      const pick = considerList(matching);
      if (pick) return pick;
    }

    const neutral = catalog.voices.filter(
      v => getLabel(v, 'gender') === 'neutral' && !opts.exclude?.has(v.id)
    );
    if (neutral.length) {
      const pickNeutral = considerList(neutral);
      if (pickNeutral) return pickNeutral;
    }
    // fall through to full catalog if no strict match was available
  }

  const pick = considerList(catalog.voices);
  return pick ?? null;
}
