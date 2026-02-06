import type { JobListResponse, JobState } from '@esl-pipeline/contracts';

import { type JobListOptions, countJobs, listJobs } from '../domain/job-repository.js';
import { jobRecordToDto } from './job-dto.js';

export interface ListJobsParams {
  states?: JobState[] | null;
  studentId?: string | null;
  from?: Date | null;
  to?: Date | null;
  limit?: number;
  offset?: number;
  order?: JobListOptions['order'];
  userId?: string | null;
}

export interface ListJobsDependencies {
  jobs: {
    list: typeof listJobs;
    count: typeof countJobs;
  };
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function listJobsWithDefaults(
  params: ListJobsParams = {},
  overrides?: Partial<ListJobsDependencies>,
): Promise<JobListResponse> {
  const jobs = overrides?.jobs ?? {
    list: listJobs,
    count: countJobs,
  };

  const limit = clampNumber(params.limit ?? DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = Math.max(params.offset ?? 0, 0);
  const order = params.order === 'asc' ? 'asc' : 'desc';

  const [items, total] = await Promise.all([
    jobs.list({
      states: params.states ?? undefined,
      studentId: params.studentId ?? null,
      from: params.from ?? null,
      to: params.to ?? null,
      limit,
      offset,
      order,
      userId: params.userId ?? null,
    }),
    jobs.count({
      states: params.states ?? undefined,
      studentId: params.studentId ?? null,
      from: params.from ?? null,
      to: params.to ?? null,
      userId: params.userId ?? null,
    }),
  ]);

  return {
    jobs: items.map((job) => jobRecordToDto(job)),
    total,
    limit,
    offset,
  };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
