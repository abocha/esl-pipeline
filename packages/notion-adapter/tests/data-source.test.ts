import { describe, expect, it, vi } from 'vitest';

import { resolveDataSourceId, resolveNotionTarget } from '../src/data-source.js';

function makeDatabaseResponse(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> & { id: string } {
  return {
    object: 'database',
    id: 'db-1',
    title: [],
    properties: {
      Name: { id: 'title', name: 'Name', type: 'title', title: {} },
    },
    data_sources: [{ id: 'ds-main', name: 'Main' }],
    ...overrides,
  };
}

describe('resolveNotionTarget', () => {
  it('returns hydrated database metadata when resolving by dbId', async () => {
    const retrieveDatabase = vi.fn().mockResolvedValue(makeDatabaseResponse());
    const client = {
      databases: { retrieve: retrieveDatabase },
      dataSources: { retrieve: vi.fn() },
      search: vi.fn(),
    } as unknown as Parameters<typeof resolveNotionTarget>[0];

    const target = await resolveNotionTarget(client, { dbId: 'db-1' });

    expect(target.databaseId).toBe('db-1');
    expect(target.dataSourceId).toBe('ds-main');
    expect(target.database.id).toBe('db-1');
    expect(retrieveDatabase).toHaveBeenCalledTimes(1);
  });

  it('uses the explicit data source id and still hydrates database metadata', async () => {
    const retrieveDataSource = vi.fn().mockResolvedValue({
      object: 'data_source',
      id: 'ds-explicit',
      parent: { type: 'database_id', database_id: 'db-2' },
    });
    const retrieveDatabase = vi.fn().mockResolvedValue(
      makeDatabaseResponse({
        id: 'db-2',
        data_sources: [
          { id: 'ds-explicit', name: 'Default' },
          { id: 'ds-archive', name: 'Archive' },
        ],
      }),
    );
    const client = {
      dataSources: { retrieve: retrieveDataSource },
      databases: { retrieve: retrieveDatabase },
      search: vi.fn(),
    } as unknown as Parameters<typeof resolveNotionTarget>[0];

    const target = await resolveNotionTarget(client, { dataSourceId: 'ds-explicit' });

    expect(target.dataSourceId).toBe('ds-explicit');
    expect(target.databaseId).toBe('db-2');
    expect(target.database.id).toBe('db-2');
    expect(retrieveDataSource).toHaveBeenCalledTimes(1);
    expect(retrieveDatabase).toHaveBeenCalledTimes(1);
  });

  it('keeps resolveDataSourceId backward-compatible', async () => {
    const client = {
      databases: { retrieve: vi.fn().mockResolvedValue(makeDatabaseResponse()) },
      dataSources: { retrieve: vi.fn() },
      search: vi.fn(),
    } as unknown as Parameters<typeof resolveDataSourceId>[0];

    const result = await resolveDataSourceId(client, { dbId: 'db-1' });

    expect(result).toEqual({
      dataSourceId: 'ds-main',
      databaseId: 'db-1',
    });
  });
});
