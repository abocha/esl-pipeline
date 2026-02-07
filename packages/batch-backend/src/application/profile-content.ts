import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import type {
  ProfileRevisionRecord,
  ProfileRevisionSource,
} from '../domain/profile-revision-model.js';
import {
  getLatestProfileRevisionByHash,
  getProfileRevisionById,
  insertProfileRevision,
  listProfileRevisions,
} from '../domain/profile-revision-repository.js';
import {
  type PromptOption,
  type PromptOptionWithPath,
  listPromptProfilesWithPath,
} from './prompt-options.js';

const PROFILE_EXTENSIONS = new Set(['.md', '.txt']);

export interface ProfileContentListResponse {
  profiles: PromptOption[];
}

export interface ProfileContentResponse {
  id: string;
  label: string;
  content: string;
  currentRevisionId: string | null;
  updatedAt: string | null;
}

export interface ProfileRevisionSummaryResponse {
  id: string;
  profileId: string;
  contentHash: string;
  source: ProfileRevisionSource;
  createdAt: string;
  createdBy: string | null;
  restoredFromRevisionId: string | null;
}

export interface ProfileRevisionDetailResponse extends ProfileRevisionSummaryResponse {
  content: string;
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
  list: typeof listProfileRevisions;
  getById: typeof getProfileRevisionById;
  getLatestByHash: typeof getLatestProfileRevisionByHash;
}

interface ProfileContentDependencies {
  config: BatchBackendConfig;
  revisions: ProfileRevisionDependencies;
}

interface UpsertProfileContentOptions {
  source?: ProfileRevisionSource;
  createdBy?: string | null;
  restoredFromRevisionId?: string | null;
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
  return id.replaceAll('\\', '/').replace(/^\/+/, '');
}

function isWithinRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  if (!relative) return true;
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

function resolveProfilePathForId(profileId: string, profileRoot: string): string {
  const normalized = normalizeProfileId(profileId);
  if (!normalized) {
    throw new ProfileContentError('profileId is required', 'profile_id_missing', 400);
  }
  const ext = path.extname(normalized).toLowerCase();
  if (!PROFILE_EXTENSIONS.has(ext)) {
    throw new ProfileContentError('profileId must end with .md or .txt', 'profile_id_invalid', 400);
  }
  const candidate = path.resolve(profileRoot, normalized);
  if (!isWithinRoot(profileRoot, candidate)) {
    throw new ProfileContentError(
      'profileId must resolve within the configured profile root',
      'profile_id_outside_root',
      400,
    );
  }
  return candidate;
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
      list: listProfileRevisions,
      getById: getProfileRevisionById,
      getLatestByHash: getLatestProfileRevisionByHash,
    },
  };
}

async function loadProfileOptions(
  overrides?: Partial<ProfileContentDependencies>,
): Promise<{ profiles: PromptOptionWithPath[]; profileRoot: string }> {
  const { config } = getDependencies(overrides);
  const { profiles, profileRoot } = await listPromptProfilesWithPath({ config });
  return { profiles, profileRoot };
}

function hashProfileContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function toProfileRevisionSummary(
  revision: ProfileRevisionRecord,
): ProfileRevisionSummaryResponse {
  return {
    id: revision.id,
    profileId: revision.profileId,
    contentHash: revision.contentHash,
    source: revision.source,
    createdAt: revision.createdAt.toISOString(),
    createdBy: revision.createdBy ?? null,
    restoredFromRevisionId: revision.restoredFromRevisionId ?? null,
  };
}

async function resolveCurrentRevisionMetadata(
  profileId: string,
  content: string,
  revisions: ProfileRevisionDependencies,
): Promise<{ currentRevisionId: string | null; updatedAt: string | null }> {
  try {
    const currentHash = hashProfileContent(content);
    const currentRevision = await revisions.getLatestByHash(profileId, currentHash);
    return {
      currentRevisionId: currentRevision?.id ?? null,
      updatedAt: currentRevision?.createdAt ? currentRevision.createdAt.toISOString() : null,
    };
  } catch {
    return {
      currentRevisionId: null,
      updatedAt: null,
    };
  }
}

async function upsertProfileContentWithRevision(
  profileId: string,
  content: string,
  overrides: Partial<ProfileContentDependencies> | undefined,
  options: UpsertProfileContentOptions,
): Promise<ProfileContentResponse> {
  const dependencies = getDependencies(overrides);
  const { profiles, profileRoot } = await loadProfileOptions(dependencies);
  const entry = profiles.find((profile) => profile.id === profileId);
  const targetPath = entry ? entry.path : resolveProfilePathForId(profileId, profileRoot);
  const normalizedContent = content ?? '';

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, normalizedContent, 'utf8');

  const hash = hashProfileContent(normalizedContent);
  const source = options.source ?? (entry ? 'update' : 'create');
  let currentRevisionId: string | null = null;
  let updatedAt: string | null = null;

  try {
    const existingRevision =
      source === 'restore' ? null : await dependencies.revisions.getLatestByHash(profileId, hash);
    const revision =
      existingRevision ??
      (await dependencies.revisions.insert({
        profileId,
        content: normalizedContent,
        contentHash: hash,
        source,
        createdBy: options.createdBy ?? null,
        restoredFromRevisionId: options.restoredFromRevisionId ?? null,
      }));

    currentRevisionId = revision.id;
    updatedAt = revision.createdAt.toISOString();
  } catch {
    currentRevisionId = null;
    updatedAt = null;
  }

  return {
    id: entry?.id ?? profileId,
    label: entry?.label ?? formatProfileLabel(profileId),
    content: normalizedContent,
    currentRevisionId,
    updatedAt,
  };
}

export async function listProfileContents(
  overrides?: Partial<ProfileContentDependencies>,
): Promise<ProfileContentListResponse> {
  const { profiles } = await loadProfileOptions(overrides);
  return {
    profiles: profiles.map(({ id, label }) => ({ id, label })),
  };
}

export async function getProfileContent(
  profileId: string,
  overrides?: Partial<ProfileContentDependencies>,
): Promise<ProfileContentResponse | null> {
  const dependencies = getDependencies(overrides);
  const { profiles } = await loadProfileOptions(dependencies);
  const entry = profiles.find((profile) => profile.id === profileId);
  if (!entry) return null;

  const content = await fs.readFile(entry.path, 'utf8');
  const metadata = await resolveCurrentRevisionMetadata(profileId, content, dependencies.revisions);
  return {
    id: entry.id,
    label: entry.label,
    content,
    ...metadata,
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

export async function deleteProfileContent(
  profileId: string,
  overrides?: Partial<ProfileContentDependencies>,
): Promise<boolean> {
  const { profiles } = await loadProfileOptions(overrides);
  const entry = profiles.find((profile) => profile.id === profileId);
  if (!entry) return false;
  await fs.unlink(entry.path);
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
  const { profiles } = await loadProfileOptions(dependencies);
  const entry = profiles.find((profile) => profile.id === profileId);
  if (!entry) return null;

  const result = await dependencies.revisions.list({
    profileId,
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
  const { profiles } = await loadProfileOptions(dependencies);
  const entry = profiles.find((profile) => profile.id === profileId);
  if (!entry) return null;

  const revision = await dependencies.revisions.getById(profileId, revisionId);
  if (!revision) return null;

  return {
    ...toProfileRevisionSummary(revision),
    content: revision.content,
  };
}

export async function restoreProfileRevision(
  profileId: string,
  revisionId: string,
  overrides?: Partial<ProfileContentDependencies & { createdBy: string | null }>,
): Promise<ProfileContentResponse | null> {
  const dependencies = getDependencies(overrides);
  const revision = await dependencies.revisions.getById(profileId, revisionId);
  if (!revision) return null;

  return upsertProfileContentWithRevision(profileId, revision.content, overrides, {
    source: 'restore',
    createdBy: overrides?.createdBy ?? null,
    restoredFromRevisionId: revision.id,
  });
}
