import type { Client } from '@notionhq/client';
import { describe, expect, it, vi } from 'vitest';

import { resolveDataSourceId } from '../src/notion.js';

const makeClient = () =>
  ({
    databases: {
      retrieve: vi.fn().mockResolvedValue({
        id: 'db-123',
        data_sources: [{ id: 'ds-1', name: 'Primary' }],
      }),
    },
    search: vi.fn(),
    dataSources: {
      retrieve: vi.fn(),
    },
  }) as unknown as Client;

describe('notion database cache', () => {
  it('reuses database retrieve result within TTL for same token/db', async () => {
    process.env.NOTION_TOKEN = 'token-cache-test';
    const client = makeClient();

    const result1 = await resolveDataSourceId(client, { dbId: 'db-123' });
    const result2 = await resolveDataSourceId(client, { dbId: 'db-123' });

    expect(result1.databaseId).toBe('db-123');
    expect(result2.databaseId).toBe('db-123');
    expect((client.databases.retrieve as any).mock.calls.length).toBe(1);
  });
});
