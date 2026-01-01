import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import { resolveRepoPath } from './prompt-assembly.js';
import { resolveProfileRoot, resolveUserProfilePath } from './profile-path.js';

const PROMPT_EXTENSIONS = new Set(['.md', '.txt']);

export interface PromptOption {
  id: string;
  label: string;
}

interface PromptOptionWithPath extends PromptOption {
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
  templatePath: string;
  profileId: string;
  profilePath: string;
}

export async function resolveAllowlistedProfilePath(
  profilePath: string,
  overrides?: Partial<{ config: BatchBackendConfig }>,
): Promise<string> {
  if (!profilePath) {
    throw new PromptOptionError('profilePath is required', 'profile_path_missing');
  }
  const config = overrides?.config ?? loadConfig();
  const { profiles, profileRoot } = await loadProfileOptionList(config);
  const resolvedPath = await resolveUserProfilePath(profilePath, profileRoot);
  const profile = profiles.find((option) => option.path === resolvedPath);
  if (!profile) {
    throw new PromptOptionError(
      'profilePath must reference an allowlisted profile',
      'profile_path_not_allowed',
    );
  }
  return resolvedPath;
}

export async function getPromptOptions(
  overrides?: Partial<{ config: BatchBackendConfig }>,
): Promise<PromptOptionsResponse> {
  const config = overrides?.config ?? loadConfig();
  const { templates, profiles, defaults } = await loadPromptOptionLists(config);

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
  overrides?: Partial<{ config: BatchBackendConfig }>,
): Promise<PromptSelectionResult> {
  const config = overrides?.config ?? loadConfig();
  const { templates, profiles, defaults, profileRoot } = await loadPromptOptionLists(config);

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
      templatePath: template.path,
      profileId: profile.id,
      profilePath: profile.path,
    };
  }

  if (params.profilePath) {
    const resolvedPath = await resolveUserProfilePath(params.profilePath, profileRoot);
    const profile = profiles.find((option) => option.path === resolvedPath);
    if (!profile) {
      throw new PromptOptionError(
        'profilePath must reference an allowlisted profile',
        'profile_path_not_allowed',
      );
    }
    return {
      templateId: template.id,
      templatePath: template.path,
      profileId: profile.id,
      profilePath: resolvedPath,
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
    templatePath: template.path,
    profileId: profile.id,
    profilePath: profile.path,
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

async function loadPromptOptionLists(config: BatchBackendConfig): Promise<PromptOptionLists> {
  const [templateOptions, profileOptions] = await Promise.all([
    loadTemplateOptionList(config),
    loadProfileOptionList(config),
  ]);

  return {
    templates: templateOptions.templates,
    profiles: profileOptions.profiles,
    defaults: {
      templateId: templateOptions.defaultTemplateId,
      profileId: profileOptions.defaultProfileId,
    },
    templateRoot: templateOptions.templateRoot,
    profileRoot: profileOptions.profileRoot,
  };
}

async function loadTemplateOptionList(config: BatchBackendConfig): Promise<{
  templates: PromptOptionWithPath[];
  templateRoot: string;
  defaultTemplateId: string | null;
}> {
  const templateRoot = await resolveTemplateRoot(config.prompt.templatePath);
  const templates = await listPromptFiles(templateRoot);
  const defaultTemplateId = await resolveDefaultId(
    config.prompt.templatePath,
    templateRoot,
    templates,
    'template',
  );

  return {
    templates,
    templateRoot,
    defaultTemplateId,
  };
}

async function loadProfileOptionList(config: BatchBackendConfig): Promise<{
  profiles: PromptOptionWithPath[];
  profileRoot: string;
  defaultProfileId: string | null;
}> {
  const profileRoot = await resolveProfileRoot(config.prompt.defaultProfilePath);
  const profiles = await listPromptFiles(profileRoot);
  const defaultProfileId = await resolveDefaultId(
    config.prompt.defaultProfilePath,
    profileRoot,
    profiles,
    'profile',
  );

  return {
    profiles,
    profileRoot,
    defaultProfileId,
  };
}

async function resolveTemplateRoot(templatePath: string): Promise<string> {
  if (!templatePath) {
    throw new PromptOptionError('Prompt template root is not configured', 'template_root_missing');
  }

  const repoRoot = await fs.realpath(resolveRepoPath());
  const candidate = path.isAbsolute(templatePath)
    ? templatePath
    : path.resolve(repoRoot, templatePath);
  const rootDir = path.dirname(candidate);

  try {
    return await fs.realpath(rootDir);
  } catch {
    throw new PromptOptionError('Prompt template root does not exist', 'template_root_missing');
  }
}

async function resolveDefaultId(
  inputPath: string,
  rootDir: string,
  options: PromptOptionWithPath[],
  type: 'template' | 'profile',
): Promise<string | null> {
  if (!inputPath) {
    throw new PromptOptionError(
      `Prompt ${type} path is not configured`,
      `${type}_path_missing`,
    );
  }

  const resolvedPath = await resolvePromptPath(inputPath);
  if (!isWithinRoot(rootDir, resolvedPath)) {
    throw new PromptOptionError(
      `Prompt ${type} path must resolve within the configured root`,
      `${type}_path_outside_root`,
    );
  }

  const match = options.find((option) => option.path === resolvedPath);
  return match?.id ?? null;
}

async function resolvePromptPath(inputPath: string): Promise<string> {
  const repoRoot = await fs.realpath(resolveRepoPath());
  const candidate = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(repoRoot, inputPath);

  try {
    return await fs.realpath(candidate);
  } catch {
    throw new PromptOptionError('Prompt path does not exist', 'prompt_path_not_found');
  }
}

async function listPromptFiles(rootDir: string): Promise<PromptOptionWithPath[]> {
  const options: PromptOptionWithPath[] = [];

  const visit = async (currentDir: string) => {
    let entries: Dirent[];
    try {
      entries = (await fs.readdir(currentDir, {
        withFileTypes: true,
        encoding: 'utf8',
      })) as Dirent[];
    } catch {
      throw new PromptOptionError('Prompt root does not exist', 'prompt_root_missing');
    }

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        let resolvedDir;
        try {
          resolvedDir = await fs.realpath(entryPath);
        } catch {
          continue;
        }
        if (!isWithinRoot(rootDir, resolvedDir)) continue;
        await visit(resolvedDir);
        continue;
      }

      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!PROMPT_EXTENSIONS.has(ext)) continue;
      let resolvedPath;
      try {
        resolvedPath = await fs.realpath(entryPath);
      } catch {
        continue;
      }
      if (!isWithinRoot(rootDir, resolvedPath)) continue;
      const id = normalizeOptionId(rootDir, resolvedPath);
      const label = formatOptionLabel(entry.name);
      options.push({ id, label, path: resolvedPath });
    }
  };

  await visit(rootDir);

  return options.sort((a, b) => a.label.localeCompare(b.label));
}

function normalizeOptionId(rootDir: string, filePath: string): string {
  const relative = path.relative(rootDir, filePath);
  return relative.split(path.sep).join('/');
}

function formatOptionLabel(filename: string): string {
  const base = path.basename(filename, path.extname(filename));
  const normalized = base.replaceAll(/[_-]+/g, ' ').trim();
  return normalized.length > 0 ? normalized : filename;
}

function isWithinRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  if (!relative) return true;
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}
