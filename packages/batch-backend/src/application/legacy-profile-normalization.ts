import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import { getActiveProfileRevision } from '../domain/profile-revision-repository.js';
import {
  FOUNDATIONAL_PROFILE_JSON_SCHEMA,
  FOUNDATIONAL_PROFILE_RESPONSE_SCHEMA_DESCRIPTION,
  FOUNDATIONAL_PROFILE_RESPONSE_SCHEMA_NAME,
  renderFoundationalProfileContent,
} from './foundational-profile.js';
import {
  createGenerationRequestEnvelope,
  flattenGenerationRequestEnvelope,
} from './generation-request-envelope.js';
import type { ProfileRevisionDetailResponse } from './profile-content.js';
import { saveProfileRevisionContent } from './profile-content.js';
import {
  type GenerateProfileRevisionDraftResult,
  generateProfileRevisionDraft,
} from './profile-revision-drafting.js';
import {
  getStudentMemoryOverview,
  type StudentMemoryOverview,
} from './student-memory-inspection.js';
import { getStudentProfileById } from './student-profiles-store.js';

const DEFAULT_NORMALIZATION_MAX_OUTPUT_TOKENS = 2_800;

export interface NormalizeLegacyProfileRequest {
  studentId: string;
  reviewerId?: string | null;
  reviewerNote?: string | null;
  maxOutputTokens?: number;
}

export interface NormalizeLegacyProfileResult {
  studentId: string;
  sourceRevisionId: string;
  draftRevision: ProfileRevisionDetailResponse;
  snapshotId: string | null;
  lessonMemoryIds: string[];
  homeworkMemoryIds: string[];
  provider: GenerateProfileRevisionDraftResult['provider'];
  model: GenerateProfileRevisionDraftResult['model'];
  providerRequestId?: string;
  usage?: GenerateProfileRevisionDraftResult['usage'];
}

interface LegacyProfileNormalizationDependencies {
  config: BatchBackendConfig;
  students: {
    getById: typeof getStudentProfileById;
  };

  revisions: {
    getActive: typeof getActiveProfileRevision;
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

export class LegacyProfileNormalizationError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = 'LegacyProfileNormalizationError';
    this.code = code;
    this.status = status;
  }
}

export async function normalizeLegacyStudentProfile(args: {
  request: NormalizeLegacyProfileRequest;
  overrides?: Partial<LegacyProfileNormalizationDependencies>;
}): Promise<NormalizeLegacyProfileResult> {
  const dependencies = getDependencies(args.overrides);
  const request = args.request;

  const student = await dependencies.students.getById(request.studentId, {
    config: dependencies.config,
  });
  if (!student) {
    throw new LegacyProfileNormalizationError('Student not found', 'student_not_found', 404);
  }

  const activeRevision = await dependencies.revisions.getActive(request.studentId);
  if (!activeRevision) {
    throw new LegacyProfileNormalizationError(
      'Active profile revision is required for normalization',
      'active_profile_revision_missing',
      409,
    );
  }

  const overview = await dependencies.memory.getOverview({
    studentId: request.studentId,
    config: dependencies.config,
  });
  if (!overview) {
    throw new LegacyProfileNormalizationError(
      'Student memory overview is unavailable for normalization',
      'student_memory_overview_unavailable',
      409,
    );
  }

  const envelope = buildLegacyNormalizationEnvelope({
    studentName: student.student,
    activeProfileContent: activeRevision.content,
    memoryOverview: overview,
    reviewerNote: request.reviewerNote ?? null,
  });
  const prompt = flattenGenerationRequestEnvelope(envelope);

  const drafting = await dependencies.drafting.generate({
    request: {
      prompt,
      envelope,
      operation: 'legacy_normalization',
      maxOutputTokens: request.maxOutputTokens ?? DEFAULT_NORMALIZATION_MAX_OUTPUT_TOKENS,
    },
    overrides: {
      config: dependencies.config,
    },
  });

  if (!('schemaVersion' in drafting.structuredProfile)) {
    throw new Error('Legacy profile normalization requires a foundational profile response.');
  }
  const structuredDraft = drafting.structuredProfile;
  const draftRevision = await dependencies.profileContent.saveRevision(
    request.studentId,
    renderFoundationalProfileContent(structuredDraft),
    {
      source: 'legacy_normalization',
      status: 'draft',
      createdBy: request.reviewerId ?? null,
      dedupeByHash: false,
      structuredContent: structuredDraft,
    },
  );

  return {
    studentId: request.studentId,
    sourceRevisionId: activeRevision.id,
    draftRevision,
    snapshotId: overview.latestReadyStudentMemorySnapshot?.id ?? null,
    lessonMemoryIds: overview.recentReadyLessonMemory.map((entry) => entry.id),
    homeworkMemoryIds: overview.recentReadyHomeworkMemory.map((entry) => entry.id),
    provider: drafting.provider,
    model: drafting.model,
    ...(drafting.providerRequestId ? { providerRequestId: drafting.providerRequestId } : {}),
    ...(drafting.usage ? { usage: drafting.usage } : {}),
  };
}

function buildLegacyNormalizationEnvelope(args: {
  studentName: string;
  activeProfileContent: string;
  memoryOverview: StudentMemoryOverview;
  reviewerNote: string | null;
}) {
  return createGenerationRequestEnvelope({
    workload: 'profile_revision',
    promptVersion: 'learner_memory_generation_v2',
    instructions: [
      'Normalize a legacy ESL student profile into a durable foundational profile.',
      'Preserve durable teacher-authored truths, omit transient continuity, and do not invent facts.',
      'Remove or compress tactical continuity that now belongs in canonical student memory.',
      'If information is clearly transient, recent, or already better represented by current memory, omit it from the normalized profile unless it is genuinely durable context.',
      'Keep the result readable, coherent, and teacher-trustworthy.',
      'Return only a closed foundational_profile_v1 JSON object.',
    ].join('\n'),
    sources: [
      { id: 'student-name', label: 'STUDENT_NAME', content: args.studentName },
      {
        id: 'current-active-profile',
        label: 'CURRENT_ACTIVE_PROFILE',
        content: args.activeProfileContent,
      },
      {
        id: 'student-memory-overview',
        label: 'STUDENT_MEMORY_OVERVIEW',
        content: JSON.stringify(args.memoryOverview),
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

function getDependencies(
  overrides?: Partial<LegacyProfileNormalizationDependencies>,
): LegacyProfileNormalizationDependencies {
  return {
    config: overrides?.config ?? loadConfig(),
    students: overrides?.students ?? {
      getById: getStudentProfileById,
    },

    revisions: overrides?.revisions ?? {
      getActive: getActiveProfileRevision,
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
