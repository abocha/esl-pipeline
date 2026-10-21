import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { load } from 'js-yaml';

import {
  ConfigurationError,
  type GeminiTtsModelId,
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
const POLICY = 'gemini-plain-wav-mp3-v1';

function voiceId(value: string): string {
  const voice = GEMINI_PREBUILT_VOICES.find(
    (candidate) => candidate.toLowerCase() === value.trim().toLowerCase(),
  );
  if (!voice)
    throw new ConfigurationError(
      'Gemini TTS requires a supported prebuilt voice. Custom and other-provider voices are not supported.',
    );
  return voice;
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
  const assignments = speakers.map((speaker, index): SpeakerVoiceAssignment => {
    const profile = profiles.find((candidate) => speakerKey(candidate.id) === speakerKey(speaker));
    const explicit = profile?.voice;
    const mapped = mapping[speakerKey(speaker)];
    const defaultVoice = mapping.default ?? options.defaultVoiceId;
    const selected =
      explicit ?? mapped ?? defaultVoice ?? (dialogue && index === 0 ? 'Puck' : 'Kore');
    return {
      speaker,
      voiceId: voiceId(selected),
      source: explicit ? 'profile' : mapped ? 'voiceMap' : defaultVoice ? 'default' : 'auto',
      capabilities,
      language: 'en-US',
      selectionReason: 'Deterministic prebuilt Gemini voice; external ranking is not used.',
    };
  });
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
          voices: GEMINI_PREBUILT_VOICES.map((id) => ({
            id,
            name: id,
            category: 'prebuilt',
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
      const request: GeminiRequest = {
        contents: [
          {
            role: 'user',
            parts: dialogue
              ? prepared.segments.map((segment) => ({
                  text: segment.text,
                  speechMetadata: { speaker: segment.speaker! },
                }))
              : [{ text: prepared.segments.map((segment) => segment.text).join('\n') }],
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
