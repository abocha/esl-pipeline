import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  createFilesystemConfigProvider,
  DEFAULT_STUDENT_NAME,
  findMarkdownCandidates,
} from '../src/config.js';

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

describe('createFilesystemConfigProvider', () => {
  it('loads student profiles from JSON files while preserving fallback semantics', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'students-'));
    const studentsDir = join(cwd, 'students');
    await mkdir(studentsDir, { recursive: true });

    await writeFile(
      join(studentsDir, 'valid.json'),
      JSON.stringify({ student: '  Zara  ', dbId: 'db-1' }),
    );
    await writeFile(join(studentsDir, 'invalid.json'), '{');
    await writeFile(
      join(studentsDir, 'default.json'),
      JSON.stringify({ student: DEFAULT_STUDENT_NAME, colorPreset: 'custom' }),
    );

    const provider = createFilesystemConfigProvider({ studentsDir });
    const profiles = await provider.loadStudentProfiles();

    expect(profiles.map((profile) => profile.student)).toEqual([DEFAULT_STUDENT_NAME, 'Zara']);
    expect(profiles.find((profile) => profile.student === DEFAULT_STUDENT_NAME)?.colorPreset).toBe(
      'custom',
    );
  });
});
