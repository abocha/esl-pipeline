import { describe, expect, it, vi } from 'vitest';

import { processHomeworkMemoryJob } from '../src/application/process-homework-memory-job.js';

describe('application/process-homework-memory-job', () => {
  it('skips generation when the homework source has no material change', async () => {
    const generator = vi.fn();
    const requestRefresh = vi.fn();

    await processHomeworkMemoryJob({
      config: {
        defaultProvider: 'openai',
      } as never,
      payload: {
        kind: 'homework-memory-generate',
        jobId: 'job-1',
        studentId: 'student-1',
        provider: 'openai',
        model: 'gpt-5.2',
      },
      overrides: {
        sourceEvaluator: vi.fn().mockResolvedValue({
          shouldGenerate: false,
          reason: 'no_material_change',
          source: {
            jobId: 'job-1',
            assignmentLineageKey: 'lineage-1',
            studentId: 'student-1',
            publishedAt: new Date('2026-03-20T00:00:00.000Z'),
            publishedMarkdown: '# ignored',
            contentHash: 'hash-1',
            publishTargets: [],
            normalizedMarkdown: {
              frontmatter: null,
              sections: [],
              plainText: '',
            },
          },
        }),
        generator,
        snapshots: {
          requestRefresh,
        },
      },
    });

    expect(generator).not.toHaveBeenCalled();
    expect(requestRefresh).not.toHaveBeenCalled();
  });

  it('generates canonical homework memory and requests snapshot refresh when the source changed', async () => {
    const generator = vi.fn().mockResolvedValue({
      entry: {
        id: 'homework-memory-1',
      },
    });
    const requestRefresh = vi.fn().mockResolvedValue(null);

    await processHomeworkMemoryJob({
      config: {
        defaultProvider: 'openai',
      } as never,
      payload: {
        kind: 'homework-memory-generate',
        jobId: 'job-1',
        studentId: 'student-1',
        provider: 'openai',
        model: 'gpt-5.2',
      },
      overrides: {
        sourceEvaluator: vi.fn().mockResolvedValue({
          shouldGenerate: true,
          reason: 'published_content_changed',
          source: {
            jobId: 'job-1',
            assignmentLineageKey: 'lineage-1',
            studentId: 'student-1',
            promptPackageId: 'prompt-1',
            draftId: 'draft-1',
            recordingId: 'recording-1',
            transcriptId: 'transcript-1',
            publishedAt: new Date('2026-03-20T00:00:00.000Z'),
            publishedMarkdown: '# Assignment',
            contentHash: 'hash-1',
            publishTargets: [
              {
                target: 'notion',
                url: 'https://example.com/notion',
                jobId: 'job-1',
                publishedAt: '2026-03-20T00:00:00.000Z',
              },
            ],
            normalizedMarkdown: {
              frontmatter: 'student: Test',
              sections: [{ heading: 'Mission', content: 'Explain the problem and give advice.' }],
              plainText: 'Mission Explain the problem and give advice.',
            },
          },
        }),
        generator,
        snapshots: {
          requestRefresh,
        },
      },
    });

    expect(generator).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          source: expect.objectContaining({
            assignmentLineageKey: 'lineage-1',
            studentId: 'student-1',
          }),
          provider: 'openai',
          model: 'gpt-5.2',
          prompt: expect.stringContaining('[PUBLISH_METADATA]'),
        }),
      }),
    );
    expect(requestRefresh).toHaveBeenCalledWith({
      config: {
        generation: {
          defaultProvider: 'openai',
        },
      },
      params: {
        studentId: 'student-1',
        trigger: 'homework-memory-ready',
        sourceEntryId: 'homework-memory-1',
      },
    });
  });
});
