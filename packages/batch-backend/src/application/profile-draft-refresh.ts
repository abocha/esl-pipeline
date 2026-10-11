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
  FOUNDATIONAL_PROFILE_JSON_SCHEMA,
  FOUNDATIONAL_PROFILE_RESPONSE_SCHEMA_DESCRIPTION,
  FOUNDATIONAL_PROFILE_RESPONSE_SCHEMA_NAME,
  type FoundationalProfile,
  renderFoundationalProfileContent,
} from './foundational-profile.js';
import {
  createGenerationRequestEnvelope,
  flattenGenerationRequestEnvelope,
} from './generation-request-envelope.js';
import { applyProfileCandidatePatch } from './profile-candidate-patch.js';
import type { ProfileRevisionDetailResponse } from './profile-content.js';
import { saveProfileRevisionContent } from './profile-content.js';
import {
  type GenerateProfileRevisionDraftResult,
  generateProfileRevisionDraft,
  isCompleteTextGenerationFinishReason,
} from './profile-revision-drafting.js';
import {
  getStudentMemoryOverview,
  type StudentMemoryOverview,
} from './student-memory-inspection.js';
import { getStudentProfileById } from './student-profiles-store.js';

export interface ProfileDraftRefreshCandidate {
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

export interface RefreshProfileDraftFromApprovedCandidatesRequest {
  studentId: string;
  candidateIds: string[];
  baseRevisionId?: string | null;
  reviewerId?: string | null;
  reviewerNote?: string | null;
  maxOutputTokens?: number;
}

export interface RefreshProfileDraftFromApprovedCandidatesResult {
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

interface ProfileDraftRefreshDependencies {
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
  memory: {
    getOverview: typeof getStudentMemoryOverview;
  };
  drafting: {
    generate: typeof generateProfileRevisionDraft;
  };
  profileContent: {
    saveRevision: typeof saveProfileRevisionContent;
  };
}

export class ProfileDraftRefreshError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = 'ProfileDraftRefreshError';
    this.code = code;
    this.status = status;
  }
}

export async function refreshProfileDraftFromApprovedCandidates(args: {
  request: RefreshProfileDraftFromApprovedCandidatesRequest;
  overrides?: Partial<ProfileDraftRefreshDependencies>;
}): Promise<RefreshProfileDraftFromApprovedCandidatesResult> {
  const dependencies = getDependencies(args.overrides);
  const request = args.request;

  if (request.candidateIds.length === 0) {
    throw new ProfileDraftRefreshError(
      'Draft refresh requires an explicit non-empty candidate selection',
      'profile_candidate_selection_required',
      400,
    );
  }

  const student = await dependencies.students.getById(request.studentId, {
    config: dependencies.config,
  });
  if (!student) {
    throw new ProfileDraftRefreshError('Student not found', 'student_not_found', 404);
  }

  const [baseRevision, selectedCandidates, memoryOverview] = await Promise.all([
    request.baseRevisionId
      ? dependencies.revisions.getById(request.studentId, request.baseRevisionId)
      : dependencies.revisions.getActive(request.studentId),
    dependencies.candidates.listByIds(request.studentId, request.candidateIds),
    dependencies.memory.getOverview({
      studentId: request.studentId,
      config: dependencies.config,
    }),
  ]);

  if (request.baseRevisionId && !baseRevision) {
    throw new ProfileDraftRefreshError(
      'Base profile revision was not found',
      'base_profile_revision_not_found',
      404,
    );
  }

  validateCandidateSelection(request.studentId, request.candidateIds, selectedCandidates);

  const baseStructuredProfile =
    baseRevision?.structuredContent ??
    deriveFoundationalProfileFromMarkdown(baseRevision?.content ?? '');
  const envelope = buildRefreshEnvelope({
    studentName: student.student,
    baseStructuredProfile,
    selectedCandidates,
    memoryOverview,
    reviewerNote: request.reviewerNote ?? null,
  });
  const prompt = flattenGenerationRequestEnvelope(envelope);

  const drafting = await dependencies.drafting.generate({
    request: {
      prompt,
      envelope,
      operation: 'profile_revision_refresh',
      maxOutputTokens:
        request.maxOutputTokens ?? dependencies.config.generation.maxOutputTokensHard,
      responseSchema: {
        name: FOUNDATIONAL_PROFILE_RESPONSE_SCHEMA_NAME,
        description: FOUNDATIONAL_PROFILE_RESPONSE_SCHEMA_DESCRIPTION,
        schema: FOUNDATIONAL_PROFILE_JSON_SCHEMA,
        strict: true,
      },
    },
    overrides: {
      config: dependencies.config,
    },
  });

  assertDraftRefreshIsComplete(drafting.finishReason);
  if (!('schemaVersion' in drafting.structuredProfile)) {
    throw new ProfileDraftRefreshError(
      'Profile draft refresh requires a foundational profile response.',
      'profile_revision_refresh_invalid_response',
      502,
    );
  }

  const structuredDraft = applyProfileCandidatePatch({
    baseProfile: drafting.structuredProfile,
    patch: { operation: 'apply', candidateIds: request.candidateIds },
    selectedCandidates,
  })!;
  const appliedCandidateIds = selectedCandidates
    .filter((candidate) => isStudentProfileCandidateRepresented(structuredDraft, candidate))
    .map((candidate) => candidate.id);
  const draftRevision = await dependencies.profileContent.saveRevision(
    request.studentId,
    renderFoundationalProfileContent(structuredDraft),
    {
      source: 'profile_revision_refresh',
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
      .map((candidate) => ({ candidateId: candidate.id, reason: 'empty_approved_fact' })),
    provider: drafting.provider,
    model: drafting.model,
    ...(drafting.providerRequestId ? { providerRequestId: drafting.providerRequestId } : {}),
    ...(drafting.usage ? { usage: drafting.usage } : {}),
  };
}

function getDependencies(
  overrides?: Partial<ProfileDraftRefreshDependencies>,
): ProfileDraftRefreshDependencies {
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
    memory: overrides?.memory ?? {
      getOverview: getStudentMemoryOverview,
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
  selectedCandidates: ProfileDraftRefreshCandidate[],
): void {
  const seen = new Set<string>();
  const requested = new Set(requestedCandidateIds);

  if (selectedCandidates.length !== requestedCandidateIds.length) {
    throw new ProfileDraftRefreshError(
      'One or more selected candidates were not found',
      'profile_candidate_not_found',
      404,
    );
  }

  for (const candidate of selectedCandidates) {
    if (!candidate.id.trim() || !requested.has(candidate.id)) {
      throw new ProfileDraftRefreshError(
        'Candidate selection contains an item without an id',
        'profile_candidate_id_missing',
        400,
      );
    }
    if (seen.has(candidate.id)) {
      throw new ProfileDraftRefreshError(
        'Candidate selection contains duplicate ids',
        'profile_candidate_duplicate',
        400,
      );
    }
    seen.add(candidate.id);

    if (candidate.studentId !== studentId) {
      throw new ProfileDraftRefreshError(
        'Candidate selection must belong to the target student',
        'profile_candidate_student_mismatch',
        400,
      );
    }

    if (candidate.status && candidate.status !== 'approved') {
      throw new ProfileDraftRefreshError(
        'Only approved candidates can refresh a draft',
        'profile_candidate_not_approved',
        409,
      );
    }

    if (candidate.reviewState && candidate.reviewState !== 'approved') {
      throw new ProfileDraftRefreshError(
        'Only approved candidates can refresh a draft',
        'profile_candidate_not_approved',
        409,
      );
    }
  }
}

function buildCandidatePayload(selectedCandidates: ProfileDraftRefreshCandidate[]) {
  return selectedCandidates.map((candidate) => ({
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
}

function buildMemoryPayload(memoryOverview: StudentMemoryOverview | null) {
  if (!memoryOverview) return null;
  return {
    latestReadyStudentMemorySnapshot: memoryOverview.latestReadyStudentMemorySnapshot,
    recentReadyLessonMemory: memoryOverview.recentReadyLessonMemory,
    recentReadyHomeworkMemory: memoryOverview.recentReadyHomeworkMemory,
    unresolvedIssues: memoryOverview.unresolvedIssues,
  };
}

function buildRefreshEnvelope(args: {
  studentName: string;
  baseStructuredProfile: FoundationalProfile | null;
  selectedCandidates: ProfileDraftRefreshCandidate[];
  memoryOverview: StudentMemoryOverview | null;
  reviewerNote: string | null;
}) {
  return createGenerationRequestEnvelope({
    workload: 'profile_revision',
    promptVersion: 'learner_memory_generation_v2',
    instructions: [
      'You are drafting a refreshed foundational student profile for an ESL homework system.',
      'Keep arrays concise and durable. Teacher-only ambiguity belongs in teacherNotes.',
      'Write a complete refreshed foundational_profile_v1 draft, not a candidate patch.',
      'Preserve durable teacher-authored truths and use memory evidence for context. Do not invent facts.',
      'Preserve selected approved candidate wording as separate items in their mapped fields. The backend will ensure those approved facts are present verbatim for teacher review.',
      'Return only a closed foundational_profile_v1 JSON object.',
    ].join('\n'),
    sources: [
      { id: 'student-name', label: 'STUDENT_NAME', content: args.studentName },
      {
        id: 'base-structured-profile',
        label: 'BASE_STRUCTURED_PROFILE',
        content: args.baseStructuredProfile
          ? JSON.stringify(args.baseStructuredProfile)
          : 'Not available.',
      },
      {
        id: 'approved-profile-candidates',
        label: 'APPROVED_PROFILE_CANDIDATES',
        content: JSON.stringify(buildCandidatePayload(args.selectedCandidates)),
      },
      {
        id: 'student-memory-overview',
        label: 'STUDENT_MEMORY_OVERVIEW',
        content: args.memoryOverview
          ? JSON.stringify(buildMemoryPayload(args.memoryOverview))
          : 'Not available.',
      },
      {
        id: 'reviewer-note',
        label: 'REVIEWER_NOTE',
        content: args.reviewerNote ?? 'Not available.',
      },
    ],
    responseSchema: {
      name: FOUNDATIONAL_PROFILE_RESPONSE_SCHEMA_NAME,
      description: FOUNDATIONAL_PROFILE_RESPONSE_SCHEMA_DESCRIPTION,
      schema: FOUNDATIONAL_PROFILE_JSON_SCHEMA,
      strict: true,
    },
  });
}

function assertDraftRefreshIsComplete(finishReason?: string): void {
  if (!isCompleteTextGenerationFinishReason(finishReason)) {
    throw new ProfileDraftRefreshError(
      `Profile draft refresh returned incomplete output (${finishReason}). No draft was saved.`,
      'profile_revision_refresh_incomplete',
      502,
    );
  }
}
