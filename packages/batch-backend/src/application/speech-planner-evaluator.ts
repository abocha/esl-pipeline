import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import type { GenerateDraftUsage, InworldTtsModel } from '@esl-pipeline/contracts';
import { analyzeValidatedSpeechPlan, type SpeechDeliveryMode } from '@esl-pipeline/tts-core';
import {
  INWORLD_RENDERER_POLICY_VERSION,
  renderInworldSpeechSegment,
} from '@esl-pipeline/tts-provider-inworld';

import { evaluateSpeechPlannerRawOutput } from './speech-performance-planner.js';
import { buildSpeechPlannerRequest } from './speech-performance-prompt.js';
import type {
  SpeechPlannerEvalFixture,
  SpeechPlannerEvalModel,
  SpeechPlannerEvalVariant,
  SpeechPlannerPriceSnapshot,
} from './speech-planner-eval-fixtures.js';
import {
  renderSpeechPlannerEvalSummaryMarkdown,
  summarizeSpeechPlannerEvalAttempts,
} from './speech-planner-eval-report.js';

export { summarizeSpeechPlannerEvalAttempts } from './speech-planner-eval-report.js';

export interface SpeechPlannerAttemptCost {
  costStatus: 'estimated';
  estimatedCostUsd: number;
  formula: {
    inputTokens: number;
    visibleOutputTokens: number;
    thinkingTokens: number;
    inputPerMillionUsd: number;
    outputIncludingThinkingPerMillionUsd: number;
  };
}

export function estimateSpeechPlannerAttemptCost(args: {
  model: SpeechPlannerEvalModel;
  usage?: GenerateDraftUsage;
  priceSnapshot: SpeechPlannerPriceSnapshot;
}): SpeechPlannerAttemptCost | { costStatus: 'unavailable' } {
  const inputTokens = args.usage?.inputTokens;
  const visibleOutputTokens = args.usage?.outputTokens;
  const thinkingTokens = args.usage?.reasoningTokens;
  if (
    inputTokens === undefined ||
    visibleOutputTokens === undefined ||
    thinkingTokens === undefined
  ) {
    return { costStatus: 'unavailable' };
  }
  const rates = args.priceSnapshot.perMillionTokens[args.model];
  const estimatedCostUsd =
    (inputTokens * rates.input +
      (visibleOutputTokens + thinkingTokens) * rates.outputIncludingThinking) /
    1_000_000;
  return {
    costStatus: 'estimated',
    estimatedCostUsd,
    formula: {
      inputTokens,
      visibleOutputTokens,
      thinkingTokens,
      inputPerMillionUsd: rates.input,
      outputIncludingThinkingPerMillionUsd: rates.outputIncludingThinking,
    },
  };
}

export interface SpeechPlannerEvalAttemptRecord {
  attemptId: string;
  fixtureId: string;
  fixtureTags?: string[];
  fixtureContentHash?: string;
  ttsModel?: InworldTtsModel;
  requestedModel: SpeechPlannerEvalModel;
  returnedModel?: string;
  promptPolicyVersion: SpeechPlannerEvalVariant['promptPolicyVersion'];
  repetition: number;
  compatibilitySmoke: boolean;
  startedAt?: string;
  endedAt?: string;
  rawParseStatus: 'parsed' | 'malformed' | 'not_attempted';
  promptedPlanStatus: 'valid' | 'invalid' | 'provider_error' | 'skipped_incompatible';
  fallbackStatus: 'not_used' | 'identity';
  promptHash?: string;
  rendererPolicyVersion?: string;
  latencyMs?: number;
  usage?: GenerateDraftUsage;
  costStatus: 'estimated' | 'unavailable';
  estimatedCostUsd?: number;
  costFormula?: SpeechPlannerAttemptCost['formula'];
  normalizedErrorCategory?: string;
  providerRequestId?: string;
  finishReason?: string;
  validationReason?: string;
  rawText?: string;
  rawTextHash?: string;
  rawParse?: ReturnType<typeof evaluateSpeechPlannerRawOutput>['rawParse'];
  parsedCandidate?: unknown;
  candidateAnalysis?: ReturnType<typeof evaluateSpeechPlannerRawOutput>['candidateAnalysis'];
  analysis?: ReturnType<typeof analyzeValidatedSpeechPlan>;
  plan?: ReturnType<typeof evaluateSpeechPlannerRawOutput>['plan'];
  rendered?: Array<{
    id: string;
    text: string;
    lexicalText: string;
    leadingInstructionTagCount: number;
    voiceId?: string;
    language?: string;
    speakingRate?: number;
    deliveryMode?: SpeechDeliveryMode;
    temperature?: number;
    speaker?: string;
  }>;
  renderedContentHash?: string;
}

export function evaluateSpeechPlannerAttemptRecord(args: {
  variant: SpeechPlannerEvalVariant;
  fixture: SpeechPlannerEvalFixture;
  rawText: string;
  returnedModel?: string;
  providerRequestId?: string;
  finishReason?: string;
  usage?: GenerateDraftUsage;
  latencyMs: number;
  priceSnapshot: SpeechPlannerPriceSnapshot;
  fallbackUsed?: boolean;
  startedAt?: string;
  endedAt?: string;
}): SpeechPlannerEvalAttemptRecord {
  const request = buildSpeechPlannerRequest(
    args.fixture.prepared,
    args.variant.promptPolicyVersion,
    args.variant.model,
  );
  const evaluated = evaluateSpeechPlannerRawOutput({
    prepared: args.fixture.prepared,
    rawText: args.rawText,
    promptPolicyVersion: args.variant.promptPolicyVersion,
    promptHash: request.promptHash,
    plannerModel: args.variant.model,
    generatedAt: new Date(0).toISOString(),
    latencyMs: args.latencyMs,
    usage: args.usage,
    returnedModel: args.returnedModel,
    providerRequestId: args.providerRequestId,
    finishReason: args.finishReason,
  });
  const cost = estimateSpeechPlannerAttemptCost({
    model: args.variant.model,
    usage: args.usage,
    priceSnapshot: args.priceSnapshot,
  });
  const base: SpeechPlannerEvalAttemptRecord = {
    attemptId: args.variant.attemptId,
    fixtureId: args.variant.fixtureId,
    fixtureTags: args.fixture.tags,
    fixtureContentHash: args.fixture.contentHash,
    ttsModel: args.fixture.prepared.selection.model as InworldTtsModel,
    requestedModel: args.variant.model,
    returnedModel: args.returnedModel,
    promptPolicyVersion: args.variant.promptPolicyVersion,
    repetition: args.variant.repetition,
    compatibilitySmoke: args.variant.compatibilitySmoke,
    startedAt: args.startedAt,
    endedAt: args.endedAt,
    rawParseStatus: evaluated.rawParse?.status ?? 'malformed',
    promptedPlanStatus: evaluated.plan ? 'valid' : 'invalid',
    fallbackStatus: (args.fallbackUsed ?? !evaluated.plan) ? 'identity' : 'not_used',
    promptHash: request.promptHash,
    rendererPolicyVersion: INWORLD_RENDERER_POLICY_VERSION,
    latencyMs: args.latencyMs,
    usage: args.usage,
    costStatus: cost.costStatus,
    rawText: args.rawText,
    rawTextHash: createHash('sha256').update(args.rawText).digest('hex'),
    rawParse: evaluated.rawParse,
    parsedCandidate: evaluated.parsedCandidate,
    candidateAnalysis: evaluated.candidateAnalysis,
    providerRequestId: args.providerRequestId,
    finishReason: args.finishReason,
    ...(evaluated.validation.status === 'invalid'
      ? { validationReason: evaluated.validation.reason }
      : {}),
    ...(cost.costStatus === 'estimated'
      ? { estimatedCostUsd: cost.estimatedCostUsd, costFormula: cost.formula }
      : {}),
    plan: evaluated.plan,
  };
  if (!evaluated.plan) return base;

  const assignments = new Map(
    args.fixture.prepared.voicePlan?.assignments.map((assignment) => [
      assignment.speaker.toLocaleLowerCase(),
      assignment,
    ]) ?? [],
  );
  const rendered = evaluated.plan.segments.map((segment) => {
    const assignment = segment.speaker
      ? assignments.get(segment.speaker.toLocaleLowerCase())
      : undefined;
    const output = renderInworldSpeechSegment({
      model: args.fixture.prepared.selection.model as InworldTtsModel,
      segment,
      capabilities: assignment?.capabilities,
      language: assignment?.language,
    });
    return {
      id: segment.id,
      ...output,
      ...(segment.speaker ? { speaker: segment.speaker } : {}),
      ...(assignment?.voiceId ? { voiceId: assignment.voiceId } : {}),
    };
  });
  const analysis = analyzeValidatedSpeechPlan(
    args.fixture.prepared,
    evaluated.plan,
    rendered.map((segment) => ({
      id: segment.id,
      text: segment.text,
      lexicalText: segment.lexicalText,
      leadingInstructionTagCount: segment.leadingInstructionTagCount,
    })),
  );
  return {
    ...base,
    rendered,
    renderedContentHash: stableHash(rendered),
    analysis,
  };
}

type ExecuteVariantResult =
  | {
      status: 'completed';
      rawText: string;
      latencyMs: number;
      startedAt?: string;
      endedAt?: string;
      returnedModel?: string;
      providerRequestId?: string;
      finishReason?: string;
      usage?: GenerateDraftUsage;
      fallbackUsed?: boolean;
    }
  | { status: 'compatibility_failure'; category: string }
  | { status: 'provider_error'; category: string; latencyMs?: number };

export interface SpeechPlannerEvalRunContext {
  mode: 'offline' | 'live';
  resolvedConfig: {
    corpusPath: string;
    priceSnapshotPath: string;
    offlineOutputFixturesPath?: string;
    privateFixturePath?: string;
    models: SpeechPlannerEvalVariant['model'][];
    promptPolicies: SpeechPlannerEvalVariant['promptPolicyVersion'][];
    repetitions: number;
    privateOnly: boolean;
  };
  environmentFlags: {
    live: boolean;
    offlineOutputFixtures: boolean;
    selectedAudio: boolean;
    privateOnly: boolean;
    postgresAdapters: 0;
  };
  preflight: {
    status: 'not_applicable' | 'allowed';
    allowedModels: readonly string[];
    requiredModels: string[];
    missingRequiredModels: string[];
    allowlistReady: boolean;
    credentialsPresent: boolean;
    usageVerified: boolean;
    usedToday?: number;
    dailyLimit: number;
    rpm: number;
    remainingDailyCapacity?: number;
    plannerAttempts: number;
    compatibilityChecks: number;
  };
}

export interface SpeechPlannerEvalRunMetadata {
  schemaVersion: 2;
  status: 'partial' | 'completed';
  createdAt: string;
  completedAt?: string;
  completedAttempts: number;
  expectedAttempts: number;
  mode: 'offline' | 'live';
  configHash: string;
  gitSha: string;
  resolvedConfig: SpeechPlannerEvalRunContext['resolvedConfig'];
  environmentFlags: SpeechPlannerEvalRunContext['environmentFlags'];
  preflight: SpeechPlannerEvalRunContext['preflight'];
  priceSnapshot: SpeechPlannerPriceSnapshot;
  rendererPolicyVersion: string;
  promptHashes: string[];
  variants: SpeechPlannerEvalVariant[];
  attemptIds: string[];
}

export function readSpeechPlannerEvalRunMetadata(
  runDirectory: string,
): SpeechPlannerEvalRunMetadata {
  const path = join(runDirectory, 'run.json');
  if (!existsSync(path)) throw new Error('Speech planner eval resume run.json is missing.');
  const metadata = JSON.parse(readFileSync(path, 'utf8')) as Partial<SpeechPlannerEvalRunMetadata>;
  if (
    metadata.schemaVersion !== 2 ||
    (metadata.status !== 'partial' && metadata.status !== 'completed') ||
    !metadata.resolvedConfig ||
    !metadata.environmentFlags ||
    !metadata.preflight ||
    !metadata.priceSnapshot ||
    !Array.isArray(metadata.variants)
  ) {
    throw new Error('Speech planner eval resume run.json has an unsupported metadata contract.');
  }
  return metadata as SpeechPlannerEvalRunMetadata;
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function returnedModelMatchesRequest(record: SpeechPlannerEvalAttemptRecord): boolean {
  return (
    record.returnedModel === undefined ||
    record.returnedModel === record.requestedModel ||
    record.returnedModel.startsWith(`${record.requestedModel}-`)
  );
}

function readAttempts(path: string): SpeechPlannerEvalAttemptRecord[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8').trim();
  if (!text) return [];
  const records = text
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line) as SpeechPlannerEvalAttemptRecord);
  if (new Set(records.map((record) => record.attemptId)).size !== records.length) {
    throw new Error('Speech planner eval resume contains duplicate attempt IDs.');
  }
  return records;
}

function appendRecord(
  runDirectory: string,
  record: SpeechPlannerEvalAttemptRecord,
): SpeechPlannerEvalAttemptRecord {
  if (record.rawText !== undefined) {
    writeImmutableFile(
      join(runDirectory, 'plans', `${record.attemptId}.json`),
      planArtifactContent(record),
    );
  }
  if (record.rendered) {
    writeImmutableFile(
      join(runDirectory, 'rendered', `${record.attemptId}.json`),
      JSON.stringify(record.rendered, null, 2),
    );
  }
  const attemptsPath = join(runDirectory, 'attempts.jsonl');
  const records = [...readAttempts(attemptsPath), record];
  writeAtomicFile(attemptsPath, `${records.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  return record;
}

function planArtifactContent(record: SpeechPlannerEvalAttemptRecord): string {
  return JSON.stringify(
    {
      rawText: record.rawText,
      rawTextHash: record.rawTextHash,
      rawParse: record.rawParse,
      parsedCandidate: record.parsedCandidate,
      candidateAnalysis: record.candidateAnalysis,
      validationReason: record.validationReason,
      promptHash: record.promptHash,
      rendererPolicyVersion: record.rendererPolicyVersion,
      fixtureContentHash: record.fixtureContentHash,
      renderedContentHash: record.renderedContentHash,
      plan: record.plan,
      analysis: record.analysis,
    },
    null,
    2,
  );
}

function validateImmutableArtifacts(
  runDirectory: string,
  records: readonly SpeechPlannerEvalAttemptRecord[],
): void {
  for (const record of records) {
    if (record.rawText !== undefined) {
      const planPath = join(runDirectory, 'plans', `${record.attemptId}.json`);
      if (!existsSync(planPath) || readFileSync(planPath, 'utf8') !== planArtifactContent(record)) {
        throw new Error(`Speech planner eval immutable artifact mismatch: ${planPath}`);
      }
    }
    if (record.rendered) {
      const renderedPath = join(runDirectory, 'rendered', `${record.attemptId}.json`);
      if (
        !existsSync(renderedPath) ||
        readFileSync(renderedPath, 'utf8') !== JSON.stringify(record.rendered, null, 2)
      ) {
        throw new Error(`Speech planner eval immutable artifact mismatch: ${renderedPath}`);
      }
    }
  }
}

function writeImmutableFile(path: string, content: string): void {
  if (existsSync(path)) {
    if (readFileSync(path, 'utf8') !== content) {
      throw new Error(`Speech planner eval immutable artifact mismatch: ${path}`);
    }
    return;
  }
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
    renameSync(temporaryPath, path);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

function writeAtomicFile(path: string, content: string): void {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
    renameSync(temporaryPath, path);
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

export async function runSpeechPlannerEvaluation(args: {
  runDirectory: string;
  gitSha: string;
  variants: readonly SpeechPlannerEvalVariant[];
  fixtures: readonly SpeechPlannerEvalFixture[];
  priceSnapshot: SpeechPlannerPriceSnapshot;
  executeVariant: (variant: SpeechPlannerEvalVariant) => Promise<ExecuteVariantResult>;
  resume?: boolean;
  runContext?: SpeechPlannerEvalRunContext;
}): Promise<{
  records: SpeechPlannerEvalAttemptRecord[];
  summary: ReturnType<typeof summarizeSpeechPlannerEvalAttempts>;
}> {
  const fixtureById = new Map(args.fixtures.map((fixture) => [fixture.id, fixture]));
  const promptHashes = [
    ...new Set(
      args.variants.map((variant) => {
        const fixture = fixtureById.get(variant.fixtureId);
        if (!fixture) throw new Error(`Unknown speech planner eval fixture: ${variant.fixtureId}`);
        return buildSpeechPlannerRequest(
          fixture.prepared,
          variant.promptPolicyVersion,
          variant.model,
        ).promptHash;
      }),
    ),
  ].sort();
  const configHash = stableHash({
    gitSha: args.gitSha,
    variants: args.variants,
    fixtureHashes: args.fixtures.map((fixture) => [fixture.id, fixture.contentHash]),
    priceSnapshot: args.priceSnapshot,
    rendererPolicyVersion: INWORLD_RENDERER_POLICY_VERSION,
    promptHashes,
  });
  const runPath = join(args.runDirectory, 'run.json');
  const attemptsPath = join(args.runDirectory, 'attempts.jsonl');
  if (existsSync(args.runDirectory) && !args.resume) {
    throw new Error(`Speech planner eval run directory already exists: ${args.runDirectory}`);
  }
  let metadata: SpeechPlannerEvalRunMetadata;
  if (args.resume) {
    metadata = readSpeechPlannerEvalRunMetadata(args.runDirectory);
    if (metadata.configHash !== configHash) {
      throw new Error('Speech planner eval resume configuration hash does not match.');
    }
  } else {
    mkdirSync(join(args.runDirectory, 'plans'), { recursive: true });
    mkdirSync(join(args.runDirectory, 'rendered'), { recursive: true });
    mkdirSync(join(args.runDirectory, 'audio'), { recursive: true });
    mkdirSync(join(args.runDirectory, 'listening'), { recursive: true });
    const runContext =
      args.runContext ??
      ({
        mode: 'offline',
        resolvedConfig: {
          corpusPath: 'injected',
          priceSnapshotPath: 'injected',
          models: [...new Set(args.variants.map((variant) => variant.model))],
          promptPolicies: [...new Set(args.variants.map((variant) => variant.promptPolicyVersion))],
          repetitions: Math.max(0, ...args.variants.map((variant) => variant.repetition)),
          privateOnly: false,
        },
        environmentFlags: {
          live: false,
          offlineOutputFixtures: true,
          selectedAudio: false,
          privateOnly: false,
          postgresAdapters: 0,
        },
        preflight: {
          status: 'not_applicable',
          allowedModels: [],
          requiredModels: [],
          missingRequiredModels: [],
          allowlistReady: false,
          credentialsPresent: false,
          usageVerified: false,
          dailyLimit: 0,
          rpm: 0,
          plannerAttempts: args.variants.length,
          compatibilityChecks: args.variants.filter((variant) => variant.compatibilitySmoke).length,
        },
      } satisfies SpeechPlannerEvalRunContext);
    metadata = {
      schemaVersion: 2,
      status: 'partial',
      createdAt: new Date().toISOString(),
      completedAttempts: 0,
      expectedAttempts: args.variants.length,
      mode: runContext.mode,
      configHash,
      gitSha: args.gitSha,
      resolvedConfig: runContext.resolvedConfig,
      environmentFlags: runContext.environmentFlags,
      preflight: runContext.preflight,
      priceSnapshot: args.priceSnapshot,
      rendererPolicyVersion: INWORLD_RENDERER_POLICY_VERSION,
      promptHashes,
      variants: [...args.variants],
      attemptIds: args.variants.map((variant) => variant.attemptId),
    };
    writeFileSync(runPath, JSON.stringify(metadata, null, 2), { encoding: 'utf8', flag: 'wx' });
  }

  const records = readAttempts(attemptsPath);
  if (args.resume) validateImmutableArtifacts(args.runDirectory, records);
  const completed = new Set(records.map((record) => record.attemptId));
  const attemptIdentity = (variant: SpeechPlannerEvalVariant) => {
    const fixture = fixtureById.get(variant.fixtureId);
    if (!fixture) throw new Error(`Unknown speech planner eval fixture: ${variant.fixtureId}`);
    return {
      fixtureTags: fixture.tags,
      fixtureContentHash: fixture.contentHash,
      ttsModel: fixture.prepared.selection.model as InworldTtsModel,
      promptHash: buildSpeechPlannerRequest(
        fixture.prepared,
        variant.promptPolicyVersion,
        variant.model,
      ).promptHash,
      rendererPolicyVersion: INWORLD_RENDERER_POLICY_VERSION,
    };
  };
  const smoke = args.variants.find((variant) => variant.compatibilitySmoke);
  const ordered = smoke
    ? [smoke, ...args.variants.filter((variant) => variant.attemptId !== smoke.attemptId)]
    : [...args.variants];
  let incompatibleModel = records.find(
    (record) =>
      record.compatibilitySmoke && record.normalizedErrorCategory?.startsWith('compatibility_'),
  )?.requestedModel;

  for (const variant of ordered) {
    if (completed.has(variant.attemptId)) continue;
    if (incompatibleModel === variant.model) {
      records.push(
        appendRecord(args.runDirectory, {
          attemptId: variant.attemptId,
          fixtureId: variant.fixtureId,
          ...attemptIdentity(variant),
          requestedModel: variant.model,
          promptPolicyVersion: variant.promptPolicyVersion,
          repetition: variant.repetition,
          compatibilitySmoke: variant.compatibilitySmoke,
          rawParseStatus: 'not_attempted',
          promptedPlanStatus: 'skipped_incompatible',
          fallbackStatus: 'not_used',
          costStatus: 'unavailable',
          normalizedErrorCategory: 'skipped_incompatible',
        }),
      );
      continue;
    }
    let result: ExecuteVariantResult;
    try {
      result = await args.executeVariant(variant);
    } catch {
      result = { status: 'provider_error', category: 'unexpected_execution_error' };
    }
    if (result.status === 'compatibility_failure') {
      incompatibleModel = variant.model;
      records.push(
        appendRecord(args.runDirectory, {
          attemptId: variant.attemptId,
          fixtureId: variant.fixtureId,
          ...attemptIdentity(variant),
          requestedModel: variant.model,
          promptPolicyVersion: variant.promptPolicyVersion,
          repetition: variant.repetition,
          compatibilitySmoke: variant.compatibilitySmoke,
          rawParseStatus: 'not_attempted',
          promptedPlanStatus: 'provider_error',
          fallbackStatus: 'identity',
          costStatus: 'unavailable',
          normalizedErrorCategory: `compatibility_${result.category}`,
        }),
      );
      continue;
    }
    if (result.status === 'provider_error') {
      records.push(
        appendRecord(args.runDirectory, {
          attemptId: variant.attemptId,
          fixtureId: variant.fixtureId,
          ...attemptIdentity(variant),
          requestedModel: variant.model,
          promptPolicyVersion: variant.promptPolicyVersion,
          repetition: variant.repetition,
          compatibilitySmoke: variant.compatibilitySmoke,
          rawParseStatus: 'not_attempted',
          promptedPlanStatus: 'provider_error',
          fallbackStatus: 'identity',
          latencyMs: result.latencyMs,
          costStatus: 'unavailable',
          normalizedErrorCategory: result.category,
        }),
      );
      continue;
    }
    const fixture = fixtureById.get(variant.fixtureId);
    if (!fixture) throw new Error(`Unknown speech planner eval fixture: ${variant.fixtureId}`);
    const record = evaluateSpeechPlannerAttemptRecord({
      variant,
      fixture,
      rawText: result.rawText,
      returnedModel: result.returnedModel,
      providerRequestId: result.providerRequestId,
      finishReason: result.finishReason,
      usage: result.usage,
      latencyMs: result.latencyMs,
      priceSnapshot: args.priceSnapshot,
      fallbackUsed: result.fallbackUsed,
      startedAt: result.startedAt,
      endedAt: result.endedAt,
    });
    if (variant.compatibilitySmoke && !record.plan) {
      incompatibleModel = variant.model;
      record.normalizedErrorCategory = 'compatibility_invalid_output';
    } else if (variant.compatibilitySmoke && !returnedModelMatchesRequest(record)) {
      incompatibleModel = variant.model;
      record.normalizedErrorCategory = 'compatibility_returned_model_mismatch';
    }
    records.push(appendRecord(args.runDirectory, record));
  }

  const summary = summarizeSpeechPlannerEvalAttempts(records);
  writeAtomicFile(join(args.runDirectory, 'summary.json'), JSON.stringify(summary, null, 2));
  writeAtomicFile(
    join(args.runDirectory, 'summary.md'),
    renderSpeechPlannerEvalSummaryMarkdown(summary),
  );
  metadata = {
    ...metadata,
    status: 'completed',
    completedAt: metadata.completedAt ?? new Date().toISOString(),
    completedAttempts: records.length,
  };
  writeAtomicFile(runPath, JSON.stringify(metadata, null, 2));
  return { records, summary };
}
