import path from 'node:path';

import { ASSIGNMENT_TEMPLATE_ID } from '@esl-pipeline/contracts';

import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import type { TemplateRecord } from '../domain/template-model.js';
import { getTemplateById, listTemplates } from '../domain/template-repository.js';
import { listTemplateIdsWithActiveRevision } from '../domain/template-revision-repository.js';
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
  defaults: {
    templateId: string | null;
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

interface PromptOptionsDependencies {
  config: BatchBackendConfig;

  templateRevisions: {
    listIdsWithActiveRevision: typeof listTemplateIdsWithActiveRevision;
  };
  templates: {
    list: typeof listTemplates;
    getById: typeof getTemplateById;
  };
}

function getDependencies(
  overrides?: Partial<PromptOptionsDependencies>,
): PromptOptionsDependencies {
  return {
    config: overrides?.config ?? loadConfig(),
    templateRevisions: overrides?.templateRevisions ?? {
      listIdsWithActiveRevision: listTemplateIdsWithActiveRevision,
    },
    templates: overrides?.templates ?? {
      list: listTemplates,
      getById: getTemplateById,
    },
  };
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
  const { templates, defaultTemplateId } = await loadTemplateOptionList(dependencies);

  return {
    templates: templates.map(({ id, label }) => ({ id, label })),
    defaults: { templateId: defaultTemplateId },
  };
}

export async function resolvePromptTemplateSelection(
  params: { templateId?: string | null },
  overrides?: Partial<PromptOptionsDependencies>,
): Promise<{ templateId: string }> {
  const dependencies = getDependencies(overrides);
  const { templates, defaultTemplateId } = await loadTemplateOptionList(dependencies);
  const templateId = params.templateId ?? defaultTemplateId;
  if (!templateId) {
    throw new PromptOptionError('templateId is required', 'template_id_missing');
  }
  const template = templates.find((option) => option.id === templateId);
  if (!template) {
    throw new PromptOptionError('templateId is not allowlisted', 'template_id_not_allowed');
  }
  return { templateId: template.id };
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

async function loadTemplateOptionList(dependencies: PromptOptionsDependencies): Promise<{
  templates: PromptOptionWithPath[];
  templateRoot: string;
  defaultTemplateId: string | null;
}> {
  const templateRoot = resolveConfiguredPromptRoot(
    dependencies.config.prompt.templatePath,
    'template',
  );
  const templateRecords = await listAllTemplateRecords(dependencies);
  const activeTemplateIds = await dependencies.templateRevisions.listIdsWithActiveRevision(
    templateRecords.map((template) => template.id),
  );
  const templates = toActivePromptOptions(templateRecords, activeTemplateIds);
  const configuredDefaultTemplateId = resolveDefaultId(
    dependencies.config.prompt.templatePath,
    templates,
    'template',
  );
  const databaseDefaultTemplateId = templateRecords.find(
    (template) => template.isDefault && templates.some((option) => option.id === template.id),
  )?.id;
  return {
    templates,
    templateRoot,
    defaultTemplateId: databaseDefaultTemplateId ?? configuredDefaultTemplateId,
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

function toActivePromptOptions(
  records: TemplateRecord[],
  confirmedActiveIds: ReadonlySet<string>,
): PromptOptionWithPath[] {
  return records
    .filter(
      (record) =>
        record.id === ASSIGNMENT_TEMPLATE_ID &&
        Boolean(record.activeRevisionId) &&
        confirmedActiveIds.has(record.id),
    )
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
