import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readMarkdownCached, resetMarkdownCache } from '../src/runtime/markdown-cache.js';

describe('runtime/markdown-cache', () => {
  afterEach(() => {
    resetMarkdownCache();
  });

  it('returns latest markdown content after file changes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orchestrator-md-cache-runtime-'));
    const mdPath = join(dir, 'lesson.md');

    await writeFile(mdPath, '# First');
    const first = await readMarkdownCached(mdPath);
    expect(first).toBe('# First');

    // Ensure file metadata changes across platforms/filesystems.
    await new Promise((resolve) => setTimeout(resolve, 10));
    await writeFile(mdPath, '# Second');
    const second = await readMarkdownCached(mdPath);
    expect(second).toBe('# Second');
  });
});
