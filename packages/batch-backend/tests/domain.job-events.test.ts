import { beforeEach, describe, expect, it, vi } from 'vitest';

import { publishJobEvent, subscribeJobEvents } from '../src/domain/job-events.js';
import type { JobRecord } from '../src/domain/job-model.js';

describe('domain/job-events', () => {
  const baseJob: JobRecord = {
    id: 'job-test',
    state: 'queued',
    md: 'fixtures/job.md',
    preset: null,
    withTts: null,
    upload: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    startedAt: null,
    finishedAt: null,
    error: null,
    manifestPath: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delivers events to subscribed listeners', () => {
    const listener = vi.fn();
    const dispose = subscribeJobEvents(listener);

    publishJobEvent({ type: 'job_created', job: baseJob });
    publishJobEvent({
      type: 'job_state_changed',
      job: { ...baseJob, state: 'running' },
    });

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, {
      type: 'job_created',
      job: baseJob,
    });
    expect(listener).toHaveBeenNthCalledWith(2, {
      type: 'job_state_changed',
      job: { ...baseJob, state: 'running' },
    });

    dispose();
  });

  it('stops delivering events after disposer is invoked', () => {
    const listener = vi.fn();
    const dispose = subscribeJobEvents(listener);

    dispose();
    publishJobEvent({ type: 'job_created', job: baseJob });

    expect(listener).not.toHaveBeenCalled();
  });

  it('does nothing when publishing without subscribers', () => {
    expect(() =>
      publishJobEvent({
        type: 'job_state_changed',
        job: { ...baseJob, state: 'failed', error: 'oops' },
      }),
    ).not.toThrow();
  });
});
