import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
      rawParseStatus: 'parsed',
      promptedPlanStatus: 'valid',
      fallbackStatus: 'not_used',
      returnedModel: 'gemini-3.5-flash-lite-2026-07-21',
      estimatedCostUsd: 0.0000925,
      analysis: { hardFailures: [] },
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

    const first = await runSpeechPlannerEvaluation({
      runDirectory,
      gitSha: 'a'.repeat(40),
      variants,
      fixtures: [fixture],
      priceSnapshot: loadSpeechPlannerPriceSnapshot(),
      executeVariant,
    });
    expect(first.records).toHaveLength(4);
    expect(
      first.records.filter((record) => record.promptedPlanStatus === 'skipped_incompatible'),
    ).toHaveLength(1);
    expect(executeVariant).toHaveBeenCalledTimes(3);
    expect(
      readFileSync(join(runDirectory, 'attempts.jsonl'), 'utf8').trim().split('\n'),
    ).toHaveLength(4);
    expect(() =>
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
});
