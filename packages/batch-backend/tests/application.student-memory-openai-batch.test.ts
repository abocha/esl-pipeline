import { describe, expect, it, vi } from 'vitest';

import {
  assertStudentMemoryOpenAiBatchAccess,
  buildStudentMemoryOpenAiBatchJsonl,
  createStudentMemoryOpenAiBatchTransport,
  StudentMemoryOpenAiBatchAccessError,
} from '../src/application/student-memory-openai-batch.js';
import { buildLessonMemoryBatchCandidates } from '../src/application/student-memory-openai-batch-candidates.js';
import type { BatchBackendConfig } from '../src/config/env.js';
import { loadConfig } from '../src/config/env.js';

function createConfig(enabled = false): BatchBackendConfig {
  const base = loadConfig();
  return {
    ...base,
    studentMemory: {
      ...base.studentMemory,
      openAiBatchEnabled: enabled,
    },
    generation: {
      ...base.generation,

      providers: {
        ...base.generation.providers,
        openai: { ...base.generation.providers.openai, apiKey: 'test-openai-key' },
      },
    },
  } as BatchBackendConfig;
}

describe('application/student-memory-openai-batch', () => {
  it('rejects lesson-memory Batch planning before reading mutable transcript state', async () => {
    await expect(
      buildLessonMemoryBatchCandidates({ transcriptIds: ['transcript-1'], model: 'gpt-5.4-nano' }),
    ).rejects.toThrow(
      'Lesson-memory OpenAI Batch planning is disabled; confirm Source to queue exact immutable content',
    );
  });

  it('blocks every remote Batch action while disabled', () => {
    expect(() =>
      assertStudentMemoryOpenAiBatchAccess({
        config: createConfig(false),
        model: 'gpt-5.4-nano',
        action: 'submit',
      }),
    ).toThrow(StudentMemoryOpenAiBatchAccessError);
  });

  it('sorts JSONL deterministically and rejects a mixed-model slice', () => {
    const body = { model: 'gpt-5.4-nano', input: 'safe source snapshot', stream: false };
    expect(
      buildStudentMemoryOpenAiBatchJsonl({
        workload: 'lesson_memory',
        model: 'gpt-5.4-nano',
        items: [
          { customId: 'lesson:b', model: 'gpt-5.4-nano', body },
          { customId: 'lesson:a', model: 'gpt-5.4-nano', body },
        ],
      }).jsonl,
    ).toBe(
      [
        JSON.stringify({ custom_id: 'lesson:a', method: 'POST', url: '/v1/responses', body }),
        JSON.stringify({ custom_id: 'lesson:b', method: 'POST', url: '/v1/responses', body }),
      ].join('\n') + '\n',
    );

    expect(() =>
      buildStudentMemoryOpenAiBatchJsonl({
        workload: 'lesson_memory',
        model: 'gpt-5.4-nano',
        items: [{ customId: 'lesson:a', model: 'gpt-5.4-mini', body }],
      }),
    ).toThrow('one model');
  });

  it('blocks transport before any network request while disabled', async () => {
    const fetchMock = vi.fn();
    const transport = createStudentMemoryOpenAiBatchTransport({ fetchImpl: fetchMock });

    await expect(
      transport.getBatch({
        config: createConfig(false),
        model: 'gpt-5.4-nano',
        batchId: 'batch_1',
      }),
    ).rejects.toBeInstanceOf(StudentMemoryOpenAiBatchAccessError);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the Batch endpoints only after the provider gate succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: 'batch_1', status: 'completed' }), { status: 200 }),
      );
    const transport = createStudentMemoryOpenAiBatchTransport({ fetchImpl: fetchMock });

    const result = await transport.getBatch({
      config: createConfig(true),
      model: 'gpt-5.6-luna',
      batchId: 'batch_1',
    });

    expect(result).toMatchObject({ id: 'batch_1', status: 'completed' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/batches/batch_1',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
