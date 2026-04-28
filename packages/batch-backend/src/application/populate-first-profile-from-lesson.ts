import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import { getProfileById } from '../domain/profile-repository.js';
import { getActiveProfileRevision } from '../domain/profile-revision-repository.js';
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
} from './profile-revision-drafting.js';
import {
  getStudentMemoryOverview,
  type StudentMemoryOverview,
} from './student-memory-inspection.js';
import {
  ensureStudentCanonicalProfileBinding,
  getStudentProfileById,
  type StudentStoreOverrides,
} from './student-profiles-store.js';

const DEFAULT_POPULATE_MAX_OUTPUT_TOKENS = 2_800;

export interface PopulateFirstProfileFromLessonRequest {
  studentId: string;
  reviewerId?: string | null;
  reviewerNote?: string | null;
  maxOutputTokens?: number;
}

export interface PopulateFirstProfileFromLessonResult {
  studentId: string;
  profileId: string;
  baseRevisionId: string | null;
  draftRevision: ProfileRevisionDetailResponse;
  snapshotId: string | null;
  lessonMemoryIds: string[];
  homeworkMemoryIds: string[];
  provider: GenerateProfileRevisionDraftResult['provider'];
  model: GenerateProfileRevisionDraftResult['model'];
  providerRequestId?: string;
  usage?: GenerateProfileRevisionDraftResult['usage'];
}

interface PopulateFirstProfileFromLessonDependencies {
  config: BatchBackendConfig;
  students: {
    getById: typeof getStudentProfileById;
    ensureCanonicalProfileBinding: typeof ensureStudentCanonicalProfileBinding;
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

export class PopulateFirstProfileFromLessonError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = 'PopulateFirstProfileFromLessonError';
    this.code = code;
    this.status = status;
  }
}

export async function populateFirstProfileFromLesson(args: {
  request: PopulateFirstProfileFromLessonRequest;
  overrides?: Partial<PopulateFirstProfileFromLessonDependencies>;
}): Promise<PopulateFirstProfileFromLessonResult> {
  const dependencies = getDependencies(args.overrides);
  const request = args.request;

  let student = await dependencies.students.getById(request.studentId, {
    config: dependencies.config,
  } satisfies StudentStoreOverrides);
  if (!student) {
    throw new PopulateFirstProfileFromLessonError('Student not found', 'student_not_found', 404);
  }

  if (!student.profileId) {
    const ensuredStudent = await dependencies.students.ensureCanonicalProfileBinding(
      request.studentId,
      {
        config: dependencies.config,
        bindingAudit: {
          reason: 'student_area_profile_initialize',
          changedBy: request.reviewerId ?? null,
        },
      } satisfies StudentStoreOverrides,
    );

    if (!ensuredStudent?.profileId) {
      throw new PopulateFirstProfileFromLessonError(
        'Unable to create a canonical learner profile binding',
        'profile_binding_failed',
        500,
      );
    }

    student = ensuredStudent;
  }
  const profileId = student.profileId;
  if (!profileId) {
    throw new PopulateFirstProfileFromLessonError(
      'Unable to resolve canonical learner profile binding',
      'profile_binding_failed',
      500,
    );
  }

  const profile = await dependencies.profiles.getById(profileId);
  if (!profile) {
    throw new PopulateFirstProfileFromLessonError('Profile not found', 'profile_not_found', 404);
  }

  const [activeRevision, overview] = await Promise.all([
    dependencies.revisions.getActive(profileId),
    dependencies.memory.getOverview({
      studentId: request.studentId,
      config: dependencies.config,
    }),
  ]);

  if (!overview) {
    throw new PopulateFirstProfileFromLessonError(
      'Student memory overview is unavailable for first-profile population',
      'student_memory_overview_unavailable',
      409,
    );
  }

  const prompt = buildPopulatePrompt({
    studentName: student.student,
    baseStructuredProfile:
      activeRevision?.structuredContent ??
      deriveFoundationalProfileFromMarkdown(activeRevision?.content ?? ''),
    memoryOverview: overview,
    reviewerNote: request.reviewerNote ?? null,
  });

  const drafting = await dependencies.drafting.generate({
    request: {
      prompt,
      operation: 'lesson_population',
      maxOutputTokens: request.maxOutputTokens ?? DEFAULT_POPULATE_MAX_OUTPUT_TOKENS,
    },
    overrides: {
      config: dependencies.config,
    },
  });

  const structuredDraft = drafting.structuredProfile;
  const draftRevision = await dependencies.profileContent.saveRevision(
    profileId,
    renderFoundationalProfileContent(structuredDraft),
    {
      source: 'lesson_population',
      status: 'draft',
      createdBy: request.reviewerId ?? null,
      dedupeByHash: false,
      structuredContent: structuredDraft,
    },
  );

  return {
    studentId: request.studentId,
    profileId,
    baseRevisionId: activeRevision?.id ?? null,
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
  overrides?: Partial<PopulateFirstProfileFromLessonDependencies>,
): PopulateFirstProfileFromLessonDependencies {
  return {
    config: overrides?.config ?? loadConfig(),
    students: overrides?.students ?? {
      getById: getStudentProfileById,
      ensureCanonicalProfileBinding: ensureStudentCanonicalProfileBinding,
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

function buildPopulatePrompt(args: {
  studentName: string;
  baseStructuredProfile: FoundationalProfile | null;
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
        recentProgress: args.memoryOverview.latestReadyStudentMemorySnapshot.recentProgress,
        recommendedAssignmentDirections:
          args.memoryOverview.latestReadyStudentMemorySnapshot.recommendedAssignmentDirections,
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
    'You are drafting a first-pass foundational student profile for an ESL homework system.',
    'Return only one JSON object matching the foundational_profile_v1 schema.',
    'Teacher-authored durable truths take priority when a base structured profile is present.',
    'Use canonical student memory and recent lesson/homework memory to infer durable context.',
    'Favor omission over invention.',
    'Compact, durable ambiguities belong in teacherNotes rather than invented facts.',
    '',
    '[STUDENT_NAME]',
    args.studentName,
    '',
    '[BASE_STRUCTURED_PROFILE]',
    args.baseStructuredProfile
      ? JSON.stringify(args.baseStructuredProfile, null, 2)
      : 'No existing structured profile.',
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
    'Output only valid JSON.',
  ].join('\n');
}
