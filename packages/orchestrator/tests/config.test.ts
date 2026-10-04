import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createFilesystemConfigProvider, DEFAULT_STUDENT_NAME } from '../src/config.js';

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
