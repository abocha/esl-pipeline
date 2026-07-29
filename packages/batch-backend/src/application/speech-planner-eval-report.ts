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
  cells: Record<string, Omit<SpeechPlannerEvalSummary, 'cells'>>;
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
    for (const warning of record.analysis?.warnings ?? []) {
      warningCounts[warning.code] = (warningCounts[warning.code] ?? 0) + 1;
    }
  }
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
      (total, record) => total + (record.analysis?.hardFailures.length ?? 0),
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
    '',
    'Latency percentiles are descriptive for this bounded sample.',
    '',
  ].join('\n');
}
