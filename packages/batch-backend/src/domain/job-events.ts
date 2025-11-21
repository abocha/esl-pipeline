// packages/batch-backend/src/domain/job-events.ts
//
// Lightweight in-memory event bus used by the batch backend to broadcast job lifecycle updates.
// Implemented with EventTarget (web standard) for better portability and modern event handling.
import type { JobRecord } from './job-model.js';

export type JobEventType = 'job_created' | 'job_state_changed';

export interface JobEvent {
  type: JobEventType;
  job: JobRecord;
}

/**
 * Custom event class for job events
 */
class JobEventCustomEvent extends Event {
  constructor(
    type: string,
    public readonly jobEvent: JobEvent,
  ) {
    super(type);
  }
}

/**
 * Custom event for subscription changes
 */
class SubscriptionChangeEvent extends Event {
  constructor(
    type: string,
    public readonly change: SubscriptionChange,
  ) {
    super(type);
  }
}

const jobEventTarget = new EventTarget();

export interface JobSubscriptionOptions {
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
}

type SubscriptionChange =
  | { scope: 'all'; count: number }
  | { scope: 'job'; jobId: string; count: number };

const subscriptionChangeTarget = new EventTarget();
const jobSubscriptionCounts = new Map<string, number>();
let wildcardSubscriptionCount = 0;

function emitSubscriptionChange(change: SubscriptionChange): void {
  const event = new SubscriptionChangeEvent('change', change);
  subscriptionChangeTarget.dispatchEvent(event);
}

export function publishJobEvent(event: JobEvent): void {
  const customEvent = new JobEventCustomEvent(event.type, event);
  jobEventTarget.dispatchEvent(customEvent);
}

export function subscribeJobEvents(
  listener: (event: JobEvent) => void,
  options?: JobSubscriptionOptions,
): () => void {
  const trackRemote = options?.trackRemote !== false;
  const isAllJobs = options?.allJobs === true || !options?.jobIds || options.jobIds.length === 0;
  const jobIds = isAllJobs ? null : [...new Set(options?.jobIds)];

  const handler = (evt: Event) => {
    if (!(evt instanceof JobEventCustomEvent)) return;
    const event = evt.jobEvent;
    if (!isAllJobs && jobIds && !jobIds.includes(event.job.id)) return;
    listener(event);
  };

  jobEventTarget.addEventListener('job_created', handler);
  jobEventTarget.addEventListener('job_state_changed', handler);

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
    jobEventTarget.removeEventListener('job_created', handler);
    jobEventTarget.removeEventListener('job_state_changed', handler);

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
  listener: (change: SubscriptionChange) => void,
): () => void {
  const handler = (evt: Event) => {
    if (!(evt instanceof SubscriptionChangeEvent)) return;
    listener(evt.change);
  };

  subscriptionChangeTarget.addEventListener('change', handler);
  return () => subscriptionChangeTarget.removeEventListener('change', handler);
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
