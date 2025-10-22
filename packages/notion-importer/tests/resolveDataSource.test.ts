import { describe, expect, it } from 'vitest';
import type { Client } from '@notionhq/client';
import { resolveDataSourceId } from '../src/notion.js';

describe('resolveDataSourceId', () => {
  it('returns parent database when data source id provided', async () => {
    const client = {
      dataSources: {
        retrieve: async () => ({
          id: 'ds-parent',
          parent: { type: 'database_id', database_id: 'db-parent' }
        })
      }
    } as unknown as Client;

    const result = await resolveDataSourceId(client, { dataSourceId: 'ds-parent' });
    expect(result).toEqual({ dataSourceId: 'ds-parent', databaseId: 'db-parent' });
  });

  it('selects single data source when only one exists', async () => {
    const client = {
      dataSources: {
        retrieve: async () => {
          throw new Error('should not be called');
        }
      },
      databases: {
        retrieve: async () => ({
          id: 'db-single',
          data_sources: [{ id: 'ds-single', name: 'Primary' }]
        })
      }
    } as unknown as Client;

    const result = await resolveDataSourceId(client, { dbId: 'db-single' });
    expect(result).toEqual({ dataSourceId: 'ds-single', databaseId: 'db-single' });
  });

  it('selects data source by name when multiple available', async () => {
    const client = {
      dataSources: {
        retrieve: async () => {
          throw new Error('should not be called');
        }
      },
      databases: {
        retrieve: async () => ({
          id: 'db-multi',
          data_sources: [
            { id: 'ds-1', name: 'Alpha' },
            { id: 'ds-2', name: 'Beta' }
          ]
        })
      },
      search: async () => ({ results: [] })
    } as unknown as Client;

    const result = await resolveDataSourceId(client, {
      dbId: 'db-multi',
      dataSourceName: 'beta'
    });
    expect(result).toEqual({ dataSourceId: 'ds-2', databaseId: 'db-multi' });
  });

  it('throws when multiple data sources without disambiguation', async () => {
    const client = {
      dataSources: {
        retrieve: async () => {
          throw new Error('should not be called');
        }
      },
      databases: {
        retrieve: async () => ({
          id: 'db-multi',
          data_sources: [
            { id: 'ds-1', name: 'Alpha' },
            { id: 'ds-2', name: 'Beta' }
          ]
        })
      }
    } as unknown as Client;

    await expect(resolveDataSourceId(client, { dbId: 'db-multi' })).rejects.toThrow(
      /Multiple data sources/
    );
  });
});
