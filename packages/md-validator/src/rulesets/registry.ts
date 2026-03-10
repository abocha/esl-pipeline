import type { MarkdownValidationIssue } from '@esl-pipeline/contracts';

import type { RulesetResolution, ValidationRulesetDefinition } from '../rules/types.js';
import { validateGeneralEnglishRuleset } from './general-english/v1.js';

interface RulesetResolutionInput {
  learningPresetId?: string | null;
  learningPresetVersion?: string | null;
}

const GENERAL_ENGLISH_RULESET: ValidationRulesetDefinition = {
  id: 'general-english',
  version: 'v1',
  track: 'general-english',
  title: 'General English',
  baseRulesetId: 'base-v1',
  run: async (input) =>
    validateGeneralEnglishRuleset({
      context: input.context,
      strict: input.strict,
      path: input.path,
    }),
};

const RULESET_REGISTRY = new Map<string, ValidationRulesetDefinition>([
  [GENERAL_ENGLISH_RULESET.id, GENERAL_ENGLISH_RULESET],
]);

const RULESET_ALIAS_REGISTRY = new Map<string, string>([
  ['general-english-intensive', GENERAL_ENGLISH_RULESET.id],
]);

function resolveRulesetByLearningPresetId(
  requestedId: string,
): ValidationRulesetDefinition | undefined {
  const direct = RULESET_REGISTRY.get(requestedId);
  if (direct) return direct;

  const aliasTarget = RULESET_ALIAS_REGISTRY.get(requestedId);
  if (aliasTarget) return RULESET_REGISTRY.get(aliasTarget);

  // Current learning-preset catalog variants for the General English track
  // are prefixed by the base track id (for example "general-english-*").
  if (requestedId.startsWith(`${GENERAL_ENGLISH_RULESET.id}-`)) {
    return GENERAL_ENGLISH_RULESET;
  }

  return undefined;
}

function issueForUnknownPreset(
  requestedId: string,
  fallbackRuleset: ValidationRulesetDefinition,
): MarkdownValidationIssue {
  return {
    code: 'ruleset.unknown_preset_fallback',
    ruleId: 'ruleset-resolution',
    severity: 'warning',
    message: `Unknown learning preset "${requestedId}". Falling back to ${fallbackRuleset.id}@${fallbackRuleset.version}.`,
    category: 'contract',
    blockingInStrict: false,
  };
}

function issueForUnknownVersion(
  requestedVersion: string,
  fallbackRuleset: ValidationRulesetDefinition,
): MarkdownValidationIssue {
  return {
    code: 'ruleset.unknown_version_fallback',
    ruleId: 'ruleset-resolution',
    severity: 'warning',
    message: `Unknown ruleset version "${requestedVersion}" for ${fallbackRuleset.id}. Falling back to ${fallbackRuleset.version}.`,
    category: 'contract',
    blockingInStrict: false,
  };
}

export function resolveValidationRuleset(input: RulesetResolutionInput): RulesetResolution {
  const fallbackRuleset = GENERAL_ENGLISH_RULESET;
  const requestedId = input.learningPresetId?.trim() || null;
  const requestedVersion = input.learningPresetVersion?.trim() || null;
  if (!requestedId) {
    return {
      ruleset: fallbackRuleset,
      requestedId: null,
      requestedVersion,
      fallbackApplied: false,
      issues: [],
    };
  }
  const found = resolveRulesetByLearningPresetId(requestedId);
  if (!found) {
    return {
      ruleset: fallbackRuleset,
      requestedId,
      requestedVersion,
      fallbackApplied: true,
      fallbackReason: 'unknown_preset',
      issues: [issueForUnknownPreset(requestedId, fallbackRuleset)],
    };
  }

  if (requestedVersion && requestedVersion !== found.version) {
    return {
      ruleset: found,
      requestedId,
      requestedVersion,
      fallbackApplied: true,
      fallbackReason: 'unknown_version',
      issues: [issueForUnknownVersion(requestedVersion, found)],
    };
  }

  return {
    ruleset: found,
    requestedId,
    requestedVersion,
    fallbackApplied: false,
    issues: [],
  };
}
