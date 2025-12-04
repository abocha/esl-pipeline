import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const okMarkdown = readFileSync(new URL('../fixtures/ok.md', import.meta.url), 'utf8');

describe('validateMarkdownFile with content option', () => {
  it('validates using provided content without reading from disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'md-val-content-'));
    const mdPath = join(dir, 'lesson.md');
    await writeFile(mdPath, 'UNUSED');

    const readFileMock = vi.fn(() => {
      throw new Error('readFile should not be called when content is provided');
    });
    vi.doMock('node:fs/promises', async () => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
      return {
        ...actual,
        readFile: readFileMock,
      };
    });

    // Re-import validateMarkdownFile to pick up mocked fs/promises
    const { validateMarkdownFile: mockedValidate } = await import('../src/validator.js');
    const result = await mockedValidate(mdPath, { content: okMarkdown });
    expect(result.ok).toBe(true);
    expect(readFileMock).not.toHaveBeenCalled();

    // Ensure the mocked module is not leaked across tests
    vi.resetModules();
  });
});
