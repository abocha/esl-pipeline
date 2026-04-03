import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const okMarkdown = readFileSync(new URL('../fixtures/ok.md', import.meta.url), 'utf8');
const CONTENT_OPTION_TEST_TIMEOUT_MS = 15_000;

describe('validateMarkdown with markdown input', () => {
  it('validates using provided markdown without reading from disk', {
    timeout: CONTENT_OPTION_TEST_TIMEOUT_MS,
  }, async () => {
    vi.resetModules();
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

    try {
      // Re-import validateMarkdown to pick up mocked fs/promises
      const { validateMarkdown: mockedValidate } = await import('../src/validator.js');
      const result = await mockedValidate({ markdown: okMarkdown });
      expect(result.ok).toBe(true);
      expect(readFileMock).not.toHaveBeenCalled();
    } finally {
      // Ensure the mocked module is not leaked across tests
      vi.doUnmock('node:fs/promises');
      vi.resetModules();
    }
  });
});
