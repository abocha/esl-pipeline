import { describe, expect, it, vi } from 'vitest';

import { submitJob } from '../src/application/submit-job.js';
import * as jobs from '../src/domain/job-repository.js';
import * as queue from '../src/infrastructure/queue-bullmq.js';

describe('retired Markdown job submission', () => {
  it.each(['fixtures/ok.md', '# Inline homework', '', null])(
    'rejects %s before persistence or queue creation',
    async (md) => {
      const insert = vi.spyOn(jobs, 'insertJob');
      const createQueue = vi.spyOn(queue, 'createJobQueue');
      await expect(submitJob({ md } as never)).rejects.toMatchObject({
        code: 'legacy_assignment_read_only',
        statusCode: 410,
      });
      expect(insert).not.toHaveBeenCalled();
      expect(createQueue).not.toHaveBeenCalled();
      vi.restoreAllMocks();
    },
  );
});
