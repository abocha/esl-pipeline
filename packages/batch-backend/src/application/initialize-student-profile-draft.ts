import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import { getActiveProfileRevision } from '../domain/profile-revision-repository.js';
import {
  createEmptyFoundationalProfile,
  normalizeFoundationalProfile,
  renderFoundationalProfileContent,
} from './foundational-profile.js';
import type { ProfileRevisionDetailResponse } from './profile-content.js';
import { saveProfileRevisionContent } from './profile-content.js';
import {
  ensureStudentCanonicalProfileBinding,
  getStudentProfileById,
  type StudentStoreOverrides,
} from './student-profiles-store.js';

export interface InitializeStudentProfileDraftRequest {
  studentId: string;
  reviewerId?: string | null;
}

export interface InitializeStudentProfileDraftResult {
  studentId: string;
  profileId: string;
  draftRevision: ProfileRevisionDetailResponse;
}

interface InitializeStudentProfileDraftDependencies {
  config: BatchBackendConfig;
  students: {
    getById: typeof getStudentProfileById;
    ensureCanonicalProfileBinding: typeof ensureStudentCanonicalProfileBinding;
  };
  revisions: {
    getActive: typeof getActiveProfileRevision;
  };
  profileContent: {
    saveRevision: typeof saveProfileRevisionContent;
  };
}

export class InitializeStudentProfileDraftError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = 'InitializeStudentProfileDraftError';
    this.code = code;
    this.status = status;
  }
}

function getDependencies(
  overrides?: Partial<InitializeStudentProfileDraftDependencies>,
): InitializeStudentProfileDraftDependencies {
  return {
    config: overrides?.config ?? loadConfig(),
    students: overrides?.students ?? {
      getById: getStudentProfileById,
      ensureCanonicalProfileBinding: ensureStudentCanonicalProfileBinding,
    },
    revisions: overrides?.revisions ?? {
      getActive: getActiveProfileRevision,
    },
    profileContent: overrides?.profileContent ?? {
      saveRevision: saveProfileRevisionContent,
    },
  };
}

export async function initializeStudentProfileDraft(args: {
  request: InitializeStudentProfileDraftRequest;
  overrides?: Partial<InitializeStudentProfileDraftDependencies>;
}): Promise<InitializeStudentProfileDraftResult> {
  const dependencies = getDependencies(args.overrides);
  const request = args.request;

  const student = await dependencies.students.getById(request.studentId, {
    config: dependencies.config,
  } satisfies StudentStoreOverrides);
  if (!student) {
    throw new InitializeStudentProfileDraftError('Student not found', 'student_not_found', 404);
  }

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

  const profileId = ensuredStudent?.profileId ?? null;
  if (!profileId) {
    throw new InitializeStudentProfileDraftError(
      'Unable to create a canonical learner profile binding',
      'profile_binding_failed',
      500,
    );
  }

  const activeRevision = await dependencies.revisions.getActive(profileId);
  if (activeRevision) {
    throw new InitializeStudentProfileDraftError(
      'Student already has an initialized learner profile',
      'profile_already_initialized',
      409,
    );
  }

  const structuredContent = normalizeFoundationalProfile(createEmptyFoundationalProfile());
  const draftRevision = await dependencies.profileContent.saveRevision(
    profileId,
    renderFoundationalProfileContent(structuredContent),
    {
      source: 'create',
      status: 'draft',
      createdBy: request.reviewerId ?? null,
      dedupeByHash: false,
      structuredContent,
    },
  );

  return {
    studentId: request.studentId,
    profileId,
    draftRevision,
  };
}
