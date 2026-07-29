import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildSpeechPlannerEvalMatrix,
  loadSpeechPlannerEvalFixtures,
  loadSpeechPlannerPriceSnapshot,
} from '../src/application/speech-planner-eval-fixtures.js';
import {
  estimateSpeechPlannerAttemptCost,
  evaluateSpeechPlannerAttemptRecord,
  runSpeechPlannerEvaluation,
  summarizeSpeechPlannerEvalAttempts,
} from '../src/application/speech-planner-evaluator.js';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('speech planner evaluator', () => {
  it('keeps visible output and thinking tokens separate in transparent cost math', () => {
    expect(
      estimateSpeechPlannerAttemptCost({
        model: 'gemini-3.5-flash-lite',
        usage: { inputTokens: 100, outputTokens: 20, reasoningTokens: 5 },
        priceSnapshot: loadSpeechPlannerPriceSnapshot(),
      }),
    ).toEqual({
      costStatus: 'estimated',
      estimatedCostUsd: 0.0000925,
      formula: {
        inputTokens: 100,
        visibleOutputTokens: 20,
        thinkingTokens: 5,
        inputPerMillionUsd: 0.3,
        outputIncludingThinkingPerMillionUsd: 2.5,
      },
    });
    expect(
      estimateSpeechPlannerAttemptCost({
        model: 'gemini-3.5-flash-lite',
        usage: { inputTokens: 100, outputTokens: 20 },
        priceSnapshot: loadSpeechPlannerPriceSnapshot(),
      }),
    ).toEqual({ costStatus: 'unavailable' });
  });

  it('separates raw parsing, valid prompted plans, fallback, rendering, and hard gates', () => {
    const fixture = loadSpeechPlannerEvalFixtures().find(
      (candidate) => candidate.id === 'neutral-dialogue',
    )!;
    const variant = buildSpeechPlannerEvalMatrix({ fixtures: [fixture], repetitions: 1 }).find(
      (candidate) => candidate.model === 'gemini-3.5-flash-lite',
    )!;
    const valid = evaluateSpeechPlannerAttemptRecord({
      variant,
      fixture,
      rawText:
        'wrapped {"segments":[{"id":"neutral-1"},{"id":"neutral-2","deliveryMode":"BALANCED"}]} done',
      returnedModel: 'gemini-3.5-flash-lite-2026-07-21',
      usage: { inputTokens: 100, outputTokens: 20, reasoningTokens: 5, totalTokens: 125 },
      latencyMs: 42,
      priceSnapshot: loadSpeechPlannerPriceSnapshot(),
    });
    expect(valid).toMatchObject({
      promptHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      rendererPolicyVersion: 'inworld-renderer-v2',
      fixtureContentHash: fixture.contentHash,
      rawParseStatus: 'parsed',
      promptedPlanStatus: 'valid',
      fallbackStatus: 'not_used',
      returnedModel: 'gemini-3.5-flash-lite-2026-07-21',
      estimatedCostUsd: 0.0000925,
      analysis: { hardFailures: [] },
      candidateAnalysis: { hardFailures: [] },
      rendered: expect.arrayContaining([
        expect.objectContaining({ id: 'neutral-1', leadingInstructionTagCount: 0 }),
      ]),
    });

    const malformed = evaluateSpeechPlannerAttemptRecord({
      variant,
      fixture,
      rawText: 'not json',
      latencyMs: 20,
      priceSnapshot: loadSpeechPlannerPriceSnapshot(),
      fallbackUsed: true,
    });
    expect(malformed).toMatchObject({
      rawParseStatus: 'malformed',
      promptedPlanStatus: 'invalid',
      fallbackStatus: 'identity',
      costStatus: 'unavailable',
    });
  });

  it('aggregates parse, prompted-valid, fallback, latency, and cost without crediting fallback', () => {
    const fixture = loadSpeechPlannerEvalFixtures()[0]!;
    const variants = buildSpeechPlannerEvalMatrix({ fixtures: [fixture], repetitions: 1 }).slice(
      0,
      2,
    );
    const records = [
      {
        attemptId: variants[0]!.attemptId,
        fixtureId: fixture.id,
        requestedModel: variants[0]!.model,
        promptPolicyVersion: variants[0]!.promptPolicyVersion,
        repetition: 1,
        compatibilitySmoke: false,
        rawParseStatus: 'parsed' as const,
        promptedPlanStatus: 'valid' as const,
        fallbackStatus: 'not_used' as const,
        latencyMs: 10,
        costStatus: 'estimated' as const,
        estimatedCostUsd: 0.001,
        usage: { inputTokens: 10, outputTokens: 4, reasoningTokens: 2 },
        analysis: {
          hardFailures: [],
          warnings: [],
          metrics: {
            segmentCount: 1,
            paceCount: 0,
            pauseCount: 1,
            pauseValuesMs: [300],
            nonverbalCount: 0,
            emphasisCount: 0,
            freeFormDirectionCount: 0,
            deliveryModeCounts: { BALANCED: 1 },
            cueCount: 2,
            cueRate: 2,
          },
        },
        rendered: [{ id: 'a', text: 'a', lexicalText: 'a', leadingInstructionTagCount: 1 }],
      },
      {
        attemptId: variants[1]!.attemptId,
        fixtureId: fixture.id,
        requestedModel: variants[1]!.model,
        promptPolicyVersion: variants[1]!.promptPolicyVersion,
        repetition: 1,
        compatibilitySmoke: false,
        rawParseStatus: 'malformed' as const,
        promptedPlanStatus: 'invalid' as const,
        fallbackStatus: 'identity' as const,
        latencyMs: 30,
        costStatus: 'unavailable' as const,
      },
    ];

    expect(summarizeSpeechPlannerEvalAttempts(records)).toMatchObject({
      attempts: 2,
      rawParseRate: 0.5,
      validPromptedPlanRate: 0.5,
      identityFallbackRate: 0.5,
      latencyMs: { median: 20, p95: 30, statisticalStatus: 'descriptive' },
      medianEstimatedCostPerValidPlanUsd: 0.001,
      estimatedCostPer100ValidPlansUsd: 0.1,
      compatibility: { failures: 0, skipped: 0 },
      returnedModelIdentity: { mismatches: 0 },
      outputTokens: { reported: 1, unavailable: 1, median: 4, p95: 4 },
      thinkingTokens: { reported: 1, unavailable: 1, median: 2, p95: 2 },
      cueDensity: { reported: 1, median: 2, p95: 2, maximum: 2 },
      pausesMs: { reported: 1, median: 300, p95: 300, maximum: 300 },
      deliveryModeCounts: { BALANCED: 1 },
      hardGates: { passed: false, schemaInvalidAttempts: 1 },
    });
  });

  it('writes immutable artifacts, derives compatibility skips, and resumes only missing attempts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'speech-planner-eval-'));
    tempRoots.push(root);
    const runDirectory = join(root, 'run-1');
    const fixture = loadSpeechPlannerEvalFixtures()[0]!;
    const variants = buildSpeechPlannerEvalMatrix({ fixtures: [fixture], repetitions: 1 });
    const executeVariant = vi.fn(async (variant: (typeof variants)[number]) => {
      if (variant.compatibilitySmoke) {
        return { status: 'compatibility_failure' as const, category: 'model_unavailable' };
      }
      return {
        status: 'completed' as const,
        rawText: JSON.stringify({ segments: [{ id: fixture.prepared.segments[0]!.id }] }),
        latencyMs: 10,
      };
    });

    let observedPartialStatus = false;
    const first = await runSpeechPlannerEvaluation({
      runDirectory,
      gitSha: 'a'.repeat(40),
      variants,
      fixtures: [fixture],
      priceSnapshot: loadSpeechPlannerPriceSnapshot(),
      executeVariant: async (variant) => {
        observedPartialStatus ||=
          (
            JSON.parse(readFileSync(join(runDirectory, 'run.json'), 'utf8')) as {
              status?: string;
            }
          ).status === 'partial';
        return executeVariant(variant);
      },
      runContext: {
        mode: 'live',
        resolvedConfig: {
          corpusPath: 'packages/batch-backend/fixtures/speech-planner-eval/corpus-v1.json',
          priceSnapshotPath:
            'packages/batch-backend/fixtures/speech-planner-eval/pricing-2026-07-28.json',
          models: ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'],
          promptPolicies: [
            'speech-performance-v1-restrained-natural',
            'speech-performance-v2-inworld-tts2',
          ],
          repetitions: 1,
          privateOnly: false,
        },
        environmentFlags: {
          live: true,
          offlineOutputFixtures: false,
          selectedAudio: false,
          privateOnly: false,
          postgresAdapters: 0,
        },
        preflight: {
          status: 'allowed',
          allowedModels: ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'],
          requiredModels: ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'],
          missingRequiredModels: [],
          allowlistReady: true,
          credentialsPresent: true,
          usageVerified: true,
          usedToday: 0,
          dailyLimit: 120,
          rpm: 4,
          remainingDailyCapacity: 120,
          plannerAttempts: 4,
          compatibilityChecks: 1,
        },
      },
    });
    expect(first.records).toHaveLength(4);
    expect(
      first.records.filter((record) => record.promptedPlanStatus === 'skipped_incompatible'),
    ).toHaveLength(1);
    expect(executeVariant).toHaveBeenCalledTimes(3);
    expect(observedPartialStatus).toBe(true);
    expect(JSON.parse(readFileSync(join(runDirectory, 'run.json'), 'utf8'))).toMatchObject({
      schemaVersion: 2,
      status: 'completed',
      mode: 'live',
      resolvedConfig: {
        repetitions: 1,
        privateOnly: false,
      },
      environmentFlags: { live: true, selectedAudio: false },
      preflight: {
        allowlistReady: true,
        dailyLimit: 120,
        rpm: 4,
      },
      priceSnapshot: loadSpeechPlannerPriceSnapshot(),
    });
    expect(
      readFileSync(join(runDirectory, 'attempts.jsonl'), 'utf8').trim().split('\n'),
    ).toHaveLength(4);
    await expect(
      runSpeechPlannerEvaluation({
        runDirectory,
        gitSha: 'a'.repeat(40),
        variants,
        fixtures: [fixture],
        priceSnapshot: loadSpeechPlannerPriceSnapshot(),
        executeVariant,
      }),
    ).rejects.toThrow('already exists');

    executeVariant.mockClear();
    const resumed = await runSpeechPlannerEvaluation({
      runDirectory,
      gitSha: 'a'.repeat(40),
      variants,
      fixtures: [fixture],
      priceSnapshot: loadSpeechPlannerPriceSnapshot(),
      executeVariant,
      resume: true,
    });
    expect(resumed.records).toHaveLength(4);
    expect(executeVariant).not.toHaveBeenCalled();
  });

  it('short-circuits remaining model cells when the compatibility smoke output is invalid', async () => {
    const root = mkdtempSync(join(tmpdir(), 'speech-planner-smoke-'));
    tempRoots.push(root);
    const fixture = loadSpeechPlannerEvalFixtures()[0]!;
    const variants = buildSpeechPlannerEvalMatrix({ fixtures: [fixture], repetitions: 1 });
    const executeVariant = vi.fn(async (variant: (typeof variants)[number]) => ({
      status: 'completed' as const,
      rawText: variant.compatibilitySmoke
        ? 'not json'
        : JSON.stringify({ segments: fixture.prepared.segments.map(({ id }) => ({ id })) }),
      latencyMs: 10,
      fallbackUsed: variant.compatibilitySmoke,
    }));

    const run = await runSpeechPlannerEvaluation({
      runDirectory: join(root, 'run'),
      gitSha: 'a'.repeat(40),
      variants,
      fixtures: [fixture],
      priceSnapshot: loadSpeechPlannerPriceSnapshot(),
      executeVariant,
    });

    expect(executeVariant).toHaveBeenCalledTimes(3);
    expect(run.records.find((record) => record.compatibilitySmoke)).toMatchObject({
      promptedPlanStatus: 'invalid',
      fallbackStatus: 'identity',
      normalizedErrorCategory: 'compatibility_invalid_output',
    });
    expect(
      run.records.filter((record) => record.promptedPlanStatus === 'skipped_incompatible'),
    ).toHaveLength(1);
  });

  it('short-circuits a compatibility smoke that returns another model identity', async () => {
    const root = mkdtempSync(join(tmpdir(), 'speech-planner-model-id-'));
    tempRoots.push(root);
    const fixture = loadSpeechPlannerEvalFixtures()[0]!;
    const variants = buildSpeechPlannerEvalMatrix({ fixtures: [fixture], repetitions: 1 });
    const executeVariant = vi.fn(async (variant: (typeof variants)[number]) => ({
      status: 'completed' as const,
      rawText: JSON.stringify({
        segments: fixture.prepared.segments.map(({ id }) => ({ id })),
      }),
      returnedModel: variant.compatibilitySmoke ? 'gemini-3.1-flash-lite' : variant.model,
      latencyMs: 10,
    }));

    const run = await runSpeechPlannerEvaluation({
      runDirectory: join(root, 'run'),
      gitSha: 'a'.repeat(40),
      variants,
      fixtures: [fixture],
      priceSnapshot: loadSpeechPlannerPriceSnapshot(),
      executeVariant,
    });

    expect(executeVariant).toHaveBeenCalledTimes(3);
    expect(run.records.find((record) => record.compatibilitySmoke)).toMatchObject({
      normalizedErrorCategory: 'compatibility_returned_model_mismatch',
    });
  });

  it('recovers an artifact-first interrupted attempt without overwriting immutable content', async () => {
    const root = mkdtempSync(join(tmpdir(), 'speech-planner-resume-'));
    tempRoots.push(root);
    const runDirectory = join(root, 'run');
    const fixture = loadSpeechPlannerEvalFixtures()[0]!;
    const variants = buildSpeechPlannerEvalMatrix({
      fixtures: [fixture],
      repetitions: 1,
      models: ['gemini-3.1-flash-lite'],
      promptPolicies: ['speech-performance-v2-inworld-tts2'],
    });
    const rawText = JSON.stringify({
      segments: fixture.prepared.segments.map(({ id }) => ({ id })),
    });
    const executeVariant = vi.fn(async () => ({
      status: 'completed' as const,
      rawText,
      latencyMs: 10,
    }));
    await runSpeechPlannerEvaluation({
      runDirectory,
      gitSha: 'a'.repeat(40),
      variants,
      fixtures: [fixture],
      priceSnapshot: loadSpeechPlannerPriceSnapshot(),
      executeVariant,
    });
    const immutablePlan = readFileSync(
      join(runDirectory, 'plans', `${variants[0]!.attemptId}.json`),
      'utf8',
    );
    writeFileSync(join(runDirectory, 'attempts.jsonl'), '', 'utf8');
    executeVariant.mockClear();

    const resumed = await runSpeechPlannerEvaluation({
      runDirectory,
      gitSha: 'a'.repeat(40),
      variants,
      fixtures: [fixture],
      priceSnapshot: loadSpeechPlannerPriceSnapshot(),
      executeVariant,
      resume: true,
    });

    expect(executeVariant).toHaveBeenCalledOnce();
    expect(resumed.records).toHaveLength(1);
    expect(
      readFileSync(join(runDirectory, 'plans', `${variants[0]!.attemptId}.json`), 'utf8'),
    ).toBe(immutablePlan);

    writeFileSync(
      join(runDirectory, 'plans', `${variants[0]!.attemptId}.json`),
      '{"tampered":true}',
      'utf8',
    );
    await expect(
      runSpeechPlannerEvaluation({
        runDirectory,
        gitSha: 'a'.repeat(40),
        variants,
        fixtures: [fixture],
        priceSnapshot: loadSpeechPlannerPriceSnapshot(),
        executeVariant,
        resume: true,
      }),
    ).rejects.toThrow('immutable artifact mismatch');
  });
});
