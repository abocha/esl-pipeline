import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import * as yaml from 'js-yaml';

import { ConfigurationError, noopLogger, ValidationError } from '@esl-pipeline/contracts';
import {
  extractFrontmatter,
  extractPronunciationShadowFocus,
  extractStudyText,
  type Frontmatter,
} from '@esl-pipeline/pmd';
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
  hashStudyText,
  INWORLD_TTS_MODELS,
  type InworldTtsModel,
  normalizeStudyTextSpeakerToken,
  resolveTtsSelection,
  type SpeakerVoiceAssignment,
  type TtsProviderAdapter,
  type VoiceAssignmentResolution,
} from '@esl-pipeline/tts-core';

import {
  DEFAULT_INWORLD_VOICES,
  type InworldSpeakerAssignment,
  loadInworldVoicesCatalog,
  resolveInworldSpeakerAssignmentsWithRankerFromCatalog,
  resolveInworldVoiceCapabilities,
  type VoiceMapConfig,
} from './catalog.js';
import { cleanSpeechText, renderInworldSpeechSegment } from './rendering.js';
import {
  classifyInworldTtsProviderError,
  resolveInworldSampleRateHertz,
  synthesizeInworldChunkWithRetry,
} from './synthesis.js';

export const INWORLD_ASSEMBLY_MARGIN_POLICY = {
  sameSpeakerMs: 180,
  speakerSwitchMs: 320,
} as const;
interface StudyTextSegment {
  speaker?: string;
  text: string;
  raw: string;
}

export function resolveInworldAssemblyGapDurations(
  segments: Array<Pick<StudyTextSegment, 'speaker'>>,
): number[] {
  return segments
    .slice(0, -1)
    .map((segment, index) =>
      segment.speaker === segments[index + 1]?.speaker
        ? INWORLD_ASSEMBLY_MARGIN_POLICY.sameSpeakerMs
        : INWORLD_ASSEMBLY_MARGIN_POLICY.speakerSwitchMs,
    );
}

export function resolveInworldTtsModel(model?: string): InworldTtsModel {
  const normalized = (model ?? '').trim().toLowerCase().replaceAll('_', '-');
  if (!normalized) return resolveTtsSelection({ provider: 'inworld' }).model as InworldTtsModel;
  if ((INWORLD_TTS_MODELS as readonly string[]).includes(normalized)) {
    return normalized as InworldTtsModel;
  }
  throw new ConfigurationError(
    `Unsupported Inworld TTS model "${model}". Use one of: ${INWORLD_TTS_MODELS.join(', ')}`,
  );
}

function resolveInworldVoiceId(explicit?: string): string {
  return (
    explicit?.trim() ||
    process.env.ESL_TTS_PROVIDER_INWORLD_VOICE?.trim() ||
    DEFAULT_INWORLD_VOICES[0]
  );
}

function cleanSpeakerName(name: string): string {
  return normalizeStudyTextSpeakerToken(name) ?? '';
}

function parseSpeaker(line: string): { speaker?: string; text: string } {
  const idx = line.indexOf(':');
  if (idx > 0 && idx < 40) {
    return { speaker: cleanSpeakerName(line.slice(0, idx)), text: line.slice(idx + 1).trim() };
  }
  return { text: line.trim() };
}

function resolveStudyTextSegments(lines: string[], frontmatter: Frontmatter): StudyTextSegment[] {
  const labelOrder = Array.isArray(frontmatter.speaker_labels)
    ? frontmatter.speaker_labels
        .map((label) => (typeof label === 'string' ? cleanSpeakerName(label) : ''))
        .filter(Boolean)
    : [];
  const nonNarratorFallback = labelOrder.find((label) => label.toLowerCase() !== 'narrator');
  const singleFallback = labelOrder.length === 1 ? labelOrder[0] : undefined;
  const segments: StudyTextSegment[] = [];
  let lastSpeaker: string | undefined;

  for (const raw of lines) {
    const { speaker, text } = parseSpeaker(raw);
    let resolvedSpeaker = speaker || undefined;
    if (!resolvedSpeaker && lastSpeaker) {
      resolvedSpeaker = lastSpeaker;
    } else if (!resolvedSpeaker && !lastSpeaker) {
      resolvedSpeaker = nonNarratorFallback ?? singleFallback;
    }
    if (resolvedSpeaker) lastSpeaker = resolvedSpeaker;
    segments.push({ speaker: resolvedSpeaker, text, raw });
  }

  return segments;
}

function collectSpeakers(segments: StudyTextSegment[], frontmatter: Frontmatter): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value !== 'string') return;
    const trimmed = cleanSpeakerName(value);
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    ordered.push(trimmed);
  };
  for (const segment of segments) add(segment.speaker);
  if (Array.isArray(frontmatter.speaker_labels)) {
    for (const label of frontmatter.speaker_labels) add(label);
  }
  if (ordered.length === 0 && Array.isArray(frontmatter.speaker_profiles)) {
    add(frontmatter.speaker_profiles.find((profile) => typeof profile.id === 'string')?.id);
  }
  if (ordered.length === 0) ordered.push('Narrator');
  return ordered;
}

async function loadVoiceMap(path: string): Promise<VoiceMapConfig> {
  try {
    const voiceMapContent = await readFile(path, 'utf8');
    const rawVoiceMap = yaml.load(voiceMapContent) ?? {};
    return typeof rawVoiceMap === 'object' && rawVoiceMap
      ? (rawVoiceMap as VoiceMapConfig)
      : ({} as VoiceMapConfig);
  } catch {
    return {};
  }
}

function sanitizeStudentName(student?: unknown): string {
  if (typeof student !== 'string') return '';
  const normalized = student
    .trim()
    .normalize('NFKD')
    .replaceAll(/[\u0300-\u036F]/g, '')
    .toLowerCase();
  return normalized.replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '');
}

function buildOutputFileName(hash: string, frontmatter: Frontmatter): string {
  const prefix = sanitizeStudentName(frontmatter.student);
  return prefix ? `${prefix}-${hash}.mp3` : `${hash}.mp3`;
}

function buildShadowSentenceOutputFileName(hash: string, frontmatter: Frontmatter): string {
  const prefix = sanitizeStudentName(frontmatter.student);
  return prefix ? `${prefix}-${hash}-shadow-sentence.mp3` : `${hash}-shadow-sentence.mp3`;
}

function buildPronunciationOutputFileName(
  hash: string,
  frontmatter: Frontmatter,
  fileStem?: string,
): string {
  const prefix = sanitizeStudentName(frontmatter.student);
  const stem =
    fileStem
      ?.trim()
      .replaceAll(/[^a-z0-9-]+/gi, '-')
      .replaceAll(/^-+|-+$/g, '') || 'pronunciation';
  return prefix ? `${prefix}-${hash}-${stem}.mp3` : `${hash}-${stem}.mp3`;
}

async function fileExistsNonEmpty(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.size > 0;
  } catch {
    return false;
  }
}

function buildVoiceSummaries(
  assignments: InworldSpeakerAssignment[],
): BuildStudyTextResult['voices'] {
  return assignments.map((assignment) => ({
    speaker: assignment.speaker,
    voiceId: assignment.voiceId,
    source: assignment.source,
    score: assignment.score,
    voiceName: assignment.voiceId,
    useCase: 'inworld',
    selectionReason: assignment.selectionReason,
    capabilityMatches: assignment.capabilityMatches,
    capabilityMismatches: assignment.capabilityMismatches,
  }));
}

function normalizeInworldSpeakerAssignment(
  assignment: SpeakerVoiceAssignment,
  model: InworldTtsModel,
): InworldSpeakerAssignment {
  return {
    ...assignment,
    selectionReason: assignment.selectionReason ?? 'Selected from prepared voice plan.',
    capabilities: assignment.capabilities ?? resolveInworldVoiceCapabilities(model),
  };
}

async function resolveAssignmentsForStudyText(
  input: BuildStudyTextInput,
  opts: BuildStudyTextOptions,
): Promise<{
  frontmatter: Frontmatter;
  segments: StudyTextSegment[];
  normalizedText: string;
  model: InworldTtsModel;
  assignments: InworldSpeakerAssignment[];
  voiceSummaries: BuildStudyTextResult['voices'];
}> {
  const frontmatter = extractFrontmatter(input.context);
  const studyText = extractStudyText(input.context);
  const segments = resolveStudyTextSegments(studyText.lines, frontmatter);
  const sanitizedSegments = segments
    .map((segment) => cleanSpeechText(segment.text))
    .filter((segment) => segment.length > 0);
  const normalizedText = sanitizedSegments.join('\n');
  const model = resolveInworldTtsModel(opts.ttsModel);
  const assignments = opts.voicePlan
    ? opts.voicePlan.assignments.map((assignment) =>
        normalizeInworldSpeakerAssignment(assignment, model),
      )
    : (
        await resolveInworldSpeakerAssignmentsWithRankerFromCatalog(
          collectSpeakers(segments, frontmatter),
          await loadVoiceMap(opts.voiceMapPath),
          await loadInworldVoicesCatalog({ logger: opts.logger }),
          {
            defaultVoiceId: opts.defaultVoiceId,
            defaultAccent: opts.defaultAccent,
            profiles: frontmatter.speaker_profiles,
            ranker: opts.voiceRanker,
            model,
            logger: opts.logger,
          },
        )
      ).assignments.map((assignment) => normalizeInworldSpeakerAssignment(assignment, model));
  return {
    frontmatter,
    segments,
    normalizedText,
    model,
    assignments,
    voiceSummaries: buildVoiceSummaries(assignments),
  };
}

export function buildInworldChunkHash(args: {
  model: string;
  voiceId: string;
  text: string;
  index: number;
  speakingRate?: number;
  temperature?: number;
  deliveryMode?: string;
  sampleRateHertz: number;
  encoding?: string;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        provider: 'inworld',
        model: args.model,
        voiceId: args.voiceId,
        text: args.text,
        index: args.index,
        speakingRate: args.speakingRate,
        temperature: args.temperature,
        deliveryMode: args.deliveryMode,
        sampleRateHertz: args.sampleRateHertz,
        encoding: args.encoding ?? 'MP3',
      }),
    )
    .digest('hex');
}

export async function buildStudyTextMp3Inworld(
  input: BuildStudyTextInput,
  opts: BuildStudyTextOptions,
): Promise<BuildStudyTextResult> {
  const plan = await resolveAssignmentsForStudyText(input, opts);
  const { frontmatter, segments, normalizedText, model, assignments, voiceSummaries } = plan;
  const sampleRateHertz = resolveInworldSampleRateHertz();
  const voiceAssignments = Object.fromEntries(
    assignments.map((assignment) => [cleanSpeakerName(assignment.speaker), assignment.voiceId]),
  );
  const assignmentLookup = new Map(
    assignments.map((assignment) => [cleanSpeakerName(assignment.speaker), assignment]),
  );
  const gapDurations = resolveInworldAssemblyGapDurations(segments);
  const renderedSegments = segments.flatMap((segment, index) => {
    const speechPlanSegment = opts.speechPlan?.segments[index];
    const assignment =
      (segment.speaker ? assignmentLookup.get(cleanSpeakerName(segment.speaker)) : undefined) ??
      assignments[0];
    const rendered = renderInworldSpeechSegment({
      model,
      segment: speechPlanSegment ?? {
        id: `segment-${index + 1}`,
        speaker: segment.speaker,
        text: segment.text,
      },
      capabilities: assignment?.capabilities,
    });
    if (!rendered.text) return [];
    return [
      {
        speaker: segment.speaker,
        voiceId: assignment?.voiceId ?? resolveInworldVoiceId(opts.defaultVoiceId),
        text: rendered.text,
        speakingRate: rendered.speakingRate,
        temperature: rendered.temperature,
        deliveryMode: rendered.deliveryMode,
        gapAfterMs: gapDurations[index],
      },
    ];
  });
  const hash = hashStudyText(
    JSON.stringify({
      provider: 'inworld',
      model,
      segments: renderedSegments.map(
        ({ voiceId, text, speakingRate, temperature, deliveryMode, gapAfterMs }) => ({
          voiceId,
          text,
          ...(speakingRate !== undefined ? { speakingRate } : {}),
          ...(temperature !== undefined ? { temperature } : {}),
          ...(deliveryMode !== undefined ? { deliveryMode } : {}),
          ...(gapAfterMs !== undefined ? { gapAfterMs } : {}),
        }),
      ),
      sampleRateHertz,
      encoding: 'MP3',
      assemblyMargins: INWORLD_ASSEMBLY_MARGIN_POLICY,
    }),
  );
  const outputDir = resolve(opts.outPath || (input.mdPath ? dirname(input.mdPath) : process.cwd()));
  const targetPath = resolve(outputDir, buildOutputFileName(hash, frontmatter));

  if (opts.preview) {
    return {
      path: targetPath,
      hash,
      duration: undefined,
      provider: 'inworld',
      modelId: model,
      voices: voiceSummaries,
      voiceAssignments,
      cachedCharacters: normalizedText.length,
      generatedCharacters: 0,
    };
  }

  await mkdir(outputDir, { recursive: true });
  if (!opts.force && (await fileExistsNonEmpty(targetPath))) {
    return {
      path: targetPath,
      hash,
      duration: undefined,
      provider: 'inworld',
      modelId: model,
      voices: voiceSummaries,
      voiceAssignments,
      cachedCharacters: normalizedText.length,
      generatedCharacters: 0,
    };
  }

  const runFiles: string[] = [];
  const runSegments: Array<Pick<StudyTextSegment, 'speaker'>> = [];
  let generatedCharacters = 0;
  let cachedCharacters = 0;

  for (const [index, segment] of renderedSegments.entries()) {
    const speechText = segment.text;
    const voiceId = segment.voiceId;
    const chunkHash = buildInworldChunkHash({
      model,
      voiceId,
      text: speechText,
      index,
      speakingRate: segment.speakingRate,
      temperature: segment.temperature,
      deliveryMode: segment.deliveryMode,
      sampleRateHertz,
    });
    const chunkFilePath = resolve(outputDir, `${chunkHash}.mp3`);
    if (!opts.force && (await fileExistsNonEmpty(chunkFilePath))) {
      runFiles.push(chunkFilePath);
      runSegments.push({ speaker: segment.speaker });
      cachedCharacters += speechText.length;
      continue;
    }
    await synthesizeInworldChunkWithRetry(speechText, voiceId, chunkFilePath, {
      model,
      speakingRate: segment.speakingRate,
      temperature: segment.temperature,
      deliveryMode: segment.deliveryMode,
      sampleRateHertz,
    });
    runFiles.push(chunkFilePath);
    runSegments.push({ speaker: segment.speaker });
    generatedCharacters += speechText.length;
  }

  if (runFiles.length === 0) {
    throw new ValidationError('TTS produced 0 segments. Check study-text content.');
  }

  if (runFiles.length === 1) {
    await copyFile(runFiles[0]!, targetPath);
  } else {
    const { concatMp3Segments, resolveFfmpegPath } = await import('./ffmpeg.js');
    await concatMp3Segments(
      runFiles,
      targetPath,
      true,
      await resolveFfmpegPath(opts.ffmpegPath),
      resolveInworldAssemblyGapDurations(runSegments),
    );
  }

  return {
    path: targetPath,
    hash,
    duration: undefined,
    provider: 'inworld',
    modelId: model,
    voices: voiceSummaries,
    voiceAssignments,
    generatedCharacters,
    cachedCharacters,
  };
}

export async function buildPronunciationShadowSentenceMp3Inworld(
  input: BuildPronunciationShadowSentenceInput,
  opts: BuildPronunciationShadowSentenceOptions,
): Promise<BuildPronunciationShadowSentenceResult> {
  const logger = opts.logger ?? noopLogger;
  const frontmatter = extractFrontmatter(input.context);
  const shadowFocus = extractPronunciationShadowFocus(input.context);
  if (!shadowFocus?.shadowSentence) {
    throw new ValidationError(
      'Pronunciation shadow sentence mode not found. Add "**Mode:** shadow_sentence" and a shadow sentence under section C.',
    );
  }
  const sentence = cleanSpeechText(shadowFocus.shadowSentence);
  if (!sentence) throw new ValidationError('Pronunciation shadow sentence is empty.');
  const model = resolveInworldTtsModel(opts.ttsModel);
  const voiceId = resolveInworldVoiceId(input.voiceId);
  const outputDir = resolve(opts.outPath || (input.mdPath ? dirname(input.mdPath) : process.cwd()));
  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        kind: 'pronunciation_shadow_sentence',
        provider: 'inworld',
        text: sentence,
        voiceId,
        model,
      }),
    )
    .digest('hex');
  const targetPath = resolve(outputDir, buildShadowSentenceOutputFileName(hash, frontmatter));

  if (opts.preview) {
    return {
      path: targetPath,
      duration: undefined,
      hash,
      provider: 'inworld',
      modelId: model,
      voiceId,
      generatedCharacters: sentence.length,
      cachedCharacters: 0,
    };
  }

  await mkdir(outputDir, { recursive: true });
  if (!opts.force && (await fileExistsNonEmpty(targetPath))) {
    return {
      path: targetPath,
      duration: undefined,
      hash,
      provider: 'inworld',
      modelId: model,
      voiceId,
      generatedCharacters: 0,
      cachedCharacters: sentence.length,
    };
  }
  logger.log({
    level: 'info',
    stage: 'tts',
    message: 'Generating pronunciation shadow sentence audio',
    detail: { provider: 'inworld', voiceId, model },
  });
  await synthesizeInworldChunkWithRetry(sentence, voiceId, targetPath, { model });
  return {
    path: targetPath,
    duration: undefined,
    hash,
    provider: 'inworld',
    modelId: model,
    voiceId,
    generatedCharacters: sentence.length,
    cachedCharacters: 0,
  };
}

export async function buildPronunciationTextMp3Inworld(
  input: BuildPronunciationTextInput,
  opts: BuildPronunciationTextOptions,
): Promise<BuildPronunciationTextResult> {
  const logger = opts.logger ?? noopLogger;
  const sentence = cleanSpeechText(input.text ?? '');
  if (!sentence) throw new ValidationError('Pronunciation synthesis text is empty.');
  const frontmatter: Frontmatter = {
    title: input.title?.trim() || 'Pronunciation Practice',
    student: 'student',
    level: 'Unknown',
    topic: 'English Practice',
    input_type: 'generate',
  };
  const model = resolveInworldTtsModel(opts.ttsModel);
  const voiceId = resolveInworldVoiceId(input.voiceId);
  const fileStem = opts.fileStem?.trim() || 'pronunciation';
  const outputDir = resolve(opts.outPath || (input.mdPath ? dirname(input.mdPath) : process.cwd()));
  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        kind: input.kind ?? 'pronunciation_text',
        provider: 'inworld',
        text: sentence,
        voiceId,
        model,
        fileStem,
      }),
    )
    .digest('hex');
  const targetPath = resolve(
    outputDir,
    buildPronunciationOutputFileName(hash, frontmatter, fileStem),
  );

  if (opts.preview) {
    return {
      path: targetPath,
      duration: undefined,
      hash,
      provider: 'inworld',
      modelId: model,
      voiceId,
      generatedCharacters: sentence.length,
      cachedCharacters: 0,
    };
  }

  await mkdir(outputDir, { recursive: true });
  if (!opts.force && (await fileExistsNonEmpty(targetPath))) {
    return {
      path: targetPath,
      duration: undefined,
      hash,
      provider: 'inworld',
      modelId: model,
      voiceId,
      generatedCharacters: 0,
      cachedCharacters: sentence.length,
    };
  }
  logger.log({
    level: 'info',
    stage: 'tts',
    message: 'Generating pronunciation text audio',
    detail: { provider: 'inworld', voiceId, model, fileStem },
  });
  await synthesizeInworldChunkWithRetry(sentence, voiceId, targetPath, { model });
  return {
    path: targetPath,
    duration: undefined,
    hash,
    provider: 'inworld',
    modelId: model,
    voiceId,
    generatedCharacters: sentence.length,
    cachedCharacters: 0,
  };
}

export async function resolveInworldSpeakerAssignments(
  input: BuildStudyTextInput,
  options: BuildStudyTextOptions,
): Promise<VoiceAssignmentResolution> {
  const frontmatter = extractFrontmatter(input.context);
  const segments = resolveStudyTextSegments(extractStudyText(input.context).lines, frontmatter);
  const resolution = await resolveInworldSpeakerAssignmentsWithRankerFromCatalog(
    collectSpeakers(segments, frontmatter),
    await loadVoiceMap(options.voiceMapPath),
    await loadInworldVoicesCatalog({ logger: options.logger }),
    {
      defaultVoiceId: options.defaultVoiceId,
      defaultAccent: options.defaultAccent,
      profiles: frontmatter.speaker_profiles,
      ranker: options.voiceRanker,
      model: resolveInworldTtsModel(options.ttsModel),
      logger: options.logger,
    },
  );
  return {
    ...resolution,
    assignments: resolution.assignments.map((assignment) => ({
      speaker: assignment.speaker,
      voiceId: assignment.voiceId,
      source: assignment.source,
      score: assignment.score,
      selectionReason: assignment.selectionReason,
      capabilityMatches: assignment.capabilityMatches,
      capabilityMismatches: assignment.capabilityMismatches,
      capabilities: assignment.capabilities,
      language: assignment.language,
    })),
  };
}

export function createInworldTtsProvider(): TtsProviderAdapter {
  return {
    id: 'inworld',
    providerMetadata(args) {
      return {
        provider: 'inworld',
        modelFamily: resolveInworldTtsModel(
          args.studyTextOptions?.ttsModel ?? args.shadowOptions?.ttsModel,
        ),
        pricingToken: 'INWORLD_TTS',
      };
    },
    classifyProviderError(error) {
      return classifyInworldTtsProviderError(error);
    },
    voice: {
      async loadCatalog() {
        return loadInworldVoicesCatalog();
      },
      async resolveSpeakerAssignments(args) {
        return resolveInworldSpeakerAssignments(args.input, args.options);
      },
    },
    async synthesizeStudyText(input, options) {
      return buildStudyTextMp3Inworld(input, { ...options, ttsProvider: 'inworld' });
    },
    async synthesizeShadowSentence(input, options) {
      return buildPronunciationShadowSentenceMp3Inworld(input, {
        ...options,
        ttsProvider: 'inworld',
      });
    },
    async synthesizePronunciationText(input, options) {
      return buildPronunciationTextMp3Inworld(input, {
        ...options,
        ttsProvider: 'inworld',
      });
    },
  };
}

export {
  loadInworldVoicesCatalog,
  resolveInworldVoiceCapabilities,
  resolveInworldSpeakerAssignmentsFromCatalog,
  resolveInworldSpeakerAssignmentsWithRankerFromCatalog,
} from './catalog.js';
export { FfmpegNotFoundError, resolveFfmpegPath } from './ffmpeg.js';
export { renderInworldSpeechSegment } from './rendering.js';
