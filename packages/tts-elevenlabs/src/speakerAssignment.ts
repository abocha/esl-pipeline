import type { SpeakerProfile } from '@esl-pipeline/md-extractor';
import {
  pickVoiceForSpeaker,
  type SpeakerMeta,
  type VoiceCatalog,
  type PickedVoice,
} from './assign.js';

export type VoiceMapConfig = {
  default?: string;
  auto?: boolean;
  [speaker: string]: unknown;
};

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
  return (str ?? '').trim().toLowerCase();
}

function findProfile(
  profiles: SpeakerProfile[] | undefined,
  speakerId: string
): SpeakerProfile | undefined {
  if (!profiles?.length) return undefined;
  const exact = profiles.find(p => p.id === speakerId);
  if (exact) return exact;
  const lowered = normalize(speakerId);
  return profiles.find(p => normalize(p.id) === lowered);
}

function resolveVoiceToken(token: string, catalog: VoiceCatalog): string | undefined {
  const trimmed = token.trim();
  if (!trimmed) return undefined;
  const byId = catalog.voices.find(v => v.id === trimmed);
  if (byId) return byId.id;
  const lower = trimmed.toLowerCase();
  const byName = catalog.voices.find(v => v.name?.toLowerCase() === lower);
  if (byName) return byName.id;
  return trimmed;
}

function pickFromGenericPool(catalog: VoiceCatalog, used: Set<string>): string | undefined {
  for (const name of GENERIC_VOICE_PRIORITY) {
    const match = catalog.voices.find(
      v => v.name && v.name.toLowerCase() === name.toLowerCase() && !used.has(v.id)
    );
    if (match) return match.id;
  }
  // fallback to first unused voice
  for (const voice of catalog.voices) {
    if (!used.has(voice.id)) return voice.id;
  }
  return undefined;
}

function coerceVoiceToken(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  return undefined;
}

export type SpeakerVoiceAssignment = {
  speaker: string;
  voiceId: string;
  source: 'profile' | 'voiceMap' | 'default' | 'auto' | 'fallback' | 'reuse';
  score?: number;
  profile?: SpeakerProfile;
  catalogEntry?: VoiceCatalog['voices'][number];
};

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
      profile?.voice ?? coerceVoiceToken((voiceMap as Record<string, unknown>)[speaker]);
    const candidates: Array<{ source: 'profile' | 'voiceMap' | 'default'; token: string }> = [];

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
      const fallbackVoice = pickFromGenericPool(catalog, usedVoices);
      if (fallbackVoice) {
        assigned = fallbackVoice;
        assignmentSource = 'fallback';
      }
    }

    if (!assigned) {
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
    const catalogEntry = catalog.voices.find(v => v.id === assigned);
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
