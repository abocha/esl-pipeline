import { describe, expect, it, vi } from 'vitest';

import { processStudentMemoryOpenAiBatchResults } from '../src/application/student-memory-openai-batch-result-processing.js';

describe('application/student-memory-openai-batch-result-processing', () => {
  it('imports valid unordered responses and makes provider errors retryable', async () => {
    const validateAndImport = vi.fn().mockResolvedValue('canonical-1');
    const result = await processStudentMemoryOpenAiBatchResults({
      runStatus: 'completed',
      items: [
        { customId: 'lesson:a', workload: 'lesson_memory' },
        { customId: 'lesson:b', workload: 'lesson_memory' },
      ],
      outputJsonl: [
        JSON.stringify({ custom_id: 'lesson:b', response: { status_code: 500, body: {} } }),
        JSON.stringify({
          custom_id: 'lesson:a',
          response: { status_code: 200, body: { id: 'resp_1' } },
        }),
      ].join('\n'),
      errorJsonl: '',
      validateAndImport,
    });

    expect(validateAndImport).toHaveBeenCalledWith(
      { customId: 'lesson:a', workload: 'lesson_memory' },
      { id: 'resp_1' },
      undefined,
    );
    expect(result.outcomes).toEqual([
      expect.objectContaining({
        customId: 'lesson:a',
        outcome: 'imported',
        canonicalRecordId: 'canonical-1',
      }),
      expect.objectContaining({
        customId: 'lesson:b',
        outcome: 'retryable_failure',
        reason: 'provider_error',
      }),
    ]);
  });

  it('keeps schema failures terminal and does not retry missing completed results', async () => {
    const validateAndImport = vi.fn().mockRejectedValue(new Error('invalid evidence source'));
    const result = await processStudentMemoryOpenAiBatchResults({
      runStatus: 'completed',
      items: [
        { customId: 'lesson:a', workload: 'lesson_memory' },
        { customId: 'lesson:b', workload: 'lesson_memory' },
      ],
      outputJsonl: JSON.stringify({
        custom_id: 'lesson:a',
        response: { status_code: 200, body: { id: 'resp_1' } },
      }),
      errorJsonl: '',
      validateAndImport,
    });

    expect(result.outcomes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          customId: 'lesson:a',
          outcome: 'terminal_failure',
          reason: 'validation_failed',
        }),
        expect.objectContaining({
          customId: 'lesson:b',
          outcome: 'terminal_failure',
          reason: 'missing_result',
        }),
      ]),
    );
  });
});
