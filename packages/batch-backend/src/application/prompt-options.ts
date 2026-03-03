import path from 'node:path';

import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import type { ProfileRecord } from '../domain/profile-model.js';
import { listProfileIdsWithActiveRevision } from '../domain/profile-revision-repository.js';
import { getProfileById, listProfiles } from '../domain/profile-repository.js';
import type { TemplateRecord } from '../domain/template-model.js';
import { listTemplateIdsWithActiveRevision } from '../domain/template-revision-repository.js';
import { getTemplateById, listTemplates } from '../domain/template-repository.js';
import { resolveRepoPath } from './prompt-assembly.js';

const PROMPT_EXTENSIONS = new Set(['.md', '.txt']);
const MAX_PROMPT_PAGE_LIMIT = 500;

export interface PromptOption {
  id: string;
  label: string;
}

export interface PromptOptionWithPath extends PromptOption {
  path: string;
}

export interface PromptOptionsResponse {
  templates: PromptOption[];
  profiles: PromptOption[];
  defaults: {
    templateId: string | null;
    profileId: string | null;
  };
}

export class PromptOptionError extends Error {
  code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'PromptOptionError';
    this.code = code;
  }
}

export interface PromptSelectionResult {
  templateId: string;
  profileId: string;
  profilePath: string;
}

interface PromptOptionsDependencies {
  config: BatchBackendConfig;
  profileRevisions: {
    listIdsWithActiveRevision: typeof listProfileIdsWithActiveRevision;
  };
  profiles: {
    list: typeof listProfiles;
    getById: typeof getProfileById;
  };
  templateRevisions: {
    listIdsWithActiveRevision: typeof listTemplateIdsWithActiveRevision;
  };
  templates: {
    list: typeof listTemplates;
    getById: typeof getTemplateById;
  };
}

interface PromptOptionLists {
  templates: PromptOptionWithPath[];
  profiles: PromptOptionWithPath[];
  defaults: {
    templateId: string | null;
    profileId: string | null;
  };
  templateRoot: string;
  profileRoot: string;
}

function getDependencies(
  overrides?: Partial<PromptOptionsDependencies>,
): PromptOptionsDependencies {
  return {
    config: overrides?.config ?? loadConfig(),
    profileRevisions: overrides?.profileRevisions ?? {
      listIdsWithActiveRevision: listProfileIdsWithActiveRevision,
    },
    profiles: overrides?.profiles ?? {
      list: listProfiles,
      getById: getProfileById,
    },
    templateRevisions: overrides?.templateRevisions ?? {
      listIdsWithActiveRevision: listTemplateIdsWithActiveRevision,
    },
    templates: overrides?.templates ?? {
      list: listTemplates,
      getById: getTemplateById,
    },
  };
}

export async function resolveAllowlistedProfilePath(
  profilePath: string,
  overrides?: Partial<PromptOptionsDependencies>,
): Promise<string> {
  if (!profilePath) {
    throw new PromptOptionError('profilePath is required', 'profile_path_missing');
  }
  const dependencies = getDependencies(overrides);
  const { profiles, profileRoot } = await loadProfileOptionList(dependencies);
  const profileId = resolveProfileIdFromPathInput(profilePath, profileRoot);
  const profile = profiles.find((option) => option.id === profileId);
  if (!profile) {
    throw new PromptOptionError(
      'profilePath must reference an allowlisted profile',
      'profile_path_not_allowed',
    );
  }
  return profile.id;
}

export async function listPromptProfilesWithPath(
  overrides?: Partial<PromptOptionsDependencies>,
): Promise<{
  profiles: PromptOptionWithPath[];
  profileRoot: string;
  defaultProfileId: string | null;
}> {
  const dependencies = getDependencies(overrides);
  const { profiles, profileRoot, defaultProfileId } = await loadProfileOptionList(dependencies);
  return { profiles, profileRoot, defaultProfileId };
}

export async function listPromptTemplatesWithPath(
  overrides?: Partial<PromptOptionsDependencies>,
): Promise<{
  templates: PromptOptionWithPath[];
  templateRoot: string;
  defaultTemplateId: string | null;
}> {
  const dependencies = getDependencies(overrides);
  const { templates, templateRoot, defaultTemplateId } = await loadTemplateOptionList(dependencies);
  return { templates, templateRoot, defaultTemplateId };
}

export async function getPromptOptions(
  overrides?: Partial<PromptOptionsDependencies>,
): Promise<PromptOptionsResponse> {
  const dependencies = getDependencies(overrides);
  const { templates, profiles, defaults } = await loadPromptOptionLists(dependencies);

  return {
    templates: templates.map(({ id, label }) => ({ id, label })),
    profiles: profiles.map(({ id, label }) => ({ id, label })),
    defaults,
  };
}

export async function resolvePromptSelection(
  params: {
    templateId?: string | null;
    profileId?: string | null;
    profilePath?: string | null;
  },
  overrides?: Partial<PromptOptionsDependencies>,
): Promise<PromptSelectionResult> {
  const dependencies = getDependencies(overrides);
  const { templates, profiles, defaults, profileRoot } = await loadPromptOptionLists(dependencies);

  const templateId = params.templateId ?? defaults.templateId;
  if (!templateId) {
    throw new PromptOptionError('templateId is required', 'template_id_missing');
  }
  const template = templates.find((option) => option.id === templateId);
  if (!template) {
    throw new PromptOptionError('templateId is not allowlisted', 'template_id_not_allowed');
  }

  if (params.profileId) {
    const profile = profiles.find((option) => option.id === params.profileId);
    if (!profile) {
      throw new PromptOptionError('profileId is not allowlisted', 'profile_id_not_allowed');
    }
    return {
      templateId: template.id,
      profileId: profile.id,
      profilePath: profile.id,
    };
  }

  if (params.profilePath) {
    const profileId = resolveProfileIdFromPathInput(params.profilePath, profileRoot);
    const profile = profiles.find((option) => option.id === profileId);
    if (!profile) {
      throw new PromptOptionError(
        'profilePath must reference an allowlisted profile',
        'profile_path_not_allowed',
      );
    }
    return {
      templateId: template.id,
      profileId: profile.id,
      profilePath: profile.id,
    };
  }

  const profileId = defaults.profileId;
  if (!profileId) {
    throw new PromptOptionError('profileId is required', 'profile_id_missing');
  }
  const profile = profiles.find((option) => option.id === profileId);
  if (!profile) {
    throw new PromptOptionError('profileId is not allowlisted', 'profile_id_not_allowed');
  }

  return {
    templateId: template.id,
    profileId: profile.id,
    profilePath: profile.id,
  };
}

async function loadPromptOptionLists(
  dependencies: PromptOptionsDependencies,
): Promise<PromptOptionLists> {
  const templateRoot = resolveConfiguredPromptRoot(dependencies.config.prompt.templatePath, 'template');
  const profileRoot = resolveConfiguredPromptRoot(
    dependencies.config.prompt.defaultProfilePath,
    'profile',
  );

  const [templateRecords, profileRecords] = await Promise.all([
    listAllTemplateRecords(dependencies),
    listAllProfileRecords(dependencies),
  ]);

  const [activeTemplateIds, activeProfileIds] = await Promise.all([
    dependencies.templateRevisions.listIdsWithActiveRevision(
      templateRecords.map((template) => template.id),
    ),
    dependencies.profileRevisions.listIdsWithActiveRevision(
      profileRecords.map((profile) => profile.id),
    ),
  ]);

  const templates = toActivePromptOptions(templateRecords, activeTemplateIds);
  const profiles = toActivePromptOptions(profileRecords, activeProfileIds);

  const defaultTemplateId = resolveDefaultId(
    dependencies.config.prompt.templatePath,
    templates,
    'template',
  );
  const defaultProfileId = resolveDefaultId(
    dependencies.config.prompt.defaultProfilePath,
    profiles,
    'profile',
  );

  return {
    templates,
    profiles,
    defaults: {
      templateId: defaultTemplateId,
      profileId: defaultProfileId,
    },
    templateRoot,
    profileRoot,
  };
}

async function listAllTemplateRecords(
  dependencies: PromptOptionsDependencies,
): Promise<TemplateRecord[]> {
  const items: TemplateRecord[] = [];
  let offset = 0;
  while (true) {
    const page = await dependencies.templates.list({
      limit: MAX_PROMPT_PAGE_LIMIT,
      offset,
      order: 'asc',
    });
    items.push(...page.items);
    offset += page.items.length;
    if (offset >= page.total || page.items.length === 0) break;
  }
  return items;
}

async function listAllProfileRecords(
  dependencies: PromptOptionsDependencies,
): Promise<ProfileRecord[]> {
  const items: ProfileRecord[] = [];
  let offset = 0;
  while (true) {
    const page = await dependencies.profiles.list({
      limit: MAX_PROMPT_PAGE_LIMIT,
      offset,
      order: 'asc',
    });
    items.push(...page.items);
    offset += page.items.length;
    if (offset >= page.total || page.items.length === 0) break;
  }
  return items;
}

async function loadTemplateOptionList(
  dependencies: PromptOptionsDependencies,
): Promise<{
  templates: PromptOptionWithPath[];
  templateRoot: string;
  defaultTemplateId: string | null;
}> {
  const lists = await loadPromptOptionLists(dependencies);
  return {
    templates: lists.templates,
    templateRoot: lists.templateRoot,
    defaultTemplateId: lists.defaults.templateId,
  };
}

async function loadProfileOptionList(
  dependencies: PromptOptionsDependencies,
): Promise<{
  profiles: PromptOptionWithPath[];
  profileRoot: string;
  defaultProfileId: string | null;
}> {
  const lists = await loadPromptOptionLists(dependencies);
  return {
    profiles: lists.profiles,
    profileRoot: lists.profileRoot,
    defaultProfileId: lists.defaults.profileId,
  };
}

function resolveConfiguredPromptRoot(configuredPath: string, type: 'template' | 'profile'): string {
  if (!configuredPath || configuredPath.trim().length === 0) {
    throw new PromptOptionError(`Prompt ${type} path is not configured`, `${type}_path_missing`);
  }

  const repoRoot = resolveRepoPath();
  const candidate = path.isAbsolute(configuredPath)
    ? path.resolve(configuredPath)
    : path.resolve(repoRoot, configuredPath);
  return path.dirname(candidate);
}

function resolveDefaultId(
  configuredPath: string,
  options: PromptOptionWithPath[],
  type: 'template' | 'profile',
): string | null {
  const configuredId = resolveConfiguredPromptId(configuredPath, type);
  const match = options.find((option) => option.id === configuredId);
  return match?.id ?? null;
}

function resolveConfiguredPromptId(configuredPath: string, type: 'template' | 'profile'): string {
  if (!configuredPath || configuredPath.trim().length === 0) {
    throw new PromptOptionError(`Prompt ${type} path is not configured`, `${type}_path_missing`);
  }

  const normalized = configuredPath.replaceAll('\\', '/').trim();
  const defaultId = path.posix.basename(normalized);
  return normalizePromptId(defaultId, type);
}

function resolveProfileIdFromPathInput(inputPath: string, profileRoot: string): string {
  if (!inputPath || inputPath.trim().length === 0) {
    throw new PromptOptionError('profilePath is required', 'profile_path_missing');
  }

  const candidate = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(profileRoot, inputPath);

  if (!isWithinRoot(profileRoot, candidate)) {
    throw new PromptOptionError(
      'profilePath must resolve within the configured profile root',
      'profile_path_outside_root',
    );
  }

  const relative = path.relative(profileRoot, candidate).split(path.sep).join('/');
  return normalizePromptId(relative, 'profile');
}

function toActivePromptOptions(
  records: (ProfileRecord | TemplateRecord)[],
  confirmedActiveIds: ReadonlySet<string>,
): PromptOptionWithPath[] {
  return records
    .filter((record) => Boolean(record.activeRevisionId) && confirmedActiveIds.has(record.id))
    .map((record) => ({
      id: record.id,
      label: record.label,
      path: record.id,
    }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

function normalizePromptId(id: string, type: 'template' | 'profile'): string {
  const normalized = path.posix.normalize(id.replaceAll('\\', '/').replace(/^\/+/, '').trim());
  if (!normalized || normalized === '.' || normalized === '..') {
    throw new PromptOptionError(`${type} id is invalid`, `${type}_id_invalid`);
  }
  if (normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    throw new PromptOptionError(`${type} id is invalid`, `${type}_id_invalid`);
  }

  const ext = path.extname(normalized).toLowerCase();
  if (!PROMPT_EXTENSIONS.has(ext)) {
    throw new PromptOptionError(`${type} id must end with .md or .txt`, `${type}_id_invalid`);
  }

  return normalized;
}

function isWithinRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  if (!relative) return true;
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}
