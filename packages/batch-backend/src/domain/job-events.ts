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

export function publishJobEvent(event: JobEvent): void {
  jobEventEmitter.emit(event.type, event);
}

export function subscribeJobEvents(listener: (event: JobEvent) => void): () => void {
  const handler = (event: JobEvent) => {
    listener(event);
  };

  jobEventEmitter.on('job_created', handler);
  jobEventEmitter.on('job_state_changed', handler);

  return () => {
    jobEventEmitter.off('job_created', handler);
    jobEventEmitter.off('job_state_changed', handler);
  };
}
