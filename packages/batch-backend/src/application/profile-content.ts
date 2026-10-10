import { createHash } from 'node:crypto';

import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import type {
  ProfileRevisionRecord,
  ProfileRevisionSource,
  RevisionStatus,
} from '../domain/profile-revision-model.js';
import {
  activateProfileRevision,
  deprecateActiveProfileRevision,
  getActiveProfileRevision,
  getLatestProfileRevisionByHash,
  getProfileRevisionById,
  insertProfileRevision,
  listProfileRevisions,
} from '../domain/profile-revision-repository.js';
import {
  copyStudentProfileCandidateDraftRevisionLinks,
  markStudentProfileCandidatesPromotedByRevision,
  type StudentProfileCandidatePromotionResult,
} from '../domain/student-profile-candidate-repository.js';
import { getStudentById } from '../domain/student-repository.js';
import {
  deriveFoundationalProfileFromMarkdown,
  type FoundationalProfile,
  normalizeFoundationalProfile,
} from './foundational-profile.js';

export interface ProfileContentResponse {
  studentId: string;
  content: string;
  structuredContent?: FoundationalProfile | null;
  currentRevisionId: string | null;
  updatedAt: string | null;
}

export interface ProfileRevisionSummaryResponse {
  id: string;
  studentId: string;
  contentHash: string;
  source: ProfileRevisionSource;
  status: 'draft' | 'active' | 'deprecated';
  versionNumber: number;
  versionLabel: string;
  activatedAt: string | null;
  deprecatedAt: string | null;
  createdAt: string;
  createdBy: string | null;
  restoredFromRevisionId: string | null;
}

export interface ProfileRevisionDetailResponse extends ProfileRevisionSummaryResponse {
  content: string;
  structuredContent?: FoundationalProfile | null;
  candidatePromotion?: StudentProfileCandidatePromotionResult;
}

export interface ProfileRevisionListResponse {
  items: ProfileRevisionSummaryResponse[];
  total: number;
  limit: number;
  offset: number;
  order: 'asc' | 'desc';
}

interface ProfileRevisionDependencies {
  insert: typeof insertProfileRevision;
  activate: typeof activateProfileRevision;
  deprecateActive: typeof deprecateActiveProfileRevision;
  list: typeof listProfileRevisions;
  getById: typeof getProfileRevisionById;
  getLatestByHash: typeof getLatestProfileRevisionByHash;
  getActive: typeof getActiveProfileRevision;
}

interface ProfileContentDependencies {
  config: BatchBackendConfig;
  revisions: ProfileRevisionDependencies;
  students: { getById: typeof getStudentById };
  candidates: {
    markPromotedByRevision: typeof markStudentProfileCandidatesPromotedByRevision;
    copyDraftLinks: typeof copyStudentProfileCandidateDraftRevisionLinks;
  };
}

interface UpsertProfileContentOptions {
  source?: ProfileRevisionSource;
  createdBy?: string | null;
  restoredFromRevisionId?: string | null;
  structuredContent?: FoundationalProfile | null;
}

export interface SaveProfileRevisionContentOptions extends UpsertProfileContentOptions {
  status?: RevisionStatus;
  dedupeByHash?: boolean;
  inheritCandidateLinksFromRevisionId?: string | null;
}

export class ProfileContentError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = 'ProfileContentError';
    this.code = code;
    this.status = status;
  }
}

function getDependencies(
  overrides?: Partial<ProfileContentDependencies>,
): ProfileContentDependencies {
  return {
    config: overrides?.config ?? loadConfig(),
    revisions: overrides?.revisions ?? {
      insert: insertProfileRevision,
      activate: activateProfileRevision,
      deprecateActive: deprecateActiveProfileRevision,
      list: listProfileRevisions,
      getById: getProfileRevisionById,
      getLatestByHash: getLatestProfileRevisionByHash,
      getActive: getActiveProfileRevision,
    },
    students: overrides?.students ?? { getById: getStudentById },
    candidates: overrides?.candidates ?? {
      markPromotedByRevision: markStudentProfileCandidatesPromotedByRevision,
      copyDraftLinks: copyStudentProfileCandidateDraftRevisionLinks,
    },
  };
}

function hashProfileContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function resolveStructuredContent(
  structuredContent: FoundationalProfile | null | undefined,
  content: string,
): FoundationalProfile | null {
  if (structuredContent) {
    return structuredContent;
  }

  return deriveFoundationalProfileFromMarkdown(content);
}

function toProfileRevisionSummary(revision: ProfileRevisionRecord): ProfileRevisionSummaryResponse {
  return {
    id: revision.id,
    studentId: revision.studentId,
    contentHash: revision.contentHash,
    source: revision.source,
    status: revision.status,
    versionNumber: revision.versionNumber,
    versionLabel: revision.versionLabel,
    activatedAt: revision.activatedAt ? revision.activatedAt.toISOString() : null,
    deprecatedAt: revision.deprecatedAt ? revision.deprecatedAt.toISOString() : null,
    createdAt: revision.createdAt.toISOString(),
    createdBy: revision.createdBy ?? null,
    restoredFromRevisionId: revision.restoredFromRevisionId ?? null,
  };
}

async function upsertProfileContentWithRevision(
  studentId: string,
  content: string,
  overrides: Partial<ProfileContentDependencies> | undefined,
  options: UpsertProfileContentOptions,
): Promise<ProfileContentResponse> {
  const revision = await saveProfileRevision(studentId, content, overrides, {
    source: options.source,
    createdBy: options.createdBy ?? null,
    restoredFromRevisionId: options.restoredFromRevisionId ?? null,
    structuredContent: options.structuredContent ?? null,
    status: 'active',
    dedupeByHash: options.source !== 'restore',
  });

  return {
    studentId,
    content: revision.content,
    structuredContent: resolveStructuredContent(revision.structuredContent, revision.content),
    currentRevisionId: revision.id,
    updatedAt: revision.createdAt,
  };
}

async function saveProfileRevision(
  studentId: string,
  content: string,
  overrides: Partial<ProfileContentDependencies> | undefined,
  options: SaveProfileRevisionContentOptions,
): Promise<ProfileRevisionDetailResponse> {
  const dependencies = getDependencies(overrides);
  const normalizedContent = content ?? '';

  if (!(await dependencies.students.getById(studentId))) {
    throw new ProfileContentError('Student not found', 'not_found', 404);
  }

  const hash = hashProfileContent(normalizedContent);
  const source = options.source ?? 'update';
  const status = options.status ?? 'active';
  const structuredContent = options.structuredContent
    ? normalizeFoundationalProfile(options.structuredContent)
    : null;

  const matchingRevision =
    options.dedupeByHash === false || source === 'restore'
      ? null
      : await dependencies.revisions.getLatestByHash(studentId, hash);

  const existingRevision =
    matchingRevision &&
    (status !== 'draft' || matchingRevision.status === 'draft') &&
    JSON.stringify(matchingRevision.structuredContent) === JSON.stringify(structuredContent)
      ? matchingRevision
      : null;
  const candidateLinkSource =
    status === 'draft' && options.inheritCandidateLinksFromRevisionId
      ? await dependencies.revisions.getById(studentId, options.inheritCandidateLinksFromRevisionId)
      : null;
  if (status === 'draft' && options.inheritCandidateLinksFromRevisionId && !candidateLinkSource) {
    throw new ProfileContentError(
      'Candidate-link source revision was not found',
      'candidate_link_source_revision_not_found',
      404,
    );
  }

  let revision =
    existingRevision ??
    (await dependencies.revisions.insert({
      studentId: studentId,
      content: normalizedContent,
      structuredContent,
      contentHash: hash,
      source,
      status,
      createdBy: options.createdBy ?? null,
      restoredFromRevisionId: options.restoredFromRevisionId ?? null,
    }));

  if (candidateLinkSource) {
    await dependencies.candidates.copyDraftLinks({
      sourceRevisionId: candidateLinkSource.id,
      targetRevisionId: revision.id,
    });
  }

  if (status === 'active' && existingRevision) {
    revision = (await dependencies.revisions.activate(studentId, revision.id)) ?? revision;
  }

  return {
    ...toProfileRevisionSummary(revision),
    studentId: studentId,
    content: revision.content,
    structuredContent: resolveStructuredContent(revision.structuredContent, revision.content),
  };
}

export async function getProfileContent(
  studentId: string,
  overrides?: Partial<ProfileContentDependencies>,
): Promise<ProfileContentResponse | null> {
  const dependencies = getDependencies(overrides);
  const revision = await dependencies.revisions.getActive(studentId);
  if (!revision) return null;

  return {
    studentId,
    content: revision.content,
    structuredContent: resolveStructuredContent(revision.structuredContent, revision.content),
    currentRevisionId: revision.id,
    updatedAt: revision.createdAt.toISOString(),
  };
}

export async function upsertProfileContent(
  studentId: string,
  content: string,
  overrides?: Partial<ProfileContentDependencies & { createdBy: string | null }>,
  structuredContent?: FoundationalProfile | null,
): Promise<ProfileContentResponse> {
  return upsertProfileContentWithRevision(studentId, content, overrides, {
    source: undefined,
    createdBy: overrides?.createdBy ?? null,
    restoredFromRevisionId: null,
    structuredContent: structuredContent ?? null,
  });
}

export async function saveProfileRevisionContent(
  studentId: string,
  content: string,
  options: SaveProfileRevisionContentOptions = {},
  overrides?: Partial<ProfileContentDependencies>,
): Promise<ProfileRevisionDetailResponse> {
  return saveProfileRevision(studentId, content, overrides, options);
}

export async function listProfileRevisionsForStudent(
  studentId: string,
  params: {
    limit?: number;
    offset?: number;
    order?: 'asc' | 'desc';
  } = {},
  overrides?: Partial<ProfileContentDependencies>,
): Promise<ProfileRevisionListResponse | null> {
  const dependencies = getDependencies(overrides);

  const result = await dependencies.revisions.list({
    studentId: studentId,
    limit: params.limit,
    offset: params.offset,
    order: params.order,
  });

  return {
    items: result.items.map((item) => toProfileRevisionSummary(item)),
    total: result.total,
    limit: result.limit,
    offset: result.offset,
    order: result.order,
  };
}

export async function getProfileRevisionForStudent(
  studentId: string,
  revisionId: string,
  overrides?: Partial<ProfileContentDependencies>,
): Promise<ProfileRevisionDetailResponse | null> {
  const dependencies = getDependencies(overrides);

  const revision = await dependencies.revisions.getById(studentId, revisionId);
  if (!revision) return null;

  return {
    ...toProfileRevisionSummary(revision),
    content: revision.content,
    structuredContent: resolveStructuredContent(revision.structuredContent, revision.content),
  };
}

export async function restoreProfileRevision(
  studentId: string,
  revisionId: string,
  overrides?: Partial<ProfileContentDependencies & { createdBy: string | null }>,
): Promise<ProfileContentResponse | null> {
  const dependencies = getDependencies(overrides);

  const revision = await dependencies.revisions.getById(studentId, revisionId);
  if (!revision) return null;

  return upsertProfileContentWithRevision(studentId, revision.content, overrides, {
    source: 'restore',
    createdBy: overrides?.createdBy ?? null,
    restoredFromRevisionId: revision.id,
    structuredContent: revision.structuredContent,
  });
}

export async function activateProfileRevisionForStudent(
  studentId: string,
  revisionId: string,
  overrides?: Partial<ProfileContentDependencies>,
): Promise<ProfileRevisionDetailResponse | null> {
  const dependencies = getDependencies(overrides);

  const activated = await dependencies.revisions.activate(studentId, revisionId);
  if (!activated) return null;

  const candidatePromotion = await dependencies.candidates.markPromotedByRevision(activated.id, {
    studentId: activated.studentId,
    contentHash: activated.contentHash,
    structuredContent: resolveStructuredContent(activated.structuredContent, activated.content),
  });

  return {
    ...toProfileRevisionSummary(activated),
    candidatePromotion,
    content: activated.content,
    structuredContent: resolveStructuredContent(activated.structuredContent, activated.content),
  };
}
