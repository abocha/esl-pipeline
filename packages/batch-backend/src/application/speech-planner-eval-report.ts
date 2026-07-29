import type { SpeechPlannerEvalAttemptRecord } from './speech-planner-evaluator.js';

export interface SpeechPlannerEvalSummary {
  attempts: number;
  rawParseRate: number;
  validPromptedPlanRate: number;
  identityFallbackRate: number;
  hardFailureCount: number;
  warningCounts: Record<string, number>;
  latencyMs: { median?: number; p95?: number; statisticalStatus: 'descriptive' };
  medianEstimatedCostPerValidPlanUsd?: number;
  estimatedCostPer100ValidPlansUsd?: number;
  compatibility: { successes: number; failures: number; skipped: number };
  returnedModelIdentity: { reported: number; missing: number; mismatches: number };
  outputTokens: NumericDistribution & { unavailable: number };
  thinkingTokens: NumericDistribution & { unavailable: number };
  cueDensity: NumericDistribution & { maximum?: number };
  pausesMs: NumericDistribution & { maximum?: number };
  deliveryModeCounts: Record<string, number>;
  instructionTags: { maximum: number; segmentsAboveOne: number };
  hardGates: {
    passed: boolean;
    schemaInvalidAttempts: number;
    authoredWordFailures: number;
    unsupportedControlFailures: number;
    tts15SteeringLeakageFailures: number;
    instructionTagFailures: number;
    plannerCapFailures: number;
    compatibilityFailures: number;
    unexplainedFallbacks: number;
    providerFailures: number;
  };
  cells: Record<string, Omit<SpeechPlannerEvalSummary, 'cells'>>;
}

interface NumericDistribution {
  reported: number;
  median?: number;
  p95?: number;
}

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle];
}

function p95(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

function distribution(values: readonly number[]): NumericDistribution {
  return { reported: values.length, median: median(values), p95: p95(values) };
}

function issueCodes(record: SpeechPlannerEvalAttemptRecord): string[] {
  return [
    ...(record.candidateAnalysis?.hardFailures ?? []),
    ...(record.analysis?.hardFailures ?? []),
  ].map((issue) => issue.code);
}

function summarizeWithoutCells(
  records: readonly SpeechPlannerEvalAttemptRecord[],
): Omit<SpeechPlannerEvalSummary, 'cells'> {
  const count = records.length;
  const validCosts = records
    .filter((record) => record.promptedPlanStatus === 'valid')
    .map((record) => record.estimatedCostUsd)
    .filter((value): value is number => value !== undefined);
  const medianCost = median(validCosts);
  const warningCounts: Record<string, number> = {};
  for (const record of records) {
    for (const warning of [
      ...(record.candidateAnalysis?.warnings ?? []),
      ...(record.analysis?.warnings ?? []),
    ]) {
      warningCounts[warning.code] = (warningCounts[warning.code] ?? 0) + 1;
    }
  }
  const outputTokens = records
    .map((record) => record.usage?.outputTokens)
    .filter((value): value is number => value !== undefined);
  const thinkingTokens = records
    .map((record) => record.usage?.reasoningTokens)
    .filter((value): value is number => value !== undefined);
  const cueDensity = records
    .map((record) => record.analysis?.metrics.cueRate)
    .filter((value): value is number => value !== undefined);
  const pausesMs = records.flatMap((record) => record.analysis?.metrics.pauseValuesMs ?? []);
  const deliveryModeCounts: Record<string, number> = {};
  for (const record of records) {
    for (const [mode, modeCount] of Object.entries(
      record.analysis?.metrics.deliveryModeCounts ?? {},
    )) {
      deliveryModeCounts[mode] = (deliveryModeCounts[mode] ?? 0) + modeCount;
    }
  }
  const instructionTagCounts = records.flatMap(
    (record) => record.rendered?.map((segment) => segment.leadingInstructionTagCount) ?? [],
  );
  const compatibilityFailures = records.filter(
    (record) =>
      record.compatibilitySmoke && record.normalizedErrorCategory?.startsWith('compatibility_'),
  ).length;
  const compatibilitySkipped = records.filter(
    (record) => record.promptedPlanStatus === 'skipped_incompatible',
  ).length;
  const reportedReturnedModels = records.filter((record) => record.returnedModel !== undefined);
  const returnedModelMismatches = reportedReturnedModels.filter(
    (record) =>
      record.returnedModel !== record.requestedModel &&
      !record.returnedModel!.startsWith(`${record.requestedModel}-`),
  ).length;
  const allIssueCodes = records.flatMap(issueCodes);
  const hardGates = {
    schemaInvalidAttempts: records.filter((record) => record.promptedPlanStatus !== 'valid').length,
    authoredWordFailures: allIssueCodes.filter((code) =>
      ['authored_words_changed', 'rendered_words_changed'].includes(code),
    ).length,
    unsupportedControlFailures:
      allIssueCodes.filter((code) => code.startsWith('unsupported_')).length +
      records.filter((record) => record.validationReason?.includes('does not support')).length,
    tts15SteeringLeakageFailures: records.filter(
      (record) =>
        record.ttsModel !== undefined &&
        record.ttsModel !== 'inworld-tts-2' &&
        (issueCodes(record).some((code) => code.startsWith('unsupported_')) ||
          record.validationReason?.includes('does not support')),
    ).length,
    instructionTagFailures: instructionTagCounts.filter((value) => value > 1).length,
    plannerCapFailures: allIssueCodes.filter((code) =>
      ['planner_pause_exceeds_cap', 'planner_nonverbal_cap_exceeded'].includes(code),
    ).length,
    compatibilityFailures: compatibilityFailures + compatibilitySkipped + returnedModelMismatches,
    unexplainedFallbacks: records.filter(
      (record) =>
        record.fallbackStatus === 'identity' &&
        !record.validationReason &&
        !record.normalizedErrorCategory,
    ).length,
    providerFailures: records.filter((record) => record.promptedPlanStatus === 'provider_error')
      .length,
  };
  const hardGatePassed = Object.values(hardGates).every((value) => value === 0);
  return {
    attempts: count,
    rawParseRate:
      count === 0
        ? 0
        : records.filter((record) => record.rawParseStatus === 'parsed').length / count,
    validPromptedPlanRate:
      count === 0
        ? 0
        : records.filter((record) => record.promptedPlanStatus === 'valid').length / count,
    identityFallbackRate:
      count === 0
        ? 0
        : records.filter((record) => record.fallbackStatus === 'identity').length / count,
    hardFailureCount: records.reduce(
      (total, record) =>
        total +
        (record.candidateAnalysis?.hardFailures.length ?? 0) +
        (record.analysis?.hardFailures.length ?? 0),
      0,
    ),
    warningCounts,
    latencyMs: {
      median: median(
        records.map((record) => record.latencyMs).filter((value) => value !== undefined),
      ),
      p95: p95(records.map((record) => record.latencyMs).filter((value) => value !== undefined)),
      statisticalStatus: 'descriptive',
    },
    ...(medianCost === undefined
      ? {}
      : {
          medianEstimatedCostPerValidPlanUsd: medianCost,
          estimatedCostPer100ValidPlansUsd: medianCost * 100,
        }),
    compatibility: {
      successes: records.filter(
        (record) =>
          record.compatibilitySmoke &&
          record.promptedPlanStatus === 'valid' &&
          !record.normalizedErrorCategory,
      ).length,
      failures: compatibilityFailures,
      skipped: compatibilitySkipped,
    },
    returnedModelIdentity: {
      reported: reportedReturnedModels.length,
      missing: count - reportedReturnedModels.length,
      mismatches: returnedModelMismatches,
    },
    outputTokens: { ...distribution(outputTokens), unavailable: count - outputTokens.length },
    thinkingTokens: {
      ...distribution(thinkingTokens),
      unavailable: count - thinkingTokens.length,
    },
    cueDensity: {
      ...distribution(cueDensity),
      ...(cueDensity.length > 0 ? { maximum: Math.max(...cueDensity) } : {}),
    },
    pausesMs: {
      ...distribution(pausesMs),
      ...(pausesMs.length > 0 ? { maximum: Math.max(...pausesMs) } : {}),
    },
    deliveryModeCounts,
    instructionTags: {
      maximum: instructionTagCounts.length > 0 ? Math.max(...instructionTagCounts) : 0,
      segmentsAboveOne: instructionTagCounts.filter((value) => value > 1).length,
    },
    hardGates: { passed: hardGatePassed, ...hardGates },
  };
}

export function summarizeSpeechPlannerEvalAttempts(
  records: readonly SpeechPlannerEvalAttemptRecord[],
): SpeechPlannerEvalSummary {
  const grouped = new Map<string, SpeechPlannerEvalAttemptRecord[]>();
  for (const record of records) {
    const key = `${record.requestedModel}|${record.promptPolicyVersion}`;
    const cell = grouped.get(key) ?? [];
    cell.push(record);
    grouped.set(key, cell);
  }
  return {
    ...summarizeWithoutCells(records),
    cells: Object.fromEntries(
      [...grouped.entries()].map(([key, cell]) => [key, summarizeWithoutCells(cell)]),
    ),
  };
}

export function renderSpeechPlannerEvalSummaryMarkdown(summary: SpeechPlannerEvalSummary): string {
  return [
    '# Speech Planner Evaluation',
    '',
    `Attempts: ${summary.attempts}`,
    `Raw parse rate: ${summary.rawParseRate.toFixed(4)}`,
    `Valid prompted plan rate: ${summary.validPromptedPlanRate.toFixed(4)}`,
    `Identity fallback rate: ${summary.identityFallbackRate.toFixed(4)}`,
    `Hard failures: ${summary.hardFailureCount}`,
    `Hard gates passed: ${summary.hardGates.passed ? 'yes' : 'no'}`,
    `Compatibility failures/skips: ${summary.compatibility.failures}/${summary.compatibility.skipped}`,
    `Returned-model mismatches: ${summary.returnedModelIdentity.mismatches}`,
    '',
    'Latency percentiles are descriptive for this bounded sample.',
    '',
  ].join('\n');
}
