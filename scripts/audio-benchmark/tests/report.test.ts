import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

import {
  calculateRunCost,
  freezeSnapshotEvidence,
  publicPriceSnapshot,
  summarizeRuns,
  writeAggregateReport,
} from '../report';
import type { BenchmarkRun } from '../schema';

const run: BenchmarkRun = {
  schemaVersion: '1.0',
  runId: 'run-1',
  campaignId: 'campaign-1',
  caseId: 'lesson-1',
  providerId: 'speechmatics-melia-1-batch',
  requestedModel: 'melia-1',
  requestMode: 'batch',
  runMode: 'mixed_diarized',
  sourceSha256: 'a'.repeat(64),
  preparedSha256: 'b'.repeat(64),
  sourceWallClockDurationMs: 120_000,
  sourceChannels: 2,
  preparedArtifactDurationMs: 120_000,
  preparedArtifactChannels: 1,
  mediaIngest: {
    inputArtifact: 'prepared_artifact',
    originalSourceDirect: 'not_tested',
  },
  attempts: [
    {
      attemptId: '001-submit',
      phase: 'submit',
      outcome: 'succeeded',
      startedAt: '2026-08-28T00:00:00.000Z',
      finishedAt: '2026-08-28T00:00:01.000Z',
      elapsedMs: 1000,
    },
  ],
  providerUsage: {
    audioDurationSec: 100,
    billableDurationSec: 90,
    billableChannels: 1,
    source: 'provider',
    rawUsage: { duration: 100 },
  },
  startedAt: '2026-08-28T00:00:00.000Z',
  finishedAt: '2026-08-28T00:00:02.000Z',
  elapsedMs: 2000,
  status: 'success',
};

describe('aggregate benchmark reporting', () => {
  test('calculates cost from billable duration and an explicit price snapshot', () => {
    const cost = calculateRunCost(run, {
      snapshotId: 'public-2026-08-28',
      entries: [
        {
          providerId: 'speechmatics-melia-1-batch',
          model: 'melia-1',
          unit: 'hour',
          usdPerUnit: 0.129,
          usage: 'billable_duration_sec',
          denominator: 3600,
          calculationStatus: 'confirmed',
        },
      ],
    });

    expect(cost.status).toBe('calculated');
    expect(cost.amountUsd).toBeCloseTo((90 / 3600) * 0.129);
    expect(cost.priceSnapshotId).toBe('public-2026-08-28');
  });

  test('keeps source, prepared, provider, billable, and physical-request dimensions distinct', () => {
    const report = summarizeRuns([run], 'public-2026-08-28', {
      snapshotId: 'public-2026-08-28',
      effectiveFrom: '2026-08-28',
      currency: 'USD',
      entries: [],
    });
    const aggregate = report.aggregates[0]!;

    expect(aggregate.usage.sourceWallClockDurationMs).toBe(120_000);
    expect(aggregate.usage.sourceChannels).toBe(2);
    expect(aggregate.usage.preparedArtifactDurationMs).toBe(120_000);
    expect(aggregate.usage.preparedArtifactChannels).toBe(1);
    expect(aggregate.usage.providerReportedAudioDurationSec).toBe(100);
    expect(aggregate.usage.providerBillableDurationSec).toBe(90);
    expect(aggregate.usage.providerBillableChannels).toBe(1);
    expect(aggregate.physicalRequestAttempts).toBe(1);
    expect(JSON.stringify(report)).not.toContain('ajá');
  });

  test('multiplies only the explicitly recorded billable channels for a split control', () => {
    const splitRun: BenchmarkRun = {
      ...run,
      runId: 'run-split-control',
      providerId: 'deepgram-nova-3',
      requestedModel: 'nova-3',
      runMode: 'trusted_split_control',
      mediaIngest: {
        inputArtifact: 'original_source',
        originalSourceDirect: 'accepted',
      },
      providerUsage: {
        audioDurationSec: 60,
        billableDurationSec: 60,
        billableChannels: 2,
        source: 'calculated',
      },
    };
    const cost = calculateRunCost(splitRun, {
      snapshotId: 'public-2026-08-28',
      entries: [
        {
          providerId: 'deepgram-nova-3',
          model: 'nova-3',
          unit: 'minute',
          usdPerUnit: 0.0092,
          usage: 'billable_duration_sec',
          denominator: 60,
          calculationStatus: 'incomplete',
        },
      ],
    });

    expect(cost.status).toBe('unknown');
    expect(cost.note).toMatch(/unconfirmed|incomplete|diarization/iu);
  });

  test('sums multiple price entries for a provider and model', () => {
    const sonioxRun: BenchmarkRun = {
      ...run,
      providerId: 'soniox-v5-async',
      requestedModel: 'stt-async-v5',
      providerUsage: {
        source: 'provider',
        rawUsage: { input_audio_tokens: 1_000_000, output_text_tokens: 2_000_000 },
      },
    };
    const cost = calculateRunCost(sonioxRun, {
      snapshotId: 'public-2026-08-28',
      entries: [
        {
          providerId: 'soniox-v5-async',
          model: 'stt-async-v5',
          unit: 'input_audio_token',
          usdPerUnit: 1.5,
          denominator: 1_000_000,
          usage: 'raw_usage_input_audio_tokens',
          calculationStatus: 'confirmed',
        },
        {
          providerId: 'soniox-v5-async',
          model: 'stt-async-v5',
          unit: 'output_text_token',
          usdPerUnit: 3.5,
          denominator: 1_000_000,
          usage: 'raw_usage_output_text_tokens',
          calculationStatus: 'confirmed',
        },
      ],
    });

    expect(cost.status).toBe('calculated');
    expect(cost.amountUsd).toBeCloseTo(8.5);
  });

  test('embeds immutable pricing evidence and refuses report overwrite', async () => {
    const snapshot = publicPriceSnapshot('public-2026-08-28');
    const report = summarizeRuns([run], snapshot.snapshotId, snapshot);
    expect(report.pricingSnapshot).toMatchObject({
      snapshotId: snapshot.snapshotId,
      effectiveFrom: snapshot.effectiveFrom,
      canonicalSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      entries: snapshot.entries,
    });

    const outputPath = path.join(
      os.tmpdir(),
      `audio-benchmark-report-${Date.now()}-${Math.random()}.json`,
    );
    await writeAggregateReport(outputPath, report);
    await expect(writeAggregateReport(outputPath, report)).rejects.toMatchObject({
      code: 'EEXIST',
    });
  });

  test('rejects a selected snapshot whose supplied canonical hash differs from its content', () => {
    expect(() =>
      freezeSnapshotEvidence({
        snapshotId: 'snapshot-1',
        effectiveFrom: '2026-08-28',
        entries: [],
        canonicalSha256: '0'.repeat(64),
      }),
    ).toThrow(/canonical hash/iu);
  });
});
