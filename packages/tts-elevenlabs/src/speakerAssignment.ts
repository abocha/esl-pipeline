import { ConfigurationError } from '@esl-pipeline/contracts';
import type { SpeakerProfile } from '@esl-pipeline/md-extractor';

import {
  type PickedVoice,
  type SpeakerMeta,
  type VoiceCatalog,
  pickVoiceForSpeaker,
} from './assign.js';

export interface VoiceMapConfig {
  default?: string;
  auto?: boolean;
  [speaker: string]: unknown;
}

const GENERIC_VOICE_PRIORITY = [
  'Liam',
  'Sarah',
  'George',
  'Alice',
  'Charlie',
  'Matilda',
  'Bella',
  'River',
  'Callum',
  'Laura',
  'Roger',
  'Clyde',
  'Harry',
];

const ROLE_FALLBACK_BY_MODE: Record<'monologue' | 'dialogue', SpeakerMeta['role']> = {
  monologue: 'narrator',
  dialogue: 'student',
};

function normalize(str: string | undefined | null): string {
  const s = (str ?? '').trim().toLowerCase();
  // Keep this small and deterministic: strip common markdown punctuation from speaker ids
  // (e.g. "**Mark" from "**Mark:**").
  const stripped = s
    .replaceAll(/[*_`~>#]/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim();
  // Also strip trailing colon-like punctuation commonly used in dialogue labels.
  return stripped.replaceAll(/[:：]+$/g, '').trim();
}

function findProfile(
  profiles: SpeakerProfile[] | undefined,
  speakerId: string,
): SpeakerProfile | undefined {
  if (!profiles?.length) return undefined;
  const exact = profiles.find((p) => p.id === speakerId);
  if (exact) return exact;
  const exactDisplay = profiles.find((p) => p.display_name === speakerId);
  if (exactDisplay) return exactDisplay;
  const lowered = normalize(speakerId);
  return profiles.find((p) => normalize(p.id) === lowered || normalize(p.display_name) === lowered);
}

function resolveVoiceToken(token: string, catalog: VoiceCatalog): string | undefined {
  const trimmed = token.trim();
  if (!trimmed) return undefined;
  const byId = catalog.voices.find((v) => v.id === trimmed);
  if (byId) return byId.id;
  const lower = trimmed.toLowerCase();
  const byName = catalog.voices.find((v) => v.name?.toLowerCase() === lower);
  if (byName) return byName.id;
  return trimmed;
}

function pickFromGenericPool(catalog: VoiceCatalog, used: Set<string>): string | undefined {
  for (const name of GENERIC_VOICE_PRIORITY) {
    const match = catalog.voices.find(
      (v) => v.name && v.name.toLowerCase() === name.toLowerCase() && !used.has(v.id),
    );
    if (match) return match.id;
  }
  // fallback to first unused voice
  for (const voice of catalog.voices) {
    if (!used.has(voice.id)) return voice.id;
  }
  return undefined;
}

function pickFromGenericPoolWithGender(
  catalog: VoiceCatalog,
  used: Set<string>,
  allowed: ReadonlySet<string>,
): string | undefined {
  const isAllowed = (voice: VoiceCatalog['voices'][number]) => {
    const gender =
      typeof voice.labels?.gender === 'string' ? voice.labels.gender.trim().toLowerCase() : '';
    const normalized = gender || 'neutral';
    return allowed.has(normalized);
  };

  for (const name of GENERIC_VOICE_PRIORITY) {
    const match = catalog.voices.find(
      (v) =>
        v.name && v.name.toLowerCase() === name.toLowerCase() && !used.has(v.id) && isAllowed(v),
    );
    if (match) return match.id;
  }

  for (const voice of catalog.voices) {
    if (!used.has(voice.id) && isAllowed(voice)) return voice.id;
  }
  return undefined;
}

function coerceVoiceToken(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  return undefined;
}

export interface SpeakerVoiceAssignment {
  speaker: string;
  voiceId: string;
  source: 'profile' | 'voiceMap' | 'default' | 'auto' | 'fallback' | 'reuse';
  score?: number;
  profile?: SpeakerProfile;
  catalogEntry?: VoiceCatalog['voices'][number];
}

export async function resolveSpeakerVoices(opts: {
  speakers: string[];
  profiles?: SpeakerProfile[];
  voiceMap: VoiceMapConfig;
  catalog: VoiceCatalog;
  mode: 'monologue' | 'dialogue';
  defaultAccent?: string;
}): Promise<SpeakerVoiceAssignment[]> {
  const assignments: SpeakerVoiceAssignment[] = [];
  const usedVoices = new Set<string>();
  const { voiceMap, catalog } = opts;
  const autoToken = (voiceMap.auto as unknown) ?? true;
  const autoEnabled = !(autoToken === false || autoToken === 'false');
  const defaultToken = coerceVoiceToken(voiceMap.default);
  const fallbackAccent =
    typeof opts.defaultAccent === 'string'
      ? opts.defaultAccent.trim().toLowerCase() || undefined
      : undefined;

  for (const speaker of opts.speakers) {
    const profile = findProfile(opts.profiles, speaker);
    const normalizedSpeaker = normalize(speaker);
    const explicitVoice =
      profile?.voice ??
      coerceVoiceToken((voiceMap as Record<string, unknown>)[speaker]) ??
      (profile
        ? (coerceVoiceToken((voiceMap as Record<string, unknown>)[profile.id]) ??
          coerceVoiceToken((voiceMap as Record<string, unknown>)[profile.display_name ?? '']))
        : undefined);
    const candidates: { source: 'profile' | 'voiceMap' | 'default'; token: string }[] = [];

    if (explicitVoice) {
      candidates.push({ source: profile?.voice ? 'profile' : 'voiceMap', token: explicitVoice });
    }
    if (defaultToken) {
      candidates.push({ source: 'default', token: defaultToken });
    }

    let assigned: string | undefined;
    let assignmentSource: SpeakerVoiceAssignment['source'] | undefined;
    let heuristicPick: PickedVoice | null = null;

    for (const candidate of candidates) {
      const resolved = resolveVoiceToken(candidate.token, catalog);
      if (!resolved) continue;
      if (usedVoices.has(resolved)) continue;
      assigned = resolved;
      assignmentSource =
        candidate.source === 'default'
          ? 'default'
          : candidate.source === 'profile'
            ? 'profile'
            : 'voiceMap';
      break;
    }

    if (!assigned) {
      const inferredRole =
        profile?.role ??
        (normalizedSpeaker === 'narrator'
          ? 'narrator'
          : normalizedSpeaker.includes('teacher')
            ? 'teacher'
            : ROLE_FALLBACK_BY_MODE[opts.mode]);
      const profileAccent =
        typeof profile?.accent === 'string' && profile.accent.trim().length > 0
          ? profile.accent.trim().toLowerCase()
          : undefined;
      const accentPreference = profileAccent ?? fallbackAccent;
      const meta: SpeakerMeta = {
        gender: profile?.gender,
        role: inferredRole,
        age:
          profile?.age && profile.age !== 'universal'
            ? (profile.age as SpeakerMeta['age'])
            : undefined,
        accent: accentPreference,
        style: profile?.style,
      };
      const profileGender = profile?.gender;
      const requireGenderMatch = Boolean(profileGender && profileGender !== 'neutral');

      heuristicPick =
        autoEnabled || profile
          ? await pickVoiceForSpeaker(speaker, meta, {
              catalog,
              exclude: usedVoices,
              requireGenderMatch,
            })
          : null;

      if (heuristicPick && !usedVoices.has(heuristicPick.id)) {
        assigned = heuristicPick.id;
        assignmentSource = 'auto';
      }
    }

    if (!assigned) {
      const profileGender = profile?.gender?.toString().trim().toLowerCase();
      const fallbackVoice =
        profileGender === 'male'
          ? pickFromGenericPoolWithGender(catalog, usedVoices, new Set(['male', 'neutral']))
          : profileGender === 'female'
            ? pickFromGenericPoolWithGender(catalog, usedVoices, new Set(['female', 'neutral']))
            : pickFromGenericPool(catalog, usedVoices);
      if (fallbackVoice) {
        assigned = fallbackVoice;
        assignmentSource = 'fallback';
      }
    }

    if (!assigned) {
      const profileGender = profile?.gender?.toString().trim().toLowerCase();
      const strictGender = profileGender === 'male' || profileGender === 'female';
      if (strictGender) {
        throw new ConfigurationError(
          `No acceptable ElevenLabs voice found for speaker "${speaker}" with gender "${profileGender}". ` +
            `Add a matching voice to your voice catalog or override via voices.yml.`,
        );
      }

      // as final fallback reuse default even if already taken
      const reuse = resolveVoiceToken(defaultToken ?? '', catalog);
      if (reuse) {
        assigned = reuse;
        assignmentSource = 'reuse';
      } else if (explicitVoice) {
        assigned = resolveVoiceToken(explicitVoice, catalog);
        assignmentSource = 'reuse';
      }
    }

    if (!assigned) {
      throw new Error(`Unable to resolve voice for speaker "${speaker}"`);
    }

    usedVoices.add(assigned);
    const catalogEntry = catalog.voices.find((v) => v.id === assigned);
    assignments.push({
      speaker,
      voiceId: assigned,
      source: assignmentSource ?? 'auto',
      score: assignmentSource === 'auto' ? heuristicPick?.score : undefined,
      profile,
      catalogEntry,
    });
  }

  return assignments;
}
