import fs from 'node:fs/promises';
import path from 'node:path';

import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
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

async function loadProfileOptions(
  overrides?: Partial<{ config: BatchBackendConfig }>,
): Promise<{ profiles: PromptOptionWithPath[]; profileRoot: string }> {
  const config = overrides?.config ?? loadConfig();
  const { profiles, profileRoot } = await listPromptProfilesWithPath({ config });
  return { profiles, profileRoot };
}

export async function listProfileContents(
  overrides?: Partial<{ config: BatchBackendConfig }>,
): Promise<ProfileContentListResponse> {
  const { profiles } = await loadProfileOptions(overrides);
  return {
    profiles: profiles.map(({ id, label }) => ({ id, label })),
  };
}

export async function getProfileContent(
  profileId: string,
  overrides?: Partial<{ config: BatchBackendConfig }>,
): Promise<ProfileContentResponse | null> {
  const { profiles } = await loadProfileOptions(overrides);
  const entry = profiles.find((profile) => profile.id === profileId);
  if (!entry) return null;

  const content = await fs.readFile(entry.path, 'utf8');
  return {
    id: entry.id,
    label: entry.label,
    content,
  };
}

export async function upsertProfileContent(
  profileId: string,
  content: string,
  overrides?: Partial<{ config: BatchBackendConfig }>,
): Promise<ProfileContentResponse> {
  const { profiles, profileRoot } = await loadProfileOptions(overrides);
  const entry = profiles.find((profile) => profile.id === profileId);
  const targetPath = entry ? entry.path : resolveProfilePathForId(profileId, profileRoot);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content ?? '', 'utf8');

  return {
    id: entry?.id ?? profileId,
    label: entry?.label ?? formatProfileLabel(profileId),
    content: content ?? '',
  };
}

export async function deleteProfileContent(
  profileId: string,
  overrides?: Partial<{ config: BatchBackendConfig }>,
): Promise<boolean> {
  const { profiles } = await loadProfileOptions(overrides);
  const entry = profiles.find((profile) => profile.id === profileId);
  if (!entry) return false;
  await fs.unlink(entry.path);
  return true;
}
