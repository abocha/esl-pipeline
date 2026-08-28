import { mkdir, open, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import priceData from './data/public-provider-pricing.json';
import { loadBenchmarkEnvironment } from './env';
import { canonicalJson, getBenchmarkRoot, resolveUnderBenchmarkRoot, sha256Text } from './manifest';
import type { BenchmarkRun, ProviderId } from './schema';

export type PriceEntry = {
  providerId: ProviderId;
  model: string;
  unit: string;
  usdPerUnit: number;
  denominator: number;
  usage:
    | 'billable_duration_sec'
    | 'provider_audio_duration_sec'
    | 'raw_usage_input_audio_tokens'
    | 'raw_usage_output_text_tokens';
  notes?: string;
  calculationStatus: 'confirmed' | 'incomplete';
};

export type PriceSnapshot = {
  snapshotId: string;
  effectiveFrom?: string;
  currency?: string;
  sources?: Array<Record<string, unknown>>;
  contractEvidence?: Array<Record<string, unknown>>;
  entries: PriceEntry[];
  canonicalSha256?: string;
};

export type CalculatedCost = {
  status: 'actual' | 'calculated' | 'unknown';
  amountUsd?: number;
  priceSnapshotId?: string;
  basis?: string;
  note?: string;
};

export type AggregateReport = {
  schemaVersion: string;
  campaignId: string;
  generatedAt: string;
  priceSnapshotId: string;
  pricingSnapshot?: PriceSnapshot;
  aggregates: Array<{
    providerId: ProviderId;
    runMode: BenchmarkRun['runMode'];
    runCount: number;
    successCount: number;
    failedCount: number;
    uncertainCount: number;
    physicalRequestAttempts: number;
    latencyMs: { p50?: number; p95?: number };
    usage: {
      sourceWallClockDurationMs: number;
      sourceChannels: number;
      preparedArtifactDurationMs: number;
      preparedArtifactChannels: number;
      providerReportedAudioDurationSec: number;
      providerBillableDurationSec: number;
      providerBillableChannels: number;
    };
    costs: {
      calculatedUsd: number;
      actualUsd: number;
      unknownRunCount: number;
      notes: string[];
    };
  }>;
};

export function calculateRunCost(run: BenchmarkRun, snapshot: PriceSnapshot): CalculatedCost {
  if (run.actualBillingAmountUsd !== undefined) {
    return {
      status: 'actual',
      amountUsd: run.actualBillingAmountUsd,
      priceSnapshotId: snapshot.snapshotId,
    };
  }
  const entries = snapshot.entries.filter(
    (candidate) =>
      candidate.providerId === run.providerId && candidate.model === run.requestedModel,
  );
  if (!entries.length)
    return {
      status: 'unknown',
      priceSnapshotId: snapshot.snapshotId,
      note: 'No matching price snapshot entry.',
    };
  const components = entries.map((entry) => ({ entry, usage: usageValue(run, entry.usage) }));
  const notes = components
    .map(({ entry }) => entry.notes)
    .filter((note): note is string => Boolean(note));
  if (entries.some((entry) => entry.calculationStatus === 'incomplete')) {
    return {
      status: 'unknown',
      priceSnapshotId: snapshot.snapshotId,
      basis: components.map(({ entry }) => entry.usage).join('+'),
      note: [...notes, 'One or more pricing components or billing rules remain unconfirmed.'].join(
        ' ',
      ),
    };
  }
  if (components.some((component) => component.usage === undefined)) {
    return {
      status: 'unknown',
      priceSnapshotId: snapshot.snapshotId,
      basis: components.map(({ entry }) => entry.usage).join('+'),
      note: notes.join(' '),
    };
  }
  const amountUsd = components.reduce((sum, { entry, usage }) => {
    const channels =
      entry.usage === 'billable_duration_sec' && run.providerUsage?.billableChannels
        ? run.providerUsage.billableChannels
        : 1;
    return sum + ((usage ?? 0) / entry.denominator) * entry.usdPerUnit * channels;
  }, 0);
  return {
    status: 'calculated',
    amountUsd,
    priceSnapshotId: snapshot.snapshotId,
    basis: components.map(({ entry }) => entry.usage).join('+'),
    note: notes.join(' '),
  };
}

export function summarizeRuns(
  runs: BenchmarkRun[],
  priceSnapshotId: string,
  snapshot?: PriceSnapshot,
): AggregateReport {
  if (snapshot && snapshot.snapshotId !== priceSnapshotId) {
    throw new Error(`Price snapshot ID mismatch: ${priceSnapshotId}`);
  }
  const groups = new Map<string, BenchmarkRun[]>();
  for (const run of runs) {
    const key = `${run.providerId}:${run.runMode}`;
    const group = groups.get(key) ?? [];
    group.push(run);
    groups.set(key, group);
  }
  return {
    schemaVersion: '1.0',
    campaignId: runs[0]?.campaignId ?? 'unknown',
    generatedAt: new Date().toISOString(),
    priceSnapshotId,
    pricingSnapshot: snapshot ? freezeSnapshotEvidence(snapshot) : undefined,
    aggregates: [...groups.values()].map((group) => {
      const costs = group.map((run) => (snapshot ? calculateRunCost(run, snapshot) : undefined));
      return {
        providerId: group[0]!.providerId,
        runMode: group[0]!.runMode,
        runCount: group.length,
        successCount: group.filter((run) => run.status === 'success').length,
        failedCount: group.filter((run) => run.status === 'failed').length,
        uncertainCount: group.filter((run) => run.status === 'uncertain').length,
        physicalRequestAttempts: group.reduce((sum, run) => sum + run.attempts.length, 0),
        latencyMs: latencySummary(
          group.map((run) => run.elapsedMs).filter((value): value is number => value !== undefined),
        ),
        usage: {
          sourceWallClockDurationMs: group.reduce(
            (sum, run) => sum + run.sourceWallClockDurationMs,
            0,
          ),
          sourceChannels: group.reduce((sum, run) => sum + run.sourceChannels, 0),
          preparedArtifactDurationMs: group.reduce(
            (sum, run) => sum + (run.preparedArtifactDurationMs ?? 0),
            0,
          ),
          preparedArtifactChannels: group.reduce(
            (sum, run) => sum + (run.preparedArtifactChannels ?? 0),
            0,
          ),
          providerReportedAudioDurationSec: group.reduce(
            (sum, run) => sum + (run.providerUsage?.audioDurationSec ?? 0),
            0,
          ),
          providerBillableDurationSec: group.reduce(
            (sum, run) => sum + (run.providerUsage?.billableDurationSec ?? 0),
            0,
          ),
          providerBillableChannels: group.reduce(
            (sum, run) => sum + (run.providerUsage?.billableChannels ?? 0),
            0,
          ),
        },
        costs: {
          calculatedUsd: costs.reduce(
            (sum, cost) => sum + (cost?.status === 'calculated' ? (cost.amountUsd ?? 0) : 0),
            0,
          ),
          actualUsd: costs.reduce(
            (sum, cost) => sum + (cost?.status === 'actual' ? (cost.amountUsd ?? 0) : 0),
            0,
          ),
          unknownRunCount: costs.filter((cost) => cost?.status === 'unknown').length,
          notes: [...new Set(costs.flatMap((cost) => (cost?.note ? [cost.note] : [])))],
        },
      };
    }),
  };
}

export function publicPriceSnapshot(snapshotId: string): PriceSnapshot {
  const matches = priceData.snapshots.filter((candidate) => candidate.snapshotId === snapshotId);
  if (matches.length > 1) {
    throw new Error(`Price snapshot ID is duplicated in the pricing evidence: ${snapshotId}`);
  }
  const snapshot = matches[0];
  if (!snapshot) throw new Error(`Unknown price snapshot: ${snapshotId}`);
  return freezeSnapshotEvidence({
    snapshotId: snapshot.snapshotId,
    effectiveFrom: snapshot.effectiveFrom,
    currency: snapshot.currency,
    sources: snapshot.sources,
    contractEvidence: snapshot.contractEvidence,
    entries: snapshot.entries as PriceEntry[],
  });
}

export function freezeSnapshotEvidence(snapshot: PriceSnapshot): PriceSnapshot {
  const content = {
    snapshotId: snapshot.snapshotId,
    effectiveFrom: snapshot.effectiveFrom,
    currency: snapshot.currency,
    sources: snapshot.sources,
    contractEvidence: snapshot.contractEvidence,
    entries: snapshot.entries,
  };
  const canonicalSha256 = sha256Text(canonicalJson(content));
  if (snapshot.canonicalSha256 && snapshot.canonicalSha256 !== canonicalSha256) {
    throw new Error(
      `Price snapshot canonical hash does not match its content: ${snapshot.snapshotId}`,
    );
  }
  return { ...content, canonicalSha256 };
}

export async function writeAggregateReport(
  outputPath: string,
  report: AggregateReport,
): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const handle = await open(outputPath, 'wx');
  try {
    await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`, 'utf8');
  } finally {
    await handle.close();
  }
}

async function readCampaignRuns(
  benchmarkRoot: string,
  campaignId: string,
): Promise<BenchmarkRun[]> {
  const runsDirectory = resolveUnderBenchmarkRoot(path.join('runs', campaignId), benchmarkRoot);
  let entries;
  try {
    entries = await readdir(runsDirectory, { withFileTypes: true });
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
  const runs: BenchmarkRun[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const run = JSON.parse(
        await readFile(path.join(runsDirectory, entry.name, 'run.json'), 'utf8'),
      ) as BenchmarkRun;
      runs.push(run);
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
      throw error;
    }
  }
  return runs;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const benchmarkRoot = getBenchmarkRoot(loadBenchmarkEnvironment());
  const campaignId = required(args, 'campaign');
  const priceSnapshotId = args.snapshot ?? 'public-2026-08-28';
  const snapshot = publicPriceSnapshot(priceSnapshotId);
  const report = summarizeRuns(
    await readCampaignRuns(benchmarkRoot, campaignId),
    priceSnapshotId,
    snapshot,
  );
  const outputPath = resolveUnderBenchmarkRoot(
    args.output ?? path.join('reports', campaignId, `${priceSnapshotId}.json`),
    benchmarkRoot,
  );
  await writeAggregateReport(outputPath, report);
  console.log(
    JSON.stringify(
      {
        reportPath: outputPath,
        campaignId,
        priceSnapshotId,
        aggregateCount: report.aggregates.length,
      },
      null,
      2,
    ),
  );
}

function usageValue(run: BenchmarkRun, usage: PriceEntry['usage']): number | undefined {
  if (usage === 'billable_duration_sec') return run.providerUsage?.billableDurationSec;
  if (usage === 'provider_audio_duration_sec') return run.providerUsage?.audioDurationSec;
  const key =
    usage === 'raw_usage_input_audio_tokens' ? 'input_audio_tokens' : 'output_text_tokens';
  const value = run.providerUsage?.rawUsage?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function latencySummary(values: number[]): { p50?: number; p95?: number } {
  if (!values.length) return {};
  const sorted = [...values].sort((left, right) => left - right);
  return {
    p50: sorted[Math.floor((sorted.length - 1) * 0.5)],
    p95: sorted[Math.floor((sorted.length - 1) * 0.95)],
  };
}

function parseArgs(argv: string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument?.startsWith('--')) continue;
    const key = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    values[key] = value;
    index += 1;
  }
  return values;
}

function required(args: Record<string, string>, name: string): string {
  const value = args[name];
  if (!value) throw new Error(`Missing required --${name}`);
  return value;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
