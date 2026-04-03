import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import { getProfileById } from '../domain/profile-repository.js';
import { getActiveProfileRevision } from '../domain/profile-revision-repository.js';
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
  profileId: string;
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
  profiles: {
    getById: typeof getProfileById;
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

  const profileId = student.profileId;
  if (!profileId) {
    throw new LegacyProfileNormalizationError(
      'Student does not have a bound profile to normalize',
      'profile_not_bound',
      409,
    );
  }

  const profile = await dependencies.profiles.getById(profileId);
  if (!profile) {
    throw new LegacyProfileNormalizationError('Profile not found', 'profile_not_found', 404);
  }

  const activeRevision = await dependencies.revisions.getActive(profileId);
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

  const prompt = buildLegacyNormalizationPrompt({
    studentName: student.student,
    activeProfileContent: activeRevision.content,
    memoryOverview: overview,
    reviewerNote: request.reviewerNote ?? null,
  });

  const drafting = await dependencies.drafting.generate({
    request: {
      prompt,
      operation: 'legacy_normalization',
      maxOutputTokens: request.maxOutputTokens ?? DEFAULT_NORMALIZATION_MAX_OUTPUT_TOKENS,
    },
    overrides: {
      config: dependencies.config,
    },
  });

  const draftRevision = await dependencies.profileContent.saveRevision(
    profileId,
    drafting.text.trim(),
    {
      source: 'legacy_normalization',
      status: 'draft',
      createdBy: request.reviewerId ?? null,
      dedupeByHash: false,
    },
  );

  return {
    studentId: request.studentId,
    profileId,
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

function getDependencies(
  overrides?: Partial<LegacyProfileNormalizationDependencies>,
): LegacyProfileNormalizationDependencies {
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

function buildLegacyNormalizationPrompt(args: {
  studentName: string;
  activeProfileContent: string;
  memoryOverview: StudentMemoryOverview;
  reviewerNote: string | null;
}): string {
  const snapshotPayload = args.memoryOverview.latestReadyStudentMemorySnapshot
    ? {
        id: args.memoryOverview.latestReadyStudentMemorySnapshot.id,
        generatedAt: args.memoryOverview.latestReadyStudentMemorySnapshot.generatedAt.toISOString(),
        snapshotSummary:
          args.memoryOverview.latestReadyStudentMemorySnapshot.snapshotSummary ?? null,
        stableStrengths: args.memoryOverview.latestReadyStudentMemorySnapshot.stableStrengths,
        recurringIssues: args.memoryOverview.latestReadyStudentMemorySnapshot.recurringIssues,
        personalFacts: args.memoryOverview.latestReadyStudentMemorySnapshot.personalFacts,
        unresolvedIssues: args.memoryOverview.latestReadyStudentMemorySnapshot.unresolvedIssues,
      }
    : null;

  const lessonPayload = args.memoryOverview.recentReadyLessonMemory.map((entry) => ({
    id: entry.id,
    generatedAt: entry.generatedAt.toISOString(),
    lessonSummary: entry.lessonSummary ?? null,
    studentFacts: entry.studentFacts,
    progressSignals: entry.progressSignals,
    followUpRecommendations: entry.followUpRecommendations,
  }));

  const homeworkPayload = args.memoryOverview.recentReadyHomeworkMemory.map((entry) => ({
    id: entry.id,
    generatedAt: entry.generatedAt.toISOString(),
    homeworkSummary: entry.homeworkSummary ?? null,
    topic: entry.topic ?? null,
    reviewTargets: entry.reviewTargets,
    taskList: entry.taskList,
    teacherFollowUpCues: entry.teacherFollowUpCues,
  }));

  return [
    'You are normalizing a legacy ESL student profile into the new foundational-profile architecture.',
    'Output only the normalized profile markdown. Do not add commentary, JSON, or fences.',
    'Preserve durable foundational truths from the current profile.',
    'Remove or compress tactical continuity that now belongs in canonical student memory.',
    'Do not invent new durable facts.',
    'If information is clearly transient, recent, or already better represented by current memory, omit it from the normalized profile unless it is genuinely durable context.',
    'Keep the result readable, coherent, and teacher-trustworthy.',
    '',
    '[STUDENT_NAME]',
    args.studentName,
    '',
    '[CURRENT_ACTIVE_PROFILE]',
    args.activeProfileContent,
    '',
    '[LATEST_READY_STUDENT_MEMORY_SNAPSHOT]',
    snapshotPayload
      ? JSON.stringify(snapshotPayload, null, 2)
      : 'No ready student-memory snapshot available.',
    '',
    '[RECENT_READY_LESSON_MEMORY]',
    lessonPayload.length > 0
      ? JSON.stringify(lessonPayload, null, 2)
      : 'No recent ready lesson-memory entries available.',
    '',
    '[RECENT_READY_HOMEWORK_MEMORY]',
    homeworkPayload.length > 0
      ? JSON.stringify(homeworkPayload, null, 2)
      : 'No recent ready homework-memory entries available.',
    '',
    '[REVIEWER_NOTE]',
    args.reviewerNote ?? 'No reviewer note provided.',
    '',
    'Output only the normalized profile markdown.',
  ].join('\n');
}
