// packages/batch-backend/src/domain/job-events.ts
//
// Lightweight in-memory event bus used by the batch backend to broadcast job lifecycle updates.
// Implemented with a singleton EventEmitter so all publishers/subscribers share the same bus.

import { EventEmitter } from 'node:events';
import type { JobRecord } from './job-model';

export type JobEventType = 'job_created' | 'job_state_changed';

export interface JobEvent {
  type: JobEventType;
  job: JobRecord;
}

const jobEventEmitter = new EventEmitter();
jobEventEmitter.setMaxListeners(0);

export type JobSubscriptionOptions = {
  /**
   * One or more job IDs to listen for. If omitted or empty, all jobs are delivered.
   */
  jobIds?: string[];
  /**
   * Treat this subscription as interested in all jobs (explicit over jobIds).
   */
  allJobs?: boolean;
  /**
   * Whether this subscription should be counted for remote (Redis) fan-out.
   * Internal relays can disable to avoid unnecessary remote subscriptions.
   */
  trackRemote?: boolean;
};

type SubscriptionChange =
  | { scope: 'all'; count: number }
  | { scope: 'job'; jobId: string; count: number };

const subscriptionChangeEmitter = new EventEmitter();
const jobSubscriptionCounts = new Map<string, number>();
let wildcardSubscriptionCount = 0;

function emitSubscriptionChange(change: SubscriptionChange): void {
  subscriptionChangeEmitter.emit('change', change);
}

export function publishJobEvent(event: JobEvent): void {
  jobEventEmitter.emit(event.type, event);
}

export function subscribeJobEvents(
  listener: (event: JobEvent) => void,
  options?: JobSubscriptionOptions
): () => void {
  const trackRemote = options?.trackRemote !== false;
  const isAllJobs = options?.allJobs === true || !options?.jobIds || options.jobIds.length === 0;
  const jobIds = isAllJobs ? null : Array.from(new Set(options?.jobIds ?? []));

  const handler = (event: JobEvent) => {
    if (!isAllJobs && jobIds && !jobIds.includes(event.job.id)) return;
    listener(event);
  };

  jobEventEmitter.on('job_created', handler);
  jobEventEmitter.on('job_state_changed', handler);

  if (trackRemote) {
    if (isAllJobs) {
      wildcardSubscriptionCount += 1;
      emitSubscriptionChange({ scope: 'all', count: wildcardSubscriptionCount });
    } else if (jobIds) {
      for (const jobId of jobIds) {
        const next = (jobSubscriptionCounts.get(jobId) ?? 0) + 1;
        jobSubscriptionCounts.set(jobId, next);
        emitSubscriptionChange({ scope: 'job', jobId, count: next });
      }
    }
  }

  return () => {
    jobEventEmitter.off('job_created', handler);
    jobEventEmitter.off('job_state_changed', handler);

    if (trackRemote) {
      if (isAllJobs) {
        wildcardSubscriptionCount = Math.max(0, wildcardSubscriptionCount - 1);
        emitSubscriptionChange({ scope: 'all', count: wildcardSubscriptionCount });
      } else if (jobIds) {
        for (const jobId of jobIds) {
          const current = jobSubscriptionCounts.get(jobId) ?? 0;
          const next = Math.max(0, current - 1);
          if (next === 0) {
            jobSubscriptionCounts.delete(jobId);
          } else {
            jobSubscriptionCounts.set(jobId, next);
          }
          emitSubscriptionChange({ scope: 'job', jobId, count: next });
        }
      }
    }
  };
}

export function onJobSubscriptionChange(
  listener: (change: SubscriptionChange) => void
): () => void {
  subscriptionChangeEmitter.on('change', listener);
  return () => subscriptionChangeEmitter.off('change', listener);
}

export function getJobSubscriptionSnapshot(): {
  all: number;
  jobs: Map<string, number>;
} {
  return {
    all: wildcardSubscriptionCount,
    jobs: new Map(jobSubscriptionCounts),
  };
}
