import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import type {
  TemplateRevisionRecord,
  TemplateRevisionSource,
  TemplateRevisionStatus,
} from '../domain/template-revision-model.js';
import {
  activateTemplateRevision,
  getLatestTemplateRevisionByHash,
  getTemplateRevisionById,
  insertTemplateRevision,
  listTemplateRevisions,
} from '../domain/template-revision-repository.js';
import { setTemplateActiveRevision, upsertTemplate } from '../domain/template-repository.js';
import {
  type PromptOption,
  type PromptOptionWithPath,
  listPromptTemplatesWithPath,
} from './prompt-options.js';

const TEMPLATE_EXTENSIONS = new Set(['.md', '.txt']);

export interface TemplateContentListResponse {
  templates: PromptOption[];
}

export interface TemplateContentResponse {
  id: string;
  label: string;
  content: string;
  currentRevisionId: string | null;
  updatedAt: string | null;
}

export interface TemplateRevisionSummaryResponse {
  id: string;
  templateId: string;
  contentHash: string;
  source: TemplateRevisionSource;
  status: TemplateRevisionStatus;
  versionNumber: number;
  versionLabel: string;
  activatedAt: string | null;
  deprecatedAt: string | null;
  createdAt: string;
  createdBy: string | null;
  restoredFromRevisionId: string | null;
}

export interface TemplateRevisionDetailResponse extends TemplateRevisionSummaryResponse {
  content: string;
}

export interface TemplateRevisionListResponse {
  items: TemplateRevisionSummaryResponse[];
  total: number;
  limit: number;
  offset: number;
  order: 'asc' | 'desc';
}

interface TemplateRevisionDependencies {
  insert: typeof insertTemplateRevision;
  activate: typeof activateTemplateRevision;
  list: typeof listTemplateRevisions;
  getById: typeof getTemplateRevisionById;
  getLatestByHash: typeof getLatestTemplateRevisionByHash;
}

interface TemplateContentDependencies {
  config: BatchBackendConfig;
  revisions: TemplateRevisionDependencies;
  templates: {
    upsert: typeof upsertTemplate;
    setActive: typeof setTemplateActiveRevision;
  };
}

interface UpsertTemplateContentOptions {
  source?: TemplateRevisionSource;
  createdBy?: string | null;
  restoredFromRevisionId?: string | null;
}

export class TemplateContentError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status = 400) {
    super(message);
    this.name = 'TemplateContentError';
    this.code = code;
    this.status = status;
  }
}

function normalizeTemplateId(id: string): string {
  return id.replaceAll('\\', '/').replace(/^\/+/, '');
}

function isWithinRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  if (!relative) return true;
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

function resolveTemplatePathForId(templateId: string, templateRoot: string): string {
  const normalized = normalizeTemplateId(templateId);
  if (!normalized) {
    throw new TemplateContentError('templateId is required', 'template_id_missing', 400);
  }
  const ext = path.extname(normalized).toLowerCase();
  if (!TEMPLATE_EXTENSIONS.has(ext)) {
    throw new TemplateContentError(
      'templateId must end with .md or .txt',
      'template_id_invalid',
      400,
    );
  }
  const candidate = path.resolve(templateRoot, normalized);
  if (!isWithinRoot(templateRoot, candidate)) {
    throw new TemplateContentError(
      'templateId must resolve within the configured template root',
      'template_id_outside_root',
      400,
    );
  }
  return candidate;
}

function formatTemplateLabel(templateId: string): string {
  const base = path.basename(templateId, path.extname(templateId));
  const normalized = base.replaceAll(/[_-]+/g, ' ').trim();
  return normalized.length > 0 ? normalized : templateId;
}

function getDependencies(
  overrides?: Partial<TemplateContentDependencies>,
): TemplateContentDependencies {
  return {
    config: overrides?.config ?? loadConfig(),
    revisions: overrides?.revisions ?? {
      insert: insertTemplateRevision,
      activate: activateTemplateRevision,
      list: listTemplateRevisions,
      getById: getTemplateRevisionById,
      getLatestByHash: getLatestTemplateRevisionByHash,
    },
    templates: overrides?.templates ?? {
      upsert: upsertTemplate,
      setActive: setTemplateActiveRevision,
    },
  };
}

async function loadTemplateOptions(
  overrides?: Partial<TemplateContentDependencies>,
): Promise<{ templates: PromptOptionWithPath[]; templateRoot: string }> {
  const { config } = getDependencies(overrides);
  const { templates, templateRoot } = await listPromptTemplatesWithPath({ config });
  return { templates, templateRoot };
}

function hashTemplateContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function toTemplateRevisionSummary(
  revision: TemplateRevisionRecord,
): TemplateRevisionSummaryResponse {
  return {
    id: revision.id,
    templateId: revision.templateId,
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

async function resolveCurrentRevisionMetadata(
  templateId: string,
  content: string,
  revisions: TemplateRevisionDependencies,
): Promise<{ currentRevisionId: string | null; updatedAt: string | null }> {
  try {
    const currentHash = hashTemplateContent(content);
    const currentRevision = await revisions.getLatestByHash(templateId, currentHash);
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

async function upsertTemplateContentWithRevision(
  templateId: string,
  content: string,
  overrides: Partial<TemplateContentDependencies> | undefined,
  options: UpsertTemplateContentOptions,
): Promise<TemplateContentResponse> {
  const dependencies = getDependencies(overrides);
  const { templates, templateRoot } = await loadTemplateOptions(dependencies);
  const entry = templates.find((template) => template.id === templateId);
  const targetPath = entry ? entry.path : resolveTemplatePathForId(templateId, templateRoot);
  const normalizedContent = content ?? '';

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, normalizedContent, 'utf8');

  const hash = hashTemplateContent(normalizedContent);
  const source = options.source ?? (entry ? 'update' : 'create');
  let currentRevisionId: string | null = null;
  let updatedAt: string | null = null;

  try {
    await dependencies.templates
      .upsert({
        id: templateId,
        label: entry?.label ?? formatTemplateLabel(templateId),
        activeRevisionId: null,
      })
      .catch(() => null);

    const existingRevision =
      source === 'restore' ? null : await dependencies.revisions.getLatestByHash(templateId, hash);
    const revision =
      existingRevision ??
      (await dependencies.revisions.insert({
        templateId,
        content: normalizedContent,
        contentHash: hash,
        source,
        createdBy: options.createdBy ?? null,
        restoredFromRevisionId: options.restoredFromRevisionId ?? null,
      }));

    await Promise.all([
      dependencies.templates
        .upsert({
          id: templateId,
          label: entry?.label ?? formatTemplateLabel(templateId),
          activeRevisionId: revision.id,
        })
        .catch(() => null),
      dependencies.revisions.activate(templateId, revision.id).catch(() => null),
      dependencies.templates.setActive(templateId, revision.id).catch(() => null),
    ]);

    currentRevisionId = revision.id;
    updatedAt = revision.createdAt.toISOString();
  } catch {
    currentRevisionId = null;
    updatedAt = null;
  }

  return {
    id: entry?.id ?? templateId,
    label: entry?.label ?? formatTemplateLabel(templateId),
    content: normalizedContent,
    currentRevisionId,
    updatedAt,
  };
}

export async function listTemplateContents(
  overrides?: Partial<TemplateContentDependencies>,
): Promise<TemplateContentListResponse> {
  const { templates } = await loadTemplateOptions(overrides);
  return {
    templates: templates.map(({ id, label }) => ({ id, label })),
  };
}

export async function getTemplateContent(
  templateId: string,
  overrides?: Partial<TemplateContentDependencies>,
): Promise<TemplateContentResponse | null> {
  const dependencies = getDependencies(overrides);
  const { templates } = await loadTemplateOptions(dependencies);
  const entry = templates.find((template) => template.id === templateId);
  if (!entry) return null;

  const content = await fs.readFile(entry.path, 'utf8');
  const metadata = await resolveCurrentRevisionMetadata(templateId, content, dependencies.revisions);
  return {
    id: entry.id,
    label: entry.label,
    content,
    ...metadata,
  };
}

export async function listTemplateRevisionsForTemplate(
  templateId: string,
  params: {
    limit?: number;
    offset?: number;
    order?: 'asc' | 'desc';
  } = {},
  overrides?: Partial<TemplateContentDependencies>,
): Promise<TemplateRevisionListResponse | null> {
  const dependencies = getDependencies(overrides);
  const { templates } = await loadTemplateOptions(dependencies);
  const entry = templates.find((template) => template.id === templateId);
  if (!entry) return null;

  const result = await dependencies.revisions.list({
    templateId,
    limit: params.limit,
    offset: params.offset,
    order: params.order,
  });

  return {
    items: result.items.map((item) => toTemplateRevisionSummary(item)),
    total: result.total,
    limit: result.limit,
    offset: result.offset,
    order: result.order,
  };
}

export async function getTemplateRevisionForTemplate(
  templateId: string,
  revisionId: string,
  overrides?: Partial<TemplateContentDependencies>,
): Promise<TemplateRevisionDetailResponse | null> {
  const dependencies = getDependencies(overrides);
  const { templates } = await loadTemplateOptions(dependencies);
  const entry = templates.find((template) => template.id === templateId);
  if (!entry) return null;

  const revision = await dependencies.revisions.getById(templateId, revisionId);
  if (!revision) return null;

  return {
    ...toTemplateRevisionSummary(revision),
    content: revision.content,
  };
}

export async function restoreTemplateRevision(
  templateId: string,
  revisionId: string,
  overrides?: Partial<TemplateContentDependencies & { createdBy: string | null }>,
): Promise<TemplateContentResponse | null> {
  const dependencies = getDependencies(overrides);
  const revision = await dependencies.revisions.getById(templateId, revisionId);
  if (!revision) return null;

  return upsertTemplateContentWithRevision(templateId, revision.content, overrides, {
    source: 'restore',
    createdBy: overrides?.createdBy ?? null,
    restoredFromRevisionId: revision.id,
  });
}

export async function activateTemplateRevisionForTemplate(
  templateId: string,
  revisionId: string,
  overrides?: Partial<TemplateContentDependencies>,
): Promise<TemplateRevisionDetailResponse | null> {
  const dependencies = getDependencies(overrides);
  const { templates } = await loadTemplateOptions(dependencies);
  const entry = templates.find((template) => template.id === templateId);
  if (!entry) return null;

  const activated = await dependencies.revisions.activate(templateId, revisionId);
  if (!activated) return null;

  await Promise.all([
    dependencies.templates
      .upsert({
        id: templateId,
        label: entry.label,
        activeRevisionId: activated.id,
      })
      .catch(() => null),
    dependencies.templates.setActive(templateId, activated.id).catch(() => null),
  ]);

  return {
    ...toTemplateRevisionSummary(activated),
    content: activated.content,
  };
}
