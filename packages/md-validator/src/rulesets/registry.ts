import type { MarkdownValidationIssue } from '@esl-pipeline/contracts';

import type { RulesetResolution, ValidationRulesetDefinition } from '../rules/types.js';
import { validateGeneralEnglishRuleset } from './general-english/v1.js';
import { validateGeneralEnglishV2Ruleset } from './general-english/v2.js';

interface RulesetResolutionInput {
  learningPresetId?: string | null;
  learningPresetVersion?: string | null;
}

const GENERAL_ENGLISH_V1_RULESET: ValidationRulesetDefinition = {
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

const GENERAL_ENGLISH_V2_RULESET: ValidationRulesetDefinition = {
  id: 'general-english',
  version: 'v2',
  track: 'general-english',
  title: 'General English',
  baseRulesetId: 'base-v1',
  run: async (input) =>
    validateGeneralEnglishV2Ruleset({
      context: input.context,
      strict: input.strict,
      path: input.path,
    }),
};

const DEFAULT_GENERAL_ENGLISH_RULESET = GENERAL_ENGLISH_V2_RULESET;

const RULESET_REGISTRY = new Map<string, Map<string, ValidationRulesetDefinition>>([
  [
    GENERAL_ENGLISH_V1_RULESET.id,
    new Map([
      [GENERAL_ENGLISH_V1_RULESET.version, GENERAL_ENGLISH_V1_RULESET],
      [GENERAL_ENGLISH_V2_RULESET.version, GENERAL_ENGLISH_V2_RULESET],
    ]),
  ],
]);

const RULESET_ALIAS_REGISTRY = new Map<string, string>([
  ['general-english-intensive', DEFAULT_GENERAL_ENGLISH_RULESET.id],
]);

function resolveRulesetByLearningPresetId(
  requestedId: string,
): Map<string, ValidationRulesetDefinition> | undefined {
  const direct = RULESET_REGISTRY.get(requestedId);
  if (direct) return direct;

  const aliasTarget = RULESET_ALIAS_REGISTRY.get(requestedId);
  if (aliasTarget) return RULESET_REGISTRY.get(aliasTarget);

  // Current learning-preset catalog variants for the General English track
  // are prefixed by the base track id (for example "general-english-*").
  if (requestedId.startsWith(`${DEFAULT_GENERAL_ENGLISH_RULESET.id}-`)) {
    return RULESET_REGISTRY.get(DEFAULT_GENERAL_ENGLISH_RULESET.id);
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
  const fallbackRuleset = DEFAULT_GENERAL_ENGLISH_RULESET;
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
  const foundVersions = resolveRulesetByLearningPresetId(requestedId);
  if (!foundVersions) {
    return {
      ruleset: fallbackRuleset,
      requestedId,
      requestedVersion,
      fallbackApplied: true,
      fallbackReason: 'unknown_preset',
      issues: [issueForUnknownPreset(requestedId, fallbackRuleset)],
    };
  }

  const found = requestedVersion ? foundVersions.get(requestedVersion) : fallbackRuleset;
  if (!found) {
    return {
      ruleset: fallbackRuleset,
      requestedId,
      requestedVersion,
      fallbackApplied: true,
      fallbackReason: 'unknown_version',
      issues: [issueForUnknownVersion(requestedVersion!, fallbackRuleset)],
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
