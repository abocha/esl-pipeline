import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import type { FactEvidence, MemoryConfidence, StudentFactAuthority } from '../domain/lesson-memory-model.js';
import { getProfileById } from '../domain/profile-repository.js';
import {
  getActiveProfileRevision,
  getProfileRevisionById,
} from '../domain/profile-revision-repository.js';
import {
  linkStudentProfileCandidatesToDraftRevision,
  listStudentProfileCandidatesByIds,
} from '../domain/student-profile-candidate-repository.js';
import type { ProfileRevisionDetailResponse } from './profile-content.js';
import { saveProfileRevisionContent } from './profile-content.js';
import {
  generateProfileRevisionDraft,
  type GenerateProfileRevisionDraftResult,
} from './profile-revision-drafting.js';
import { getStudentProfileById } from './student-profiles-store.js';

const DEFAULT_PROMOTION_MAX_OUTPUT_TOKENS = 2_400;

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
  profileId?: string | null;
  reviewerId?: string | null;
  reviewerNote?: string | null;
  maxOutputTokens?: number;
}

export interface PromoteStudentProfileCandidatesResult {
  studentId: string;
  profileId: string;
  baseRevisionId: string | null;
  draftRevision: ProfileRevisionDetailResponse;
  includedCandidateIds: string[];
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
  profiles: {
    getById: typeof getProfileById;
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

  const profileId = request.profileId ?? student.profileId;
  if (!profileId) {
    throw new ProfileCandidatePromotionError(
      'Student does not have a bound profile for promotion',
      'profile_not_bound',
      409,
    );
  }

  const profile = await dependencies.profiles.getById(profileId);
  if (!profile) {
    throw new ProfileCandidatePromotionError('Profile not found', 'profile_not_found', 404);
  }

  const baseRevision = request.baseRevisionId
    ? await dependencies.revisions.getById(profileId, request.baseRevisionId)
    : await dependencies.revisions.getActive(profileId);
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

  const prompt = buildPromotionPrompt({
    studentName: student.student,
    baseProfileContent: baseRevision?.content ?? '',
    selectedCandidates,
    reviewerNote: request.reviewerNote ?? null,
  });

  const drafting = await dependencies.drafting.generate({
    request: {
      prompt,
      operation: 'candidate_promotion',
      maxOutputTokens: request.maxOutputTokens ?? DEFAULT_PROMOTION_MAX_OUTPUT_TOKENS,
    },
    overrides: {
      config: dependencies.config,
    },
  });

  const draftRevision = await dependencies.profileContent.saveRevision(
    profileId,
    drafting.text.trim(),
    {
      source: 'candidate_promotion',
      status: 'draft',
      createdBy: request.reviewerId ?? null,
      dedupeByHash: false,
    },
  );

  await dependencies.candidates.linkToDraft({
    studentId: request.studentId,
    candidateIds: selectedCandidates.map((candidate) => candidate.id),
    draftRevisionId: draftRevision.id,
  });

  return {
    studentId: request.studentId,
    profileId,
    baseRevisionId: baseRevision?.id ?? null,
    draftRevision,
    includedCandidateIds: selectedCandidates.map((candidate) => candidate.id),
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
    profiles: overrides?.profiles ?? {
      getById: getProfileById,
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

  if (selectedCandidates.length !== requestedCandidateIds.length) {
    throw new ProfileCandidatePromotionError(
      'One or more selected candidates were not found',
      'profile_candidate_not_found',
      404,
    );
  }

  for (const candidate of selectedCandidates) {
    if (!candidate.id.trim()) {
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

function buildPromotionPrompt(args: {
  studentName: string;
  baseProfileContent: string;
  selectedCandidates: ProfilePromotionCandidate[];
  reviewerNote: string | null;
}): string {
  const candidatePayload = args.selectedCandidates.map((candidate) => ({
    id: candidate.id,
    targetSection: candidate.targetSection,
    category: candidate.category,
    approvedFact: (candidate.approvedFact ?? candidate.fact).trim(),
    originalFact: candidate.fact,
    authority: candidate.authority,
    confidence: candidate.confidence,
    evidence: candidate.evidence,
    sourceSnapshotId: candidate.sourceSnapshotId ?? null,
    sourceLessonMemoryIds: candidate.sourceLessonMemoryIds ?? [],
  }));

  return [
    'You are drafting a foundational student profile revision for an ESL homework system.',
    'You must produce only the revised profile markdown. Do not add commentary, JSON, or fences.',
    'This is a bounded promotion pass, not a full rewrite from scratch.',
    'Preserve unrelated profile wording and structure whenever possible.',
    'Integrate only the selected approved candidate facts below.',
    'Do not invent new durable facts beyond the selected candidate set.',
    'You may smooth wording and deduplicate overlap where that improves coherence.',
    'If the base profile is empty, create a compact foundational profile with clear sections for goals, context, interests, strengths, challenges, and study preferences.',
    '',
    '[STUDENT_NAME]',
    args.studentName,
    '',
    '[BASE_PROFILE_CONTENT]',
    args.baseProfileContent.trim().length > 0
      ? args.baseProfileContent
      : 'No existing active profile content. Build a compact foundational profile from the approved facts only.',
    '',
    '[SELECTED_APPROVED_CANDIDATES]',
    JSON.stringify(candidatePayload, null, 2),
    '',
    '[REVIEWER_NOTE]',
    args.reviewerNote ?? 'No reviewer note provided.',
    '',
    'Output only the revised profile markdown.',
  ].join('\n');
}
