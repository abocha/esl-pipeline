import { ConfigurationError } from '@esl-pipeline/contracts';

import type { PreparedStudyTextSynthesis, VoicePlan, VoicePlanAssignment } from './types.js';

export function createResolvedVoicePlan(
  prepared: PreparedStudyTextSynthesis,
  assignments: VoicePlanAssignment[],
  options: Pick<VoicePlan, 'ranker'> = {},
): VoicePlan {
  return {
    schemaVersion: 1,
    mode: 'resolved',
    provider: prepared.selection.provider,
    model: prepared.selection.model,
    sourceHash: prepared.sourceHash,
    ...options,
    assignments,
  };
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
    prepared.segments.flatMap((segment) => (segment.speaker ? [segment.speaker] : [])),
  );
  const assignedSpeakers = new Set<string>();
  for (const assignment of plan.assignments) {
    if (!sourceSpeakers.has(assignment.speaker)) {
      throw new ConfigurationError(
        `Voice plan assignment speaker "${assignment.speaker}" is not present in prepared text.`,
      );
    }
    if (assignedSpeakers.has(assignment.speaker)) {
      throw new ConfigurationError(
        `Voice plan contains duplicate assignment for speaker "${assignment.speaker}".`,
      );
    }
    assignedSpeakers.add(assignment.speaker);
  }
  return plan;
}

export function withVoicePlan(
  prepared: PreparedStudyTextSynthesis,
  voicePlan: VoicePlan,
): PreparedStudyTextSynthesis {
  const validated = validateVoicePlan(prepared, voicePlan);
  return {
    ...prepared,
    voicePlan: validated,
    voiceAssignments: Object.fromEntries(
      validated.assignments.map((assignment) => [assignment.speaker, assignment.voiceId]),
    ),
  };
}
