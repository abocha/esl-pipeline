import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { GenerateDraftUsage, InworldTtsModel } from '@esl-pipeline/contracts';
import { analyzeValidatedSpeechPlan } from '@esl-pipeline/tts-core';
import { renderInworldSpeechSegment } from '@esl-pipeline/tts-provider-inworld';

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
  latencyMs?: number;
  usage?: GenerateDraftUsage;
  costStatus: 'estimated' | 'unavailable';
  estimatedCostUsd?: number;
  costFormula?: SpeechPlannerAttemptCost['formula'];
  normalizedErrorCategory?: string;
  rawText?: string;
  parsedCandidate?: unknown;
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
    deliveryMode?: string;
  }>;
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
    requestedModel: args.variant.model,
    returnedModel: args.returnedModel,
    promptPolicyVersion: args.variant.promptPolicyVersion,
    repetition: args.variant.repetition,
    compatibilitySmoke: args.variant.compatibilitySmoke,
    startedAt: args.startedAt,
    endedAt: args.endedAt,
    rawParseStatus: evaluated.rawParse?.status ?? 'malformed',
    promptedPlanStatus: evaluated.plan ? 'valid' : 'invalid',
    fallbackStatus: args.fallbackUsed ? 'identity' : 'not_used',
    latencyMs: args.latencyMs,
    usage: args.usage,
    costStatus: cost.costStatus,
    rawText: args.rawText,
    parsedCandidate: evaluated.parsedCandidate,
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
  return { ...base, rendered, analysis };
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

interface RunMetadata {
  schemaVersion: 1;
  configHash: string;
  gitSha: string;
  priceSnapshotVersion: string;
  attemptIds: string[];
  status: 'running' | 'complete' | 'partial';
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
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
  appendFileSync(join(runDirectory, 'attempts.jsonl'), `${JSON.stringify(record)}\n`, 'utf8');
  if (record.rawText !== undefined) {
    writeFileSync(
      join(runDirectory, 'plans', `${record.attemptId}.json`),
      JSON.stringify(
        {
          rawText: record.rawText,
          parsedCandidate: record.parsedCandidate,
          plan: record.plan,
          analysis: record.analysis,
        },
        null,
        2,
      ),
      { encoding: 'utf8', flag: 'wx' },
    );
  }
  if (record.rendered) {
    writeFileSync(
      join(runDirectory, 'rendered', `${record.attemptId}.json`),
      JSON.stringify(record.rendered, null, 2),
      { encoding: 'utf8', flag: 'wx' },
    );
  }
  return record;
}

export async function runSpeechPlannerEvaluation(args: {
  runDirectory: string;
  gitSha: string;
  variants: readonly SpeechPlannerEvalVariant[];
  fixtures: readonly SpeechPlannerEvalFixture[];
  priceSnapshot: SpeechPlannerPriceSnapshot;
  executeVariant: (variant: SpeechPlannerEvalVariant) => Promise<ExecuteVariantResult>;
  resume?: boolean;
}): Promise<{
  records: SpeechPlannerEvalAttemptRecord[];
  summary: ReturnType<typeof summarizeSpeechPlannerEvalAttempts>;
}> {
  const configHash = stableHash({
    gitSha: args.gitSha,
    variants: args.variants,
    fixtureHashes: args.fixtures.map((fixture) => [fixture.id, fixture.contentHash]),
    priceSnapshot: args.priceSnapshot,
  });
  const runPath = join(args.runDirectory, 'run.json');
  const attemptsPath = join(args.runDirectory, 'attempts.jsonl');
  if (existsSync(args.runDirectory) && !args.resume) {
    throw new Error(`Speech planner eval run directory already exists: ${args.runDirectory}`);
  }
  let metadata: RunMetadata;
  if (args.resume) {
    if (!existsSync(runPath)) throw new Error('Speech planner eval resume run.json is missing.');
    metadata = JSON.parse(readFileSync(runPath, 'utf8')) as RunMetadata;
    if (metadata.configHash !== configHash) {
      throw new Error('Speech planner eval resume configuration hash does not match.');
    }
  } else {
    mkdirSync(join(args.runDirectory, 'plans'), { recursive: true });
    mkdirSync(join(args.runDirectory, 'rendered'), { recursive: true });
    mkdirSync(join(args.runDirectory, 'audio'), { recursive: true });
    mkdirSync(join(args.runDirectory, 'listening'), { recursive: true });
    metadata = {
      schemaVersion: 1,
      configHash,
      gitSha: args.gitSha,
      priceSnapshotVersion: args.priceSnapshot.version,
      attemptIds: args.variants.map((variant) => variant.attemptId),
      status: 'running',
    };
    writeFileSync(runPath, JSON.stringify(metadata, null, 2), { encoding: 'utf8', flag: 'wx' });
  }

  const records = readAttempts(attemptsPath);
  const completed = new Set(records.map((record) => record.attemptId));
  const fixtureById = new Map(args.fixtures.map((fixture) => [fixture.id, fixture]));
  const smoke = args.variants.find((variant) => variant.compatibilitySmoke);
  const ordered = smoke
    ? [smoke, ...args.variants.filter((variant) => variant.attemptId !== smoke.attemptId)]
    : [...args.variants];
  let incompatibleModel = records.find(
    (record) =>
      record.compatibilitySmoke &&
      record.promptedPlanStatus === 'provider_error' &&
      record.normalizedErrorCategory?.startsWith('compatibility_'),
  )?.requestedModel;

  for (const variant of ordered) {
    if (completed.has(variant.attemptId)) continue;
    if (incompatibleModel === variant.model) {
      records.push(
        appendRecord(args.runDirectory, {
          attemptId: variant.attemptId,
          fixtureId: variant.fixtureId,
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
          requestedModel: variant.model,
          promptPolicyVersion: variant.promptPolicyVersion,
          repetition: variant.repetition,
          compatibilitySmoke: variant.compatibilitySmoke,
          rawParseStatus: 'not_attempted',
          promptedPlanStatus: 'provider_error',
          fallbackStatus: 'not_used',
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
          requestedModel: variant.model,
          promptPolicyVersion: variant.promptPolicyVersion,
          repetition: variant.repetition,
          compatibilitySmoke: variant.compatibilitySmoke,
          rawParseStatus: 'not_attempted',
          promptedPlanStatus: 'provider_error',
          fallbackStatus: 'not_used',
          latencyMs: result.latencyMs,
          costStatus: 'unavailable',
          normalizedErrorCategory: result.category,
        }),
      );
      continue;
    }
    const fixture = fixtureById.get(variant.fixtureId);
    if (!fixture) throw new Error(`Unknown speech planner eval fixture: ${variant.fixtureId}`);
    records.push(
      appendRecord(
        args.runDirectory,
        evaluateSpeechPlannerAttemptRecord({
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
        }),
      ),
    );
  }

  const summary = summarizeSpeechPlannerEvalAttempts(records);
  writeFileSync(join(args.runDirectory, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  writeFileSync(
    join(args.runDirectory, 'summary.md'),
    renderSpeechPlannerEvalSummaryMarkdown(summary),
    'utf8',
  );
  metadata.status = records.length === args.variants.length ? 'complete' : 'partial';
  writeFileSync(runPath, JSON.stringify(metadata, null, 2), 'utf8');
  return { records, summary };
}
