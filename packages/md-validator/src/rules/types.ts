import type { MarkdownValidationIssue, MarkdownValidationResponse } from '@esl-pipeline/contracts';

import type { ResolvedValidateInput } from '../core/input.js';

export interface RulesetExecutionInput {
  context: ResolvedValidateInput['context'];
  strict: boolean;
  path?: string;
}

export interface ValidationRulesetDefinition {
  id: string;
  version: string;
  track: string;
  title: string;
  baseRulesetId?: string;
  run: (input: RulesetExecutionInput) => Promise<MarkdownValidationResponse>;
}

export interface RulesetResolution {
  ruleset: ValidationRulesetDefinition;
  requestedId: string | null;
  requestedVersion: string | null;
  fallbackApplied: boolean;
  fallbackReason?: string;
  issues: MarkdownValidationIssue[];
}
