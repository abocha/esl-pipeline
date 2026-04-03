import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseMarkdownContext } from '@esl-pipeline/pmd';

const { createNotionClientMock } = vi.hoisted(() => ({
  createNotionClientMock: vi.fn(),
}));

vi.mock('../src/client.js', () => ({
  createNotionClient: createNotionClientMock,
}));

const tempDirs: string[] = [];
const IMPORTER_TEST_TIMEOUT_MS = 15_000;

async function createMarkdownFile(content: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'esl-importer-'));
  const filePath = path.join(root, 'lesson.md');
  await fs.writeFile(filePath, content, 'utf8');
  tempDirs.push(root);
  return filePath;
}

describe('runImport data source resolution', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it('retrieves database metadata once when importing', {
    timeout: IMPORTER_TEST_TIMEOUT_MS,
  }, async () => {
    const mdPath = await createMarkdownFile(`---\ntitle: Demo\n---\n\n# Hello`);
    const client = {
      databases: {
        retrieve: vi.fn().mockResolvedValue({
          object: 'database',
          id: 'db-1',
          title: [],
          properties: {
            Name: { id: 'title', name: 'Name', type: 'title', title: {} },
          },
          data_sources: [{ id: 'ds-main', name: 'Main' }],
        }),
      },
      dataSources: {
        retrieve: vi.fn(),
        query: vi.fn(),
      },
      pages: {
        create: vi.fn().mockResolvedValue({
          object: 'page',
          id: 'page-1',
          url: 'https://www.notion.so/page-1',
        }),
      },
      blocks: {
        children: {
          append: vi.fn(),
        },
      },
      search: vi.fn(),
    };
    createNotionClientMock.mockReturnValue(client);

    const { runImport } = await import('../src/importer.js');
    const result = await runImport({
      context: parseMarkdownContext(await fs.readFile(mdPath, 'utf8')),
      mdPath,
      dbId: 'db-1',
      validationResult: {
        ok: true,
        errors: [],
        warnings: [],
      },
    });

    expect(result.page_id).toBe('page-1');
    expect(client.databases.retrieve).toHaveBeenCalledTimes(1);
    expect(client.pages.create).toHaveBeenCalledTimes(1);
  });
});
