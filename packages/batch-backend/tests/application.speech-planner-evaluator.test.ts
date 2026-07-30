import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildSpeechPlannerEvalMatrix,
  loadSpeechPlannerEvalControls,
  loadSpeechPlannerEvalFixtures,
  loadSpeechPlannerPriceSnapshot,
} from '../src/application/speech-planner-eval-fixtures.js';
import {
  beginSpeechPlannerEvalRunActivity,
  estimateSpeechPlannerAttemptCost,
  evaluateSpeechPlannerAttemptRecord,
  finishSpeechPlannerEvalRunActivity,
  readSpeechPlannerEvalRunMetadata,
  runSpeechPlannerEvaluation,
  summarizeSpeechPlannerEvalAttempts,
} from '../src/application/speech-planner-evaluator.js';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('speech planner evaluator', () => {
  it('records immutable production-faithful identity controls without provider calls', async () => {
    const root = mkdtempSync(join(tmpdir(), 'speech-planner-controls-'));
    tempRoots.push(root);
    const runDirectory = join(root, 'run');
    const fixture = loadSpeechPlannerEvalFixtures()[0]!;
    const variants = buildSpeechPlannerEvalMatrix({
      fixtures: [fixture],
      repetitions: 1,
      models: ['gemini-3.1-flash-lite'],
      promptPolicies: ['speech-performance-v2-inworld-tts2'],
    });
    const controls = loadSpeechPlannerEvalControls();
    const executeVariant = vi.fn(async () => ({
      status: 'completed' as const,
      rawText: JSON.stringify({
        segments: fixture.prepared.segments.map(({ id }) => ({ id })),
      }),
      latencyMs: 10,
    }));

    const result = await runSpeechPlannerEvaluation({
      runDirectory,
      gitSha: 'a'.repeat(40),
      variants,
      fixtures: [fixture],
      controls,
      priceSnapshot: loadSpeechPlannerPriceSnapshot(),
      executeVariant,
    });

    expect(executeVariant).toHaveBeenCalledOnce();
    expect(result.controls).toEqual([
      expect.objectContaining({
        controlId: 'tts-1-5-identity-rendering',
        controlContentHash: controls[0]!.contentHash,
        status: 'passed',
        planMode: 'identity',
        analysis: expect.objectContaining({ hardFailures: [] }),
        rendered: [
          expect.objectContaining({
            id: 'legacy-natural',
            text: 'Please read the notice before Friday.',
            lexicalText: 'Please read the notice before Friday.',
            leadingInstructionTagCount: 0,
            speakingRate: 1,
          }),
          expect.not.objectContaining({ speakingRate: expect.anything() }),
        ],
      }),
    ]);
    expect(JSON.parse(readFileSync(join(runDirectory, 'run.json'), 'utf8'))).toMatchObject({
      schemaVersion: 4,
      expectedControls: 1,
      completedControls: 1,
      controlIds: ['tts-1-5-identity-rendering'],
      controlHashes: [controls[0]!.contentHash],
      status: 'completed',
    });
    const controlPath = join(runDirectory, 'controls', 'tts-1-5-identity-rendering.json');
    const immutableControl = readFileSync(controlPath, 'utf8');

    executeVariant.mockClear();
    const resumed = await runSpeechPlannerEvaluation({
      runDirectory,
      gitSha: 'a'.repeat(40),
      variants,
      fixtures: [fixture],
      controls,
      priceSnapshot: loadSpeechPlannerPriceSnapshot(),
      executeVariant,
      resume: true,
    });
    expect(executeVariant).not.toHaveBeenCalled();
    expect(resumed.controls).toHaveLength(1);
    expect(readFileSync(controlPath, 'utf8')).toBe(immutableControl);

    writeFileSync(controlPath, '{"tampered":true}', 'utf8');
    await expect(
      runSpeechPlannerEvaluation({
        runDirectory,
        gitSha: 'a'.repeat(40),
        variants,
        fixtures: [fixture],
        controls,
        priceSnapshot: loadSpeechPlannerPriceSnapshot(),
        executeVariant,
        resume: true,
      }),
    ).rejects.toThrow('control artifact');
  });

  it('rejects schema 4 metadata without explicit control completion counts', () => {
    const root = mkdtempSync(join(tmpdir(), 'speech-planner-metadata-'));
    tempRoots.push(root);
    writeFileSync(
      join(root, 'run.json'),
      JSON.stringify({
        schemaVersion: 4,
        status: 'partial',
        resolvedConfig: {},
        environmentFlags: {},
        preflight: {},
        priceSnapshot: {},
        variants: [],
        controlIds: [],
        controlHashes: [],
        activities: [],
      }),
    );

    expect(() => readSpeechPlannerEvalRunMetadata(root)).toThrow('unsupported metadata contract');
  });

  it('keeps aggregate status partial until paid attempts and controls are both complete', async () => {
    const root = mkdtempSync(join(tmpdir(), 'speech-planner-completion-'));
    tempRoots.push(root);
    const runDirectory = join(root, 'run');
    const fixture = loadSpeechPlannerEvalFixtures()[0]!;
    const variants = buildSpeechPlannerEvalMatrix({
      fixtures: [fixture],
      repetitions: 1,
      models: ['gemini-3.1-flash-lite'],
      promptPolicies: ['speech-performance-v2-inworld-tts2'],
    });
    await runSpeechPlannerEvaluation({
      runDirectory,
      gitSha: 'a'.repeat(40),
      variants,
      fixtures: [fixture],
      controls: loadSpeechPlannerEvalControls(),
      priceSnapshot: loadSpeechPlannerPriceSnapshot(),
      executeVariant: async () => ({
        status: 'completed',
        rawText: JSON.stringify({ segments: fixture.prepared.segments.map(({ id }) => ({ id })) }),
        latencyMs: 1,
      }),
    });
    const metadata = readSpeechPlannerEvalRunMetadata(runDirectory);
    const runContext = {
      mode: metadata.mode,
      resolvedConfig: metadata.resolvedConfig,
      environmentFlags: metadata.environmentFlags,
      preflight: metadata.preflight,
    };
    const activityId = beginSpeechPlannerEvalRunActivity({
      runDirectory,
      kind: 'planner_resume',
      runContext,
    });
    finishSpeechPlannerEvalRunActivity({
      runDirectory,
      activityId,
      status: 'completed',
      completedAttempts: 0,
      completedControls: 1,
    });

    expect(readSpeechPlannerEvalRunMetadata(runDirectory).status).toBe('partial');
  });

  it('supersedes an interrupted planner activity on a safe later resume', async () => {
    const root = mkdtempSync(join(tmpdir(), 'speech-planner-activity-resume-'));
    tempRoots.push(root);
    const runDirectory = join(root, 'run');
    const fixture = loadSpeechPlannerEvalFixtures()[0]!;
    const variants = buildSpeechPlannerEvalMatrix({
      fixtures: [fixture],
      repetitions: 1,
      models: ['gemini-3.1-flash-lite'],
      promptPolicies: ['speech-performance-v2-inworld-tts2'],
    });
    await runSpeechPlannerEvaluation({
      runDirectory,
      gitSha: 'a'.repeat(40),
      variants,
      fixtures: [fixture],
      priceSnapshot: loadSpeechPlannerPriceSnapshot(),
      executeVariant: async () => ({
        status: 'completed',
        rawText: JSON.stringify({ segments: fixture.prepared.segments.map(({ id }) => ({ id })) }),
        latencyMs: 1,
      }),
    });
    const metadata = readSpeechPlannerEvalRunMetadata(runDirectory);
    const runContext = {
      mode: metadata.mode,
      resolvedConfig: metadata.resolvedConfig,
      environmentFlags: metadata.environmentFlags,
      preflight: metadata.preflight,
    };
    beginSpeechPlannerEvalRunActivity({ runDirectory, kind: 'planner_resume', runContext });
    const recoveryId = beginSpeechPlannerEvalRunActivity({
      runDirectory,
      kind: 'planner_resume',
      runContext,
    });
    finishSpeechPlannerEvalRunActivity({
      runDirectory,
      activityId: recoveryId,
      status: 'completed',
      completedAttempts: 1,
      completedControls: 0,
      providerCalls: 0,
    });

    const recovered = readSpeechPlannerEvalRunMetadata(runDirectory);
    expect(recovered.status).toBe('completed');
    expect(recovered.activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'planner_resume',
          status: 'interrupted',
          normalizedErrorCategory: 'interrupted_before_resume',
        }),
      ]),
    );
  });

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
    ).toEqual({
      costStatus: 'unavailable',
      missingUsageFields: ['thinkingTokens'],
      knownUsage: { inputTokens: 100, visibleOutputTokens: 20 },
    });
  });

  it('deduplicates the same semantic warning and breaks warnings down by cell and fixture', () => {
    const fixture = loadSpeechPlannerEvalFixtures()[0]!;
    const variant = buildSpeechPlannerEvalMatrix({ fixtures: [fixture], repetitions: 1 })[0]!;
    const duplicateWarning = {
      severity: 'warning' as const,
      code: 'redundant_instruction_components',
      segmentId: 'segment-1',
      detail: { fields: 'emotion,freeFormDirection' },
    };
    const record = {
      attemptId: variant.attemptId,
      fixtureId: fixture.id,
      requestedModel: variant.model,
      promptPolicyVersion: variant.promptPolicyVersion,
      repetition: 1,
      compatibilitySmoke: false,
      rawParseStatus: 'parsed' as const,
      promptedPlanStatus: 'valid' as const,
      fallbackStatus: 'not_used' as const,
      costStatus: 'unavailable' as const,
      candidateAnalysis: { hardFailures: [], warnings: [duplicateWarning] },
      analysis: {
        hardFailures: [],
        warnings: [duplicateWarning],
        metrics: {
          segmentCount: 1,
          paceCount: 0,
          pauseCount: 0,
          pauseValuesMs: [],
          nonverbalCount: 0,
          emphasisCount: 0,
          freeFormDirectionCount: 1,
          instructionCount: 0,
          nonDefaultDeliveryModeCount: 0,
          deliveryModeCounts: {},
          cueCount: 2,
          cueRate: 2,
        },
      },
    };

    const summary = summarizeSpeechPlannerEvalAttempts([record]);
    expect(summary).toMatchObject({
      warningCounts: { redundant_instruction_components: 1 },
      warningBreakdown: {
        redundant_instruction_components: {
          total: 1,
          byFixture: { [fixture.id]: 1 },
          byFieldPair: { 'emotion,freeFormDirection': 1 },
          byCell: { [`${variant.model}|${variant.promptPolicyVersion}`]: 1 },
        },
      },
    });
  });

  it('derives warning field pairs from a real evaluated plan without changing shared warnings', () => {
    const fixture = loadSpeechPlannerEvalFixtures()[0]!;
    const variant = buildSpeechPlannerEvalMatrix({ fixtures: [fixture], repetitions: 1 })[0]!;
    const [first, ...remaining] = fixture.prepared.segments;
    const record = evaluateSpeechPlannerAttemptRecord({
      variant,
      fixture,
      rawText: JSON.stringify({
        segments: [
          {
            id: first!.id,
            emotion: 'warm',
            intonation: 'gently rising',
            freeFormDirection: 'Keep the delivery warm and clear.',
            pace: 'measured',
            pauseBeforeMs: 100,
            pauseAfterMs: 200,
            deliveryMode: 'BALANCED',
          },
          ...remaining.map(({ id }) => ({ id })),
        ],
      }),
      latencyMs: 1,
      priceSnapshot: loadSpeechPlannerPriceSnapshot(),
    });

    const summary = summarizeSpeechPlannerEvalAttempts([record]);
    expect(summary).toMatchObject({
      warningCounts: {
        redundant_instruction_components: 1,
        high_cue_density: 1,
      },
      warningBreakdown: {
        redundant_instruction_components: {
          byFieldPair: {
            'emotion,freeFormDirection': 1,
            'intonation,freeFormDirection': 1,
          },
        },
        high_cue_density: {
          byFieldPair: {
            'emotion,freeFormDirection': 1,
            'pauseBeforeMs,pauseAfterMs': 1,
          },
        },
      },
    });
    expect(summary.warningBreakdown.redundant_instruction_components?.byFieldPair).toEqual({
      'emotion,freeFormDirection': 1,
      'intonation,freeFormDirection': 1,
    });
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
      rendererPolicyVersion: 'inworld-renderer-v3-contextual-continuity',
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
            instructionCount: 0,
            nonDefaultDeliveryModeCount: 0,
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
          controlsPath: 'packages/batch-backend/fixtures/speech-planner-eval/controls-v1.json',
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
      schemaVersion: 4,
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
      activities: [
        {
          kind: 'planner_initial',
          status: 'completed',
          preflight: { usedToday: 0, plannerAttempts: 4 },
        },
      ],
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

  it('fails closed on an artifact-first interrupted attempt without another provider call', async () => {
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
    ).rejects.toThrow('indeterminate');

    expect(executeVariant).not.toHaveBeenCalled();
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
    ).rejects.toThrow('indeterminate');
  });

  it('records a transient provider failure as one physical call with no retry', async () => {
    const root = mkdtempSync(join(tmpdir(), 'speech-planner-provider-failure-'));
    tempRoots.push(root);
    const runDirectory = join(root, 'run');
    const fixture = loadSpeechPlannerEvalFixtures()[0]!;
    const variants = buildSpeechPlannerEvalMatrix({
      fixtures: [fixture],
      repetitions: 1,
      models: ['gemini-3.1-flash-lite'],
      promptPolicies: ['speech-performance-v2-inworld-tts2'],
    });
    const executeVariant = vi.fn(async () => ({
      status: 'provider_error' as const,
      category: 'UNAVAILABLE',
      latencyMs: 12,
    }));

    const run = await runSpeechPlannerEvaluation({
      runDirectory,
      gitSha: 'a'.repeat(40),
      variants,
      fixtures: [fixture],
      priceSnapshot: loadSpeechPlannerPriceSnapshot(),
      executeVariant,
      runContext: {
        mode: 'live',
        resolvedConfig: {
          corpusPath: 'injected',
          controlsPath: 'injected',
          priceSnapshotPath: 'injected',
          models: ['gemini-3.1-flash-lite'],
          promptPolicies: ['speech-performance-v2-inworld-tts2'],
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
          allowedModels: ['gemini-3.1-flash-lite'],
          requiredModels: ['gemini-3.1-flash-lite'],
          missingRequiredModels: [],
          allowlistReady: true,
          credentialsPresent: true,
          usageVerified: true,
          usedToday: 0,
          dailyLimit: 120,
          rpm: 4,
          remainingDailyCapacity: 120,
          plannerAttempts: 1,
          compatibilityChecks: 0,
        },
      },
    });

    expect(executeVariant).toHaveBeenCalledOnce();
    expect(run.records).toEqual([
      expect.objectContaining({
        promptedPlanStatus: 'provider_error',
        normalizedErrorCategory: 'UNAVAILABLE',
        retryAttempted: false,
      }),
    ]);
    expect(JSON.parse(readFileSync(join(runDirectory, 'run.json'), 'utf8'))).toMatchObject({
      activities: [expect.objectContaining({ providerCalls: 1 })],
    });

    const callPath = join(runDirectory, 'calls', `${variants[0]!.attemptId}.json`);
    const immutableCall = readFileSync(callPath, 'utf8');
    rmSync(callPath);
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
    ).rejects.toThrow('call-intent');
    writeFileSync(callPath, immutableCall, 'utf8');
    const tampered = JSON.parse(immutableCall) as { retryAttempted: boolean };
    tampered.retryAttempted = true;
    writeFileSync(callPath, JSON.stringify(tampered, null, 2), 'utf8');
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
    ).rejects.toThrow('call-intent');
    expect(executeVariant).toHaveBeenCalledOnce();

    writeFileSync(callPath, immutableCall, 'utf8');
    const runPath = join(runDirectory, 'run.json');
    const interruptedMetadata = JSON.parse(readFileSync(runPath, 'utf8')) as {
      status: string;
      completedAt?: string;
      activities: {
        kind: string;
        status: string;
        completedAt?: string;
        providerCalls?: number;
      }[];
    };
    interruptedMetadata.status = 'partial';
    delete interruptedMetadata.completedAt;
    interruptedMetadata.activities[0]!.status = 'partial';
    delete interruptedMetadata.activities[0]!.completedAt;
    delete interruptedMetadata.activities[0]!.providerCalls;
    writeFileSync(runPath, JSON.stringify(interruptedMetadata, null, 2), 'utf8');

    await runSpeechPlannerEvaluation({
      runDirectory,
      gitSha: 'a'.repeat(40),
      variants,
      fixtures: [fixture],
      priceSnapshot: loadSpeechPlannerPriceSnapshot(),
      executeVariant,
      resume: true,
    });
    const recovered = readSpeechPlannerEvalRunMetadata(runDirectory);
    expect(recovered.status).toBe('completed');
    expect(recovered.activities[0]).toMatchObject({
      kind: 'planner_initial',
      status: 'interrupted',
      providerCalls: 1,
      normalizedErrorCategory: 'interrupted_before_resume',
    });
    expect(executeVariant).toHaveBeenCalledOnce();
  });
});
