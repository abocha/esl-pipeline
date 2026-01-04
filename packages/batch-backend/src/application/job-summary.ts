import type { JobState, JobSummaryResponse } from '@esl-pipeline/contracts';

import { getJobSummary } from '../domain/job-repository.js';

export interface JobSummaryParams {
  from?: Date | null;
  to?: Date | null;
  userId?: string | null;
}

export interface JobSummaryDependencies {
  jobs: {
    summary: typeof getJobSummary;
  };
  now: () => Date;
}

const DEFAULT_RANGE_DAYS = 7;

export async function getJobSummaryWithDefaults(
  params: JobSummaryParams = {},
  overrides?: Partial<JobSummaryDependencies>,
): Promise<JobSummaryResponse> {
  const jobs = overrides?.jobs ?? { summary: getJobSummary };
  const now = overrides?.now ?? (() => new Date());
  const resolved = resolveDateRange(params, now);

  const summary = await jobs.summary({
    from: resolved.from,
    to: resolved.to,
    userId: params.userId ?? null,
  });

  const byState: Record<JobState, number> = {
    queued: summary.queued,
    running: summary.running,
    awaiting_approval: summary.awaitingApproval,
    succeeded: summary.succeeded,
    failed: summary.failed,
  };

  return {
    total: summary.total,
    byState,
    pendingApprovals: byState.awaiting_approval,
    last7Days: {
      total: summary.total,
      succeeded: summary.succeeded,
      failed: summary.failed,
    },
    tts: {
      enabled: summary.ttsEnabled,
      succeeded: summary.ttsSucceeded,
    },
  };
}

function resolveDateRange(
  params: JobSummaryParams,
  nowFactory: () => Date,
): { from: Date; to: Date } {
  const now = nowFactory();
  const to = params.to ?? now;
  const from =
    params.from ??
    new Date(to.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);
  return { from, to };
}
