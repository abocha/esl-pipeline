import { describe, expect, it } from 'vitest';

import {
  TemplateContentError,
  deleteTemplateContent,
  getTemplateContent,
  listTemplateContents,
  listTemplateRevisionsForTemplate,
  restoreTemplateRevision,
  upsertTemplateContent,
} from '../src/application/template-content.js';
import type { TemplateRevisionRecord } from '../src/domain/template-revision-model.js';
import type { TemplateRecord } from '../src/domain/template-model.js';

const BASE_TEMPLATE = 'Header\nINSERT PROFILE HERE\nFooter';

function createInMemoryDependencies(seed?: {
  templates?: { id: string; label: string; content: string }[];
}) {
  const templates = new Map<string, TemplateRecord>();
  const revisions: TemplateRevisionRecord[] = [];

  const createRevision = (params: {
    templateId: string;
    content: string;
    contentHash: string;
    source: 'create' | 'update' | 'restore';
    createdBy?: string | null;
    restoredFromRevisionId?: string | null;
  }): TemplateRevisionRecord => {
    const versionNumber =
      revisions.filter((revision) => revision.templateId === params.templateId).length + 1;

    return {
      id: `template-revision-${params.templateId}-${versionNumber}`,
      templateId: params.templateId,
      content: params.content,
      contentHash: params.contentHash,
      source: params.source,
      status: 'active',
      versionNumber,
      versionLabel: `v${versionNumber}`,
      activatedAt: new Date('2026-01-01T00:00:00.000Z'),
      deprecatedAt: null,
      createdAt: new Date(`2026-01-01T00:00:0${Math.min(versionNumber, 9)}.000Z`),
      createdBy: params.createdBy ?? null,
      restoredFromRevisionId: params.restoredFromRevisionId ?? null,
    };
  };

  if (seed?.templates) {
    for (const template of seed.templates) {
      const revision = createRevision({
        templateId: template.id,
        content: template.content,
        contentHash: `hash-${template.id}`,
        source: 'create',
      });
      revisions.push(revision);
      templates.set(template.id, {
        id: template.id,
        label: template.label,
        activeRevisionId: revision.id,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
    }
  }

  return {
    templates: {
      list: async (params: { search?: string; limit?: number; offset?: number; order?: 'asc' | 'desc' } = {}) => {
        const { limit = 500, offset = 0, order = 'asc' } = params;
        const sorted = [...templates.values()].sort((a, b) =>
          order === 'asc' ? a.label.localeCompare(b.label) : b.label.localeCompare(a.label),
        );
        return {
          items: sorted.slice(offset, offset + limit),
          total: sorted.length,
          limit,
          offset,
          order,
        };
      },
      getById: async (id: string) => templates.get(id) ?? null,
      upsert: async ({
        id,
        label,
        activeRevisionId,
      }: {
        id: string;
        label: string;
        activeRevisionId?: string | null;
      }): Promise<TemplateRecord> => {
        const existing = templates.get(id);
        const next: TemplateRecord = {
          id,
          label,
          activeRevisionId: activeRevisionId ?? existing?.activeRevisionId ?? null,
          createdAt: existing?.createdAt ?? new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        };
        templates.set(id, next);
        return next;
      },
      setActive: async (templateId: string, revisionId: string | null): Promise<TemplateRecord | null> => {
        const existing = templates.get(templateId);
        if (!existing) return null;
        const next = {
          ...existing,
          activeRevisionId: revisionId,
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        };
        templates.set(templateId, next);
        return next;
      },
    },
    revisions: {
      getLatestByHash: async (templateId: string, contentHash: string) =>
        revisions.findLast(
          (revision) => revision.templateId === templateId && revision.contentHash === contentHash,
        ) ?? null,
      insert: async ({
        templateId,
        content,
        contentHash,
        source,
        createdBy,
        restoredFromRevisionId,
      }: {
        templateId: string;
        content: string;
        contentHash: string;
        source?: 'create' | 'update' | 'restore';
        createdBy?: string | null;
        restoredFromRevisionId?: string | null;
      }) => {
        const revision = createRevision({
          templateId,
          content,
          contentHash,
          source: source ?? 'update',
          createdBy,
          restoredFromRevisionId,
        });

        for (const current of revisions) {
          if (current.templateId === templateId && current.status === 'active') {
            current.status = 'deprecated';
            current.activatedAt = null;
            current.deprecatedAt = new Date('2026-01-01T00:00:00.000Z');
          }
        }

        revisions.push(revision);
        return revision;
      },
      activate: async (templateId: string, revisionId: string) => {
        const target = revisions.find(
          (revision) => revision.templateId === templateId && revision.id === revisionId,
        );
        if (!target) return null;

        for (const current of revisions) {
          if (current.templateId !== templateId) continue;
          if (current.id === revisionId) {
            current.status = 'active';
            current.activatedAt = new Date('2026-01-01T00:00:00.000Z');
            current.deprecatedAt = null;
          } else if (current.status === 'active') {
            current.status = 'deprecated';
            current.activatedAt = null;
            current.deprecatedAt = new Date('2026-01-01T00:00:00.000Z');
          }
        }
        return target;
      },
      deprecateActive: async (templateId: string) => {
        let count = 0;
        for (const current of revisions) {
          if (current.templateId !== templateId || current.status !== 'active') continue;
          current.status = 'deprecated';
          current.activatedAt = null;
          current.deprecatedAt = new Date('2026-01-01T00:00:00.000Z');
          count += 1;
        }
        return count;
      },
      list: async ({
        templateId,
        limit = 50,
        offset = 0,
        order = 'desc',
      }: {
        templateId: string;
        limit?: number;
        offset?: number;
        order?: 'asc' | 'desc';
      }) => {
        const filtered = revisions.filter((revision) => revision.templateId === templateId);
        const sorted = [...filtered].sort((a, b) =>
          order === 'asc'
            ? a.createdAt.getTime() - b.createdAt.getTime()
            : b.createdAt.getTime() - a.createdAt.getTime(),
        );

        return {
          items: sorted.slice(offset, offset + limit),
          total: filtered.length,
          limit,
          offset,
          order,
        };
      },
      getById: async (templateId: string, revisionId: string) =>
        revisions.find((revision) => revision.templateId === templateId && revision.id === revisionId) ?? null,
    },
  };
}

describe('application/template-content (DB-only)', () => {
  it('lists active templates and reads active content', async () => {
    const deps = createInMemoryDependencies({
      templates: [{ id: 'default.md', label: 'Default Template', content: BASE_TEMPLATE }],
    });

    const list = await listTemplateContents(deps);
    expect(list.templates).toEqual([{ id: 'default.md', label: 'Default Template' }]);

    const content = await getTemplateContent('default.md', deps);
    expect(content?.content).toContain('INSERT PROFILE HERE');
    expect(content?.currentRevisionId).toBeTruthy();
  });

  it('paginates template option listing beyond 500 active records', async () => {
    const deps = createInMemoryDependencies({
      templates: Array.from({ length: 550 }, (_, index) => ({
        id: `template-${index}.md`,
        label: `Template ${index}`,
        content: `Header ${index}\nINSERT PROFILE HERE\nFooter ${index}`,
      })),
    });

    const listCalls: { limit?: number; offset?: number; order?: 'asc' | 'desc' }[] = [];
    const originalList = deps.templates.list;
    deps.templates.list = async (
      params: { search?: string; limit?: number; offset?: number; order?: 'asc' | 'desc' } = {},
    ) => {
      listCalls.push(params);
      return originalList(params);
    };

    const list = await listTemplateContents(deps);
    expect(list.templates).toHaveLength(550);
    expect(list.templates.some((template) => template.id === 'template-549.md')).toBe(true);
    expect(listCalls.length).toBeGreaterThan(1);
    expect(listCalls[0]).toMatchObject({ limit: 500, offset: 0, order: 'asc' });
    expect(listCalls[1]).toMatchObject({ limit: 500, offset: 500, order: 'asc' });
  });

  it('rejects template saves without INSERT PROFILE HERE marker', async () => {
    const deps = createInMemoryDependencies();

    await expect(upsertTemplateContent('invalid.md', 'No marker here', deps)).rejects.toMatchObject({
      code: 'template_marker_missing',
    } satisfies Partial<TemplateContentError>);
  });

  it('archives templates and keeps revisions for restore', async () => {
    const deps = createInMemoryDependencies();

    const created = await upsertTemplateContent('custom.md', BASE_TEMPLATE, deps);
    expect(created.currentRevisionId).toBeTruthy();

    const removed = await deleteTemplateContent('custom.md', deps);
    expect(removed).toBe(true);

    const archived = await getTemplateContent('custom.md', deps);
    expect(archived).toBeNull();

    const revisions = await listTemplateRevisionsForTemplate('custom.md', { order: 'desc' }, deps);
    expect(revisions?.total).toBe(1);
    expect(revisions?.items[0]?.status).toBe('deprecated');

    const revisionId = revisions?.items[0]?.id;
    if (!revisionId) throw new Error('Expected revision id');

    const restored = await restoreTemplateRevision('custom.md', revisionId, deps);
    expect(restored?.content).toContain('INSERT PROFILE HERE');
  });
});
