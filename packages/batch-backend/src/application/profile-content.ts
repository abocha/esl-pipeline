import { createHash } from 'node:crypto';
import path from 'node:path';

import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import {
  deriveFoundationalProfileFromMarkdown,
  normalizeFoundationalProfile,
  type FoundationalProfile,
} from './foundational-profile.js';
import {
  getProfileById,
  listProfiles,
  setProfileActiveRevision,
  upsertProfile,
} from '../domain/profile-repository.js';
import type {
  ProfileRevisionRecord,
  ProfileRevisionSource,
  RevisionStatus,
} from '../domain/profile-revision-model.js';
import {
  activateProfileRevision,
  deprecateActiveProfileRevision,
  getLatestProfileRevisionByHash,
  getProfileRevisionById,
  insertProfileRevision,
  listProfileRevisions,
} from '../domain/profile-revision-repository.js';
import { markStudentProfileCandidatesPromotedByRevision } from '../domain/student-profile-candidate-repository.js';
import type { PromptOption } from './prompt-options.js';

const PROFILE_EXTENSIONS = new Set(['.md', '.txt']);
const MAX_OPTION_PAGE_LIMIT = 500;

export interface ProfileContentListResponse {
  profiles: PromptOption[];
}

export interface ProfileContentResponse {
  id: string;
  label: string;
  content: string;
  structuredContent?: FoundationalProfile | null;
  currentRevisionId: string | null;
  updatedAt: string | null;
}

export interface ProfileRevisionSummaryResponse {
  id: string;
  profileId: string;
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
}

interface ProfileContentDependencies {
  config: BatchBackendConfig;
  revisions: ProfileRevisionDependencies;
  profiles: {
    list: typeof listProfiles;
    getById: typeof getProfileById;
    upsert: typeof upsertProfile;
    setActive: typeof setProfileActiveRevision;
  };
  candidates: {
    markPromotedByRevision: typeof markStudentProfileCandidatesPromotedByRevision;
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

function normalizeProfileId(id: string): string {
  const normalized = path.posix
    .normalize(id.replaceAll('\\', '/').replace(/^\/+/, '').trim())
    .trim();

  if (!normalized || normalized === '.' || normalized === '..') {
    throw new ProfileContentError('profileId is required', 'profile_id_missing', 400);
  }
  if (normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    throw new ProfileContentError('profileId is invalid', 'profile_id_invalid', 400);
  }

  const ext = path.extname(normalized).toLowerCase();
  if (!PROFILE_EXTENSIONS.has(ext)) {
    throw new ProfileContentError('profileId must end with .md or .txt', 'profile_id_invalid', 400);
  }

  return normalized;
}

function formatProfileLabel(profileId: string): string {
  const base = path.basename(profileId, path.extname(profileId));
  const normalized = base.replaceAll(/[_-]+/g, ' ').trim();
  return normalized.length > 0 ? normalized : profileId;
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
    },
    profiles: overrides?.profiles ?? {
      list: listProfiles,
      getById: getProfileById,
      upsert: upsertProfile,
      setActive: setProfileActiveRevision,
    },
    candidates: overrides?.candidates ?? {
      markPromotedByRevision: markStudentProfileCandidatesPromotedByRevision,
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
    profileId: revision.profileId,
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

async function listActiveProfileOptions(
  dependencies: ProfileContentDependencies,
): Promise<PromptOption[]> {
  const options: PromptOption[] = [];
  let offset = 0;

  while (true) {
    const listed = await dependencies.profiles.list({
      limit: MAX_OPTION_PAGE_LIMIT,
      offset,
      order: 'asc',
    });

    options.push(
      ...listed.items
        .filter((profile) => Boolean(profile.activeRevisionId))
        .map((profile) => ({ id: profile.id, label: profile.label })),
    );

    offset += listed.items.length;
    if (offset >= listed.total || listed.items.length === 0) {
      break;
    }
  }

  return options;
}

async function upsertProfileContentWithRevision(
  profileId: string,
  content: string,
  overrides: Partial<ProfileContentDependencies> | undefined,
  options: UpsertProfileContentOptions,
): Promise<ProfileContentResponse> {
  const dependencies = getDependencies(overrides);
  const normalizedProfileId = normalizeProfileId(profileId);
  const existingProfile = await dependencies.profiles.getById(normalizedProfileId);
  const label = existingProfile?.label ?? formatProfileLabel(normalizedProfileId);
  const revision = await saveProfileRevision(profileId, content, overrides, {
    source: options.source,
    createdBy: options.createdBy ?? null,
    restoredFromRevisionId: options.restoredFromRevisionId ?? null,
    structuredContent: options.structuredContent ?? null,
    status: 'active',
    dedupeByHash: options.source !== 'restore',
  });

  return {
    id: normalizedProfileId,
    label,
    content: revision.content,
    structuredContent: resolveStructuredContent(revision.structuredContent, revision.content),
    currentRevisionId: revision.id,
    updatedAt: revision.createdAt,
  };
}

async function saveProfileRevision(
  profileId: string,
  content: string,
  overrides: Partial<ProfileContentDependencies> | undefined,
  options: SaveProfileRevisionContentOptions,
): Promise<ProfileRevisionDetailResponse> {
  const dependencies = getDependencies(overrides);
  const normalizedProfileId = normalizeProfileId(profileId);
  const normalizedContent = content ?? '';
  const existingProfile = await dependencies.profiles.getById(normalizedProfileId);
  const label = existingProfile?.label ?? formatProfileLabel(normalizedProfileId);

  await dependencies.profiles.upsert({
    id: normalizedProfileId,
    label,
    activeRevisionId: existingProfile?.activeRevisionId ?? null,
  });

  const hash = hashProfileContent(normalizedContent);
  const source = options.source ?? (existingProfile ? 'update' : 'create');
  const status = options.status ?? 'active';
  const structuredContent = options.structuredContent
    ? normalizeFoundationalProfile(options.structuredContent)
    : null;

  const existingRevision =
    options.dedupeByHash === false || source === 'restore'
      ? null
      : await dependencies.revisions.getLatestByHash(normalizedProfileId, hash);

  const revision =
    existingRevision ??
    (await dependencies.revisions.insert({
      profileId: normalizedProfileId,
      content: normalizedContent,
      structuredContent,
      contentHash: hash,
      source,
      status,
      createdBy: options.createdBy ?? null,
      restoredFromRevisionId: options.restoredFromRevisionId ?? null,
    }));

  if (status === 'active') {
    await Promise.all([
      dependencies.revisions.activate(normalizedProfileId, revision.id),
      dependencies.profiles.setActive(normalizedProfileId, revision.id),
    ]);
  }

  return {
    ...toProfileRevisionSummary(revision),
    profileId: normalizedProfileId,
    content: revision.content,
    structuredContent: resolveStructuredContent(revision.structuredContent, revision.content),
  };
}

export async function listProfileContents(
  overrides?: Partial<ProfileContentDependencies>,
): Promise<ProfileContentListResponse> {
  const dependencies = getDependencies(overrides);
  const profiles = await listActiveProfileOptions(dependencies);
  return { profiles };
}

export async function getProfileContent(
  profileId: string,
  overrides?: Partial<ProfileContentDependencies>,
): Promise<ProfileContentResponse | null> {
  const dependencies = getDependencies(overrides);
  const normalizedProfileId = normalizeProfileId(profileId);
  const profile = await dependencies.profiles.getById(normalizedProfileId);
  if (!profile?.activeRevisionId) return null;

  const revision = await dependencies.revisions.getById(
    normalizedProfileId,
    profile.activeRevisionId,
  );
  if (!revision) return null;

  return {
    id: profile.id,
    label: profile.label,
    content: revision.content,
    structuredContent: resolveStructuredContent(revision.structuredContent, revision.content),
    currentRevisionId: revision.id,
    updatedAt: revision.createdAt.toISOString(),
  };
}

export async function upsertProfileContent(
  profileId: string,
  content: string,
  overrides?: Partial<ProfileContentDependencies & { createdBy: string | null }>,
): Promise<ProfileContentResponse> {
  return upsertProfileContentWithRevision(profileId, content, overrides, {
    source: undefined,
    createdBy: overrides?.createdBy ?? null,
    restoredFromRevisionId: null,
  });
}

export async function saveProfileRevisionContent(
  profileId: string,
  content: string,
  options: SaveProfileRevisionContentOptions = {},
  overrides?: Partial<ProfileContentDependencies>,
): Promise<ProfileRevisionDetailResponse> {
  return saveProfileRevision(profileId, content, overrides, options);
}

export async function deleteProfileContent(
  profileId: string,
  overrides?: Partial<ProfileContentDependencies>,
): Promise<boolean> {
  const dependencies = getDependencies(overrides);
  const normalizedProfileId = normalizeProfileId(profileId);
  const profile = await dependencies.profiles.getById(normalizedProfileId);
  if (!profile?.activeRevisionId) return false;

  await Promise.all([
    dependencies.revisions.deprecateActive(normalizedProfileId),
    dependencies.profiles.setActive(normalizedProfileId, null),
  ]);

  return true;
}

export async function listProfileRevisionsForProfile(
  profileId: string,
  params: {
    limit?: number;
    offset?: number;
    order?: 'asc' | 'desc';
  } = {},
  overrides?: Partial<ProfileContentDependencies>,
): Promise<ProfileRevisionListResponse | null> {
  const dependencies = getDependencies(overrides);
  const normalizedProfileId = normalizeProfileId(profileId);
  const profile = await dependencies.profiles.getById(normalizedProfileId);
  if (!profile) return null;

  const result = await dependencies.revisions.list({
    profileId: normalizedProfileId,
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

export async function getProfileRevisionForProfile(
  profileId: string,
  revisionId: string,
  overrides?: Partial<ProfileContentDependencies>,
): Promise<ProfileRevisionDetailResponse | null> {
  const dependencies = getDependencies(overrides);
  const normalizedProfileId = normalizeProfileId(profileId);
  const profile = await dependencies.profiles.getById(normalizedProfileId);
  if (!profile) return null;

  const revision = await dependencies.revisions.getById(normalizedProfileId, revisionId);
  if (!revision) return null;

  return {
    ...toProfileRevisionSummary(revision),
    content: revision.content,
    structuredContent: resolveStructuredContent(revision.structuredContent, revision.content),
  };
}

export async function restoreProfileRevision(
  profileId: string,
  revisionId: string,
  overrides?: Partial<ProfileContentDependencies & { createdBy: string | null }>,
): Promise<ProfileContentResponse | null> {
  const dependencies = getDependencies(overrides);
  const normalizedProfileId = normalizeProfileId(profileId);
  const profile = await dependencies.profiles.getById(normalizedProfileId);
  if (!profile) return null;

  const revision = await dependencies.revisions.getById(normalizedProfileId, revisionId);
  if (!revision) return null;

  return upsertProfileContentWithRevision(normalizedProfileId, revision.content, overrides, {
    source: 'restore',
    createdBy: overrides?.createdBy ?? null,
    restoredFromRevisionId: revision.id,
    structuredContent: revision.structuredContent,
  });
}

export async function activateProfileRevisionForProfile(
  profileId: string,
  revisionId: string,
  overrides?: Partial<ProfileContentDependencies>,
): Promise<ProfileRevisionDetailResponse | null> {
  const dependencies = getDependencies(overrides);
  const normalizedProfileId = normalizeProfileId(profileId);
  const profile = await dependencies.profiles.getById(normalizedProfileId);
  if (!profile) return null;

  const activated = await dependencies.revisions.activate(normalizedProfileId, revisionId);
  if (!activated) return null;

  await dependencies.profiles.setActive(normalizedProfileId, activated.id);
  if (activated.source === 'candidate_promotion') {
    await dependencies.candidates.markPromotedByRevision(activated.id);
  }

  return {
    ...toProfileRevisionSummary(activated),
    content: activated.content,
    structuredContent: resolveStructuredContent(activated.structuredContent, activated.content),
  };
}
