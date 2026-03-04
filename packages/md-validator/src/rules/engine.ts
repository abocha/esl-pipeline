import type { MarkdownValidationResponse } from '@esl-pipeline/contracts';

import type { RulesetExecutionInput, ValidationRulesetDefinition } from './types.js';

export async function executeRuleset(
  ruleset: ValidationRulesetDefinition,
  input: RulesetExecutionInput,
): Promise<MarkdownValidationResponse> {
  return ruleset.run(input);
}
