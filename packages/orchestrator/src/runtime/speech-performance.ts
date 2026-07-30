import { createHash } from 'node:crypto';

import {
  analyzeValidatedSpeechPlan,
  createIdentitySpeechPerformancePlan,
  getTtsModelCapabilities,
  type PreparedStudyTextSynthesis,
  type SpeechPerformancePlan,
  type SpeechPerformancePlanner,
  SpeechPerformancePlannerBudgetExceededError,
  type SpeechPerformancePlannerFallbackReason,
  SpeechPerformancePlannerInvalidOutputError,
  validateSpeechPerformancePlan,
} from '@esl-pipeline/tts-core';

import type { PipelineLogger } from '../observability.js';

export interface ResolvedSpeechPerformancePlan {
  plan: SpeechPerformancePlan;
  hash: string;
}

export async function resolveSpeechPerformancePlan(args: {
  prepared: PreparedStudyTextSynthesis;
  planner?: SpeechPerformancePlanner;
  plannerUnavailableReason?: SpeechPerformancePlannerFallbackReason;
  logger?: PipelineLogger;
  debugLogPlan?: boolean;
}): Promise<ResolvedSpeechPerformancePlan> {
  const capabilities = getTtsModelCapabilities(
    args.prepared.selection.provider,
    args.prepared.selection.model,
  );
  if (capabilities.planningMode === 'identity') {
    return finalize(createIdentitySpeechPerformancePlan(args.prepared));
  }
  if (!args.planner) {
    return finalize(
      createIdentitySpeechPerformancePlan(args.prepared, {
        fallbackReason: args.plannerUnavailableReason ?? 'planner_unavailable',
      }),
    );
  }

  let planned: SpeechPerformancePlan;
  try {
    planned = await args.planner.plan(args.prepared);
  } catch (error) {
    const fallbackReason =
      error instanceof SpeechPerformancePlannerInvalidOutputError
        ? 'planner_invalid'
        : error instanceof SpeechPerformancePlannerBudgetExceededError ||
            (typeof error === 'object' &&
              error !== null &&
              'category' in error &&
              error.category === 'budget_exceeded')
          ? 'planner_budget_exceeded'
          : 'planner_execution_failed';
    logPlannerFallback(args.logger, fallbackReason, error, args.debugLogPlan ?? false);
    return finalize(
      createIdentitySpeechPerformancePlan(args.prepared, {
        fallbackReason,
      }),
    );
  }

  try {
    const resolved = finalize(validateSpeechPerformancePlan(args.prepared, planned));
    logPromptedPlan(args.logger, args.prepared, resolved, args.debugLogPlan ?? false);
    return resolved;
  } catch (error) {
    logPlannerFallback(args.logger, 'planner_invalid', error, args.debugLogPlan ?? false);
    return finalize(
      createIdentitySpeechPerformancePlan(args.prepared, {
        fallbackReason: 'planner_invalid',
      }),
    );
  }
}

function logPromptedPlan(
  logger: PipelineLogger | undefined,
  prepared: PreparedStudyTextSynthesis,
  resolved: ResolvedSpeechPerformancePlan,
  debugLogPlan: boolean,
): void {
  const analysis = analyzeValidatedSpeechPlan(prepared, resolved.plan);
  const qualityIssues = [...analysis.hardFailures, ...analysis.warnings];
  const cueCounts = {
    emotion: 0,
    intonation: 0,
    pace: 0,
    emphasis: 0,
    pauses: 0,
    nonVerbals: 0,
    deliveryMode: 0,
    freeFormDirection: 0,
  };
  for (const segment of resolved.plan.segments) {
    if (segment.emotion) cueCounts.emotion += 1;
    if (segment.intonation) cueCounts.intonation += 1;
    if (segment.pace) cueCounts.pace += 1;
    cueCounts.emphasis += segment.emphasis?.length ?? 0;
    if (segment.pauseBeforeMs) cueCounts.pauses += 1;
    if (segment.pauseAfterMs) cueCounts.pauses += 1;
    cueCounts.nonVerbals += segment.nonVerbalsBefore?.length ?? 0;
    cueCounts.nonVerbals += segment.nonVerbalsAfter?.length ?? 0;
    if (segment.deliveryMode) cueCounts.deliveryMode += 1;
    if (segment.freeFormDirection) cueCounts.freeFormDirection += 1;
  }
  const schemaMetrics =
    resolved.plan.schemaVersion === 2
      ? {
          schemaVersion: 2,
          resolvedPerformanceMode: resolved.plan.resolvedPerformanceMode,
          overallDirectionComponentCount:
            resolved.plan.performanceContext.overallDirection.components.length,
          speakerEnvelopeCount: resolved.plan.performanceContext.speakerEnvelopes.length,
          turnAdjustmentCount: resolved.plan.segments.filter((segment) => segment.turnAdjustment)
            .length,
          effectiveInstructionCount: analysis.metrics.instructionCount,
          effectiveCueCount: analysis.metrics.cueCount,
        }
      : { cueCounts };
  logger?.log({
    level: 'info',
    stage: 'speech-plan',
    message: 'Speech performance planner produced a prompted plan',
    detail: {
      provider: resolved.plan.provider,
      model: resolved.plan.model,
      speechPlanHash: resolved.hash,
      promptPolicyVersion: resolved.plan.planner?.promptPolicyVersion ?? 'legacy-unversioned-v1',
      promptHash: resolved.plan.planner?.promptHash ?? null,
      segmentCount: resolved.plan.segments.length,
      qualityIssueCount: qualityIssues.length,
      qualityIssueCodes: qualityIssues.map((issue) => issue.code),
      ...schemaMetrics,
    },
  });
  if (debugLogPlan) {
    logger?.log({
      level: 'info',
      stage: 'speech-plan',
      message: 'Speech performance planner validated plan debug payload',
      detail: {
        speechPlanHash: resolved.hash,
        speechPlan: resolved.plan,
      },
    });
  }
}

function logPlannerFallback(
  logger: PipelineLogger | undefined,
  fallbackReason: SpeechPerformancePlannerFallbackReason,
  error: unknown,
  debugLogPlan: boolean,
): void {
  const invalidOutputError =
    error instanceof SpeechPerformancePlannerInvalidOutputError ? error : undefined;
  const qualityIssueCodes = invalidOutputError ? ['planner_output_invalid'] : [];
  logger?.log({
    level: 'warn',
    stage: 'speech-plan',
    message: 'Speech performance planner fell back to an identity plan',
    detail: {
      fallbackReason,
      errorName: error instanceof Error ? error.name : 'UnknownError',
      ...(invalidOutputError
        ? { qualityIssueCount: qualityIssueCodes.length, qualityIssueCodes }
        : {}),
      ...(debugLogPlan && invalidOutputError?.validationMessage
        ? { validationMessage: invalidOutputError.validationMessage }
        : {}),
      ...(debugLogPlan && invalidOutputError?.rejectedOutput !== undefined
        ? { rejectedPlannerOutput: invalidOutputError.rejectedOutput }
        : {}),
      ...(debugLogPlan && invalidOutputError?.rawText !== undefined
        ? { rejectedPlannerRawText: invalidOutputError.rawText }
        : {}),
    },
  });
}

function finalize(plan: SpeechPerformancePlan): ResolvedSpeechPerformancePlan {
  return {
    plan,
    hash: createHash('sha256').update(JSON.stringify(plan)).digest('hex'),
  };
}
