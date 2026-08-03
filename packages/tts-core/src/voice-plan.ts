import { ConfigurationError } from '@esl-pipeline/contracts';

import { getTtsModelCapabilities } from './descriptors.js';
import { normalizeStudyTextSpeakerToken } from './speech-plan.js';
import type {
  PreparedStudyTextSynthesis,
  TtsModelId,
  TtsProviderId,
  VoiceAssignmentCapabilities,
  VoicePlan,
  VoicePlanAssignment,
} from './types.js';

export function voiceAssignmentCapabilitiesForModel(
  provider: TtsProviderId,
  model: TtsModelId,
): VoiceAssignmentCapabilities {
  const capabilities = getTtsModelCapabilities(provider, model);
  return {
    supportsMetadataInstructions: capabilities.metadataInstructions === true,
    supportsNonVerbals: capabilities.nonVerbals === true,
    supportsUppercaseEmphasis: capabilities.uppercaseEmphasis === true,
    supportsFreeFormDirection: capabilities.naturalLanguageSteering === true,
  };
}

export function createResolvedVoicePlan(
  prepared: PreparedStudyTextSynthesis,
  assignments: VoicePlanAssignment[],
  options: Pick<VoicePlan, 'mode' | 'ranker' | 'fallbackReason'> = {
    mode: 'deterministic',
  },
): VoicePlan {
  return {
    schemaVersion: 1,
    capabilityPolicyVersion: 'model-scoped-v1',
    provider: prepared.selection.provider,
    model: prepared.selection.model,
    sourceHash: prepared.sourceHash,
    ...options,
    assignments,
  };
}

function capabilitySnapshotsMatch(
  actual: VoiceAssignmentCapabilities,
  expected: VoiceAssignmentCapabilities,
): boolean {
  return (
    actual.supportsMetadataInstructions === expected.supportsMetadataInstructions &&
    actual.supportsNonVerbals === expected.supportsNonVerbals &&
    actual.supportsUppercaseEmphasis === expected.supportsUppercaseEmphasis &&
    actual.supportsFreeFormDirection === expected.supportsFreeFormDirection
  );
}

function assertCapabilitySnapshotsMatch(
  assignments: VoicePlanAssignment[],
  expected: VoiceAssignmentCapabilities,
): void {
  const contradictory = assignments.find(
    (assignment) => !capabilitySnapshotsMatch(assignment.capabilities, expected),
  );
  if (contradictory) {
    throw new ConfigurationError(
      `Voice plan assignment for speaker "${contradictory.speaker}" contradicts model-scoped capabilities.`,
    );
  }
}

export function validateVoicePlan(
  prepared: PreparedStudyTextSynthesis,
  plan: VoicePlan,
): VoicePlan {
  if (plan.schemaVersion !== 1) {
    throw new ConfigurationError(`Unsupported voice plan schema version "${plan.schemaVersion}".`);
  }
  if (
    plan.provider !== prepared.selection.provider ||
    plan.model !== prepared.selection.model ||
    plan.sourceHash !== prepared.sourceHash
  ) {
    throw new ConfigurationError(
      'Voice plan selection or source hash does not match prepared text.',
    );
  }

  const sourceSpeakers = new Set(
    [
      ...prepared.segments.flatMap((segment) => (segment.speaker ? [segment.speaker] : [])),
      ...(prepared.speakerLabels ?? []),
    ]
      .map((speaker) => normalizeStudyTextSpeakerToken(speaker)?.toLocaleLowerCase())
      .filter((key): key is string => key !== undefined),
  );
  const assignedSpeakers = new Set<string>();
  for (const assignment of plan.assignments) {
    const speakerKey = normalizeStudyTextSpeakerToken(assignment.speaker)?.toLocaleLowerCase();
    if (!speakerKey || !sourceSpeakers.has(speakerKey)) {
      throw new ConfigurationError(
        `Voice plan assignment speaker "${assignment.speaker}" is not present in prepared text.`,
      );
    }
    if (assignedSpeakers.has(speakerKey)) {
      throw new ConfigurationError(
        `Voice plan contains duplicate assignment for speaker "${assignment.speaker}".`,
      );
    }
    assignedSpeakers.add(speakerKey);
  }
  return plan;
}

export function resolveVoicePlanForExecution(
  prepared: PreparedStudyTextSynthesis,
  plan: VoicePlan,
): VoicePlan {
  const validated = validateVoicePlan(prepared, plan);
  const expected = voiceAssignmentCapabilitiesForModel(validated.provider, validated.model);
  if (validated.capabilityPolicyVersion === 'model-scoped-v1') {
    assertCapabilitySnapshotsMatch(validated.assignments, expected);
    return validated;
  }
  if (validated.provider !== 'inworld') return validated;

  let changed = false;
  const assignments = validated.assignments.map((assignment) => {
    if (capabilitySnapshotsMatch(assignment.capabilities, expected)) return assignment;
    changed = true;
    return { ...assignment, capabilities: expected };
  });
  return changed ? { ...validated, assignments } : validated;
}

export function withVoicePlan(
  prepared: PreparedStudyTextSynthesis,
  voicePlan: VoicePlan,
): PreparedStudyTextSynthesis {
  const validated = resolveVoicePlanForExecution(prepared, voicePlan);
  return {
    ...prepared,
    voicePlan: validated,
    voiceAssignments: Object.fromEntries(
      validated.assignments.map((assignment) => [assignment.speaker, assignment.voiceId]),
    ),
  };
}
