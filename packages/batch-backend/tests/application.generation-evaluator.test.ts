import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { validateMarkdown } from '@esl-pipeline/md-validator';

import {
  GENERATION_EVAL_ASSIGNMENT_TEMPLATE_BASELINE,
  GENERATION_EVAL_FIXTURES,
} from '../src/application/generation-eval-fixtures.js';
import {
  assertLiveGenerationEvalAccess,
  buildGenerationEvalEnvelope,
  evaluateAssignmentWithBoundedRepair,
  evaluateGenerationEvalVerdict,
  evaluateInjectionOutcome,
  runGenerationEval,
  validateStructuredEvalOutput,
} from '../src/application/generation-evaluator.js';
import { stitchPromptEnvelope } from '../src/application/prompt-assembly.js';

describe('application/generation-evaluator', () => {
  it('routes assignment evals to Sol and every other OpenAI eval to Luna', () => {
    expect(GENERATION_EVAL_FIXTURES.map(({ id, model }) => ({ id, model }))).toEqual([
      { id: 'assignment-v1', model: 'gpt-5.6-sol' },
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
      path: 'docs/prompt-gallery/templates/hw_prompt_definitive.md',
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
      assignmentFixture.sources.every((source) => source.content.includes('Synthetic eval')),
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
      assignment: vi.fn(),
    });

    expect(result.records[0]).toMatchObject({
      templateBaseline: {
        path: 'docs/prompt-gallery/templates/hw_prompt_definitive.md',
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

  it('uses md-validator and allows exactly one repair request', async () => {
    const validator = vi.fn(validateMarkdown);
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ text: '# Goal\n\nBroken assignment' })
      .mockResolvedValueOnce({ text: '# Self-check\n\nStill incomplete' });

    const result = await evaluateAssignmentWithBoundedRepair({
      fixture: GENERATION_EVAL_FIXTURES[0]!,
      generate,
      validator,
    });

    expect(generate).toHaveBeenCalledTimes(2);
    expect(validator).toHaveBeenCalledTimes(2);
    expect(validator).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        strict: true,
        learningPresetId: 'general-english',
        learningPresetVersion: 'v2',
      }),
    );
    expect(validator).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        strict: true,
        learningPresetId: 'general-english',
        learningPresetVersion: 'v2',
      }),
    );
    expect(result.validationPassed).toBe(false);
    expect(result.repairAttempted).toBe(true);
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
      assignment: vi.fn(),
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

  it('records a privacy-safe reason and repair count when assignment validation still fails', async () => {
    const assignment = vi
      .fn()
      .mockResolvedValueOnce({ text: '# Goal\n\nBroken assignment' })
      .mockResolvedValueOnce({ text: '# Self-check\n\nStill incomplete' });

    const result = await runGenerationEval({
      fixtures: [GENERATION_EVAL_FIXTURES[0]!],
      live: true,
      structured: vi.fn(),
      assignment,
    });

    expect(result.records[0]).toMatchObject({
      assignmentValidationPassed: false,
      assignmentRepairAttempted: true,
      assignmentValidationErrorCount: expect.any(Number),
      normalizedFailureReason: 'assignment_validation_failed',
      verdict: 'failed',
    });
    expect(result.records[0]?.assignmentValidationErrorCount).toBeGreaterThan(0);
    expect(assignment).toHaveBeenCalledTimes(2);
  });
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
