import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import type {
  FactEvidence,
  MemoryConfidence,
  StudentFactAuthority,
} from '../domain/lesson-memory-model.js';
import {
  getActiveProfileRevision,
  getProfileRevisionById,
} from '../domain/profile-revision-repository.js';
import { isStudentProfileCandidateRepresented } from '../domain/student-profile-candidate-model.js';
import {
  linkStudentProfileCandidatesToDraftRevision,
  listStudentProfileCandidatesByIds,
} from '../domain/student-profile-candidate-repository.js';
import {
  deriveFoundationalProfileFromMarkdown,
  type FoundationalProfile,
  renderFoundationalProfileContent,
} from './foundational-profile.js';
import {
  createGenerationRequestEnvelope,
  flattenGenerationRequestEnvelope,
} from './generation-request-envelope.js';
import {
  applyProfileCandidatePatch,
  PROFILE_CANDIDATE_PATCH_JSON_SCHEMA,
  PROFILE_CANDIDATE_PATCH_RESPONSE_SCHEMA_DESCRIPTION,
  PROFILE_CANDIDATE_PATCH_RESPONSE_SCHEMA_NAME,
  type ProfileCandidatePatch,
  validateProfileCandidatePatch,
} from './profile-candidate-patch.js';
import type { ProfileRevisionDetailResponse } from './profile-content.js';
import { saveProfileRevisionContent } from './profile-content.js';
import {
  type GenerateProfileRevisionDraftResult,
  generateProfileRevisionDraft,
  isCompleteTextGenerationFinishReason,
} from './profile-revision-drafting.js';
import { getStudentProfileById } from './student-profiles-store.js';

export interface ProfilePromotionCandidate {
  id: string;
  studentId: string;
  targetSection: string;
  fact: string;
  approvedFact?: string | null;
  category: string;
  authority: StudentFactAuthority;
  confidence: MemoryConfidence;
  evidence: FactEvidence[];
  status?: string;
  reviewState?: string;
  sourceSnapshotId?: string | null;
  sourceLessonMemoryIds?: string[];
}

export interface PromoteStudentProfileCandidatesRequest {
  studentId: string;
  candidateIds: string[];
  baseRevisionId?: string | null;
  reviewerId?: string | null;
  reviewerNote?: string | null;
  maxOutputTokens?: number;
}

export interface PromoteStudentProfileCandidatesResult {
  studentId: string;
  baseRevisionId: string | null;
  draftRevision: ProfileRevisionDetailResponse;
  includedCandidateIds: string[];
  omittedCandidates: Array<{ candidateId: string; reason: string }>;
  provider: GenerateProfileRevisionDraftResult['provider'];
  model: GenerateProfileRevisionDraftResult['model'];
  providerRequestId?: string;
  usage?: GenerateProfileRevisionDraftResult['usage'];
}

interface ProfileCandidatePromotionDependencies {
  config: BatchBackendConfig;
  students: {
    getById: typeof getStudentProfileById;
  };

  revisions: {
    getActive: typeof getActiveProfileRevision;
    getById: typeof getProfileRevisionById;
  };
  candidates: {
    listByIds: typeof listStudentProfileCandidatesByIds;
    linkToDraft: typeof linkStudentProfileCandidatesToDraftRevision;
  };
  drafting: {
    generate: typeof generateProfileRevisionDraft;
  };
  profileContent: {
    saveRevision: typeof saveProfileRevisionContent;
  };
}

export class ProfileCandidatePromotionError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = 'ProfileCandidatePromotionError';
    this.code = code;
    this.status = status;
  }
}

export async function promoteStudentProfileCandidates(args: {
  request: PromoteStudentProfileCandidatesRequest;
  overrides?: Partial<ProfileCandidatePromotionDependencies>;
}): Promise<PromoteStudentProfileCandidatesResult> {
  const dependencies = getDependencies(args.overrides);
  const request = args.request;

  if (request.candidateIds.length === 0) {
    throw new ProfileCandidatePromotionError(
      'Promotion requires an explicit non-empty candidate selection',
      'profile_candidate_selection_required',
      400,
    );
  }

  const student = await dependencies.students.getById(request.studentId, {
    config: dependencies.config,
  });
  if (!student) {
    throw new ProfileCandidatePromotionError('Student not found', 'student_not_found', 404);
  }

  const baseRevision = request.baseRevisionId
    ? await dependencies.revisions.getById(request.studentId, request.baseRevisionId)
    : await dependencies.revisions.getActive(request.studentId);
  if (request.baseRevisionId && !baseRevision) {
    throw new ProfileCandidatePromotionError(
      'Base profile revision was not found',
      'base_profile_revision_not_found',
      404,
    );
  }

  const selectedCandidates = await dependencies.candidates.listByIds(
    request.studentId,
    request.candidateIds,
  );
  validateCandidateSelection(request.studentId, request.candidateIds, selectedCandidates);

  const baseStructuredProfile =
    baseRevision?.structuredContent ??
    deriveFoundationalProfileFromMarkdown(baseRevision?.content ?? '');

  const envelope = buildPromotionEnvelope({
    studentName: student.student,
    baseStructuredProfile,
    selectedCandidates,
    reviewerNote: request.reviewerNote ?? null,
  });
  const prompt = flattenGenerationRequestEnvelope(envelope);

  const drafting = await dependencies.drafting.generate({
    request: {
      prompt,
      envelope,
      operation: 'candidate_promotion',
      maxOutputTokens:
        request.maxOutputTokens ?? dependencies.config.generation.maxOutputTokensHard,
      responseSchema: {
        name: PROFILE_CANDIDATE_PATCH_RESPONSE_SCHEMA_NAME,
        description: PROFILE_CANDIDATE_PATCH_RESPONSE_SCHEMA_DESCRIPTION,
        schema: PROFILE_CANDIDATE_PATCH_JSON_SCHEMA,
        strict: true,
      },
      validateOutput: validateProfileCandidatePatch,
    },
    overrides: {
      config: dependencies.config,
    },
  });

  assertCandidatePromotionDraftIsComplete({
    draftText: drafting.rawText,
    finishReason: drafting.finishReason,
  });

  let candidatePatch: ProfileCandidatePatch;
  try {
    candidatePatch = validateProfileCandidatePatch(drafting.structuredProfile);
  } catch (error) {
    throw new ProfileCandidatePromotionError(
      error instanceof Error ? error.message : String(error),
      'profile_candidate_patch_invalid',
      502,
    );
  }
  if (candidatePatch.operation === 'no_change') {
    throw new ProfileCandidatePromotionError(
      'No selected candidate was safe to promote; no draft revision was saved.',
      'profile_candidate_no_change',
      409,
    );
  }

  let structuredDraft: FoundationalProfile | null;
  try {
    structuredDraft = applyProfileCandidatePatch({
      baseProfile: baseStructuredProfile,
      patch: candidatePatch,
      selectedCandidates,
    });
  } catch (error) {
    throw new ProfileCandidatePromotionError(
      error instanceof Error ? error.message : String(error),
      'profile_candidate_patch_invalid',
      502,
    );
  }
  if (!structuredDraft) {
    throw new ProfileCandidatePromotionError(
      'Candidate patch did not produce a profile change; no draft revision was saved.',
      'profile_candidate_no_change',
      409,
    );
  }
  const renderedDraft = renderFoundationalProfileContent(structuredDraft);
  const appliedCandidateIds = selectedCandidates
    .filter(
      (candidate) =>
        candidatePatch.candidateIds.includes(candidate.id) &&
        isStudentProfileCandidateRepresented(structuredDraft, candidate),
    )
    .map((candidate) => candidate.id);
  if (appliedCandidateIds.length === 0) {
    throw new ProfileCandidatePromotionError(
      'No selected approved fact was represented in the completed profile.',
      'profile_candidate_no_change',
      409,
    );
  }

  const draftRevision = await dependencies.profileContent.saveRevision(
    request.studentId,
    renderedDraft,
    {
      source: 'candidate_promotion',
      status: 'draft',
      createdBy: request.reviewerId ?? null,
      dedupeByHash: false,
      structuredContent: structuredDraft,
    },
  );

  await dependencies.candidates.linkToDraft({
    studentId: request.studentId,
    candidateIds: appliedCandidateIds,
    draftRevisionId: draftRevision.id,
  });

  return {
    studentId: request.studentId,
    baseRevisionId: baseRevision?.id ?? null,
    draftRevision,
    includedCandidateIds: appliedCandidateIds,
    omittedCandidates: selectedCandidates
      .filter((candidate) => !appliedCandidateIds.includes(candidate.id))
      .map((candidate) => ({
        candidateId: candidate.id,
        reason: candidatePatch.candidateIds.includes(candidate.id)
          ? 'empty_approved_fact'
          : 'provider_omitted',
      })),
    provider: drafting.provider,
    model: drafting.model,
    ...(drafting.providerRequestId ? { providerRequestId: drafting.providerRequestId } : {}),
    ...(drafting.usage ? { usage: drafting.usage } : {}),
  };
}

function getDependencies(
  overrides?: Partial<ProfileCandidatePromotionDependencies>,
): ProfileCandidatePromotionDependencies {
  return {
    config: overrides?.config ?? loadConfig(),
    students: overrides?.students ?? {
      getById: getStudentProfileById,
    },

    revisions: overrides?.revisions ?? {
      getActive: getActiveProfileRevision,
      getById: getProfileRevisionById,
    },
    candidates: overrides?.candidates ?? {
      listByIds: listStudentProfileCandidatesByIds,
      linkToDraft: linkStudentProfileCandidatesToDraftRevision,
    },
    drafting: overrides?.drafting ?? {
      generate: generateProfileRevisionDraft,
    },
    profileContent: overrides?.profileContent ?? {
      saveRevision: saveProfileRevisionContent,
    },
  };
}

function validateCandidateSelection(
  studentId: string,
  requestedCandidateIds: string[],
  selectedCandidates: ProfilePromotionCandidate[],
): void {
  const seen = new Set<string>();
  const requested = new Set(requestedCandidateIds);

  if (selectedCandidates.length !== requestedCandidateIds.length) {
    throw new ProfileCandidatePromotionError(
      'One or more selected candidates were not found',
      'profile_candidate_not_found',
      404,
    );
  }

  for (const candidate of selectedCandidates) {
    if (!candidate.id.trim() || !requested.has(candidate.id)) {
      throw new ProfileCandidatePromotionError(
        'Candidate selection contains an item without an id',
        'profile_candidate_id_missing',
        400,
      );
    }
    if (seen.has(candidate.id)) {
      throw new ProfileCandidatePromotionError(
        'Candidate selection contains duplicate ids',
        'profile_candidate_duplicate',
        400,
      );
    }
    seen.add(candidate.id);

    if (candidate.studentId !== studentId) {
      throw new ProfileCandidatePromotionError(
        'Candidate selection must belong to the target student',
        'profile_candidate_student_mismatch',
        400,
      );
    }

    if (candidate.status && candidate.status !== 'approved') {
      throw new ProfileCandidatePromotionError(
        'Only approved candidates can be promoted',
        'profile_candidate_not_approved',
        409,
      );
    }

    if (candidate.reviewState && candidate.reviewState !== 'approved') {
      throw new ProfileCandidatePromotionError(
        'Only approved candidates can be promoted',
        'profile_candidate_not_approved',
        409,
      );
    }
  }
}

function buildPromotionEnvelope(args: {
  studentName: string;
  baseStructuredProfile: FoundationalProfile | null;
  selectedCandidates: ProfilePromotionCandidate[];
  reviewerNote: string | null;
}) {
  return createGenerationRequestEnvelope({
    workload: 'profile_candidate_patch',
    promptVersion: 'learner_memory_generation_v2',
    instructions: [
      'Decide whether selected approved candidates are safe to promote into the student profile.',
      'Return only a closed profile_candidate_patch_v1 JSON object.',
      'Use operation apply only with IDs from SELECTED_APPROVED_CANDIDATES.',
      'Use no_change with no IDs when no selected candidate should be promoted.',
      'Integrate only selected approved candidate facts. Do not invent new durable facts beyond the selected candidate set. Favor omission over invention.',
      'Do not rewrite profile fields or invent wording; the backend preserves unrelated fields and applies approved facts.',
    ].join('\n'),
    sources: [
      { id: 'student-name', label: 'STUDENT_NAME', content: args.studentName },
      {
        id: 'base-profile',
        label: 'BASE_STRUCTURED_PROFILE',
        content: args.baseStructuredProfile
          ? JSON.stringify(args.baseStructuredProfile)
          : 'Not available.',
      },
      {
        id: 'approved-candidates',
        label: 'SELECTED_APPROVED_CANDIDATES',
        content: JSON.stringify(args.selectedCandidates),
      },
      {
        id: 'reviewer-note',
        label: 'REVIEWER_NOTE',
        content: args.reviewerNote ?? 'Not available.',
      },
    ],
    responseSchema: {
      name: PROFILE_CANDIDATE_PATCH_RESPONSE_SCHEMA_NAME,
      description: PROFILE_CANDIDATE_PATCH_RESPONSE_SCHEMA_DESCRIPTION,
      schema: PROFILE_CANDIDATE_PATCH_JSON_SCHEMA,
      strict: true,
    },
  });
}

function assertCandidatePromotionDraftIsComplete(args: {
  draftText: string;
  finishReason?: string;
}): void {
  if (!isCompleteTextGenerationFinishReason(args.finishReason)) {
    throw new ProfileCandidatePromotionError(
      `Profile draft generation returned incomplete output (${args.finishReason}). No draft was saved.`,
      'profile_candidate_draft_incomplete',
      502,
    );
  }

  const draftText = args.draftText.trim();
  if (!draftText) {
    throw new ProfileCandidatePromotionError(
      'Profile draft generation returned empty output. No draft was saved.',
      'profile_candidate_draft_empty',
      502,
    );
  }
}
