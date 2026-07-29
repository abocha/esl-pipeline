import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import type { GenerateDraftUsage, InworldTtsModel } from '@esl-pipeline/contracts';
import {
  analyzeValidatedSpeechPlan,
  createIdentitySpeechPerformancePlan,
  getTtsModelCapabilities,
  type SpeechDeliveryMode,
} from '@esl-pipeline/tts-core';
import {
  INWORLD_RENDERER_POLICY_VERSION,
  renderInworldSpeechSegment,
} from '@esl-pipeline/tts-provider-inworld';

import { evaluateSpeechPlannerRawOutput } from './speech-performance-planner.js';
import { buildSpeechPlannerRequest } from './speech-performance-prompt.js';
import type {
  SpeechPlannerEvalControl,
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

export interface SpeechPlannerAttemptCostUnavailable {
  costStatus: 'unavailable';
  missingUsageFields: Array<'inputTokens' | 'visibleOutputTokens' | 'thinkingTokens'>;
  knownUsage: {
    inputTokens?: number;
    visibleOutputTokens?: number;
    thinkingTokens?: number;
  };
}

export function estimateSpeechPlannerAttemptCost(args: {
  model: SpeechPlannerEvalModel;
  usage?: GenerateDraftUsage;
  priceSnapshot: SpeechPlannerPriceSnapshot;
}): SpeechPlannerAttemptCost | SpeechPlannerAttemptCostUnavailable {
  const inputTokens = args.usage?.inputTokens;
  const visibleOutputTokens = args.usage?.outputTokens;
  const thinkingTokens = args.usage?.reasoningTokens;
  if (
    inputTokens === undefined ||
    visibleOutputTokens === undefined ||
    thinkingTokens === undefined
  ) {
    return {
      costStatus: 'unavailable',
      missingUsageFields: [
        ...(inputTokens === undefined ? (['inputTokens'] as const) : []),
        ...(visibleOutputTokens === undefined ? (['visibleOutputTokens'] as const) : []),
        ...(thinkingTokens === undefined ? (['thinkingTokens'] as const) : []),
      ],
      knownUsage: {
        ...(inputTokens === undefined ? {} : { inputTokens }),
        ...(visibleOutputTokens === undefined ? {} : { visibleOutputTokens }),
        ...(thinkingTokens === undefined ? {} : { thinkingTokens }),
      },
    };
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
  costMissingUsageFields?: SpeechPlannerAttemptCostUnavailable['missingUsageFields'];
  costKnownUsage?: SpeechPlannerAttemptCostUnavailable['knownUsage'];
  normalizedErrorCategory?: string;
  retryAttempted?: false;
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

export interface SpeechPlannerEvalControlRecord {
  controlId: string;
  controlContentHash: string;
  status: 'passed' | 'failed';
  planMode: 'identity';
  rendered: Array<{
    id: string;
    text: string;
    lexicalText: string;
    leadingInstructionTagCount: number;
    language?: string;
    speakingRate?: number;
  }>;
  analysis: ReturnType<typeof analyzeValidatedSpeechPlan>;
  failedChecks: string[];
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
      : {
          costMissingUsageFields: cost.missingUsageFields,
          costKnownUsage: cost.knownUsage,
        }),
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
    controlsPath: string;
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
  schemaVersion: 4;
  status: 'partial' | 'completed';
  createdAt: string;
  completedAt?: string;
  completedAttempts: number;
  expectedAttempts: number;
  completedControls: number;
  expectedControls: number;
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
  controlIds: string[];
  controlHashes: string[];
  activities: SpeechPlannerEvalRunActivity[];
}

export interface SpeechPlannerEvalRunActivity {
  id: string;
  kind: 'planner_initial' | 'planner_resume' | 'selected_audio';
  status: 'partial' | 'completed' | 'failed' | 'interrupted';
  startedAt: string;
  completedAt?: string;
  environmentFlags: SpeechPlannerEvalRunContext['environmentFlags'];
  preflight: SpeechPlannerEvalRunContext['preflight'];
  providerCalls?: number;
  synthesisCalls?: number;
  normalizedErrorCategory?: string;
}

export function readSpeechPlannerEvalRunMetadata(
  runDirectory: string,
): SpeechPlannerEvalRunMetadata {
  const path = join(runDirectory, 'run.json');
  if (!existsSync(path)) throw new Error('Speech planner eval resume run.json is missing.');
  const metadata = JSON.parse(readFileSync(path, 'utf8')) as Partial<SpeechPlannerEvalRunMetadata>;
  if (
    metadata.schemaVersion !== 4 ||
    (metadata.status !== 'partial' && metadata.status !== 'completed') ||
    !metadata.resolvedConfig ||
    !metadata.environmentFlags ||
    !metadata.preflight ||
    !metadata.priceSnapshot ||
    !Array.isArray(metadata.variants) ||
    !Number.isInteger(metadata.completedAttempts) ||
    !Number.isInteger(metadata.expectedAttempts) ||
    !Number.isInteger(metadata.completedControls) ||
    !Number.isInteger(metadata.expectedControls) ||
    (metadata.completedAttempts ?? -1) < 0 ||
    (metadata.expectedAttempts ?? -1) < 0 ||
    (metadata.completedControls ?? -1) < 0 ||
    (metadata.expectedControls ?? -1) < 0 ||
    !Array.isArray(metadata.controlIds) ||
    !Array.isArray(metadata.controlHashes) ||
    !Array.isArray(metadata.activities)
  ) {
    throw new Error('Speech planner eval resume run.json has an unsupported metadata contract.');
  }
  return metadata as SpeechPlannerEvalRunMetadata;
}

export function beginSpeechPlannerEvalRunActivity(args: {
  runDirectory: string;
  kind: SpeechPlannerEvalRunActivity['kind'];
  runContext: SpeechPlannerEvalRunContext;
}): string {
  const metadata = readSpeechPlannerEvalRunMetadata(args.runDirectory);
  const id = randomUUID();
  const interruptedAt = new Date().toISOString();
  const priorActivities = metadata.activities.map((activity) =>
    args.kind === 'planner_resume' &&
    activity.status === 'partial' &&
    (activity.kind === 'planner_initial' || activity.kind === 'planner_resume')
      ? {
          ...activity,
          status: 'interrupted' as const,
          completedAt: interruptedAt,
          normalizedErrorCategory: 'interrupted_before_resume',
        }
      : activity,
  );
  const pending: SpeechPlannerEvalRunMetadata = {
    ...metadata,
    status: 'partial',
    environmentFlags: {
      ...metadata.environmentFlags,
      selectedAudio: metadata.environmentFlags.selectedAudio || args.kind === 'selected_audio',
    },
    activities: [
      ...priorActivities,
      {
        id,
        kind: args.kind,
        status: 'partial',
        startedAt: new Date().toISOString(),
        environmentFlags: args.runContext.environmentFlags,
        preflight: args.runContext.preflight,
      },
    ],
  };
  delete pending.completedAt;
  writeAtomicFile(join(args.runDirectory, 'run.json'), JSON.stringify(pending, null, 2));
  return id;
}

export function finishSpeechPlannerEvalRunActivity(args: {
  runDirectory: string;
  activityId: string;
  status: 'completed' | 'failed';
  completedAttempts?: number;
  completedControls?: number;
  providerCalls?: number;
  synthesisCalls?: number;
  normalizedErrorCategory?: string;
}): void {
  const metadata = readSpeechPlannerEvalRunMetadata(args.runDirectory);
  const activityIndex = metadata.activities.findIndex(
    (activity) => activity.id === args.activityId,
  );
  if (activityIndex < 0) throw new Error('Speech planner eval run activity is missing.');
  const completedAt = new Date().toISOString();
  const activities = metadata.activities.map((activity, index) =>
    index === activityIndex
      ? {
          ...activity,
          status: args.status,
          completedAt,
          ...(args.providerCalls === undefined ? {} : { providerCalls: args.providerCalls }),
          ...(args.synthesisCalls === undefined ? {} : { synthesisCalls: args.synthesisCalls }),
          ...(args.normalizedErrorCategory === undefined
            ? {}
            : { normalizedErrorCategory: args.normalizedErrorCategory }),
        }
      : activity,
  );
  let lastFailedAudioIndex = -1;
  let lastCompletedAudioIndex = -1;
  activities.forEach((activity, index) => {
    if (activity.kind !== 'selected_audio') return;
    if (activity.status === 'failed') lastFailedAudioIndex = index;
    if (activity.status === 'completed') lastCompletedAudioIndex = index;
  });
  const hasUnresolvedAudioFailure = lastFailedAudioIndex > lastCompletedAudioIndex;
  const hasPartialActivity = activities.some((activity) => activity.status === 'partial');
  const completedAttempts = args.completedAttempts ?? metadata.completedAttempts;
  const completedControls = args.completedControls ?? metadata.completedControls;
  const runCompleted =
    args.status === 'completed' &&
    !hasUnresolvedAudioFailure &&
    !hasPartialActivity &&
    completedAttempts === metadata.expectedAttempts &&
    completedControls === metadata.expectedControls;
  const updated: SpeechPlannerEvalRunMetadata = {
    ...metadata,
    status: runCompleted ? 'completed' : 'partial',
    ...(runCompleted ? { completedAt } : {}),
    completedAttempts,
    completedControls,
    activities,
  };
  if (!runCompleted) delete updated.completedAt;
  writeAtomicFile(join(args.runDirectory, 'run.json'), JSON.stringify(updated, null, 2));
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

function evaluateDeterministicControl(
  control: SpeechPlannerEvalControl,
): SpeechPlannerEvalControlRecord {
  const capabilities = getTtsModelCapabilities(
    control.prepared.selection.provider,
    control.prepared.selection.model,
  );
  const plan = createIdentitySpeechPerformancePlan(control.prepared);
  const assignments = new Map(
    control.prepared.voicePlan?.assignments.map((assignment) => [
      assignment.speaker.toLocaleLowerCase(),
      assignment,
    ]) ?? [],
  );
  const rendered = plan.segments.map((segment) => {
    const assignment = segment.speaker
      ? assignments.get(segment.speaker.toLocaleLowerCase())
      : undefined;
    return {
      id: segment.id,
      ...renderInworldSpeechSegment({
        model: control.prepared.selection.model as InworldTtsModel,
        segment,
        capabilities: assignment?.capabilities,
        language: assignment?.language,
      }),
    };
  });
  const analysis = analyzeValidatedSpeechPlan(
    control.prepared,
    plan,
    rendered.map(({ id, text, lexicalText, leadingInstructionTagCount }) => ({
      id,
      text,
      lexicalText,
      leadingInstructionTagCount,
    })),
  );
  const natural = rendered.find((segment) => segment.id === 'legacy-natural');
  const defaultPace = rendered.find((segment) => segment.id === 'legacy-default');
  const failedChecks: string[] = [];
  if (capabilities.planningMode !== control.expected.planningMode)
    failedChecks.push('planning_mode');
  if (plan.mode !== control.expected.planningMode) failedChecks.push('plan_mode');
  if (natural?.speakingRate !== control.expected.naturalSpeakingRate)
    failedChecks.push('natural_speaking_rate');
  if (defaultPace?.speakingRate !== undefined) failedChecks.push('default_speaking_rate');
  if (
    Math.max(0, ...rendered.map((segment) => segment.leadingInstructionTagCount)) >
    control.expected.maximumInstructionTags
  )
    failedChecks.push('instruction_tags');
  if (rendered.some((segment) => 'deliveryMode' in segment))
    failedChecks.push('unsupported_delivery_mode');
  if (analysis.hardFailures.length > 0) failedChecks.push('validated_analysis');

  return {
    controlId: control.id,
    controlContentHash: control.contentHash,
    status: failedChecks.length === 0 ? 'passed' : 'failed',
    planMode: 'identity',
    rendered,
    analysis,
    failedChecks,
  };
}

function materializeDeterministicControls(args: {
  runDirectory: string;
  controls: readonly SpeechPlannerEvalControl[];
  resume: boolean;
  completedControls: number;
}): SpeechPlannerEvalControlRecord[] {
  return args.controls.map((control) => {
    const record = evaluateDeterministicControl(control);
    const path = join(args.runDirectory, 'controls', `${control.id}.json`);
    const content = JSON.stringify(record, null, 2);
    if (existsSync(path)) {
      if (readFileSync(path, 'utf8') !== content) {
        throw new Error(`Speech planner eval control artifact does not match: ${control.id}`);
      }
    } else {
      if (args.resume && args.completedControls > 0) {
        throw new Error(`Speech planner eval control artifact is missing: ${control.id}`);
      }
      writeImmutableFile(path, content);
    }
    if (record.status !== 'passed') {
      throw new Error(
        `Speech planner eval deterministic control failed: ${control.id} (${record.failedChecks.join(',')})`,
      );
    }
    return record;
  });
}

function assertNoIndeterminateAttempts(args: {
  runDirectory: string;
  variants: readonly SpeechPlannerEvalVariant[];
  completed: ReadonlySet<string>;
}): void {
  for (const variant of args.variants) {
    if (args.completed.has(variant.attemptId)) continue;
    const artifacts = [
      join(args.runDirectory, 'calls', `${variant.attemptId}.json`),
      join(args.runDirectory, 'plans', `${variant.attemptId}.json`),
      join(args.runDirectory, 'rendered', `${variant.attemptId}.json`),
    ];
    if (artifacts.some((path) => existsSync(path))) {
      throw new Error(
        `Speech planner eval attempt is indeterminate and will not be replayed: ${variant.attemptId}`,
      );
    }
  }
}

interface SpeechPlannerPhysicalCallIntent {
  attemptId: string;
  activityId: string;
  fixtureId: string;
  requestedModel: SpeechPlannerEvalModel;
  promptPolicyVersion: SpeechPlannerEvalVariant['promptPolicyVersion'];
  repetition: number;
  retryAttempted: false;
}

function physicalCallIntentContent(intent: SpeechPlannerPhysicalCallIntent): string {
  return JSON.stringify(intent, null, 2);
}

function recordPhysicalCallIntent(
  runDirectory: string,
  variant: SpeechPlannerEvalVariant,
  activityId: string,
): void {
  writeImmutableFile(
    join(runDirectory, 'calls', `${variant.attemptId}.json`),
    physicalCallIntentContent({
      attemptId: variant.attemptId,
      activityId,
      fixtureId: variant.fixtureId,
      requestedModel: variant.model,
      promptPolicyVersion: variant.promptPolicyVersion,
      repetition: variant.repetition,
      retryAttempted: false,
    }),
  );
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
  metadata: SpeechPlannerEvalRunMetadata,
  variants: readonly SpeechPlannerEvalVariant[],
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
  if (metadata.mode !== 'live') return;
  const variantsById = new Map(variants.map((variant) => [variant.attemptId, variant]));
  const plannerActivityIds = new Set(
    metadata.activities
      .filter((activity) => activity.kind !== 'selected_audio')
      .map((activity) => activity.id),
  );
  const expectedAttemptIds = new Set(
    records
      .filter((record) => record.promptedPlanStatus !== 'skipped_incompatible')
      .map((record) => record.attemptId),
  );
  const callsDirectory = join(runDirectory, 'calls');
  const callFiles = existsSync(callsDirectory)
    ? readdirSync(callsDirectory).filter((name) => name.endsWith('.json'))
    : [];
  const actualAttemptIds = new Set(callFiles.map((name) => name.slice(0, -'.json'.length)));
  if (
    actualAttemptIds.size !== expectedAttemptIds.size ||
    [...actualAttemptIds].some((attemptId) => !expectedAttemptIds.has(attemptId))
  ) {
    throw new Error('Speech planner eval physical call-intent artifacts do not match attempts.');
  }
  const callsByActivity = new Map<string, number>();
  for (const attemptId of expectedAttemptIds) {
    const variant = variantsById.get(attemptId);
    const path = join(callsDirectory, `${attemptId}.json`);
    if (!variant || !existsSync(path)) {
      throw new Error(`Speech planner eval immutable call-intent artifact mismatch: ${path}`);
    }
    let intent: SpeechPlannerPhysicalCallIntent;
    try {
      intent = JSON.parse(readFileSync(path, 'utf8')) as SpeechPlannerPhysicalCallIntent;
    } catch {
      throw new Error(`Speech planner eval immutable call-intent artifact mismatch: ${path}`);
    }
    if (
      !plannerActivityIds.has(intent.activityId) ||
      readFileSync(path, 'utf8') !==
        physicalCallIntentContent({
          attemptId: variant.attemptId,
          activityId: intent.activityId,
          fixtureId: variant.fixtureId,
          requestedModel: variant.model,
          promptPolicyVersion: variant.promptPolicyVersion,
          repetition: variant.repetition,
          retryAttempted: false,
        })
    ) {
      throw new Error(`Speech planner eval immutable call-intent artifact mismatch: ${path}`);
    }
    callsByActivity.set(intent.activityId, (callsByActivity.get(intent.activityId) ?? 0) + 1);
  }
  for (const activity of metadata.activities) {
    if (activity.kind === 'selected_audio' || activity.providerCalls === undefined) continue;
    if ((callsByActivity.get(activity.id) ?? 0) !== activity.providerCalls) {
      throw new Error(`Speech planner eval activity call count mismatch: ${activity.id}`);
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
  controls?: readonly SpeechPlannerEvalControl[];
  priceSnapshot: SpeechPlannerPriceSnapshot;
  executeVariant: (variant: SpeechPlannerEvalVariant) => Promise<ExecuteVariantResult>;
  resume?: boolean;
  runContext?: SpeechPlannerEvalRunContext;
}): Promise<{
  records: SpeechPlannerEvalAttemptRecord[];
  controls: SpeechPlannerEvalControlRecord[];
  summary: ReturnType<typeof summarizeSpeechPlannerEvalAttempts>;
}> {
  const controls = args.controls ?? [];
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
    controlHashes: controls.map((control) => [control.id, control.contentHash]),
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
  let activityContext: SpeechPlannerEvalRunContext;
  let activityId: string;
  if (args.resume) {
    metadata = readSpeechPlannerEvalRunMetadata(args.runDirectory);
    if (metadata.configHash !== configHash) {
      throw new Error('Speech planner eval resume configuration hash does not match.');
    }
    activityContext = args.runContext ?? {
      mode: metadata.mode,
      resolvedConfig: metadata.resolvedConfig,
      environmentFlags: metadata.environmentFlags,
      preflight: metadata.preflight,
    };
    activityId = beginSpeechPlannerEvalRunActivity({
      runDirectory: args.runDirectory,
      kind: 'planner_resume',
      runContext: activityContext,
    });
    metadata = readSpeechPlannerEvalRunMetadata(args.runDirectory);
  } else {
    mkdirSync(join(args.runDirectory, 'plans'), { recursive: true });
    mkdirSync(join(args.runDirectory, 'rendered'), { recursive: true });
    mkdirSync(join(args.runDirectory, 'controls'), { recursive: true });
    mkdirSync(join(args.runDirectory, 'calls'), { recursive: true });
    mkdirSync(join(args.runDirectory, 'audio'), { recursive: true });
    mkdirSync(join(args.runDirectory, 'listening'), { recursive: true });
    const runContext =
      args.runContext ??
      ({
        mode: 'offline',
        resolvedConfig: {
          corpusPath: 'injected',
          controlsPath: 'injected',
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
    activityContext = runContext;
    activityId = randomUUID();
    metadata = {
      schemaVersion: 4,
      status: 'partial',
      createdAt: new Date().toISOString(),
      completedAttempts: 0,
      expectedAttempts: args.variants.length,
      completedControls: 0,
      expectedControls: controls.length,
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
      controlIds: controls.map((control) => control.id),
      controlHashes: controls.map((control) => control.contentHash),
      activities: [
        {
          id: activityId,
          kind: 'planner_initial',
          status: 'partial',
          startedAt: new Date().toISOString(),
          environmentFlags: runContext.environmentFlags,
          preflight: runContext.preflight,
        },
      ],
    };
    writeFileSync(runPath, JSON.stringify(metadata, null, 2), { encoding: 'utf8', flag: 'wx' });
  }

  const controlRecords = materializeDeterministicControls({
    runDirectory: args.runDirectory,
    controls,
    resume: args.resume ?? false,
    completedControls: metadata.completedControls,
  });

  const records = readAttempts(attemptsPath);
  if (args.resume) {
    validateImmutableArtifacts(args.runDirectory, records, metadata, args.variants);
  }
  const completed = new Set(records.map((record) => record.attemptId));
  if (args.resume) {
    assertNoIndeterminateAttempts({
      runDirectory: args.runDirectory,
      variants: args.variants,
      completed,
    });
  }
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
  let providerCalls = 0;

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
          costMissingUsageFields: ['inputTokens', 'visibleOutputTokens', 'thinkingTokens'],
          costKnownUsage: {},
          normalizedErrorCategory: 'skipped_incompatible',
        }),
      );
      continue;
    }
    let result: ExecuteVariantResult;
    try {
      if (activityContext.mode === 'live') {
        recordPhysicalCallIntent(args.runDirectory, variant, activityId);
        providerCalls += 1;
      }
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
          costMissingUsageFields: ['inputTokens', 'visibleOutputTokens', 'thinkingTokens'],
          costKnownUsage: {},
          normalizedErrorCategory: `compatibility_${result.category}`,
          retryAttempted: false,
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
          costMissingUsageFields: ['inputTokens', 'visibleOutputTokens', 'thinkingTokens'],
          costKnownUsage: {},
          normalizedErrorCategory: result.category,
          retryAttempted: false,
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

  const summary = summarizeSpeechPlannerEvalAttempts(records, controlRecords);
  writeAtomicFile(join(args.runDirectory, 'summary.json'), JSON.stringify(summary, null, 2));
  writeAtomicFile(
    join(args.runDirectory, 'summary.md'),
    renderSpeechPlannerEvalSummaryMarkdown(summary),
  );
  finishSpeechPlannerEvalRunActivity({
    runDirectory: args.runDirectory,
    activityId,
    status: 'completed',
    completedAttempts: records.length,
    completedControls: controlRecords.length,
    providerCalls,
  });
  return { records, controls: controlRecords, summary };
}
