import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCliEnv } from '@esl-pipeline/shared-infrastructure';
import type { SpeechPerformancePromptPolicyId } from '@esl-pipeline/tts-core';
import {
  concatMp3Segments,
  createInworldClientProvider,
  resolveFfmpegPath,
  resolveInworldAssemblyGapDurations,
  synthesizeInworldChunkWithRetry,
} from '@esl-pipeline/tts-provider-inworld';

import {
  getConfiguredGenerationAllowedModels,
  getConfiguredSpeechPlannerLimits,
} from '../application/generation-budget-guard.js';
import {
  executeSpeechPlannerAttempt,
  type SpeechPlannerAttemptResult,
} from '../application/speech-performance-planner.js';
import {
  buildSpeechPlannerEvalMatrix,
  loadOfflineSpeechPlannerOutputs,
  loadSpeechPlannerEvalFixtures,
  loadSpeechPlannerPriceSnapshot,
  SPEECH_PLANNER_EVAL_MODELS,
  SPEECH_PLANNER_EVAL_PROMPT_POLICIES,
  type SpeechPlannerEvalFixture,
  type SpeechPlannerEvalModel,
  type SpeechPlannerEvalVariant,
} from '../application/speech-planner-eval-fixtures.js';
import {
  createSpeechPlannerEvalBudgetRepository,
  preflightSpeechPlannerEval,
  SpeechPlannerEvalRateLimiter,
} from '../application/speech-planner-eval-preflight.js';
import {
  runSpeechPlannerEvaluation,
  type SpeechPlannerEvalAttemptRecord,
} from '../application/speech-planner-evaluator.js';
import {
  selectSpeechPlannerAudioBlocks,
  writeBlindListeningReport,
} from '../application/speech-planner-listening-report.js';
import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';

const DEFAULT_CORPUS = 'packages/batch-backend/fixtures/speech-planner-eval/corpus-v1.json';
const DEFAULT_PRICES =
  'packages/batch-backend/fixtures/speech-planner-eval/pricing-2026-07-28.json';
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const PRIVATE_ROOT = resolve(REPO_ROOT, 'tmp/speech-planner-eval-private');

function resolveInputPath(path: string): string {
  return isAbsolute(path) ? path : resolve(REPO_ROOT, path);
}

export interface EvalSpeechPlannerOptions {
  live: boolean;
  audio: 'none' | 'selected';
  models: SpeechPlannerEvalModel[];
  prompts: SpeechPerformancePromptPolicyId[];
  repetitions: number;
  corpus: string;
  priceSnapshot: string;
  offlineOutputFixtures?: string;
  privateFixture?: string;
  privateOnly: boolean;
  usedToday?: number;
  output: string;
  resumeRun?: string;
}

function flagValue(argv: readonly string[], name: string): string | undefined {
  const prefix = `${name}=`;
  return argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function parseCsv<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  label: string,
): T[] {
  const values = value ? value.split(',').map((entry) => entry.trim()) : [...allowed];
  if (values.length === 0 || values.some((entry) => !allowed.includes(entry as T))) {
    throw new Error(`${label} must contain only: ${allowed.join(', ')}`);
  }
  return [...new Set(values)] as T[];
}

function assertPrivatePath(path: string): string {
  const absolute = resolveInputPath(path);
  const relation = relative(PRIVATE_ROOT, absolute);
  if (!relation || relation.startsWith('..') || isAbsolute(relation)) {
    throw new Error('Private fixtures must be contained by tmp/speech-planner-eval-private.');
  }
  return absolute;
}

export function parseEvalSpeechPlannerArgs(argv: readonly string[]): EvalSpeechPlannerOptions {
  const known = [
    '--live',
    '--audio=',
    '--models=',
    '--prompts=',
    '--repetitions=',
    '--corpus=',
    '--price-snapshot=',
    '--offline-output-fixtures=',
    '--private-fixture=',
    '--private-only',
    '--used-today=',
    '--output=',
    '--resume-run=',
  ];
  const unknown = argv.find(
    (argument) =>
      !known.some((entry) =>
        entry.endsWith('=') ? argument.startsWith(entry) : argument === entry,
      ),
  );
  if (unknown) throw new Error(`Unknown speech planner eval argument: ${unknown}`);

  const audio = flagValue(argv, '--audio') ?? 'none';
  if (audio !== 'none' && audio !== 'selected')
    throw new Error('--audio must be none or selected.');
  const repetitionsRaw = flagValue(argv, '--repetitions') ?? '3';
  const repetitions = Number(repetitionsRaw);
  if (!Number.isInteger(repetitions) || repetitions < 1) {
    throw new Error('--repetitions must be a positive integer.');
  }
  const usedTodayRaw = flagValue(argv, '--used-today');
  const usedToday = usedTodayRaw === undefined ? undefined : Number(usedTodayRaw);
  if (usedToday !== undefined && (!Number.isInteger(usedToday) || usedToday < 0)) {
    throw new Error('--used-today must be a nonnegative integer.');
  }
  const privateRaw = flagValue(argv, '--private-fixture');
  const privateFixture = privateRaw ? assertPrivatePath(privateRaw) : undefined;
  return {
    live: argv.includes('--live'),
    audio,
    models: parseCsv(flagValue(argv, '--models'), SPEECH_PLANNER_EVAL_MODELS, '--models'),
    prompts: parseCsv(
      flagValue(argv, '--prompts'),
      SPEECH_PLANNER_EVAL_PROMPT_POLICIES,
      '--prompts',
    ),
    repetitions,
    corpus: flagValue(argv, '--corpus') ?? DEFAULT_CORPUS,
    priceSnapshot: flagValue(argv, '--price-snapshot') ?? DEFAULT_PRICES,
    offlineOutputFixtures: flagValue(argv, '--offline-output-fixtures'),
    privateFixture,
    privateOnly: argv.includes('--private-only'),
    usedToday,
    output: flagValue(argv, '--output') ?? 'tmp/speech-planner-eval',
    resumeRun: flagValue(argv, '--resume-run'),
  };
}

function loadPrivateFixture(path: string): SpeechPlannerEvalFixture[] {
  if (!existsSync(path)) throw new Error(`Private speech planner fixture is unavailable: ${path}`);
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  const entries = Array.isArray(raw) ? raw : [raw];
  return entries.map((entry, index) => {
    if (!entry || typeof entry !== 'object') throw new Error('Private fixture must be an object.');
    const fixture = entry as Omit<SpeechPlannerEvalFixture, 'contentHash'>;
    if (!fixture.id || !fixture.prepared || !Array.isArray(fixture.tags)) {
      throw new Error(`Private fixture ${index + 1} is missing required fields.`);
    }
    return {
      ...fixture,
      contentHash: createHash('sha256').update(JSON.stringify(fixture)).digest('hex'),
    };
  });
}

function makeRunId(mode: string): string {
  return `${new Date().toISOString().replaceAll(/[-:.]/gu, '').replace('Z', 'Z')}-${mode}`;
}

function resolveGitSha(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

export interface EvalSpeechPlannerCliResult {
  mode: 'dry-run' | 'offline' | 'live';
  plannerAttempts: number;
  compatibilityChecks: number;
  providerCalls: number;
  synthesisCalls: number;
  postgresAdapters: 0;
  currentDayUsage: number | 'unverified';
  completedAttempts?: number;
  runDirectory?: string;
}

type AttemptExecutor = typeof executeSpeechPlannerAttempt;

function readCompletedAttemptIds(runDirectory: string): Set<string> {
  const attemptsPath = join(runDirectory, 'attempts.jsonl');
  if (!existsSync(attemptsPath)) return new Set();
  const lines = readFileSync(attemptsPath, 'utf8').split(/\r?\n/u).filter(Boolean);
  return new Set(lines.map((line) => (JSON.parse(line) as { attemptId: string }).attemptId));
}

export async function runEvalSpeechPlannerCli(
  argv: readonly string[],
  dependencies: {
    stdout?: (message: string) => void;
    config?: BatchBackendConfig;
    gitSha?: string;
    executeAttempt?: AttemptExecutor;
    writeSelectedAudio?: (args: {
      runDirectory: string;
      records: SpeechPlannerEvalAttemptRecord[];
    }) => Promise<number>;
  } = {},
): Promise<EvalSpeechPlannerCliResult> {
  const options = parseEvalSpeechPlannerArgs(argv);
  if (options.audio === 'selected' && !options.live) {
    throw new Error('--audio=selected requires --live.');
  }
  if (options.audio === 'selected' && !createInworldClientProvider().isConfigured()) {
    throw new Error(
      '--audio=selected requires ESL_TTS_PROVIDER_INWORLD_API_KEY or INWORLD_API_KEY.',
    );
  }
  if (options.offlineOutputFixtures && options.live) {
    throw new Error('--offline-output-fixtures is mutually exclusive with --live.');
  }
  if (options.privateOnly && !options.privateFixture) {
    throw new Error('--private-only requires --private-fixture.');
  }
  const stdout = dependencies.stdout ?? console.log;
  const config = dependencies.config ?? loadConfig();
  const gitSha = dependencies.gitSha ?? resolveGitSha();
  const priceSnapshot = loadSpeechPlannerPriceSnapshot(resolveInputPath(options.priceSnapshot));
  const fixtures = options.privateOnly
    ? loadPrivateFixture(options.privateFixture!)
    : loadSpeechPlannerEvalFixtures(resolveInputPath(options.corpus));
  const variants = buildSpeechPlannerEvalMatrix({
    fixtures,
    repetitions: options.repetitions,
    models: options.models,
    promptPolicies: options.prompts,
  });
  if (options.offlineOutputFixtures) {
    const runDirectory = options.resumeRun
      ? resolveInputPath(options.resumeRun)
      : resolve(resolveInputPath(options.output), makeRunId('offline'));
    const outputs = loadOfflineSpeechPlannerOutputs(
      resolveInputPath(options.offlineOutputFixtures),
    );
    const fixtureById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
    const offlineVariants: SpeechPlannerEvalVariant[] = outputs.map((output) => {
      const fixture = fixtureById.get(output.fixtureId);
      if (!fixture) throw new Error(`Unknown offline fixture: ${output.fixtureId}`);
      return {
        attemptId: `offline-${output.id}`,
        fixtureId: output.fixtureId,
        fixtureHash: fixture.contentHash,
        model: 'gemini-3.1-flash-lite',
        promptPolicyVersion: 'speech-performance-v2-inworld-tts2',
        repetition: 1,
        compatibilitySmoke: false,
      };
    });
    const outputByAttempt = new Map(
      outputs.map((output) => [`offline-${output.id}`, output.rawText]),
    );
    const run = await runSpeechPlannerEvaluation({
      runDirectory,
      gitSha,
      variants: offlineVariants,
      fixtures,
      priceSnapshot,
      executeVariant: async (variant) => ({
        status: 'completed',
        rawText: outputByAttempt.get(variant.attemptId)!,
        latencyMs: 0,
      }),
    });
    const result: EvalSpeechPlannerCliResult = {
      mode: 'offline',
      plannerAttempts: offlineVariants.length,
      compatibilityChecks: 0,
      providerCalls: 0,
      synthesisCalls: 0,
      postgresAdapters: 0,
      currentDayUsage: 'unverified',
      completedAttempts: run.records.length,
      runDirectory,
    };
    stdout(JSON.stringify(result));
    return result;
  }
  const allowedModels = getConfiguredGenerationAllowedModels(config.generation, 'google_ai_studio');
  const limits = getConfiguredSpeechPlannerLimits(config);
  const resumeDirectory = options.resumeRun ? resolveInputPath(options.resumeRun) : undefined;
  const completedAttemptIds = resumeDirectory
    ? readCompletedAttemptIds(resumeDirectory)
    : new Set<string>();
  const preflight = preflightSpeechPlannerEval({
    variants,
    live: options.live,
    credentialsPresent: Boolean(config.generation.providers.googleAiStudio.apiKey),
    usedToday: options.usedToday,
    dailyLimit: limits.dailyRequestBudget ?? 0,
    rpm: limits.rpmBudget ?? 0,
    allowedModels,
    completedAttemptIds,
  });
  if (!preflight.allowed) throw new Error(preflight.remediation);

  const dryResult: EvalSpeechPlannerCliResult = {
    mode: 'dry-run',
    plannerAttempts: variants.length,
    compatibilityChecks: variants.filter((variant) => variant.compatibilitySmoke).length,
    providerCalls: 0,
    synthesisCalls: 0,
    postgresAdapters: 0,
    currentDayUsage: options.usedToday ?? 'unverified',
  };
  if (!options.live && !options.offlineOutputFixtures) {
    stdout(
      JSON.stringify({
        ...dryResult,
        models: options.models,
        prompts: options.prompts,
        repetitions: options.repetitions,
        configuredDailyLimit: limits.dailyRequestBudget,
        configuredRpm: limits.rpmBudget,
        remainingDailyCapacity: preflight.remainingDailyCapacity,
        priceSnapshot: priceSnapshot.version,
        output: resolveInputPath(options.output),
      }),
    );
    return dryResult;
  }

  const runDirectory = resumeDirectory
    ? resumeDirectory
    : resolve(
        resolveInputPath(options.output),
        makeRunId(options.offlineOutputFixtures ? 'offline' : 'baseline'),
      );
  if (options.usedToday === undefined) {
    throw new Error('Live evaluation requires --used-today=<nonnegative integer>.');
  }
  const repository = createSpeechPlannerEvalBudgetRepository({ usedToday: options.usedToday });
  const limiter = new SpeechPlannerEvalRateLimiter({ rpm: limits.rpmBudget ?? 0 });
  const executeAttempt = dependencies.executeAttempt ?? executeSpeechPlannerAttempt;
  let providerCalls = 0;
  const run = await runSpeechPlannerEvaluation({
    runDirectory,
    gitSha,
    variants,
    fixtures,
    priceSnapshot,
    resume: Boolean(options.resumeRun),
    executeVariant: async (variant) => {
      const fixture = fixtures.find((candidate) => candidate.id === variant.fixtureId)!;
      await limiter.acquire();
      providerCalls += 1;
      const startedAt = new Date();
      try {
        const attempt: SpeechPlannerAttemptResult = await executeAttempt({
          config: {
            ...config,
            speechPlanner: { ...config.speechPlanner, model: variant.model },
          },
          prepared: fixture.prepared,
          promptPolicyVersion: variant.promptPolicyVersion,
          repository,
        });
        const endedAt = new Date();
        return {
          status: 'completed' as const,
          rawText: attempt.rawText ?? '',
          latencyMs: attempt.latencyMs,
          returnedModel: attempt.returnedModel,
          providerRequestId: attempt.providerRequestId,
          finishReason: attempt.finishReason,
          usage: attempt.usage,
          startedAt: startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
        };
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error
            ? String((error as { code?: unknown }).code)
            : 'provider_error';
        const status =
          error && typeof error === 'object' && 'status' in error
            ? Number((error as { status?: unknown }).status)
            : undefined;
        if (
          variant.compatibilitySmoke &&
          (status === 400 || status === 404 || code.includes('MODEL') || code.includes('INVALID'))
        ) {
          return { status: 'compatibility_failure' as const, category: code };
        }
        return { status: 'provider_error' as const, category: code };
      }
    },
  });
  const synthesisCalls =
    options.audio === 'selected'
      ? await (dependencies.writeSelectedAudio ?? writeSelectedInworldAudio)({
          runDirectory,
          records: run.records,
        })
      : 0;
  const result: EvalSpeechPlannerCliResult = {
    mode: 'live',
    plannerAttempts: preflight.plannerAttempts,
    compatibilityChecks: preflight.compatibilityChecks,
    providerCalls,
    synthesisCalls,
    postgresAdapters: 0,
    currentDayUsage: options.usedToday,
    completedAttempts: run.records.length,
    runDirectory,
  };
  stdout(JSON.stringify(result));
  return result;
}

export async function writeSelectedInworldAudio(
  args: { runDirectory: string; records: SpeechPlannerEvalAttemptRecord[] },
  dependencies: {
    synthesizeChunk?: typeof synthesizeInworldChunkWithRetry;
    concatenate?: typeof concatMp3Segments;
    ffmpegPath?: string;
  } = {},
): Promise<number> {
  const blocks = selectSpeechPlannerAudioBlocks(args.records);
  const outputDirectory = join(args.runDirectory, 'listening');
  const chunksDirectory = join(outputDirectory, 'chunks');
  const audioDirectory = join(outputDirectory, 'audio');
  mkdirSync(chunksDirectory, { recursive: true });
  mkdirSync(audioDirectory, { recursive: true });
  const synthesizeChunk = dependencies.synthesizeChunk ?? synthesizeInworldChunkWithRetry;
  const concatenate = dependencies.concatenate ?? concatMp3Segments;
  const ffmpegPath = dependencies.ffmpegPath ?? (await resolveFfmpegPath());
  let synthesisCalls = 0;

  await writeBlindListeningReport({
    outputDirectory,
    blocks,
    seed: createHash('sha256').update(args.runDirectory).digest('hex'),
    synthesize: async ({ block, variant, blindLabel }) => {
      const startedAt = Date.now();
      const rendered = variant.record.rendered ?? [];
      if (!variant.record.ttsModel || rendered.length === 0) {
        throw new Error(`Attempt ${variant.attemptId} has no synthesizable rendered plan.`);
      }
      const chunkPaths: string[] = [];
      for (const [index, segment] of rendered.entries()) {
        if (!segment.voiceId) {
          throw new Error(`Attempt ${variant.attemptId} segment ${segment.id} has no voice ID.`);
        }
        const chunkPath = join(chunksDirectory, `${variant.attemptId}-${index}.mp3`);
        await synthesizeChunk(segment.text, segment.voiceId, chunkPath, {
          model: variant.record.ttsModel,
          speakingRate: segment.speakingRate,
          temperature: segment.temperature,
          deliveryMode: segment.deliveryMode,
          language: segment.language,
        });
        synthesisCalls += 1;
        chunkPaths.push(chunkPath);
      }
      const audioFileName = `${block.blockId}-${blindLabel}.mp3`;
      const audioPath = join(audioDirectory, audioFileName);
      if (chunkPaths.length === 1) {
        await concatenate(chunkPaths, audioPath, true, ffmpegPath);
      } else {
        await concatenate(
          chunkPaths,
          audioPath,
          true,
          ffmpegPath,
          resolveInworldAssemblyGapDurations(
            rendered.map((segment) => ({ speaker: segment.speaker })),
          ),
        );
      }
      return {
        audioPath: `audio/${audioFileName}`,
        latencyMs: Date.now() - startedAt,
        bytes: statSync(audioPath).size,
        cacheOutcome: 'miss' as const,
      };
    },
  });
  return synthesisCalls;
}

async function main(): Promise<void> {
  loadCliEnv({ moduleUrl: import.meta.url });
  await runEvalSpeechPlannerCli(process.argv.slice(2));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
