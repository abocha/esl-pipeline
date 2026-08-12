import { describe, expect, it } from 'vitest';

import { getPromptOptions, resolvePromptSelection } from '../src/application/prompt-options.js';
import type { BatchBackendConfig } from '../src/config/env.js';

function createConfig(templatePath: string, profilePath: string): BatchBackendConfig {
  return {
    prompt: {
      templatePath,
      defaultProfilePath: profilePath,
    },
  } as BatchBackendConfig;
}

function createActiveRevisionDependencies(
  activeTemplateIds: readonly string[],
  activeProfileIds: readonly string[],
) {
  const activeTemplateSet = new Set(activeTemplateIds);
  const activeProfileSet = new Set(activeProfileIds);

  return {
    templateRevisions: {
      listIdsWithActiveRevision: async (templateIds: readonly string[]) =>
        new Set(templateIds.filter((id) => activeTemplateSet.has(id))),
    },
    profileRevisions: {
      listIdsWithActiveRevision: async (profileIds: readonly string[]) =>
        new Set(profileIds.filter((id) => activeProfileSet.has(id))),
    },
  };
}

describe('application/prompt-options', () => {
  it('returns active-only prompt catalog and DB-backed defaults', async () => {
    const config = createConfig(
      'packages/batch-backend/prompt-assets/templates/default-template.md',
      'packages/batch-backend/prompt-assets/profiles/default-profile.md',
    );

    const options = await getPromptOptions({
      config,
      ...createActiveRevisionDependencies(['default-template.md'], ['default-profile.md']),
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
      profiles: {
        list: async () => ({
          items: [
            {
              id: 'default-profile.md',
              label: 'Default Profile',
              activeRevisionId: 'profile-revision-1',
              createdAt: new Date('2026-01-01T00:00:00.000Z'),
              updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            },
            {
              id: 'archived-profile.md',
              label: 'Archived Profile',
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
      profiles: [{ id: 'default-profile.md', label: 'Default Profile' }],
      defaults: {
        templateId: 'default-template.md',
        profileId: 'default-profile.md',
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
      ...createActiveRevisionDependencies(['other-template.md'], ['other-profile.md']),
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
      profiles: {
        list: async () => ({
          items: [
            {
              id: 'other-profile.md',
              label: 'Other Profile',
              activeRevisionId: 'profile-revision-1',
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
      profileId: null,
    });
  });

  it('prefers an active DB-selected default template over the configured path', async () => {
    const config = createConfig(
      'packages/batch-backend/prompt-assets/templates/default-template.md',
      'packages/batch-backend/prompt-assets/profiles/default-profile.md',
    );

    const options = await getPromptOptions({
      config,
      ...createActiveRevisionDependencies(
        ['default-template.md', 'alternate-template.md'],
        ['default-profile.md'],
      ),
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
      profiles: {
        list: async () => ({
          items: [
            {
              id: 'default-profile.md',
              label: 'Default Profile',
              activeRevisionId: 'profile-revision-1',
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

    expect(options.defaults.templateId).toBe('alternate-template.md');
  });

  it('maps legacy profilePath to canonical profile ID in selection', async () => {
    const config = createConfig(
      'packages/batch-backend/prompt-assets/templates/default-template.md',
      'packages/batch-backend/prompt-assets/profiles/default-profile.md',
    );

    const selection = await resolvePromptSelection(
      {
        templateId: 'default-template.md',
        profilePath: 'nested/custom-profile.md',
      },
      {
        config,
        ...createActiveRevisionDependencies(
          ['default-template.md'],
          ['default-profile.md', 'nested/custom-profile.md'],
        ),
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
            ],
            total: 1,
            limit: 500,
            offset: 0,
            order: 'asc',
          }),
          getById: async () => null,
        },
        profiles: {
          list: async () => ({
            items: [
              {
                id: 'default-profile.md',
                label: 'Default Profile',
                activeRevisionId: 'profile-revision-1',
                createdAt: new Date('2026-01-01T00:00:00.000Z'),
                updatedAt: new Date('2026-01-01T00:00:00.000Z'),
              },
              {
                id: 'nested/custom-profile.md',
                label: 'Custom Profile',
                activeRevisionId: 'profile-revision-2',
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
      },
    );

    expect(selection).toEqual({
      templateId: 'default-template.md',
      profileId: 'nested/custom-profile.md',
      profilePath: 'nested/custom-profile.md',
    });
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
    const profileItems = Array.from({ length: 550 }, (_, index) => ({
      id: `profile-${index}.md`,
      label: `Profile ${index}`,
      activeRevisionId: `profile-revision-${index}`,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    }));

    const templateListCalls: { limit?: number; offset?: number; order?: 'asc' | 'desc' }[] = [];
    const profileListCalls: { limit?: number; offset?: number; order?: 'asc' | 'desc' }[] = [];

    const options = await getPromptOptions({
      config,
      ...createActiveRevisionDependencies(
        templateItems.map((template) => template.id),
        profileItems.map((profile) => profile.id),
      ),
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
      profiles: {
        list: async (params = {}) => {
          const { limit = 500, offset = 0, order = 'asc' } = params;
          profileListCalls.push({ limit, offset, order });
          return {
            items: profileItems.slice(offset, offset + limit),
            total: profileItems.length,
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
      profileId: 'profile-549.md',
    });
    expect(options.templates.some((template) => template.id === 'template-549.md')).toBe(true);
    expect(options.profiles.some((profile) => profile.id === 'profile-549.md')).toBe(true);
    expect(templateListCalls.length).toBeGreaterThan(1);
    expect(profileListCalls.length).toBeGreaterThan(1);
  });

  it('excludes prompts when pointer exists but no active revision is confirmed', async () => {
    const config = createConfig(
      'packages/batch-backend/prompt-assets/templates/default-template.md',
      'packages/batch-backend/prompt-assets/profiles/default-profile.md',
    );

    const options = await getPromptOptions({
      config,
      ...createActiveRevisionDependencies([], []),
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
      profiles: {
        list: async () => ({
          items: [
            {
              id: 'default-profile.md',
              label: 'Default Profile',
              activeRevisionId: 'stale-profile-pointer',
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
      profiles: [],
      defaults: {
        templateId: null,
        profileId: null,
      },
    });
  });
});
