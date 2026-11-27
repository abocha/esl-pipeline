import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { load } from 'js-yaml';

import {
  assignmentPlainText,
  ConfigurationError,
  type GeminiTtsModelId,
  type SpeakerProfile,
  ValidationError,
} from '@esl-pipeline/contracts';
import {
  type BuildPronunciationShadowSentenceInput,
  type BuildPronunciationShadowSentenceOptions,
  type BuildPronunciationShadowSentenceResult,
  type BuildPronunciationTextInput,
  type BuildPronunciationTextOptions,
  type BuildPronunciationTextResult,
  type BuildStudyTextInput,
  type BuildStudyTextOptions,
  type BuildStudyTextResult,
  createPreparedStudyTextSynthesis,
  normalizePlainSpeechText,
  normalizeStudyTextSpeakerToken,
  resolveAssignmentMetadata,
  resolveAssignmentShadowFocus,
  resolveTtsSelection,
  resolveVoicePlanForExecution,
  type SpeakerVoiceAssignment,
  type TtsProviderAdapter,
  type TtsRequestControl,
  throwIfTtsCancelled,
  type VoiceCatalog,
  validateSpeechPerformancePlan,
  voiceAssignmentCapabilitiesForModel,
} from '@esl-pipeline/tts-core';

import { encodeGeminiMp3 } from './audio.js';
import { createGeminiClient, type GeminiRequest, GeminiTtsError } from './client.js';

// The deliberately bounded prebuilt catalog supports native two-speaker requests.
export const GEMINI_PREBUILT_VOICES = [
  'Zephyr',
  'Puck',
  'Charon',
  'Kore',
  'Fenrir',
  'Leda',
  'Orus',
  'Aoede',
  'Callirrhoe',
  'Autonoe',
  'Enceladus',
  'Iapetus',
  'Umbriel',
  'Algieba',
  'Despina',
  'Erinome',
  'Algenib',
  'Rasalgethi',
  'Laomedeia',
  'Achernar',
  'Alnilam',
  'Schedar',
  'Gacrux',
  'Pulcherrima',
  'Achird',
  'Zubenelgenubi',
  'Vindemiatrix',
  'Sadachbia',
  'Sadaltager',
  'Sulafat',
] as const;
const GENDER_FALLBACKS = {
  male: { id: 'en-us-mako', name: 'Mako' },
  female: { id: 'en-us-kira', name: 'Kira' },
} as const;
const GEMINI_LIBRARY_VOICES = Object.values(GENDER_FALLBACKS);
const AUTOMATIC_VOICES = {
  male: [
    { id: 'Charon', cues: /\b(informative|instructional|formal|teacher|instructor|expert)\b/i },
    { id: 'Puck', cues: /\b(upbeat|energetic|enthusiastic|playful)\b/i },
    { id: 'Zubenelgenubi', cues: /\b(casual|relaxed|laid-back|conversational)\b/i },
    { id: 'Achird', cues: /\b(friendly|approachable|storyteller|narrator)\b/i },
  ],
  female: [
    { id: 'Erinome', cues: /\b(clear|instructional|formal|teacher|instructor|expert)\b/i },
    { id: 'Sulafat', cues: /\b(warm|friendly|approachable)\b/i },
    { id: 'Vindemiatrix', cues: /\b(gentle|patient|reassuring|soft)\b/i },
    { id: 'Callirrhoe', cues: /\b(casual|relaxed|easy-going|conversational)\b/i },
  ],
} as const satisfies Record<
  keyof typeof GENDER_FALLBACKS,
  readonly {
    id: (typeof GEMINI_PREBUILT_VOICES)[number];
    cues: RegExp;
  }[]
>;
const POLICY = 'gemini-plain-wav-mp3-v1';

function voiceId(value: string): string {
  const token = value.trim().toLowerCase();
  const voice =
    GEMINI_PREBUILT_VOICES.find((candidate) => candidate.toLowerCase() === token) ??
    GEMINI_LIBRARY_VOICES.find(({ id, name }) => id === token || name.toLowerCase() === token)?.id;
  if (!voice)
    throw new ConfigurationError(
      'Gemini TTS requires a supported prebuilt or allowlisted library voice.',
    );
  return voice;
}

function pickVoice(
  profile: SpeakerProfile | undefined,
  defaultAccent: string | undefined,
  defaultVoice: string,
  usedVoices: ReadonlySet<string>,
): { id: string; reason: string } {
  const gender = profile?.gender;
  if (!profile || (gender !== 'male' && gender !== 'female')) {
    const available = [defaultVoice, 'Puck', 'Kore'].find((id) => !usedVoices.has(id));
    return { id: available ?? defaultVoice, reason: 'General Gemini voice fallback.' };
  }

  const requestedAccent = (profile.accent ?? defaultAccent)?.trim().toLowerCase();
  const accent = requestedAccent && !/^(neutral|standard|default)$/.test(requestedAccent);
  const candidates = AUTOMATIC_VOICES[gender].filter(({ id }) => !usedVoices.has(id));
  // Studio verifies only the US English locale for this shortlist.
  const matchesLocale =
    accent && /^(american( english)?|us( english)?|en-us)$/.test(requestedAccent);
  const useShortlist = !accent || matchesLocale;
  const match = useShortlist
    ? [profile.voice_direction, profile.persona, profile.role]
        .map((hint) => hint && candidates.find(({ cues }) => cues.test(hint)))
        .find(Boolean)
    : undefined;
  if (match) return { id: match.id, reason: 'Matched speaker gender and delivery cues.' };
  if (matchesLocale && candidates[0]) {
    return { id: candidates[0].id, reason: 'Matched speaker gender and US English locale.' };
  }

  const fallback = GENDER_FALLBACKS[gender].id;
  if (usedVoices.has(fallback) && candidates[0]) {
    return { id: candidates[0].id, reason: 'Selected a distinct voice matching speaker gender.' };
  }
  return {
    id: fallback,
    reason:
      accent && !matchesLocale
        ? 'Used gender fallback because the requested accent is unverified.'
        : 'Used the configured gender fallback.',
  };
}

function modelId(model?: string): GeminiTtsModelId {
  return resolveTtsSelection({ provider: 'gemini', model }).model as GeminiTtsModelId;
}

function speakerKey(value: string): string {
  return (normalizeStudyTextSpeakerToken(value) ?? value).toLowerCase();
}

async function voiceMap(path: string): Promise<Record<string, string>> {
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  const data = load(content);
  if (data == null) return {};
  if (typeof data !== 'object' || Array.isArray(data))
    throw new ConfigurationError('Gemini voice map must be a mapping.');
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === 'auto') continue;
    if (typeof value !== 'string')
      throw new ConfigurationError('Gemini voice-map values must be voice IDs.');
    result[speakerKey(key)] = voiceId(value);
  }
  return result;
}

function preparedInput(input: BuildStudyTextInput, options: BuildStudyTextOptions) {
  const prepared = createPreparedStudyTextSynthesis(input, {
    ...options,
    ttsProvider: 'gemini',
    ttsModel: modelId(options.ttsModel),
  });
  if (!prepared.segments.length || prepared.segments.some((segment) => !segment.text.trim()))
    throw new ValidationError('Gemini TTS study text must contain non-empty turns.');
  const speakers = [...new Set(prepared.segments.map((segment) => segment.speaker ?? 'Narrator'))];
  // AssignmentV1 authors the performance form; legacy transport flags cannot override it.
  const dialogue = input.assignment.input.studyText.type === 'dialogue';
  if (dialogue && speakers.length !== 2)
    throw new ConfigurationError(
      'Gemini native dialogue requires exactly two speakers. Author a monologue or select another provider for other speaker counts.',
    );
  return { prepared, speakers, dialogue };
}

async function assignmentsFor(
  input: BuildStudyTextInput,
  options: BuildStudyTextOptions,
): Promise<SpeakerVoiceAssignment[]> {
  throwIfTtsCancelled(options);
  const { prepared, speakers, dialogue } = preparedInput(input, options);
  const capabilities = voiceAssignmentCapabilitiesForModel('gemini', prepared.selection.model);
  if (options.voicePlan) {
    const plan = resolveVoicePlanForExecution(prepared, options.voicePlan);
    const assignments = speakers.map((speaker) => {
      const existing = plan.assignments.find(
        (assignment) => speakerKey(assignment.speaker) === speakerKey(speaker),
      );
      if (!existing)
        throw new ConfigurationError('Gemini voice plan is missing a study-text speaker.');
      return { ...existing, speaker, voiceId: voiceId(existing.voiceId) };
    });
    if (!dialogue && new Set(assignments.map((assignment) => assignment.voiceId)).size > 1)
      throw new ConfigurationError('Gemini monologue voice plan must select one voice.');
    return assignments;
  }
  const mapping = await voiceMap(options.voiceMapPath);
  const profiles = resolveAssignmentMetadata(input).speaker_profiles ?? [];
  const defaultVoice = mapping.default ?? options.defaultVoiceId;
  const preferences = speakers.map((speaker) => {
    const profile = profiles.find((candidate) => speakerKey(candidate.id) === speakerKey(speaker));
    const explicit = profile?.voice;
    const mapped = mapping[speakerKey(speaker)];
    const override = explicit ?? mapped ?? defaultVoice;
    return {
      speaker,
      profile,
      override: override === undefined ? undefined : voiceId(override),
      source: explicit ? 'profile' : mapped ? 'voiceMap' : defaultVoice ? 'default' : 'auto',
    } as const;
  });
  const usedVoices = new Set<string>(
    preferences.flatMap(({ override }) => (override ? [override] : [])),
  );
  const assignments = preferences.map(
    ({ speaker, profile, override, source }, index): SpeakerVoiceAssignment => {
      const voice = override
        ? { id: override, reason: 'Used an explicit Gemini voice selection.' }
        : pickVoice(
            profile,
            options.defaultAccent,
            dialogue && index === 0 ? 'Puck' : 'Kore',
            usedVoices,
          );
      usedVoices.add(voice.id);
      return {
        speaker,
        voiceId: voice.id,
        source,
        capabilities,
        language: 'en-US',
        selectionReason: voice.reason,
      };
    },
  );
  if (!dialogue) for (const assignment of assignments) assignment.voiceId = assignments[0]!.voiceId;
  throwIfTtsCancelled(options);
  return assignments;
}

async function nonempty(path: string): Promise<boolean> {
  try {
    return (await stat(path)).size > 0;
  } catch {
    return false;
  }
}

async function publishCache(
  source: string,
  target: string,
  control: TtsRequestControl,
): Promise<void> {
  throwIfTtsCancelled(control);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await copyFile(source, temporary);
    throwIfTtsCancelled(control);
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

export function createGeminiTtsProvider(
  config: { projectId?: string; timeoutMs?: number } = {},
): TtsProviderAdapter {
  const client = createGeminiClient(config);
  async function synthesize(
    request: GeminiRequest,
    kind: string,
    options: BuildPronunciationTextOptions,
    characters: number,
  ) {
    throwIfTtsCancelled(options);
    if (options.outputFormat && options.outputFormat !== 'mp3')
      throw new ConfigurationError('Gemini TTS currently supports MP3 pipeline output only.');
    const model = modelId(options.ttsModel);
    const project = client.projectId();
    // Bound memory and reject excessive input rather than splitting away dialogue context.
    if (Buffer.byteLength(JSON.stringify(request), 'utf8') > 32 * 1024)
      throw new ConfigurationError(
        'Gemini TTS request exceeds the 32 KiB local payload ceiling; shorten the text.',
      );
    const hash = createHash('sha256')
      .update(JSON.stringify({ provider: 'gemini', model, project, kind, request, policy: POLICY }))
      .digest('hex');
    const outDir = resolve(options.outPath);
    const target = join(outDir, `${kind}-${hash}.mp3`);
    const cacheDir = resolve(process.env.BATCH_TTS_CACHE_DIR?.trim() || join(outDir, '.tts-cache'));
    const cache = join(cacheDir, 'gemini', `${hash}.mp3`);
    if (options.preview)
      return {
        path: target,
        hash,
        provider: 'gemini',
        modelId: model,
        duration: undefined,
        generatedCharacters: 0,
        cachedCharacters: 0,
      };
    if (!options.force && (await nonempty(cache))) {
      await publishCache(cache, target, options);
      options.logger?.log({
        level: 'info',
        stage: 'tts',
        message: 'Gemini TTS cache reused',
        detail: { provider: 'gemini', model, hash, cachedCharacters: characters },
      });
      return {
        path: target,
        hash,
        provider: 'gemini',
        modelId: model,
        duration: undefined,
        generatedCharacters: 0,
        cachedCharacters: characters,
      };
    }
    const { audio, duration } = await client.synthesize(request, model, options);
    await encodeGeminiMp3(audio, cache, options);
    await publishCache(cache, target, options);
    return {
      path: target,
      hash,
      provider: 'gemini',
      modelId: model,
      duration,
      generatedCharacters: characters,
      cachedCharacters: 0,
    };
  }

  async function pronunciation(
    input: BuildPronunciationTextInput,
    options: BuildPronunciationTextOptions,
  ): Promise<BuildPronunciationTextResult> {
    const text = normalizePlainSpeechText(input.text);
    if (!text) throw new ValidationError('Gemini pronunciation text is empty.');
    const voice = voiceId(input.voiceId);
    const request: GeminiRequest = {
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { voice } } },
    };
    return {
      ...(await synthesize(request, 'pronunciation', options, text.length)),
      voiceId: voice,
    };
  }

  return {
    id: 'gemini',
    providerMetadata(args) {
      return {
        provider: 'gemini',
        modelFamily: modelId(args.studyTextOptions?.ttsModel ?? args.shadowOptions?.ttsModel),
        pricingToken: 'GEMINI_TTS',
      };
    },
    classifyProviderError(error) {
      return error instanceof GeminiTtsError ? error.category : null;
    },
    voice: {
      async loadCatalog(): Promise<VoiceCatalog> {
        return {
          capabilities: { provider: 'gemini' },
          voices: [
            ...GEMINI_PREBUILT_VOICES.map((id) => ({ id, name: id, category: 'prebuilt' })),
            ...GEMINI_LIBRARY_VOICES.map((voice) => ({ ...voice, category: 'library' })),
          ].map((voice) => ({
            ...voice,
            verifiedLanguages: [{ language: 'en', locale: 'en-US' }],
          })),
        };
      },
      async resolveSpeakerAssignments({ input, options }) {
        return { mode: 'deterministic', assignments: await assignmentsFor(input, options) };
      },
    },
    async synthesizeStudyText(input, options): Promise<BuildStudyTextResult> {
      const { prepared, dialogue } = preparedInput(input, options);
      const assignments = await assignmentsFor(input, options);
      if (options.speechPlan) {
        const plan = validateSpeechPerformancePlan(prepared, options.speechPlan);
        if (plan.mode !== 'identity' || plan.schemaVersion !== 1)
          throw new ConfigurationError('Gemini TTS uses plain identity speech plans only.');
      }
      const direction = input.assignment.input.studyText.deliveryDirection;
      const style = direction ? assignmentPlainText(direction).trim() : '';
      const styleMetadata = style ? { style } : undefined;
      const request: GeminiRequest = {
        contents: [
          {
            role: 'user',
            parts: dialogue
              ? prepared.segments.map((segment) => ({
                  text: segment.text,
                  speechMetadata: { speaker: segment.speaker!, ...styleMetadata },
                }))
              : [
                  {
                    text: prepared.segments.map((segment) => segment.text).join('\n'),
                    ...(styleMetadata && { speechMetadata: styleMetadata }),
                  },
                ],
          },
        ],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: dialogue
            ? {
                multiSpeakerVoiceConfig: {
                  speakerVoiceConfigs: assignments.map((assignment) => ({
                    speaker: assignment.speaker,
                    voiceConfig: { voice: assignment.voiceId },
                  })),
                },
              }
            : { voiceConfig: { voice: assignments[0]!.voiceId } },
        },
      };
      const result = await synthesize(
        request,
        'study-text',
        options,
        prepared.segments.reduce((sum, segment) => sum + segment.text.length, 0),
      );
      return {
        ...result,
        voices: assignments.map((assignment) => ({
          speaker: assignment.speaker,
          voiceId: assignment.voiceId,
          voiceName: assignment.voiceId,
          source: assignment.source,
          selectionReason: assignment.selectionReason,
        })),
        voiceAssignments: Object.fromEntries(
          assignments.map((assignment) => [assignment.speaker, assignment.voiceId]),
        ),
      };
    },
    synthesizePronunciationText: pronunciation,
    async synthesizeShadowSentence(
      input: BuildPronunciationShadowSentenceInput,
      options: BuildPronunciationShadowSentenceOptions,
    ): Promise<BuildPronunciationShadowSentenceResult> {
      const focus = resolveAssignmentShadowFocus(input);
      if (!focus?.shadowSentence)
        throw new ValidationError('AssignmentV1 pronunciation shadow sentence mode is required.');
      return pronunciation({ text: focus.shadowSentence, voiceId: input.voiceId }, options);
    },
  };
}
