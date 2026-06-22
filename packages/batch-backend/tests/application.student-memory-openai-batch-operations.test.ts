import { describe, expect, it, vi } from 'vitest';

import {
  createAndSubmitStudentMemoryOpenAiBatchPlan,
  createStudentMemoryOpenAiBatchPlan,
} from '../src/application/student-memory-openai-batch-operations.js';
import { loadConfig } from '../src/config/env.js';

describe('application/student-memory-openai-batch-operations', () => {
  it('builds a source-text-free dry-run summary without persistence or transport', async () => {
    const createRun = vi.fn();
    const plan = await createStudentMemoryOpenAiBatchPlan({
      workload: 'lesson_memory',
      model: 'gpt-5.4-nano',
      items: [
        {
          id: 'item-1',
          studentId: 'student-1',
          customId: 'student-memory-batch:v1:lesson_memory:1',
          model: 'gpt-5.4-nano',
          body: { model: 'gpt-5.4-nano', input: 'sensitive source text' },
          canonicalScopeKey: 'transcript-1',
          sourceVersionHash: 'a'.repeat(64),
          requestEnvelope: { version: 'generation_request_envelope_v1' } as never,
          responseSchemaFingerprint: 'schema',
          sourceRefs: { transcriptId: 'transcript-1' },
        },
      ],
      persist: false,
      repository: { createRun },
    });

    expect(createRun).not.toHaveBeenCalled();
    expect(plan.summary).toEqual({
      workload: 'lesson_memory',
      model: 'gpt-5.4-nano',
      itemCount: 1,
      inputBytes: expect.any(Number),
      inputJsonlSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      customIds: ['student-memory-batch:v1:lesson_memory:1'],
    });
    expect(JSON.stringify(plan.summary)).not.toContain('sensitive source text');
  });

  it('submits a persisted retry slice immediately after creating it', async () => {
    const createRun = vi.fn().mockResolvedValue({ id: 'child-run' });
    const markSubmitted = vi.fn();
    const transport = {
      uploadInput: vi.fn().mockResolvedValue({ id: 'file_1' }),
      createBatch: vi.fn().mockResolvedValue({ id: 'batch_1' }),
    };

    const result = await createAndSubmitStudentMemoryOpenAiBatchPlan({
      config: loadConfig(),
      workload: 'lesson_memory',
      model: 'gpt-5.4-nano',
      parentRetryRunId: 'parent-run',
      items: [
        {
          retryOfItemId: 'parent-item',
          studentId: 'student-1',
          customId: 'lesson:scope:retry:parent-run',
          model: 'gpt-5.4-nano',
          body: { model: 'gpt-5.4-nano' },
          canonicalScopeKey: 'scope',
          sourceVersionHash: 'a'.repeat(64),
          requestEnvelope: { version: 'generation_request_envelope_v1' } as never,
          responseSchemaFingerprint: 'schema',
          sourceRefs: { sourceSelectionHash: 'selection' },
        },
      ],
      transport: transport as never,
      repository: { createRun, markSubmitted },
    });

    expect(createRun).toHaveBeenCalledOnce();
    expect(transport.uploadInput).toHaveBeenCalledOnce();
    expect(transport.createBatch).toHaveBeenCalledOnce();
    expect(markSubmitted).toHaveBeenCalledWith({
      runId: 'child-run',
      remoteInputFileId: 'file_1',
      remoteBatchId: 'batch_1',
    });
    expect(result).toMatchObject({ runId: 'child-run', remoteBatchId: 'batch_1' });
  });
});
