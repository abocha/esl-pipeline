import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import { findMarkdownCandidates } from '../src/config.js';

describe('findMarkdownCandidates', () => {
  it('prioritizes recently modified markdown files', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'find-md-'));
    const fixturesDir = join(cwd, 'fixtures');
    await mkdir(fixturesDir, { recursive: true });

    const olderPath = join(fixturesDir, 'older.md');
    await writeFile(olderPath, '# Old lesson');
    await utimes(olderPath, new Date(Date.now() - 10_000), new Date(Date.now() - 10_000));

    const newerPath = join(fixturesDir, 'newer.md');
    await writeFile(newerPath, '# New lesson');
    await utimes(newerPath, new Date(), new Date());

    const result = await findMarkdownCandidates(cwd, 1, 5);
    expect(result).toEqual([relative(cwd, newerPath)]);
  });
});
