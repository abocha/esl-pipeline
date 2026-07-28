import { InworldTTS, type InworldTTSClient, type VoiceInfo } from '@inworld/tts';

import type { PipelineLogger, SpeakerProfile } from '@esl-pipeline/contracts';
import {
  INWORLD_TTS_MODELS,
  type InworldTtsModel,
  type SpeakerVoiceAssignment,
  type VoiceAssignmentCapabilities,
  type VoiceAssignmentResolution,
  type VoiceCatalog,
  type VoicePlanRanker,
} from '@esl-pipeline/tts-core';

import {
  classifyInworldTtsProviderError,
  resolveInworldApiKey,
  resolveInworldTimeoutMs,
} from './synthesis.js';

export const DEFAULT_INWORLD_VOICES = ['Ashley', 'Dennis'] as const;
const DEFAULT_INWORLD_TTS_MODEL: InworldTtsModel = 'inworld-tts-2';
const CANONICAL_ROLE = ['narrator', 'teacher', 'student', 'system'] as const;
const CANONICAL_GENDER = ['male', 'female', 'neutral', 'child'] as const;
const CANONICAL_AGE = [
  'child',
  'teen',
  'young',
  'adult',
  'middle_aged',
  'senior',
  'universal',
] as const;

export interface VoiceMapConfig extends Record<string, unknown> {
  default?: unknown;
}

export interface InworldSpeakerAssignment extends SpeakerVoiceAssignment {
  selectionReason: string;
  capabilities: VoiceAssignmentCapabilities;
  language?: string;
}

export interface InworldSpeakerAssignmentOptions {
  defaultVoiceId?: string;
  defaultAccent?: string;
  profiles?: SpeakerProfile[];
  ranker?: VoicePlanRanker;
  model?: InworldTtsModel;
  logger?: PipelineLogger;
}

function normalizeVoiceMapToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeSpeakerToken(value: string | undefined | null): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replaceAll(/[*_`~>#\]]/g, '')
    .replaceAll('[', '')
    .replaceAll(/\s+/g, ' ')
    .replaceAll(/[:：]+$/g, '')
    .trim();
}

function resolveVoiceMapValue(voiceMap: VoiceMapConfig, speaker: string): string | undefined {
  const direct = normalizeVoiceMapToken(voiceMap[speaker]);
  if (direct) return direct;
  const normalizedSpeaker = normalizeSpeakerToken(speaker);
  const entry = Object.entries(voiceMap).find(
    ([key]) => normalizeSpeakerToken(key) === normalizedSpeaker,
  );
  return entry ? normalizeVoiceMapToken(entry[1]) : undefined;
}

export function resolveInworldSpeakerAssignmentsFromCatalog(
  speakers: string[],
  voiceMap: VoiceMapConfig,
  catalog: Pick<VoiceCatalog, 'voices'>,
  options: InworldSpeakerAssignmentOptions = {},
): InworldSpeakerAssignment[] {
  const configuredDefault = options.defaultVoiceId ?? normalizeVoiceMapToken(voiceMap.default);
  const model = options.model ?? DEFAULT_INWORLD_TTS_MODEL;
  const credentialedEnglishVoices = catalog.voices.filter(
    (voice) => !isStaticInworldVoice(voice.id) && isEnglishInworldVoice(voice),
  );
  const staticVoices = catalog.voices.filter((voice) => isStaticInworldVoice(voice.id));
  const usedVoices = new Set<string>();

  return speakers.map((speaker, index) => {
    const explicit = resolveVoiceMapValue(voiceMap, speaker);
    if (explicit || configuredDefault) {
      const voiceId = explicit ?? configuredDefault!;
      const catalogVoice = catalog.voices.find((voice) => voice.id === voiceId);
      return {
        speaker,
        voiceId,
        source: explicit ? 'voiceMap' : 'default',
        score: explicit ? 100 : 90,
        selectionReason: explicit
          ? 'Selected from voices.yml explicit speaker mapping.'
          : 'Selected from configured Inworld default voice.',
        capabilities: resolveInworldVoiceCapabilities(model),
        ...(resolveCatalogVoiceLanguage(catalogVoice)
          ? { language: resolveCatalogVoiceLanguage(catalogVoice) }
          : {}),
      };
    }

    const profile = findInworldSpeakerProfile(options.profiles, speaker);
    const preferredAccent =
      normalizeRequestedAccent(profile?.accent) ?? normalizeRequestedAccent(options.defaultAccent);
    const candidates = credentialedEnglishVoices
      .map((voice) => scoreInworldVoiceCandidate({ voice, profile, preferredAccent, model }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.voice.name.localeCompare(b.voice.name) ||
          a.voice.id.localeCompare(b.voice.id),
      );
    const selected =
      candidates.find((candidate) => !usedVoices.has(candidate.voice.id)) ?? candidates[0];
    if (selected) {
      usedVoices.add(selected.voice.id);
      const exactAccent = !preferredAccent || selected.accent === preferredAccent;
      return {
        speaker,
        voiceId: selected.voice.id,
        source: exactAccent ? 'auto' : 'fallback',
        score: selected.score,
        selectionReason: exactAccent
          ? `Selected from Inworld credentialed English catalog with ${preferredAccent ? `exact "${preferredAccent}" accent` : 'deterministic scoring'}.`
          : `Selected deterministic Inworld English fallback because accent "${preferredAccent}" was unavailable.`,
        capabilityMatches: selected.capabilityMatches,
        capabilityMismatches: selected.capabilityMismatches,
        capabilities: selected.capabilities,
        ...(resolveCatalogVoiceLanguage(selected.voice)
          ? { language: resolveCatalogVoiceLanguage(selected.voice) }
          : {}),
      };
    }

    const staticVoice =
      staticVoices[index % staticVoices.length]?.id ??
      DEFAULT_INWORLD_VOICES[index % DEFAULT_INWORLD_VOICES.length] ??
      DEFAULT_INWORLD_VOICES[0];
    usedVoices.add(staticVoice);
    return {
      speaker,
      voiceId: staticVoice,
      source: 'fallback',
      score: 50 - index,
      selectionReason: 'Selected from Inworld static fallback voices.',
      capabilities: resolveInworldVoiceCapabilities(model),
      ...(resolveCatalogVoiceLanguage(catalog.voices.find((voice) => voice.id === staticVoice))
        ? {
            language: resolveCatalogVoiceLanguage(
              catalog.voices.find((voice) => voice.id === staticVoice),
            ),
          }
        : {}),
    };
  });
}

export async function resolveInworldSpeakerAssignmentsWithRankerFromCatalog(
  speakers: string[],
  voiceMap: VoiceMapConfig,
  catalog: Pick<VoiceCatalog, 'voices'>,
  options: InworldSpeakerAssignmentOptions = {},
): Promise<VoiceAssignmentResolution> {
  const deterministic = resolveInworldSpeakerAssignmentsFromCatalog(
    speakers,
    voiceMap,
    catalog,
    options,
  );
  if (!options.ranker) {
    return { assignments: deterministic, mode: 'deterministic', fallbackReason: 'ranker_disabled' };
  }
  if (options.model !== 'inworld-tts-2') {
    options.logger?.log({
      level: 'info',
      stage: 'voice-plan',
      message: 'Inworld voice ranker skipped',
      detail: {
        ranker: options.ranker.metadata,
        reason: 'model_not_supported',
        model: options.model,
      },
    });
    return {
      assignments: deterministic,
      mode: 'deterministic',
      fallbackReason: 'model_not_supported',
    };
  }

  const credentialedEnglishVoices = catalog.voices.filter(
    (voice) => !isStaticInworldVoice(voice.id) && isEnglishInworldVoice(voice),
  );
  const rankable = deterministic.flatMap((assignment) => {
    if (assignment.source !== 'auto' && assignment.source !== 'fallback') return [];
    const profile = findInworldSpeakerProfile(options.profiles, assignment.speaker);
    const preferredAccent =
      normalizeRequestedAccent(profile?.accent) ?? normalizeRequestedAccent(options.defaultAccent);
    const candidates = credentialedEnglishVoices
      .map((voice) =>
        scoreInworldVoiceCandidate({
          voice,
          profile,
          preferredAccent,
          model: options.model ?? DEFAULT_INWORLD_TTS_MODEL,
        }),
      )
      .sort(
        (a, b) =>
          b.score - a.score ||
          a.voice.name.localeCompare(b.voice.name) ||
          a.voice.id.localeCompare(b.voice.id),
      )
      .slice(0, 12);
    return candidates.length > 0 ? [{ assignment, profile, candidates }] : [];
  });
  if (rankable.length === 0) {
    options.logger?.log({
      level: 'info',
      stage: 'voice-plan',
      message: 'Inworld voice ranker skipped',
      detail: {
        ranker: options.ranker.metadata,
        reason: 'no_rankable_credentialed_english_candidates',
      },
    });
    return {
      assignments: deterministic,
      mode: 'deterministic',
      fallbackReason: 'no_rankable_credentialed_english_candidates',
    };
  }

  try {
    if (options.ranker.debugLogPlan) {
      options.logger?.log({
        level: 'info',
        stage: 'voice-plan',
        message: 'Inworld voice ranker shortlist debug payload',
        detail: {
          speakers: rankable.map(({ assignment, candidates }) => ({
            speaker: assignment.speaker,
            candidates: candidates.map((candidate) => ({
              voiceId: candidate.voice.id,
              name: candidate.voice.name,
              score: candidate.score,
              capabilities: candidate.capabilities,
              capabilityMatches: candidate.capabilityMatches,
              capabilityMismatches: candidate.capabilityMismatches,
            })),
          })),
        },
      });
    }
    const ranked = await options.ranker.rank({
      provider: 'inworld',
      model: options.model,
      speakers: rankable.map(({ assignment, profile, candidates }) => ({
        speaker: assignment.speaker,
        ...(profile ? { profile } : {}),
        candidates: candidates.map((candidate) => ({
          voiceId: candidate.voice.id,
          name: candidate.voice.name,
          score: candidate.score,
          ...(typeof candidate.voice.labels?.description === 'string'
            ? { description: candidate.voice.labels.description }
            : {}),
          ...(Array.isArray(candidate.voice.labels?.tags)
            ? { tags: candidate.voice.labels.tags.map(String) }
            : {}),
          capabilities: candidate.capabilities,
        })),
      })),
    });
    const selectionBySpeaker = new Map(
      ranked.selections.map((selection) => [selection.speaker, selection]),
    );
    const usedVoices = new Set(
      deterministic
        .filter((assignment) => assignment.source === 'voiceMap' || assignment.source === 'default')
        .map((assignment) => assignment.voiceId),
    );
    const resolved = deterministic.map((assignment) => {
      const rankedSelection = selectionBySpeaker.get(assignment.speaker);
      const rankedCandidate = rankable
        .find((entry) => entry.assignment.speaker === assignment.speaker)
        ?.candidates.find((candidate) => candidate.voice.id === rankedSelection?.voiceId);
      if (!rankedCandidate || usedVoices.has(rankedCandidate.voice.id)) return assignment;
      usedVoices.add(rankedCandidate.voice.id);
      return {
        speaker: assignment.speaker,
        voiceId: rankedCandidate.voice.id,
        source: 'auto' as const,
        score: rankedCandidate.score,
        selectionReason: rankedSelection?.reason
          ? `Selected by Inworld voice ranker: ${rankedSelection.reason}`
          : 'Selected by Inworld voice ranker from credentialed English shortlist.',
        capabilityMatches: rankedCandidate.capabilityMatches,
        capabilityMismatches: rankedCandidate.capabilityMismatches,
        capabilities: rankedCandidate.capabilities,
        ...(resolveCatalogVoiceLanguage(rankedCandidate.voice)
          ? { language: resolveCatalogVoiceLanguage(rankedCandidate.voice) }
          : {}),
      };
    });
    options.logger?.log({
      level: 'info',
      stage: 'voice-plan',
      message: 'Inworld voice ranker selected credentialed voices',
      detail: {
        ranker: options.ranker.metadata,
        voices: resolved.map(({ speaker, voiceId }) => ({ speaker, voiceId })),
      },
    });
    return { assignments: resolved, mode: 'ranked' };
  } catch (error) {
    options.logger?.log({
      level: 'warn',
      stage: 'voice-plan',
      message: 'Inworld voice ranker fell back to deterministic catalog selection',
      detail: {
        ranker: options.ranker.metadata,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        ...(options.ranker.debugLogPlan && error instanceof Error
          ? {
              errorMessage: error.message,
              ...('rawText' in error && typeof error.rawText === 'string'
                ? { rejectedRankerRawText: error.rawText }
                : {}),
            }
          : {}),
      },
    });
    return { assignments: deterministic, mode: 'fallback', fallbackReason: 'ranker_failed' };
  }
}

function findInworldSpeakerProfile(
  profiles: SpeakerProfile[] | undefined,
  speaker: string,
): SpeakerProfile | undefined {
  const normalizedSpeaker = normalizeInworldToken(speaker);
  return profiles?.find(
    (profile) =>
      normalizeInworldToken(profile.id) === normalizedSpeaker ||
      normalizeInworldToken(profile.display_name) === normalizedSpeaker,
  );
}

function normalizeInworldToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value
    .trim()
    .toLowerCase()
    .replaceAll(/[\s-]+/g, '_');
  return normalized || undefined;
}

function normalizeRequestedAccent(value: unknown): string | undefined {
  const normalized = normalizeInworldToken(value);
  if (
    normalized === 'neutral' ||
    normalized === 'standard' ||
    normalized === 'default' ||
    normalized === 'generic'
  ) {
    return undefined;
  }
  return normalized;
}

function readInworldVoiceLabel(
  voice: VoiceCatalog['voices'][number],
  key: string,
): string | undefined {
  return normalizeInworldToken(voice.labels?.[key]);
}

function isStaticInworldVoice(voiceId: string): boolean {
  return (DEFAULT_INWORLD_VOICES as readonly string[]).includes(voiceId);
}

function isEnglishInworldVoice(voice: VoiceCatalog['voices'][number]): boolean {
  const language = readInworldVoiceLabel(voice, 'language');
  if (language) return language === 'en' || language.startsWith('en_');
  return (voice.verifiedLanguages ?? []).some((entry) => {
    const token = normalizeInworldToken(entry.locale ?? entry.language);
    return token === 'en' || token?.startsWith('en_');
  });
}

function normalizeInworldLanguage(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const hyphenated = value.trim().replaceAll('_', '-');
  if (!hyphenated) return undefined;
  try {
    return Intl.getCanonicalLocales(hyphenated)[0] ?? hyphenated;
  } catch {
    return hyphenated;
  }
}

function resolveCatalogVoiceLanguage(
  voice: VoiceCatalog['voices'][number] | undefined,
): string | undefined {
  return normalizeInworldLanguage(
    voice?.verifiedLanguages?.[0]?.locale ??
      voice?.verifiedLanguages?.[0]?.language ??
      voice?.labels?.language,
  );
}

export function scoreInworldVoiceCandidate(args: {
  voice: VoiceCatalog['voices'][number];
  profile?: SpeakerProfile;
  preferredAccent?: string;
  model?: InworldTtsModel;
}) {
  const accent = readInworldVoiceLabel(args.voice, 'accent');
  const gender = readInworldVoiceLabel(args.voice, 'gender');
  const age = readInworldVoiceLabel(args.voice, 'age');
  const capabilityMatches: string[] = [];
  const capabilityMismatches: string[] = [];
  const capabilities = resolveInworldVoiceCapabilities(args.model ?? DEFAULT_INWORLD_TTS_MODEL);
  let score = 50;

  if (args.preferredAccent) {
    if (accent === args.preferredAccent) {
      score += 40;
      capabilityMatches.push(`accent:${args.preferredAccent}`);
    } else {
      score -= 20;
      capabilityMismatches.push(`accent:${args.preferredAccent}`);
    }
  }
  const profileGender = normalizeInworldToken(args.profile?.gender);
  if (profileGender) {
    if (gender === profileGender) {
      score += 20;
      capabilityMatches.push(`gender:${profileGender}`);
    } else if (gender) {
      score -= 10;
      capabilityMismatches.push(`gender:${profileGender}`);
    }
  }
  const profileAge = normalizeInworldToken(args.profile?.age);
  if (profileAge && profileAge !== 'universal') {
    if (age === profileAge) {
      score += 10;
      capabilityMatches.push(`age:${profileAge}`);
    } else if (age) {
      score -= 5;
      capabilityMismatches.push(`age:${profileAge}`);
    }
  }
  const profileText =
    `${args.profile?.role ?? ''} ${args.profile?.persona ?? ''} ${args.profile?.voice_direction ?? ''}`.toLowerCase();
  const searchableVoiceText = [
    args.voice.name,
    String(args.voice.labels?.description ?? ''),
    ...(Array.isArray(args.voice.labels?.tags) ? args.voice.labels.tags.map(String) : []),
  ]
    .join(' ')
    .toLowerCase();
  const personaTerms = [...new Set(profileText.match(/[a-z]{4,}/g) ?? [])];
  const personaMatches = personaTerms.filter((term) => searchableVoiceText.includes(term));
  if (personaMatches.length > 0) {
    score += Math.min(10, personaMatches.length * 2);
    capabilityMatches.push(`persona:${personaMatches.join(',')}`);
  }
  const mismatchedQualities = ['strident', 'promotional', 'shouty', 'theatrical'];
  const requestedQualities = new Set(profileText.match(/[a-z]{4,}/g) ?? []);
  const qualityMismatches = mismatchedQualities.filter(
    (quality) => searchableVoiceText.includes(quality) && !requestedQualities.has(quality),
  );
  if (qualityMismatches.length > 0) {
    score -= qualityMismatches.length * 12;
    capabilityMismatches.push(`quality:${qualityMismatches.join(',')}`);
  }

  return {
    voice: args.voice,
    score,
    accent,
    capabilityMatches: capabilityMatches.length > 0 ? capabilityMatches : undefined,
    capabilityMismatches: capabilityMismatches.length > 0 ? capabilityMismatches : undefined,
    capabilities,
  };
}

export function resolveInworldVoiceCapabilities(
  model: InworldTtsModel,
): VoiceAssignmentCapabilities {
  const supportsTts2Steering = model === 'inworld-tts-2';
  return {
    supportsMetadataInstructions: supportsTts2Steering,
    supportsNonVerbals: supportsTts2Steering,
    supportsUppercaseEmphasis: supportsTts2Steering,
    supportsFreeFormDirection: supportsTts2Steering,
  };
}

export function resolveInworldVoiceMetadata(voice: VoiceInfo): {
  accent?: string;
  gender?: string;
  age?: string;
} {
  const metadataText = [voice.displayName, voice.name, voice.description, ...(voice.tags ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const locale = normalizeInworldToken(voice.langCode);

  const accent =
    findInworldMetadataToken(metadataText, [
      'american',
      'british',
      'australian',
      'indian',
      'irish',
      'canadian',
      'new zealand',
    ]) ??
    (locale === 'en_gb'
      ? 'british'
      : locale === 'en_au'
        ? 'australian'
        : locale === 'en_in'
          ? 'indian'
          : locale === 'en_ie'
            ? 'irish'
            : locale === 'en_ca'
              ? 'canadian'
              : locale === 'en_nz'
                ? 'new_zealand'
                : undefined);
  const gender = findInworldMetadataToken(metadataText, ['female', 'male', 'neutral']);
  const age = findInworldMetadataToken(metadataText, [
    'child',
    'teen',
    'young',
    'adult',
    'middle aged',
    'senior',
  ]);

  return {
    ...(accent ? { accent: normalizeInworldToken(accent) } : {}),
    ...(gender ? { gender: normalizeInworldToken(gender) } : {}),
    ...(age ? { age: normalizeInworldToken(age) } : {}),
  };
}

function findInworldMetadataToken(text: string, tokens: string[]): string | undefined {
  return tokens.find((token) =>
    new RegExp(`\\b${token.replaceAll(' ', '\\s+')}\\b`, 'i').test(text),
  );
}

export async function loadInworldVoicesCatalog(
  dependencies: {
    logger?: PipelineLogger;
    client?: Pick<InworldTTSClient, 'listVoices'>;
  } = {},
): Promise<VoiceCatalog> {
  const generatedAt = new Date().toISOString();
  const voices: VoiceCatalog['voices'] = DEFAULT_INWORLD_VOICES.map((voiceId) => ({
    id: voiceId,
    name: voiceId,
    category: 'inworld',
    labels: {
      provider: 'inworld',
      model_family: DEFAULT_INWORLD_TTS_MODEL,
      language: 'en',
      accent: 'american',
      gender: voiceId === 'Dennis' ? 'male' : 'female',
    },
    useCase: DEFAULT_INWORLD_TTS_MODEL,
    verifiedLanguages: [{ language: 'en', locale: 'en-US' }],
  }));

  const apiKey = resolveInworldApiKey();
  if (apiKey || dependencies.client) {
    try {
      const client =
        dependencies.client ??
        InworldTTS({ apiKey: apiKey!, timeout: resolveInworldTimeoutMs() ?? 30_000 });
      const workspaceVoices = await client.listVoices();
      for (const voice of workspaceVoices) {
        if (!voice.voiceId) continue;
        const metadata = resolveInworldVoiceMetadata(voice);
        const language = normalizeInworldLanguage(voice.langCode);
        voices.push({
          id: voice.voiceId,
          name: voice.displayName || voice.voiceId,
          category: 'inworld',
          labels: {
            provider: 'inworld',
            model_family: DEFAULT_INWORLD_TTS_MODEL,
            ...(voice.displayName ? { display_name: voice.displayName } : {}),
            ...(voice.name ? { name: voice.name } : {}),
            ...(language ? { language } : {}),
            ...(metadata.accent ? { accent: metadata.accent } : {}),
            ...(metadata.gender ? { gender: metadata.gender } : {}),
            ...(metadata.age ? { age: metadata.age } : {}),
            ...(voice.description ? { description: voice.description } : {}),
            ...(voice.tags?.length ? { tags: voice.tags } : {}),
            ...(voice.source ? { source: voice.source } : {}),
          },
          useCase: DEFAULT_INWORLD_TTS_MODEL,
          verifiedLanguages: language ? [{ language, locale: language }] : [],
        });
      }
    } catch (error) {
      dependencies.logger?.log({
        level: 'warn',
        stage: 'voice-plan',
        message: 'Inworld voice catalog fell back to static voices',
        detail: {
          provider: 'inworld',
          errorCategory: classifyInworldTtsProviderError(error),
          fallbackVoiceCount: DEFAULT_INWORLD_VOICES.length,
        },
      });
    }
  }

  return {
    generatedAt,
    capabilities: {
      generatedAt,
      provider: 'inworld',
      role: [...CANONICAL_ROLE],
      gender: [...CANONICAL_GENDER],
      age: [...CANONICAL_AGE],
      accent: [
        ...new Set(
          voices
            .map((voice) => readInworldVoiceLabel(voice, 'accent'))
            .filter((accent): accent is string => Boolean(accent)),
        ),
      ].sort(),
      style: [...INWORLD_TTS_MODELS].sort(),
    },
    voices,
  };
}
