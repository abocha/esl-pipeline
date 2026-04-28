import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import type {
  FactEvidence,
  MemoryConfidence,
  StudentFactAuthority,
} from '../domain/lesson-memory-model.js';
import { getProfileById } from '../domain/profile-repository.js';
import {
  getActiveProfileRevision,
  getProfileRevisionById,
} from '../domain/profile-revision-repository.js';
import {
  linkStudentProfileCandidatesToDraftRevision,
  listStudentProfileCandidatesByIds,
} from '../domain/student-profile-candidate-repository.js';
import {
  deriveFoundationalProfileFromMarkdown,
  type FoundationalProfile,
  renderFoundationalProfileContent,
} from './foundational-profile.js';
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

  const baseStructuredProfile =
    baseRevision?.structuredContent ??
    deriveFoundationalProfileFromMarkdown(baseRevision?.content ?? '');

  const prompt = buildPromotionPrompt({
    studentName: student.student,
    baseStructuredProfile,
    selectedCandidates,
    reviewerNote: request.reviewerNote ?? null,
  });

  const drafting = await dependencies.drafting.generate({
    request: {
      prompt,
      operation: 'candidate_promotion',
      maxOutputTokens:
        request.maxOutputTokens ?? dependencies.config.generation.maxOutputTokensHard,
    },
    overrides: {
      config: dependencies.config,
    },
  });

  assertCandidatePromotionDraftIsComplete({
    draftText: drafting.rawText,
    finishReason: drafting.finishReason,
    baseProfileContent:
      renderStructuredProfileForComparison(baseStructuredProfile) ?? baseRevision?.content ?? '',
  });

  const structuredDraft = drafting.structuredProfile;
  const renderedDraft = renderFoundationalProfileContent(structuredDraft);

  const draftRevision = await dependencies.profileContent.saveRevision(profileId, renderedDraft, {
    source: 'candidate_promotion',
    status: 'draft',
    createdBy: request.reviewerId ?? null,
    dedupeByHash: false,
    structuredContent: structuredDraft,
  });

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
  baseStructuredProfile: FoundationalProfile | null;
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
    'Return only one JSON object matching the foundational_profile_v1 schema.',
    'This is a bounded promotion pass, not a full rewrite from scratch.',
    'Preserve unrelated teacher-authored truths whenever possible.',
    'Integrate only the selected approved candidate facts below.',
    'Do not invent new durable facts beyond the selected candidate set.',
    'Favor omission over invention.',
    'You may smooth wording and deduplicate overlap where that improves coherence.',
    'Keep arrays concise and durable. Teacher-only ambiguity belongs in teacherNotes.',
    '',
    '[STUDENT_NAME]',
    args.studentName,
    '',
    '[BASE_STRUCTURED_PROFILE]',
    args.baseStructuredProfile
      ? JSON.stringify(args.baseStructuredProfile, null, 2)
      : 'No existing structured profile. Build the first durable profile from the approved facts only.',
    '',
    '[SELECTED_APPROVED_CANDIDATES]',
    JSON.stringify(candidatePayload, null, 2),
    '',
    '[REVIEWER_NOTE]',
    args.reviewerNote ?? 'No reviewer note provided.',
    '',
    'Output only valid JSON.',
  ].join('\n');
}

function assertCandidatePromotionDraftIsComplete(args: {
  draftText: string;
  finishReason?: string;
  baseProfileContent: string;
}): void {
  if (!isCompleteTextGenerationFinishReason(args.finishReason)) {
    throw new ProfileCandidatePromotionError(
      `Profile draft generation returned incomplete output (${args.finishReason}). No draft was saved.`,
      'profile_candidate_draft_incomplete',
      502,
    );
  }

  const draftText = args.draftText.trim();
  const baseProfileContent = args.baseProfileContent.trim();
  if (!draftText) {
    throw new ProfileCandidatePromotionError(
      'Profile draft generation returned empty output. No draft was saved.',
      'profile_candidate_draft_empty',
      502,
    );
  }

  // Promotions should preserve most of the base profile. A dramatic collapse in output length
  // is a strong signal that the generation stopped early even if the provider omitted metadata.
  if (
    baseProfileContent.length >= 1_500 &&
    draftText.length < Math.floor(baseProfileContent.length * 0.4)
  ) {
    throw new ProfileCandidatePromotionError(
      'Profile draft generation appears truncated compared with the base profile. No draft was saved.',
      'profile_candidate_draft_truncated',
      502,
    );
  }
}

function renderStructuredProfileForComparison(profile: FoundationalProfile | null): string | null {
  return profile ? renderFoundationalProfileContent(profile) : null;
}
