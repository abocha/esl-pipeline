import { describe, expect, it } from 'vitest';

import { parseArgs } from '../src/tools/retry-student-profile-candidate-refresh.js';

describe('tools/retry-student-profile-candidate-refresh', () => {
  it('parses one explicit snapshot UUID', () => {
    expect(parseArgs(['--snapshot-id', '11111111-1111-4111-8111-111111111111'])).toEqual({
      snapshotId: '11111111-1111-4111-8111-111111111111',
    });
  });

  it.each([
    { argv: [], message: '--snapshot-id is required' },
    { argv: ['--snapshot-id'], message: 'Missing value for --snapshot-id' },
    { argv: ['--snapshot-id', 'not-a-uuid'], message: '--snapshot-id must be a valid UUID' },
    {
      argv: [
        '--snapshot-id',
        '11111111-1111-4111-8111-111111111111',
        '--snapshot-id',
        '22222222-2222-4222-8222-222222222222',
      ],
      message: '--snapshot-id may be provided only once',
    },
    { argv: ['--all'], message: 'Unknown argument: --all' },
  ])('rejects invalid input: $message', ({ argv, message }) => {
    expect(() => parseArgs(argv)).toThrow(message);
  });
});
