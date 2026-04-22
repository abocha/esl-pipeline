import { describe, expect, it } from 'vitest';

import { parseArgs } from '../src/tools/export-student-lesson-artifacts.js';

describe('tools/export-student-lesson-artifacts', () => {
  it('parses the required student id and optional output path', () => {
    expect(
      parseArgs([
        '--student-id',
        '11111111-1111-4111-8111-111111111111',
        '--out',
        'tmp/exports/student-123.zip',
      ]),
    ).toEqual({
      studentId: '11111111-1111-4111-8111-111111111111',
      outPath: 'tmp/exports/student-123.zip',
    });
  });

  it('rejects missing student id', () => {
    expect(() => parseArgs([])).toThrow(/--student-id/i);
  });

  it('rejects a non-uuid student id before hitting the database', () => {
    expect(() => parseArgs(['--student-id', 'not-a-uuid'])).toThrow(/uuid/i);
  });
});
