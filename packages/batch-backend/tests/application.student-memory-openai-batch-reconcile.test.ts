import { describe, expect, it } from 'vitest';

import { reconcileStudentMemoryOpenAiBatchJsonl } from '../src/application/student-memory-openai-batch-reconcile.js';

describe('application/student-memory-openai-batch-reconcile', () => {
  it('maps unordered output lines by custom id and keeps raw response bodies in memory only', () => {
    const result = reconcileStudentMemoryOpenAiBatchJsonl({
      expectedCustomIds: ['lesson:a', 'lesson:b'],
      outputJsonl: [
        JSON.stringify({
          custom_id: 'lesson:b',
          response: { status_code: 200, body: { id: 'r2' } },
        }),
        JSON.stringify({
          custom_id: 'lesson:a',
          response: { status_code: 200, body: { id: 'r1' } },
        }),
      ].join('\n'),
      errorJsonl: '',
    });

    expect(result.linesByCustomId.get('lesson:a')).toMatchObject({
      kind: 'response',
      body: { id: 'r1' },
    });
    expect(result.linesByCustomId.get('lesson:b')).toMatchObject({
      kind: 'response',
      body: { id: 'r2' },
    });
    expect(result.failures).toEqual([]);
  });

  it('refuses unknown and duplicate result ids without attaching either to an item', () => {
    const result = reconcileStudentMemoryOpenAiBatchJsonl({
      expectedCustomIds: ['lesson:a'],
      outputJsonl: [
        JSON.stringify({
          custom_id: 'lesson:a',
          response: { status_code: 200, body: { id: 'r1' } },
        }),
        JSON.stringify({
          custom_id: 'lesson:a',
          response: { status_code: 200, body: { id: 'r2' } },
        }),
        JSON.stringify({
          custom_id: 'foreign',
          response: { status_code: 200, body: { id: 'r3' } },
        }),
      ].join('\n'),
      errorJsonl: '',
    });

    expect(result.linesByCustomId.get('lesson:a')).toBeUndefined();
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: 'duplicate_custom_id', customId: 'lesson:a' }),
        expect.objectContaining({ reason: 'unknown_custom_id', customId: 'foreign' }),
      ]),
    );
  });
});
