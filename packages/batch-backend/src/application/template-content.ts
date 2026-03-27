import { createHash } from 'node:crypto';
import path from 'node:path';

import type { BatchBackendConfig } from '../config/env.js';
import { loadConfig } from '../config/env.js';
import {
  getTemplateById,
  listTemplates,
  setTemplateActiveRevision,
  upsertTemplate,
} from '../domain/template-repository.js';
import type {
  TemplateRevisionRecord,
  TemplateRevisionSource,
  TemplateRevisionStatus,
} from '../domain/template-revision-model.js';
import {
  activateTemplateRevision,
  deprecateActiveTemplateRevision,
  getLatestTemplateRevisionByHash,
  getTemplateRevisionById,
  insertTemplateRevision,
  listTemplateRevisions,
} from '../domain/template-revision-repository.js';
import type { PromptOption } from './prompt-options.js';

const TEMPLATE_EXTENSIONS = new Set(['.md', '.txt']);
const MAX_OPTION_PAGE_LIMIT = 500;
const LEGACY_PROFILE_MARKER = 'INSERT PROFILE HERE';

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
  deprecateActive: typeof deprecateActiveTemplateRevision;
  list: typeof listTemplateRevisions;
  getById: typeof getTemplateRevisionById;
  getLatestByHash: typeof getLatestTemplateRevisionByHash;
}

interface TemplateContentDependencies {
  config: BatchBackendConfig;
  revisions: TemplateRevisionDependencies;
  templates: {
    list: typeof listTemplates;
    getById: typeof getTemplateById;
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
  const normalized = path.posix
    .normalize(id.replaceAll('\\', '/').replace(/^\/+/, '').trim())
    .trim();

  if (!normalized || normalized === '.' || normalized === '..') {
    throw new TemplateContentError('templateId is required', 'template_id_missing', 400);
  }
  if (normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    throw new TemplateContentError('templateId is invalid', 'template_id_invalid', 400);
  }

  const ext = path.extname(normalized).toLowerCase();
  if (!TEMPLATE_EXTENSIONS.has(ext)) {
    throw new TemplateContentError(
      'templateId must end with .md or .txt',
      'template_id_invalid',
      400,
    );
  }

  return normalized;
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
      deprecateActive: deprecateActiveTemplateRevision,
      list: listTemplateRevisions,
      getById: getTemplateRevisionById,
      getLatestByHash: getLatestTemplateRevisionByHash,
    },
    templates: overrides?.templates ?? {
      list: listTemplates,
      getById: getTemplateById,
      upsert: upsertTemplate,
      setActive: setTemplateActiveRevision,
    },
  };
}

function hashTemplateContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function assertTemplateUsesCanonicalAssembly(content: string): void {
  if (!content.includes(LEGACY_PROFILE_MARKER)) {
    return;
  }

  throw new TemplateContentError(
    `Templates must not contain retired legacy marker ${LEGACY_PROFILE_MARKER}.`,
    'template_legacy_marker_forbidden',
    400,
  );
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

async function listActiveTemplateOptions(
  dependencies: TemplateContentDependencies,
): Promise<PromptOption[]> {
  const options: PromptOption[] = [];
  let offset = 0;

  while (true) {
    const listed = await dependencies.templates.list({
      limit: MAX_OPTION_PAGE_LIMIT,
      offset,
      order: 'asc',
    });

    options.push(
      ...listed.items
        .filter((template) => Boolean(template.activeRevisionId))
        .map((template) => ({ id: template.id, label: template.label })),
    );

    offset += listed.items.length;
    if (offset >= listed.total || listed.items.length === 0) {
      break;
    }
  }

  return options;
}

async function upsertTemplateContentWithRevision(
  templateId: string,
  content: string,
  overrides: Partial<TemplateContentDependencies> | undefined,
  options: UpsertTemplateContentOptions,
): Promise<TemplateContentResponse> {
  const dependencies = getDependencies(overrides);
  const normalizedTemplateId = normalizeTemplateId(templateId);
  const normalizedContent = content ?? '';
  assertTemplateUsesCanonicalAssembly(normalizedContent);

  const existingTemplate = await dependencies.templates.getById(normalizedTemplateId);
  const label = existingTemplate?.label ?? formatTemplateLabel(normalizedTemplateId);

  await dependencies.templates.upsert({
    id: normalizedTemplateId,
    label,
    activeRevisionId: existingTemplate?.activeRevisionId ?? null,
  });

  const hash = hashTemplateContent(normalizedContent);
  const source = options.source ?? (existingTemplate ? 'update' : 'create');

  const existingRevision =
    source === 'restore'
      ? null
      : await dependencies.revisions.getLatestByHash(normalizedTemplateId, hash);

  const revision =
    existingRevision ??
    (await dependencies.revisions.insert({
      templateId: normalizedTemplateId,
      content: normalizedContent,
      contentHash: hash,
      source,
      createdBy: options.createdBy ?? null,
      restoredFromRevisionId: options.restoredFromRevisionId ?? null,
    }));

  await Promise.all([
    dependencies.revisions.activate(normalizedTemplateId, revision.id),
    dependencies.templates.setActive(normalizedTemplateId, revision.id),
  ]);

  return {
    id: normalizedTemplateId,
    label,
    content: revision.content,
    currentRevisionId: revision.id,
    updatedAt: revision.createdAt.toISOString(),
  };
}

export async function listTemplateContents(
  overrides?: Partial<TemplateContentDependencies>,
): Promise<TemplateContentListResponse> {
  const dependencies = getDependencies(overrides);
  const templates = await listActiveTemplateOptions(dependencies);
  return { templates };
}

export async function getTemplateContent(
  templateId: string,
  overrides?: Partial<TemplateContentDependencies>,
): Promise<TemplateContentResponse | null> {
  const dependencies = getDependencies(overrides);
  const normalizedTemplateId = normalizeTemplateId(templateId);
  const template = await dependencies.templates.getById(normalizedTemplateId);
  if (!template?.activeRevisionId) return null;

  const revision = await dependencies.revisions.getById(
    normalizedTemplateId,
    template.activeRevisionId,
  );
  if (!revision) return null;

  return {
    id: template.id,
    label: template.label,
    content: revision.content,
    currentRevisionId: revision.id,
    updatedAt: revision.createdAt.toISOString(),
  };
}

export async function upsertTemplateContent(
  templateId: string,
  content: string,
  overrides?: Partial<TemplateContentDependencies & { createdBy: string | null }>,
): Promise<TemplateContentResponse> {
  return upsertTemplateContentWithRevision(templateId, content, overrides, {
    source: undefined,
    createdBy: overrides?.createdBy ?? null,
    restoredFromRevisionId: null,
  });
}

export async function deleteTemplateContent(
  templateId: string,
  overrides?: Partial<TemplateContentDependencies>,
): Promise<boolean> {
  const dependencies = getDependencies(overrides);
  const normalizedTemplateId = normalizeTemplateId(templateId);
  const template = await dependencies.templates.getById(normalizedTemplateId);
  if (!template?.activeRevisionId) return false;

  await Promise.all([
    dependencies.revisions.deprecateActive(normalizedTemplateId),
    dependencies.templates.setActive(normalizedTemplateId, null),
  ]);

  return true;
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
  const normalizedTemplateId = normalizeTemplateId(templateId);
  const template = await dependencies.templates.getById(normalizedTemplateId);
  if (!template) return null;

  const result = await dependencies.revisions.list({
    templateId: normalizedTemplateId,
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
  const normalizedTemplateId = normalizeTemplateId(templateId);
  const template = await dependencies.templates.getById(normalizedTemplateId);
  if (!template) return null;

  const revision = await dependencies.revisions.getById(normalizedTemplateId, revisionId);
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
  const normalizedTemplateId = normalizeTemplateId(templateId);
  const template = await dependencies.templates.getById(normalizedTemplateId);
  if (!template) return null;

  const revision = await dependencies.revisions.getById(normalizedTemplateId, revisionId);
  if (!revision) return null;
  assertTemplateUsesCanonicalAssembly(revision.content);

  return upsertTemplateContentWithRevision(normalizedTemplateId, revision.content, overrides, {
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
  const normalizedTemplateId = normalizeTemplateId(templateId);
  const template = await dependencies.templates.getById(normalizedTemplateId);
  if (!template) return null;

  const existingRevision = await dependencies.revisions.getById(normalizedTemplateId, revisionId);
  if (!existingRevision) return null;
  assertTemplateUsesCanonicalAssembly(existingRevision.content);

  const activated = await dependencies.revisions.activate(normalizedTemplateId, revisionId);
  if (!activated) return null;

  await dependencies.templates.setActive(normalizedTemplateId, activated.id);

  return {
    ...toTemplateRevisionSummary(activated),
    content: activated.content,
  };
}
