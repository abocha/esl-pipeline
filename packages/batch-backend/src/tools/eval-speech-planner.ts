import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
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
  beginSpeechPlannerEvalRunActivity,
  finishSpeechPlannerEvalRunActivity,
  readSpeechPlannerEvalRunMetadata,
  runSpeechPlannerEvaluation,
  type SpeechPlannerEvalAttemptRecord,
  type SpeechPlannerEvalRunContext,
  type SpeechPlannerEvalRunMetadata,
} from '../application/speech-planner-evaluator.js';
import {
  buildSpeechPlannerListeningIdentity,
  hashSpeechPlannerListeningIdentity,
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
const IGNORED_ARTIFACT_ROOT = resolve(REPO_ROOT, 'tmp');

function resolveInputPath(path: string): string {
  return isAbsolute(path) ? path : resolve(REPO_ROOT, path);
}

function artifactInputPath(path: string): string {
  const absolute = resolveInputPath(path);
  const relation = relative(REPO_ROOT, absolute);
  return relation && !relation.startsWith('..') && !isAbsolute(relation)
    ? relation.replaceAll('\\', '/')
    : absolute;
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

function assertPrivateArtifactPath(path: string): void {
  const absolute = resolveInputPath(path);
  const relation = relative(IGNORED_ARTIFACT_ROOT, absolute);
  if (!relation || relation.startsWith('..') || isAbsolute(relation)) {
    throw new Error('Private evaluation output must remain under the ignored tmp root.');
  }
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

export function assertEvaluationSourceRevision(args: {
  writesArtifacts: boolean;
  porcelain: string;
}): void {
  if (args.writesArtifacts && args.porcelain.trim()) {
    throw new Error('Speech planner evaluation artifacts require a clean Git worktree.');
  }
}

function resolveEvaluationGitSha(writesArtifacts: boolean): string {
  assertEvaluationSourceRevision({
    writesArtifacts,
    porcelain: execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
      encoding: 'utf8',
    }),
  });
  return resolveGitSha();
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
    inworldConfigured?: boolean;
    writeSelectedAudio?: (args: {
      runDirectory: string;
      records: SpeechPlannerEvalAttemptRecord[];
    }) => Promise<number>;
  } = {},
): Promise<EvalSpeechPlannerCliResult> {
  let options = parseEvalSpeechPlannerArgs(argv);
  const resumeDirectory = options.resumeRun ? resolveInputPath(options.resumeRun) : undefined;
  const resumeMetadata: SpeechPlannerEvalRunMetadata | undefined = resumeDirectory
    ? readSpeechPlannerEvalRunMetadata(resumeDirectory)
    : undefined;
  if (resumeMetadata) {
    if (resumeMetadata.mode === 'live' && !options.live) {
      throw new Error('Resuming a live speech planner evaluation requires --live.');
    }
    if (resumeMetadata.mode === 'offline' && options.live) {
      throw new Error('An offline speech planner evaluation cannot be resumed with --live.');
    }
    const saved = resumeMetadata.resolvedConfig;
    options = {
      ...options,
      models: saved.models,
      prompts: saved.promptPolicies,
      repetitions: saved.repetitions,
      corpus: saved.corpusPath,
      priceSnapshot: saved.priceSnapshotPath,
      offlineOutputFixtures: saved.offlineOutputFixturesPath,
      privateFixture: saved.privateFixturePath
        ? assertPrivatePath(saved.privateFixturePath)
        : undefined,
      privateOnly: saved.privateOnly,
    };
  }
  if (options.audio === 'selected' && !options.live) {
    throw new Error('--audio=selected requires --live.');
  }
  if (
    options.audio === 'selected' &&
    !(dependencies.inworldConfigured ?? createInworldClientProvider().isConfigured())
  ) {
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
  if (options.privateFixture && !options.privateOnly) {
    throw new Error('--private-fixture requires --private-only.');
  }
  if (options.privateOnly) {
    assertPrivateArtifactPath(options.resumeRun ?? options.output);
  }
  const stdout = dependencies.stdout ?? console.log;
  const config = dependencies.config ?? loadConfig();
  const gitSha =
    dependencies.gitSha ??
    resolveEvaluationGitSha(options.live || options.offlineOutputFixtures !== undefined);
  const priceSnapshot = loadSpeechPlannerPriceSnapshot(resolveInputPath(options.priceSnapshot));
  const fixtures = options.privateOnly
    ? loadPrivateFixture(options.privateFixture!)
    : loadSpeechPlannerEvalFixtures(resolveInputPath(options.corpus));
  const variants =
    resumeMetadata?.variants ??
    buildSpeechPlannerEvalMatrix({
      fixtures,
      repetitions: options.repetitions,
      models: options.models,
      promptPolicies: options.prompts,
    });
  const allowedModels = getConfiguredGenerationAllowedModels(config.generation, 'google_ai_studio');
  const limits = getConfiguredSpeechPlannerLimits(config);
  if (options.offlineOutputFixtures) {
    const runDirectory = options.resumeRun
      ? resolveInputPath(options.resumeRun)
      : resolve(resolveInputPath(options.output), makeRunId('offline'));
    const outputs = loadOfflineSpeechPlannerOutputs(
      resolveInputPath(options.offlineOutputFixtures),
    );
    const fixtureById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
    const offlineVariants: SpeechPlannerEvalVariant[] =
      resumeMetadata?.variants ??
      outputs.map((output) => {
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
    const outputByAttempt = new Map(outputs.map((output) => [`offline-${output.id}`, output]));
    const run = await runSpeechPlannerEvaluation({
      runDirectory,
      gitSha,
      variants: offlineVariants,
      fixtures,
      priceSnapshot,
      resume: Boolean(options.resumeRun),
      runContext: {
        mode: 'offline',
        resolvedConfig: {
          corpusPath: artifactInputPath(options.corpus),
          priceSnapshotPath: artifactInputPath(options.priceSnapshot),
          offlineOutputFixturesPath: artifactInputPath(options.offlineOutputFixtures),
          ...(options.privateFixture
            ? { privateFixturePath: artifactInputPath(options.privateFixture) }
            : {}),
          models: options.models,
          promptPolicies: options.prompts,
          repetitions: options.repetitions,
          privateOnly: options.privateOnly,
        },
        environmentFlags: {
          live: false,
          offlineOutputFixtures: true,
          selectedAudio: false,
          privateOnly: options.privateOnly,
          postgresAdapters: 0,
        },
        preflight: {
          status: 'not_applicable',
          allowedModels,
          requiredModels: [...SPEECH_PLANNER_EVAL_MODELS],
          missingRequiredModels: SPEECH_PLANNER_EVAL_MODELS.filter(
            (model) => !allowedModels.includes(model),
          ),
          allowlistReady: SPEECH_PLANNER_EVAL_MODELS.every((model) =>
            allowedModels.includes(model),
          ),
          credentialsPresent: Boolean(config.generation.providers.googleAiStudio.apiKey),
          usageVerified: false,
          dailyLimit: limits.dailyRequestBudget ?? 0,
          rpm: limits.rpmBudget ?? 0,
          plannerAttempts: offlineVariants.length,
          compatibilityChecks: 0,
        },
      },
      executeVariant: async (variant) => {
        const output = outputByAttempt.get(variant.attemptId)!;
        if (output.expectedClassification === 'provider_error') {
          return {
            status: 'provider_error',
            category: output.normalizedErrorCategory ?? 'provider_error',
          };
        }
        return {
          status: 'completed',
          rawText: output.rawText!,
          latencyMs: 0,
          fallbackUsed: output.expectedClassification === 'fallback_triggering' ? true : undefined,
        };
      },
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
        allowlistReady: preflight.allowlistReady,
        missingRequiredModels: preflight.missingRequiredModels,
        requiredAllowlist: SPEECH_PLANNER_EVAL_MODELS,
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
  const liveRunContext = {
    mode: 'live',
    resolvedConfig: {
      corpusPath: artifactInputPath(options.corpus),
      priceSnapshotPath: artifactInputPath(options.priceSnapshot),
      ...(options.privateFixture
        ? { privateFixturePath: artifactInputPath(options.privateFixture) }
        : {}),
      models: options.models,
      promptPolicies: options.prompts,
      repetitions: options.repetitions,
      privateOnly: options.privateOnly,
    },
    environmentFlags: {
      live: true,
      offlineOutputFixtures: false,
      selectedAudio: options.audio === 'selected',
      privateOnly: options.privateOnly,
      postgresAdapters: 0,
    },
    preflight: {
      status: 'allowed',
      allowedModels,
      requiredModels: [...SPEECH_PLANNER_EVAL_MODELS],
      missingRequiredModels: preflight.missingRequiredModels,
      allowlistReady: preflight.allowlistReady,
      credentialsPresent: Boolean(config.generation.providers.googleAiStudio.apiKey),
      usageVerified: preflight.usageVerified,
      usedToday: options.usedToday,
      dailyLimit: limits.dailyRequestBudget ?? 0,
      rpm: limits.rpmBudget ?? 0,
      remainingDailyCapacity: preflight.remainingDailyCapacity,
      plannerAttempts: preflight.plannerAttempts,
      compatibilityChecks: preflight.compatibilityChecks,
    },
  } satisfies SpeechPlannerEvalRunContext;
  const run = await runSpeechPlannerEvaluation({
    runDirectory,
    gitSha,
    variants,
    fixtures,
    priceSnapshot,
    resume: Boolean(options.resumeRun),
    runContext: liveRunContext,
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
          fallbackUsed: Boolean(attempt.fallback),
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
  let synthesisCalls = 0;
  if (options.audio === 'selected') {
    const activityId = beginSpeechPlannerEvalRunActivity({
      runDirectory,
      kind: 'selected_audio',
      runContext: liveRunContext,
    });
    try {
      synthesisCalls = await (dependencies.writeSelectedAudio ?? writeSelectedInworldAudio)({
        runDirectory,
        records: run.records,
      });
      finishSpeechPlannerEvalRunActivity({
        runDirectory,
        activityId,
        status: 'completed',
        synthesisCalls,
      });
    } catch (error) {
      finishSpeechPlannerEvalRunActivity({
        runDirectory,
        activityId,
        status: 'failed',
        normalizedErrorCategory: 'selected_audio_failed',
      });
      throw error;
    }
  }
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
  const indexPath = join(outputDirectory, 'index.html');
  const keyPath = join(outputDirectory, 'key.json');
  const incompleteBackups: string[] = [];
  const interruptedFiles: string[] = [];
  for (const reportPath of [indexPath, keyPath]) {
    const backupPath = `${reportPath}.incomplete`;
    if (!existsSync(backupPath)) continue;
    if (existsSync(reportPath)) {
      const interruptedPath = `${reportPath}.interrupted-${randomUUID()}`;
      renameSync(reportPath, interruptedPath);
      interruptedFiles.push(interruptedPath);
    }
    renameSync(backupPath, reportPath);
  }
  const cleanupInterruptedFiles = () => {
    for (const path of interruptedFiles) {
      if (existsSync(path)) unlinkSync(path);
    }
    if (!existsSync(outputDirectory)) return;
    for (const name of readdirSync(outputDirectory).filter((entry) =>
      entry.includes('.interrupted-'),
    )) {
      unlinkSync(join(outputDirectory, name));
    }
  };
  const expectedAudioHashes = new Map<string, { bytes: number; contentHash: string }>();
  const listeningSeed = createHash('sha256').update(args.runDirectory).digest('hex');
  const expectedIdentity = buildSpeechPlannerListeningIdentity(blocks, listeningSeed);
  if (existsSync(indexPath) || existsSync(keyPath)) {
    if (existsSync(keyPath)) {
      const key = JSON.parse(readFileSync(keyPath, 'utf8')) as {
        seed?: string;
        identityHash?: string;
        htmlContentHash?: string;
        blocks?: Array<{
          blockId?: string;
          fixtureId?: string;
          complete?: boolean;
          preferenceEligible?: boolean;
          variants?: Array<{
            blindLabel?: string;
            attemptId?: string;
            requestedModel?: SpeechPlannerEvalModel;
            promptPolicyVersion?: SpeechPerformancePromptPolicyId;
            settingsHash?: string;
            synthesis?: { audioPath?: string; bytes?: number; contentHash?: string };
          }>;
        }>;
      };
      const actualIdentity =
        key.blocks?.map((block) => ({
          blockId: block.blockId,
          fixtureId: block.fixtureId,
          complete: block.complete,
          preferenceEligible: block.preferenceEligible,
          variants:
            block.variants?.map((variant) => ({
              blindLabel: variant.blindLabel,
              attemptId: variant.attemptId,
              requestedModel: variant.requestedModel,
              promptPolicyVersion: variant.promptPolicyVersion,
              settingsHash: variant.settingsHash,
            })) ?? [],
        })) ?? [];
      if (
        key.seed !== listeningSeed ||
        key.identityHash !== hashSpeechPlannerListeningIdentity(expectedIdentity) ||
        (existsSync(indexPath) &&
          key.htmlContentHash !==
            createHash('sha256').update(readFileSync(indexPath, 'utf8')).digest('hex')) ||
        JSON.stringify(actualIdentity) !== JSON.stringify(expectedIdentity)
      ) {
        throw new Error('Selected audio listening key identity mismatch.');
      }
      for (const block of key.blocks ?? []) {
        for (const variant of block.variants ?? []) {
          const synthesis = variant.synthesis;
          const expectedAudioPath = `audio/${block.blockId}-${variant.blindLabel}.mp3`;
          if (
            !synthesis?.audioPath ||
            synthesis.audioPath !== expectedAudioPath ||
            !Number.isInteger(synthesis.bytes) ||
            synthesis.bytes! < 1 ||
            !/^[a-f0-9]{64}$/u.test(synthesis.contentHash ?? '')
          ) {
            throw new Error('Selected audio key contains invalid integrity metadata.');
          }
          const absoluteAudioPath = resolve(outputDirectory, synthesis.audioPath);
          const relation = relative(outputDirectory, absoluteAudioPath);
          if (!relation || relation.startsWith('..') || isAbsolute(relation)) {
            throw new Error('Selected audio key contains an unsafe audio path.');
          }
          if (expectedAudioHashes.has(absoluteAudioPath)) {
            throw new Error('Selected audio key contains duplicate audio paths.');
          }
          expectedAudioHashes.set(absoluteAudioPath, {
            bytes: synthesis.bytes!,
            contentHash: synthesis.contentHash!,
          });
        }
      }
    }
    if (existsSync(indexPath) && existsSync(keyPath)) {
      let missingAudio = false;
      for (const [audioPath, integrity] of expectedAudioHashes) {
        if (!existsSync(audioPath)) {
          missingAudio = true;
          continue;
        }
        const content = readFileSync(audioPath);
        const contentHash = createHash('sha256').update(content).digest('hex');
        if (content.length !== integrity.bytes || contentHash !== integrity.contentHash) {
          throw new Error(`Selected audio immutable audio mismatch: ${audioPath}`);
        }
      }
      if (!missingAudio) {
        cleanupInterruptedFiles();
        return 0;
      }
    }
    for (const reportPath of [indexPath, keyPath].filter((path) => existsSync(path))) {
      const backupPath = `${reportPath}.incomplete`;
      if (existsSync(backupPath)) {
        throw new Error('Selected audio resume contains multiple incomplete listening reports.');
      }
      renameSync(reportPath, backupPath);
      incompleteBackups.push(backupPath);
    }
  }
  const chunksDirectory = join(outputDirectory, 'chunks');
  const audioDirectory = join(outputDirectory, 'audio');
  mkdirSync(chunksDirectory, { recursive: true });
  mkdirSync(audioDirectory, { recursive: true });
  const synthesizeChunk = dependencies.synthesizeChunk ?? synthesizeInworldChunkWithRetry;
  const concatenate = dependencies.concatenate ?? concatMp3Segments;
  const ffmpegPath = dependencies.ffmpegPath ?? (await resolveFfmpegPath());
  const clientProvider = createInworldClientProvider();
  let synthesisCalls = 0;

  await writeBlindListeningReport({
    outputDirectory,
    blocks,
    seed: listeningSeed,
    synthesize: async ({ block, variant, blindLabel }) => {
      const startedAt = Date.now();
      const rendered = variant.record.rendered ?? [];
      if (!variant.record.ttsModel || rendered.length === 0) {
        throw new Error(`Attempt ${variant.attemptId} has no synthesizable rendered plan.`);
      }
      const chunkPaths: string[] = [];
      let generatedVariantChunk = false;
      for (const [index, segment] of rendered.entries()) {
        if (!segment.voiceId) {
          throw new Error(`Attempt ${variant.attemptId} segment ${segment.id} has no voice ID.`);
        }
        const chunkPath = join(chunksDirectory, `${variant.attemptId}-${index}.mp3`);
        if (!existsSync(chunkPath) || statSync(chunkPath).size === 0) {
          await synthesizeChunk(
            segment.text,
            segment.voiceId,
            chunkPath,
            {
              model: variant.record.ttsModel,
              speakingRate: segment.speakingRate,
              temperature: segment.temperature,
              deliveryMode: segment.deliveryMode,
              language: segment.language,
            },
            { clientProvider },
          );
          synthesisCalls += 1;
          generatedVariantChunk = true;
        }
        chunkPaths.push(chunkPath);
      }
      const audioFileName = `${block.blockId}-${blindLabel}.mp3`;
      const audioPath = join(audioDirectory, audioFileName);
      if (!existsSync(audioPath) || statSync(audioPath).size === 0) {
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
      }
      const audioContent = readFileSync(audioPath);
      const contentHash = createHash('sha256').update(audioContent).digest('hex');
      const expectedIntegrity = expectedAudioHashes.get(audioPath);
      if (
        expectedIntegrity &&
        (audioContent.length !== expectedIntegrity.bytes ||
          contentHash !== expectedIntegrity.contentHash)
      ) {
        throw new Error(`Selected audio immutable audio mismatch: ${audioPath}`);
      }
      return {
        audioPath: `audio/${audioFileName}`,
        latencyMs: Date.now() - startedAt,
        bytes: audioContent.length,
        contentHash,
        cacheOutcome: generatedVariantChunk ? ('miss' as const) : ('hit' as const),
      };
    },
  });
  for (const backupPath of incompleteBackups) unlinkSync(backupPath);
  cleanupInterruptedFiles();
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
