import type {
  MarkdownValidationResponse,
  MarkdownValidationRuleSetInfo,
} from '@esl-pipeline/contracts';

import { resolveValidateInput, type ValidateMarkdownInput } from './core/input.js';
import { buildIssuesFromLegacyMessages, mergeIssues, withRulesetMetadata } from './core/result.js';
import { executeRuleset } from './rules/engine.js';
import { resolveValidationRuleset } from './rulesets/registry.js';

export interface ValidateOptions {
  strict?: boolean;
  /**
   * @deprecated Use validateMarkdown with `{ markdown: ... }` or `{ context: ... }`.
   */
  content?: string;
}

export type ValidateResult = MarkdownValidationResponse;

function buildRulesetInfo(input: {
  id: string;
  version: string;
  requestedId: string | null;
  requestedVersion: string | null;
  fallbackApplied: boolean;
  fallbackReason?: string;
}): MarkdownValidationRuleSetInfo {
  return {
    id: input.id,
    version: input.version,
    requestedId: input.requestedId,
    requestedVersion: input.requestedVersion,
    fallbackApplied: input.fallbackApplied,
    ...(input.fallbackReason ? { fallbackReason: input.fallbackReason } : {}),
  };
}

export async function validateMarkdown(input: ValidateMarkdownInput): Promise<ValidateResult> {
  let resolvedInput;
  try {
    resolvedInput = await resolveValidateInput(input);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      errors: [message],
      warnings: [],
      issues: [
        {
          code: 'validation.input_resolution_failed',
          ruleId: 'input-resolution',
          severity: 'error',
          message,
          category: 'runtime',
          blockingInStrict: true,
        },
      ],
    };
  }

  const rulesetResolution = resolveValidationRuleset({
    learningPresetId: resolvedInput.learningPresetId,
    learningPresetVersion: resolvedInput.learningPresetVersion,
  });

  const rulesetResult = await executeRuleset(rulesetResolution.ruleset, {
    context: resolvedInput.context,
    strict: resolvedInput.strict,
    path: resolvedInput.path,
  });

  const legacyPayload = {
    errors: [...(rulesetResult.errors ?? [])],
    warnings: [...(rulesetResult.warnings ?? [])],
  };

  // Build legacy-derived issues from pre-resolution payload to avoid duplicating
  // canonical ruleset-resolution issues in `issues`.
  const legacyIssues = buildIssuesFromLegacyMessages(legacyPayload);
  const issues = mergeIssues(legacyIssues, rulesetResolution.issues);
  const hasExplicitErrors = rulesetResolution.issues.some((issue) => issue.severity === 'error');

  const response: MarkdownValidationResponse = {
    ...rulesetResult,
    ok: hasExplicitErrors ? false : rulesetResult.ok,
    errors: legacyPayload.errors,
    warnings: legacyPayload.warnings,
  };

  return withRulesetMetadata(
    response,
    buildRulesetInfo({
      id: rulesetResolution.ruleset.id,
      version: rulesetResolution.ruleset.version,
      requestedId: rulesetResolution.requestedId,
      requestedVersion: rulesetResolution.requestedVersion,
      fallbackApplied: rulesetResolution.fallbackApplied,
      fallbackReason: rulesetResolution.fallbackReason,
    }),
    issues,
  );
}

export type { ValidateMarkdownInput } from './core/input.js';
