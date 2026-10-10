import { z } from 'zod';

import { isStudentProfileCandidateRepresented } from '../domain/student-profile-candidate-model.js';
import { type FoundationalProfile, normalizeFoundationalProfile } from './foundational-profile.js';

const CandidatePatchOperationSchema = z.enum(['apply', 'no_change']);

export const ProfileCandidatePatchSchema = z
  .object({
    operation: CandidatePatchOperationSchema,
    candidateIds: z.array(z.string().trim().min(1)),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.candidateIds).size !== value.candidateIds.length) {
      ctx.addIssue({ code: 'custom', message: 'Candidate IDs must be unique' });
    }
    if (value.operation === 'no_change' && value.candidateIds.length > 0) {
      ctx.addIssue({ code: 'custom', message: 'no_change patches must not include candidate IDs' });
    }
    if (value.operation === 'apply' && value.candidateIds.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'apply patches require at least one candidate ID' });
    }
  });

export type ProfileCandidatePatch = z.infer<typeof ProfileCandidatePatchSchema>;

export const PROFILE_CANDIDATE_PATCH_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    operation: { type: 'string', enum: ['apply', 'no_change'] },
    candidateIds: { type: 'array', items: { type: 'string', minLength: 1 } },
  },
  required: ['operation', 'candidateIds'],
} as const satisfies Record<string, unknown>;

export const PROFILE_CANDIDATE_PATCH_RESPONSE_SCHEMA_NAME = 'profile_candidate_patch_v1';
export const PROFILE_CANDIDATE_PATCH_RESPONSE_SCHEMA_DESCRIPTION =
  'Closed profile candidate decision. apply references only selected approved candidate IDs; no_change references none.';

export function validateProfileCandidatePatch(input: unknown): ProfileCandidatePatch {
  return ProfileCandidatePatchSchema.parse(input);
}

export function applyProfileCandidatePatch(args: {
  baseProfile: FoundationalProfile | null;
  patch: ProfileCandidatePatch;
  selectedCandidates: Array<{
    id: string;
    targetSection: string;
    fact: string;
    approvedFact?: string | null;
  }>;
}): FoundationalProfile | null {
  if (args.patch.operation === 'no_change') return args.baseProfile;

  const candidatesById = new Map(
    args.selectedCandidates.map((candidate) => [candidate.id, candidate]),
  );
  const invalidIds = args.patch.candidateIds.filter((id) => !candidatesById.has(id));
  if (invalidIds.length > 0) {
    throw new Error(
      `Candidate patch referenced unselected candidate IDs: ${invalidIds.join(', ')}`,
    );
  }

  const profile = normalizeFoundationalProfile(
    args.baseProfile ?? {
      schemaVersion: 'foundational_profile_v1',
      overallLevel: null,
      primaryGoals: [],
      communicationContexts: [],
      interestsAndUsefulThemes: [],
      stableStrengths: [],
      persistentChallenges: [],
      studyPreferences: [],
      durableConstraints: [],
      teacherNotes: null,
    },
  );
  for (const candidateId of args.patch.candidateIds) {
    const candidate = candidatesById.get(candidateId)!;
    const value = (candidate.approvedFact ?? candidate.fact).trim();
    if (!value) continue;
    const field = fieldForTargetSection(candidate.targetSection);
    if (!isStudentProfileCandidateRepresented(profile, candidate)) {
      profile[field].push(value);
    }
  }
  return normalizeFoundationalProfile(profile);
}

function fieldForTargetSection(
  targetSection: string,
): keyof Pick<
  FoundationalProfile,
  | 'primaryGoals'
  | 'communicationContexts'
  | 'interestsAndUsefulThemes'
  | 'stableStrengths'
  | 'persistentChallenges'
  | 'studyPreferences'
  | 'durableConstraints'
> {
  switch (targetSection) {
    case 'goals_motivation':
      return 'primaryGoals';
    case 'work_communication_context':
      return 'communicationContexts';
    case 'interests_personal_context':
      return 'interestsAndUsefulThemes';
    case 'learning_preferences_study_habits':
      return 'studyPreferences';
    case 'long_running_strengths':
      return 'stableStrengths';
    case 'persistent_challenges_constraints':
      return 'persistentChallenges';
    default:
      throw new Error(`Unsupported candidate target section: ${targetSection}`);
  }
}
