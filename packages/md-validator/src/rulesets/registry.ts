import type { MarkdownValidationIssue } from '@esl-pipeline/contracts';

import type { RulesetResolution, ValidationRulesetDefinition } from '../rules/types.js';
import { validateGeneralEnglishRuleset } from './general-english/v1.js';

interface RulesetResolutionInput {
  learningPresetId?: string | null;
  learningPresetVersion?: string | null;
  preset?: string | null;
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
  const legacyPreset = input.preset?.trim() || null;

  if (!requestedId && !legacyPreset) {
    return {
      ruleset: fallbackRuleset,
      requestedId: null,
      requestedVersion,
      fallbackApplied: false,
      issues: [],
    };
  }

  if (requestedId) {
    const found = RULESET_REGISTRY.get(requestedId);
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

  return {
    ruleset: fallbackRuleset,
    requestedId: legacyPreset,
    requestedVersion,
    fallbackApplied: true,
    fallbackReason: 'legacy_preset_mapping',
    issues: [],
  };
}
