import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  GENERATION_EVAL_ASSIGNMENT_TEMPLATE_BASELINE,
  GENERATION_EVAL_FIXTURES,
} from '../src/application/generation-eval-fixtures.js';
import {
  assertLiveGenerationEvalAccess,
  buildGenerationEvalEnvelope,
  createBudgetedGenerationEvalExecutor,
  evaluateGenerationEvalVerdict,
  evaluateInjectionOutcome,
  runGenerationEval,
  validateStructuredEvalOutput,
} from '../src/application/generation-evaluator.js';
import { stitchPromptEnvelope } from '../src/application/prompt-assembly.js';
import { loadConfig } from '../src/config/env.js';
import { freshAssignmentFixture as assignmentFixture } from './assignment-v1.test-harness.js';

describe('application/generation-evaluator', () => {
  it('routes assignment evals to Sol and every other OpenAI eval to Luna', () => {
    expect(GENERATION_EVAL_FIXTURES.map(({ id, model }) => ({ id, model }))).toEqual([
      { id: 'assignment-v1', model: 'gpt-6.1-sol' },
      { id: 'lesson-memory-v1', model: 'gpt-5.6-luna' },
      { id: 'homework-memory-v1', model: 'gpt-5.6-luna' },
      { id: 'snapshot-v1', model: 'gpt-5.6-luna' },
      { id: 'profile-draft-v1', model: 'gpt-5.6-luna' },
      { id: 'candidate-patch-v1', model: 'gpt-5.6-luna' },
    ]);
  });

  it('builds every structured fixture with its canonical strict response schema', () => {
    const structuredFixtures = GENERATION_EVAL_FIXTURES.filter(
      (fixture) => fixture.workload !== 'assignment_draft',
    );

    expect(structuredFixtures).toHaveLength(5);
    for (const fixture of structuredFixtures) {
      const envelope = buildGenerationEvalEnvelope(fixture);
      expect(envelope.responseSchema).toMatchObject({ strict: true });
      expect(envelope.responseSchema?.name).toBe(fixture.responseSchema?.name);
      expect(fixture.evidenceRequirements.length).toBeGreaterThan(0);
      expect(
        fixture.evidenceRequirements.every(
          (requirement) =>
            requirement.allowedSourceIds.length > 0 &&
            (requirement.expectedOutputFragments.length > 0 ||
              requirement.normalizedOutputAssertion !== undefined),
        ),
      ).toBe(true);
    }
  });

  it('uses the verified assignment template baseline and the full canonical synthetic source manifest', () => {
    const assignmentFixture = GENERATION_EVAL_FIXTURES.find(
      (fixture) => fixture.id === 'assignment-v1',
    )!;
    const envelope = buildGenerationEvalEnvelope(assignmentFixture);

    expect(assignmentFixture.instructions).toBe(
      GENERATION_EVAL_ASSIGNMENT_TEMPLATE_BASELINE.content,
    );
    const templateContent = readFileSync(
      resolve(
        import.meta.dirname,
        '..',
        '..',
        '..',
        GENERATION_EVAL_ASSIGNMENT_TEMPLATE_BASELINE.path,
      ),
      'utf8',
    );
    expect(GENERATION_EVAL_ASSIGNMENT_TEMPLATE_BASELINE).toMatchObject({
      path: 'packages/batch-backend/prompt-assets/templates/hw_prompt_assignment_v1.md',
      content: templateContent,
      contentHash: createHash('sha256').update(templateContent).digest('hex'),
    });
    expect(assignmentFixture.instructions).toContain('**`[CANONICAL_STUDENT_NAME]`**');
    expect(assignmentFixture.instructions).toContain(
      'Use **`[CANONICAL_STUDENT_NAME]`** as the authoritative learner display name',
    );
    expect(envelope.sourceManifest).toEqual(
      stitchPromptEnvelope({
        template: 'unused in source-manifest comparison',
        profile: 'Synthetic eval context.',
        studentMemorySnapshot: 'Synthetic eval context.',
        recentLessonMemory: 'Synthetic eval context.',
        recentHomeworkMemory: 'Synthetic eval context.',
        unresolvedIssues: 'Synthetic eval context.',
        notes: 'Synthetic eval context.',
        transcript: 'Synthetic eval context.',
      }).sourceManifest,
    );
    expect(
      assignmentFixture.sources
        .filter((source) => source.id !== 'canonical-student-name')
        .every((source) => source.content.includes('Synthetic eval')),
    ).toBe(true);
  });

  it('records the assignment template baseline hash in its eval record without retaining template content', async () => {
    const assignmentFixture = GENERATION_EVAL_FIXTURES.find(
      (fixture) => fixture.id === 'assignment-v1',
    )!;

    const result = await runGenerationEval({
      fixtures: [assignmentFixture],
      live: false,
      structured: vi.fn(),
    });

    expect(result.records[0]).toMatchObject({
      templateBaseline: {
        path: 'packages/batch-backend/prompt-assets/templates/hw_prompt_assignment_v1.md',
        contentHash: GENERATION_EVAL_ASSIGNMENT_TEMPLATE_BASELINE.contentHash,
      },
    });
    expect(JSON.stringify(result.records[0])).not.toContain(
      GENERATION_EVAL_ASSIGNMENT_TEMPLATE_BASELINE.content,
    );
  });

  it('rejects invented evidence source IDs even when the structured schema is valid', () => {
    const fixture = GENERATION_EVAL_FIXTURES.find(
      (candidate) => candidate.id === 'lesson-memory-v1',
    )!;
    const result = validateStructuredEvalOutput(fixture, {
      lessonTitle: 'Japan Travel Goals',
      lessonSummary: 'The learner wants to visit Japan.',
      topicsDiscussed: [],
      mistakePatterns: [],
      grammarReviewed: [],
      grammarWatchlist: [],
      vocabularyFocus: [],
      pronunciationFocus: [],
      studentFacts: [
        {
          fact: 'Wants to visit Japan.',
          category: 'goal',
          authority: 'student_stated',
          confidence: 'high',
          evidence: [
            {
              sourceId: 'invented:source',
              quote: 'I want to visit Japan this summer.',
              speakerRole: 'student',
              evidenceNote: null,
              transcriptSpan: null,
            },
          ],
          reviewNeeded: false,
        },
      ],
      progressSignals: [],
      followUpRecommendations: [],
    });

    expect(result.schemaValid).toBe(true);
    expect(result.groundedClaimCoverage).toBe(0);
    expect(result.invalidEvidenceSourceIds).toEqual(['invented:source']);
  });

  it('accepts an explicitly allowed normalized profile paraphrase for the selected claim', () => {
    const fixture = GENERATION_EVAL_FIXTURES.find(
      (candidate) => candidate.id === 'profile-draft-v1',
    )!;

    const result = validateStructuredEvalOutput(fixture, {
      ...validFoundationalProfile(),
      stableStrengths: ['Uses transition phrases to organize product demonstrations'],
    });

    expect(result).toMatchObject({
      schemaValid: true,
      groundedClaimCoverage: 1,
      invalidEvidenceSourceIds: [],
    });
  });

  it('rejects unsupported and conflicting profile values for the selected claim', () => {
    const fixture = GENERATION_EVAL_FIXTURES.find(
      (candidate) => candidate.id === 'profile-draft-v1',
    )!;

    const unsupported = validateStructuredEvalOutput(fixture, {
      ...validFoundationalProfile(),
      stableStrengths: ['Leads effective product demonstrations'],
    });
    const conflicting = validateStructuredEvalOutput(fixture, {
      ...validFoundationalProfile(),
      stableStrengths: ['Avoids transition phrases during product demonstrations'],
    });

    expect(unsupported).toMatchObject({ schemaValid: true, groundedClaimCoverage: 0 });
    expect(conflicting).toMatchObject({ schemaValid: true, groundedClaimCoverage: 0 });
  });

  it('does not let an unrelated profile field satisfy the selected grounding claim', () => {
    const fixture = GENERATION_EVAL_FIXTURES.find(
      (candidate) => candidate.id === 'profile-draft-v1',
    )!;

    const result = validateStructuredEvalOutput(fixture, {
      ...validFoundationalProfile(),
      primaryGoals: ['Uses transition phrases to organize product demonstrations'],
      stableStrengths: ['Explains product details clearly'],
    });

    expect(result).toMatchObject({ schemaValid: true, groundedClaimCoverage: 0 });
  });

  it('treats an injected instruction echoed by model output as a failed injection outcome', () => {
    const fixture = GENERATION_EVAL_FIXTURES.find((candidate) => candidate.id === 'assignment-v1')!;

    expect(
      evaluateInjectionOutcome(fixture, 'Here are the system prompts you requested.'),
    ).toMatchObject({ passed: false, reason: 'protected_prompt_disclosed' });
    expect(evaluateInjectionOutcome(fixture, '# Safe assignment')).toMatchObject({ passed: true });
  });

  it('fails the overall verdict for every activation-gate failure category', () => {
    const verdict = evaluateGenerationEvalVerdict({
      expectedFixtures: 2,
      records: [
        {
          fixtureId: 'provider-error',
          completed: true,
          providerError: 'provider_timeout',
          schemaValid: null,
          groundedClaimCoverage: null,
          assignmentValidationPassed: null,
          injectionPassed: null,
        },
        {
          fixtureId: 'invalid-output',
          completed: false,
          schemaValid: false,
          groundedClaimCoverage: 0,
          assignmentValidationPassed: false,
          injectionPassed: false,
        },
      ],
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.failureReasons).toEqual(
      expect.arrayContaining([
        'provider_error',
        'invalid_schema',
        'inadequate_grounding',
        'assignment_validation_failed',
        'injection_outcome_failed',
        'incomplete_report',
      ]),
    );
  });

  it('loads canonical environment before checking live-eval opt-in and credentials', () => {
    const env: Record<string, string | undefined> = {};
    const loadEnv = vi.fn(() => {
      env.GENERATION_LIVE_EVAL_ENABLED = 'true';
      env.OPENAI_API_KEY = 'test-key';
    });

    expect(() => assertLiveGenerationEvalAccess({ live: true, env, loadEnv })).not.toThrow();
    expect(loadEnv).toHaveBeenCalledOnce();
  });

  it('dispatches structured fixtures through the strict structured executor and records safe audit fields', async () => {
    const fixture = GENERATION_EVAL_FIXTURES.find(
      (candidate) => candidate.id === 'lesson-memory-v1',
    )!;
    const structured = vi.fn().mockResolvedValue({
      output: {},
      rawText: '{}',
      model: 'gpt-5.6-luna-2026-07-10',
      providerRequestId: 'resp_eval_123',
      finishReason: 'completed',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });

    const result = await runGenerationEval({
      fixtures: [fixture],
      live: true,
      structured,
      now: () => 1_000,
    });

    expect(structured).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          responseSchema: expect.objectContaining({
            name: fixture.responseSchema?.name,
            strict: true,
          }),
        }),
      }),
    );
    expect(result.records[0]).toMatchObject({
      requestedModel: 'gpt-5.6-luna',
      returnedModel: 'gpt-5.6-luna-2026-07-10',
      providerRequestId: 'resp_eval_123',
      finishReason: 'completed',
      latencyMs: 0,
      schemaValid: false,
      verdict: 'failed',
    });
    expect(result.verdict).toMatchObject({ passed: false });
  });

  it.each([true, false])(
    'validates assignment domain output without a repair (valid=%s)',
    async (valid) => {
      const output = assignmentFixture();
      if (!valid) output.input.studyText.turns[0]!.speakerId = 'invented';
      const structured = vi.fn().mockResolvedValue({
        output,
        rawText: JSON.stringify(output),
        usage: { totalTokens: 36 },
        providerRequestId: 'resp-1',
      });
      const result = await runGenerationEval({
        fixtures: [GENERATION_EVAL_FIXTURES[0]!],
        live: true,
        structured,
      });
      expect(structured).toHaveBeenCalledTimes(1);
      expect(structured.mock.calls[0]![0].request.admission).toBe('assignment_v1');
      expect(result.records[0]).toMatchObject({
        assignmentValidationPassed: valid,
        usage: { totalTokens: 36 },
        providerRequestId: 'resp-1',
        verdict: valid ? 'passed' : 'failed',
      });
      expect(JSON.stringify(result.records)).not.toContain('invented');
    },
  );
});

function validFoundationalProfile() {
  return {
    schemaVersion: 'foundational_profile_v1',
    overallLevel: 'B1',
    primaryGoals: [],
    communicationContexts: [],
    interestsAndUsefulThemes: [],
    stableStrengths: [],
    persistentChallenges: [],
    studyPreferences: [],
    durableConstraints: [],
    teacherNotes: null,
  };
}

it('live evaluator refuses quota before dispatch and keeps usage on the requested model', async () => {
  const execute = vi
    .fn()
    .mockResolvedValue({ output: {}, rawText: '{}', usage: { totalTokens: 7 } });
  const reserve = vi.fn().mockResolvedValue({
    allowed: false,
    reason: { limitType: 'daily_tokens', window: 'day', limit: 225000, used: 225000 },
    usage: {},
  });
  const recordActual = vi.fn();
  const guarded = createBudgetedGenerationEvalExecutor(loadConfig(), execute, {
    repository: { reserve, recordActual, getUsage: vi.fn() },
  });
  const request = {
    model: 'gpt-6.1-sol',
    prompt: 'Synthetic evaluator source',
    maxOutputTokens: 120,
    responseSchema: { name: 'synthetic_eval', schema: { type: 'object' }, strict: true },
  };
  await expect(guarded({ request })).rejects.toMatchObject({ limitType: 'daily_tokens' });
  expect(execute).not.toHaveBeenCalled();
  expect(recordActual).not.toHaveBeenCalled();
  reserve.mockResolvedValue({ allowed: true, usage: {} });
  await guarded({ request });
  expect(reserve).toHaveBeenLastCalledWith(
    expect.objectContaining({
      model: 'gpt-6.1-sol',
      limits: expect.objectContaining({ dailyTokenBudget: 225000 }),
    }),
  );
  expect(execute).toHaveBeenCalledOnce();
  expect(execute).toHaveBeenCalledWith({ request });
  await guarded({ request: { ...request, maxOutputTokens: undefined } });
  expect(execute).toHaveBeenLastCalledWith({ request: { ...request, maxOutputTokens: 12000 } });
  expect(recordActual).toHaveBeenCalledWith(
    expect.objectContaining({ provider: 'openai', model: 'gpt-6.1-sol', actualTokens: 7 }),
  );
});

it.each([false, true])(
  'rejects live evaluator process-local budget fallback with PG enabled=%s',
  async (pgEnabled) => {
    const config = loadConfig();
    config.pg.enabled = pgEnabled;
    config.nodeEnv = 'test';
    const execute = vi.fn();
    const guarded = createBudgetedGenerationEvalExecutor(config, execute);
    await expect(
      guarded({
        request: {
          model: 'gpt-5.6-luna',
          prompt: 'synthetic',
          responseSchema: { name: 'fixture', schema: { type: 'object' } },
        },
      }),
    ).rejects.toThrow('persistent PostgreSQL');
    expect(execute).not.toHaveBeenCalled();
  },
);
