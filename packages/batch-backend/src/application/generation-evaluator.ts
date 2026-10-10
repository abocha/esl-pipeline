import { validateFreshAssignmentV1 } from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import { validateFoundationalProfileOutput } from './foundational-profile.js';
import {
  enforceGenerationBudgetBeforeAttempt,
  type GenerationBudgetGuardDependencies,
  recordGenerationBudgetUsageAfterSuccess,
  resolveGenerationBudgetRepository,
} from './generation-budget-guard.js';
import type { GenerationEvalFixture } from './generation-eval-fixtures.js';
import type {
  ProviderExecutionResult,
  ProviderStructuredExecutionRequest,
  ProviderStructuredExecutionResult,
} from './generation-providers.js';
import { ProviderExecutionError } from './generation-providers.js';
import {
  createGenerationRequestEnvelope,
  type GenerationRequestEnvelopeV1,
  resolveGenerationRequestText,
} from './generation-request-envelope.js';
import { validateHomeworkMemoryContent } from './homework-memory-content-schema.js';
import { validateLessonMemoryContent } from './lesson-memory-content-schema.js';
import { validateProfileCandidatePatch } from './profile-candidate-patch.js';
import { validateStudentMemorySnapshotContent } from './student-memory-snapshot-content-schema.js';

export interface StructuredEvalValidation {
  schemaValid: boolean;
  groundedClaimCoverage: number;
  invalidEvidenceSourceIds: string[];
}

export interface GenerationEvalVerdictRecord {
  fixtureId: string;
  completed: boolean;
  providerError?: string;
  schemaValid: boolean | null;
  groundedClaimCoverage: number | null;
  assignmentValidationPassed: boolean | null;
  assignmentValidationErrorCount?: number;
  injectionPassed: boolean | null;
}

export interface GenerationEvalVerdict {
  passed: boolean;
  failureReasons: Array<
    | 'provider_error'
    | 'invalid_schema'
    | 'inadequate_grounding'
    | 'assignment_validation_failed'
    | 'injection_outcome_failed'
    | 'incomplete_report'
  >;
}

export interface GenerationEvalRecord extends GenerationEvalVerdictRecord {
  workload: GenerationEvalFixture['workload'];
  requestedModel: string;
  sourceSelectionHash: string;
  templateBaseline?: {
    path: string;
    contentHash: string;
  };
  returnedModel?: string;
  providerRequestId?: string;
  finishReason?: string;
  normalizedFailureReason?: string;
  settings: GenerationRequestEnvelopeV1['settings'];
  usage: ProviderExecutionResult['usage'] | null;
  latencyMs: number | null;
  verdict: 'passed' | 'failed' | 'not_run';
  invalidEvidenceSourceIds?: string[];
}

type StructuredExecutor = (args: {
  request: ProviderStructuredExecutionRequest;
}) => Promise<ProviderStructuredExecutionResult & { model?: string }>;
/** The live CLI uses the same ledger as runtime work; fake executors stay local. */
export function createBudgetedGenerationEvalExecutor(
  config: BatchBackendConfig,
  executor: StructuredExecutor,
  overrides: GenerationBudgetGuardDependencies = {},
): StructuredExecutor {
  const repository = resolveGenerationBudgetRepository({ config, overrides });
  return async ({ request: input }) => {
    const request = {
      ...input,
      maxOutputTokens: input.maxOutputTokens ?? config.generation.maxOutputTokensHard,
    };
    if (!overrides.repository && (!config.pg.enabled || config.nodeEnv === 'test')) {
      throw new Error(
        'Live generation evaluation requires persistent PostgreSQL budget accounting outside NODE_ENV=test.',
      );
    }
    await enforceGenerationBudgetBeforeAttempt({
      config,
      provider: 'openai',
      model: request.model,
      prompt: resolveGenerationRequestText(request),
      maxOutputTokens: request.maxOutputTokens,
      now: new Date(),
      repository,
    });
    let result;
    try {
      result = await executor({ request });
    } catch (error) {
      if (error instanceof ProviderExecutionError && error.usage) {
        await recordGenerationBudgetUsageAfterSuccess({
          config,
          provider: 'openai',
          model: request.model,
          usageTotalTokens: error.usage.totalTokens,
          now: new Date(),
          repository,
        });
      }
      throw error;
    }
    await recordGenerationBudgetUsageAfterSuccess({
      config,
      provider: 'openai',
      model: request.model,
      usageTotalTokens: result.usage?.totalTokens,
      now: new Date(),
      repository,
    });
    return result;
  };
}

export function buildGenerationEvalEnvelope(
  fixture: GenerationEvalFixture,
): GenerationRequestEnvelopeV1 {
  return createGenerationRequestEnvelope({
    workload: fixture.workload,
    promptVersion: 'generation-eval-fixtures-v1',
    instructions: fixture.instructions,
    sources: fixture.sources,
    ...(fixture.responseSchema
      ? {
          responseSchema: {
            ...fixture.responseSchema,
            strict: fixture.responseSchema.strict ?? true,
          },
        }
      : {}),
  });
}

export function validateStructuredEvalOutput(
  fixture: GenerationEvalFixture,
  output: unknown,
): StructuredEvalValidation {
  try {
    validateStructuredWorkloadOutput(fixture, output);
  } catch {
    return { schemaValid: false, groundedClaimCoverage: 0, invalidEvidenceSourceIds: [] };
  }

  const referencedSourceIds = collectEvidenceSourceIds(output);
  const outputText = JSON.stringify(output).toLowerCase();
  const allowedSourceIds = new Set(fixture.sources.map((source) => source.id));
  const invalidEvidenceSourceIds = [
    ...new Set(referencedSourceIds.filter((sourceId) => !allowedSourceIds.has(sourceId))),
  ];
  const groundedClaimCoverage =
    fixture.evidenceRequirements.length === 0
      ? 1
      : fixture.evidenceRequirements.filter((requirement) => {
          const hasAllowedEvidence = referencedSourceIds.some((sourceId) =>
            requirement.allowedSourceIds.includes(sourceId),
          );
          const hasExpectedOutputFragments =
            requirement.expectedOutputFragments.length > 0 &&
            requirement.expectedOutputFragments.every((fragment) =>
              outputText.includes(fragment.toLowerCase()),
            );
          const hasNormalizedOutputAssertion =
            requirement.normalizedOutputAssertion !== undefined &&
            matchesNormalizedOutputAssertion(output, requirement.normalizedOutputAssertion);
          return hasAllowedEvidence || hasExpectedOutputFragments || hasNormalizedOutputAssertion;
        }).length / fixture.evidenceRequirements.length;

  return {
    schemaValid: true,
    groundedClaimCoverage: invalidEvidenceSourceIds.length > 0 ? 0 : groundedClaimCoverage,
    invalidEvidenceSourceIds,
  };
}

export function evaluateInjectionOutcome(
  fixture: GenerationEvalFixture,
  output: string,
): { passed: boolean; reason?: 'protected_prompt_disclosed' } {
  const normalizedOutput = output.toLowerCase();
  const disclosed = fixture.injectionExpectation?.protectedOutputFragments.some((fragment) =>
    normalizedOutput.includes(fragment.toLowerCase()),
  );
  return disclosed ? { passed: false, reason: 'protected_prompt_disclosed' } : { passed: true };
}

export function assertLiveGenerationEvalAccess(args: {
  live: boolean;
  env: Record<string, string | undefined>;
  loadEnv: () => void;
}): void {
  if (!args.live) return;
  args.loadEnv();
  if (args.env.GENERATION_LIVE_EVAL_ENABLED !== 'true') {
    throw new Error('Live generation evals require GENERATION_LIVE_EVAL_ENABLED=true.');
  }
  if (!args.env.OPENAI_API_KEY?.trim()) {
    throw new Error('Live generation evals require OPENAI_API_KEY.');
  }
}

export async function runGenerationEval(args: {
  fixtures: readonly GenerationEvalFixture[];
  live: boolean;
  structured: StructuredExecutor;
  now?: () => number;
}): Promise<{ records: GenerationEvalRecord[]; verdict: GenerationEvalVerdict }> {
  const now = args.now ?? Date.now;
  const records: GenerationEvalRecord[] = [];
  for (const fixture of args.fixtures) {
    const envelope = buildGenerationEvalEnvelope(fixture);
    const base: GenerationEvalRecord = {
      fixtureId: fixture.id,
      workload: fixture.workload,
      requestedModel: fixture.model,
      sourceSelectionHash: envelope.sourceSelectionHash,
      ...(fixture.templateBaseline ? { templateBaseline: { ...fixture.templateBaseline } } : {}),
      settings: envelope.settings,
      completed: true,
      schemaValid: null,
      groundedClaimCoverage: null,
      assignmentValidationPassed: null,
      injectionPassed: null,
      usage: null,
      latencyMs: null,
      verdict: args.live ? 'failed' : 'not_run',
    };
    if (!args.live) {
      records.push(base);
      continue;
    }

    const startedAt = now();
    try {
      if (!fixture.responseSchema) {
        throw new Error(`Structured fixture ${fixture.id} is missing its response schema.`);
      }
      const result = await args.structured({
        request: {
          model: fixture.model,
          envelope,
          responseSchema: fixture.responseSchema,
          ...(fixture.workload === 'assignment_draft'
            ? { admission: 'assignment_v1' as const }
            : {}),
        },
      });
      const validation = validateStructuredEvalOutput(fixture, result.output);
      const injection = evaluateInjectionOutcome(fixture, result.rawText);
      records.push({
        ...base,
        returnedModel: result.model,
        providerRequestId: result.providerRequestId,
        finishReason: result.finishReason,
        usage: result.usage ?? null,
        latencyMs: now() - startedAt,
        schemaValid: validation.schemaValid,
        ...(fixture.workload === 'assignment_draft'
          ? {
              assignmentValidationPassed: validation.schemaValid,
              assignmentValidationErrorCount: validation.schemaValid ? 0 : 1,
            }
          : {}),
        groundedClaimCoverage: validation.groundedClaimCoverage,
        injectionPassed: injection.passed,
        invalidEvidenceSourceIds: validation.invalidEvidenceSourceIds,
        ...(!validation.schemaValid
          ? { normalizedFailureReason: 'invalid_schema' }
          : validation.groundedClaimCoverage < 1
            ? { normalizedFailureReason: 'inadequate_grounding' }
            : !injection.passed
              ? { normalizedFailureReason: 'injection_outcome_failed' }
              : {}),
        verdict:
          validation.schemaValid &&
          validation.groundedClaimCoverage === 1 &&
          validation.invalidEvidenceSourceIds.length === 0 &&
          injection.passed
            ? 'passed'
            : 'failed',
      });
    } catch (error) {
      records.push({
        ...base,
        ...(error instanceof ProviderExecutionError
          ? {
              usage: error.usage ?? null,
              providerRequestId: error.providerRequestId,
              finishReason: error.finishReason,
            }
          : {}),
        latencyMs: now() - startedAt,
        providerError: normalizeGenerationEvalFailure(error),
        normalizedFailureReason: normalizeGenerationEvalFailure(error),
        completed: true,
        verdict: 'failed',
      });
    }
  }
  return {
    records,
    verdict: evaluateGenerationEvalVerdict({ expectedFixtures: args.fixtures.length, records }),
  };
}

export function evaluateGenerationEvalVerdict(args: {
  expectedFixtures: number;
  records: readonly GenerationEvalVerdictRecord[];
}): GenerationEvalVerdict {
  const failureReasons = new Set<GenerationEvalVerdict['failureReasons'][number]>();
  if (
    args.records.length !== args.expectedFixtures ||
    args.records.some((record) => !record.completed)
  ) {
    failureReasons.add('incomplete_report');
  }
  for (const record of args.records) {
    if (record.providerError) failureReasons.add('provider_error');
    if (record.schemaValid === false) failureReasons.add('invalid_schema');
    if (record.groundedClaimCoverage !== null && record.groundedClaimCoverage < 1) {
      failureReasons.add('inadequate_grounding');
    }
    if (record.assignmentValidationPassed === false) {
      failureReasons.add('assignment_validation_failed');
    }
    if (record.injectionPassed === false) failureReasons.add('injection_outcome_failed');
  }
  return { passed: failureReasons.size === 0, failureReasons: [...failureReasons] };
}

function validateStructuredWorkloadOutput(fixture: GenerationEvalFixture, output: unknown): void {
  switch (fixture.workload) {
    case 'lesson_memory':
      validateLessonMemoryContent(output);
      return;
    case 'homework_memory':
      validateHomeworkMemoryContent(output);
      return;
    case 'student_memory_snapshot':
      validateStudentMemorySnapshotContent(output);
      return;
    case 'profile_revision':
      validateFoundationalProfileOutput(output);
      return;
    case 'profile_candidate_patch':
      validateProfileCandidatePatch(output);
      return;
    case 'assignment_draft':
      validateFreshAssignmentV1(output, {
        studentName: 'Eval Persona One',
        inputKind: 'generate',
        suppliedUrls: [],
      });
      return;
  }
}

function collectEvidenceSourceIds(value: unknown): string[] {
  const output: string[] = [];
  visit(value, output);
  return output;
}

function matchesNormalizedOutputAssertion(
  output: unknown,
  assertion: NonNullable<
    GenerationEvalFixture['evidenceRequirements'][number]['normalizedOutputAssertion']
  >,
): boolean {
  if (!output || typeof output !== 'object') return false;
  const candidateValues = (output as Record<string, unknown>)[assertion.field];
  if (!Array.isArray(candidateValues)) return false;
  const allowedValues = new Set(assertion.allowedValues.map(normalizeEvalText));
  return candidateValues.some(
    (value) => typeof value === 'string' && allowedValues.has(normalizeEvalText(value)),
  );
}

function normalizeEvalText(value: string): string {
  return value
    .toLocaleLowerCase('en-US')
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function visit(value: unknown, output: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) visit(item, output);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const record = value as Record<string, unknown>;
  if (
    typeof record.sourceId === 'string' &&
    ('quote' in record || 'observedForm' in record || 'observedIssue' in record)
  ) {
    output.push(record.sourceId);
  }
  for (const nested of Object.values(record)) visit(nested, output);
}

function normalizeGenerationEvalFailure(error: unknown): string {
  if (!(error instanceof Error)) return 'provider_contract_error';
  const candidate = error as Error & { code?: unknown; status?: unknown };
  const code = typeof candidate.code === 'string' ? candidate.code.toLowerCase() : '';
  const status = typeof candidate.status === 'number' ? candidate.status : undefined;
  if (code === 'rate_limit_exceeded' || status === 429) return 'provider_rate_limit';
  if (status === 408 || status === 504 || (status !== undefined && status >= 500)) {
    return 'provider_timeout';
  }
  return 'provider_contract_error';
}
