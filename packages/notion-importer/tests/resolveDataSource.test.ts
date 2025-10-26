import { describe, expect, it, vi } from 'vitest';
import type { Client } from '@notionhq/client';
import { resolveDataSourceId } from '../src/notion.js';
import type { ResolveDataSourceInput } from '../src/types.js';

describe('resolveDataSourceId', () => {
  it('Test Case 1: dataSourceId provided', async () => {
    const mockRetrieve = vi.fn().mockResolvedValue({
      id: 'ds-123',
      parent: { type: 'database_id', database_id: 'db-456' },
    });
    const client = {
      dataSources: { retrieve: mockRetrieve },
    } as unknown as Client;

    const result = await resolveDataSourceId(client, { dataSourceId: 'ds-123' });
    expect(result).toEqual({ dataSourceId: 'ds-123', databaseId: 'db-456' });
    expect(mockRetrieve).toHaveBeenCalledWith({ data_source_id: 'ds-123' });
  });

  it('Test Case 2: dbId provided, single data source found', async () => {
    const mockRetrieve = vi.fn().mockResolvedValue({
      id: 'db-456',
      data_sources: [{ id: 'ds-789', name: 'Primary' }],
    });
    const client = {
      databases: { retrieve: mockRetrieve },
    } as unknown as Client;

    const result = await resolveDataSourceId(client, { dbId: 'db-456' });
    expect(result).toEqual({ dataSourceId: 'ds-789', databaseId: 'db-456' });
    expect(mockRetrieve).toHaveBeenCalledWith({ database_id: 'db-456' });
  });

  it('Test Case 3: dbId provided, multiple data sources found, no dataSourceName', async () => {
    const mockRetrieve = vi.fn().mockResolvedValue({
      id: 'db-456',
      data_sources: [
        { id: 'ds-1', name: 'Alpha' },
        { id: 'ds-2', name: 'Beta' },
      ],
    });
    const client = {
      databases: { retrieve: mockRetrieve },
    } as unknown as Client;

    await expect(resolveDataSourceId(client, { dbId: 'db-456' })).rejects.toThrow(
      /Multiple data sources found under db-456/
    );
  });

  it('Test Case 4: dbId provided, multiple data sources found, dataSourceName provided', async () => {
    const mockRetrieve = vi.fn().mockResolvedValue({
      id: 'db-456',
      data_sources: [
        { id: 'ds-1', name: 'Alpha' },
        { id: 'ds-2', name: 'Beta' },
      ],
    });
    const client = {
      databases: { retrieve: mockRetrieve },
    } as unknown as Client;

    const result = await resolveDataSourceId(client, {
      dbId: 'db-456',
      dataSourceName: 'beta',
    });
    expect(result).toEqual({ dataSourceId: 'ds-2', databaseId: 'db-456' });
  });

  it('Test Case 5: No IDs/Names provided', async () => {
    const client = {} as unknown as Client;

    await expect(resolveDataSourceId(client, {} as ResolveDataSourceInput)).rejects.toThrow(
      'Provide --data-source-id or --db-id/--db.'
    );
  });
});
