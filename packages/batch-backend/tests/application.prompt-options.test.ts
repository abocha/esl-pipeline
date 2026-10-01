import { describe, expect, it } from 'vitest';

import {
  getPromptOptions,
  resolvePromptTemplateSelection,
} from '../src/application/prompt-options.js';
import type { BatchBackendConfig } from '../src/config/env.js';

function createConfig(templatePath: string, _legacyProfilePath: string): BatchBackendConfig {
  return {
    prompt: {
      templatePath,
    },
  } as BatchBackendConfig;
}

function createActiveRevisionDependencies(activeTemplateIds: readonly string[]) {
  const activeTemplateSet = new Set(activeTemplateIds);

  return {
    templateRevisions: {
      listIdsWithActiveRevision: async (templateIds: readonly string[]) =>
        new Set(templateIds.filter((id) => activeTemplateSet.has(id))),
    },
  };
}

describe('application/prompt-options', () => {
  it('returns active-only template catalog and DB-backed defaults', async () => {
    const config = createConfig(
      'packages/batch-backend/prompt-assets/templates/default-template.md',
      'packages/batch-backend/prompt-assets/profiles/default-profile.md',
    );

    const options = await getPromptOptions({
      config,
      ...createActiveRevisionDependencies(['default-template.md']),
      templates: {
        list: async () => ({
          items: [
            {
              id: 'default-template.md',
              label: 'Default Template',
              activeRevisionId: 'template-revision-1',
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            },
            {
              id: 'archived-template.md',
              label: 'Archived Template',
              activeRevisionId: null,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            },
          ],
          total: 2,
          limit: 500,
          offset: 0,
          order: 'asc',
        }),
        getById: async () => null,
      },
    });

    expect(options).toEqual({
      templates: [{ id: 'default-template.md', label: 'Default Template' }],
      defaults: {
        templateId: 'default-template.md',
      },
    });
  });

  it('returns null defaults when configured IDs are not active in DB', async () => {
    const config = createConfig(
      'packages/batch-backend/prompt-assets/templates/missing-template.md',
      'packages/batch-backend/prompt-assets/profiles/missing-profile.md',
    );

    const options = await getPromptOptions({
      config,
      ...createActiveRevisionDependencies(['other-template.md']),
      templates: {
        list: async () => ({
          items: [
            {
              id: 'other-template.md',
              label: 'Other Template',
              activeRevisionId: 'template-revision-1',
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            },
          ],
          total: 1,
          limit: 500,
          offset: 0,
          order: 'asc',
        }),
        getById: async () => null,
      },
    });

    expect(options.defaults).toEqual({
      templateId: null,
    });
  });

  it('prefers an active DB-selected default template over the configured path', async () => {
    const config = createConfig(
      'packages/batch-backend/prompt-assets/templates/default-template.md',
      'packages/batch-backend/prompt-assets/profiles/default-profile.md',
    );

    const options = await getPromptOptions({
      config,
      ...createActiveRevisionDependencies(['default-template.md', 'alternate-template.md']),
      templates: {
        list: async () => ({
          items: [
            {
              id: 'default-template.md',
              label: 'Default Template',
              activeRevisionId: 'template-revision-1',
              isDefault: false,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            },
            {
              id: 'alternate-template.md',
              label: 'Alternate Template',
              activeRevisionId: 'template-revision-2',
              isDefault: true,
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            },
          ],
          total: 2,
          limit: 500,
          offset: 0,
          order: 'asc',
        }),
        getById: async () => null,
      },
    });

    expect(options.defaults.templateId).toBe('alternate-template.md');
  });

  it('paginates beyond 500 records and resolves defaults outside first page', async () => {
    const config = createConfig(
      'packages/batch-backend/prompt-assets/templates/template-549.md',
      'packages/batch-backend/prompt-assets/profiles/profile-549.md',
    );

    const templateItems = Array.from({ length: 550 }, (_, index) => ({
      id: `template-${index}.md`,
      label: `Template ${index}`,
      activeRevisionId: `template-revision-${index}`,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    }));

    const templateListCalls: { limit?: number; offset?: number; order?: 'asc' | 'desc' }[] = [];

    const options = await getPromptOptions({
      config,
      ...createActiveRevisionDependencies(templateItems.map((template) => template.id)),
      templates: {
        list: async (params = {}) => {
          const { limit = 500, offset = 0, order = 'asc' } = params;
          templateListCalls.push({ limit, offset, order });
          return {
            items: templateItems.slice(offset, offset + limit),
            total: templateItems.length,
            limit,
            offset,
            order,
          };
        },
        getById: async () => null,
      },
    });

    expect(options.defaults).toEqual({
      templateId: 'template-549.md',
    });
    expect(options.templates.some((template) => template.id === 'template-549.md')).toBe(true);
    expect(templateListCalls.length).toBeGreaterThan(1);
  });

  it('excludes prompts when pointer exists but no active revision is confirmed', async () => {
    const config = createConfig(
      'packages/batch-backend/prompt-assets/templates/default-template.md',
      'packages/batch-backend/prompt-assets/profiles/default-profile.md',
    );

    const options = await getPromptOptions({
      config,
      ...createActiveRevisionDependencies([]),
      templates: {
        list: async () => ({
          items: [
            {
              id: 'default-template.md',
              label: 'Default Template',
              activeRevisionId: 'stale-template-pointer',
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            },
          ],
          total: 1,
          limit: 500,
          offset: 0,
          order: 'asc',
        }),
        getById: async () => null,
      },
    });

    expect(options).toEqual({
      templates: [],
      defaults: {
        templateId: null,
      },
    });
  });
  it('resolves only an active allowlisted template', async () => {
    const config = createConfig('default-template.md', 'retired-profile.md');
    const overrides = {
      config,
      ...createActiveRevisionDependencies(['default-template.md']),
      templates: {
        list: async () => ({
          items: [
            {
              id: 'default-template.md',
              label: 'Template',
              activeRevisionId: 'revision-1',
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
          total: 1,
          limit: 500,
          offset: 0,
          order: 'asc' as const,
        }),
        getById: async () => null,
      },
    };
    await expect(resolvePromptTemplateSelection({}, overrides)).resolves.toEqual({
      templateId: 'default-template.md',
    });
    await expect(
      resolvePromptTemplateSelection({ templateId: 'foreign.md' }, overrides),
    ).rejects.toMatchObject({ code: 'template_id_not_allowed' });
  });
});
