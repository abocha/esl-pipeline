import type { StudentSummaryResponse } from '@esl-pipeline/contracts';

import {
  listStudentProfiles,
  type StudentProfileListParams,
} from './student-profiles-store.js';
import { getStudentJobSummaries } from '../domain/job-repository.js';

export interface StudentSummaryParams {
  limit?: number;
  offset?: number;
  order?: StudentProfileListParams['order'];
}

export interface StudentSummaryDependencies {
  profiles: {
    list: typeof listStudentProfiles;
  };
  jobs: {
    summaries: typeof getStudentJobSummaries;
  };
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function getStudentSummaryWithDefaults(
  params: StudentSummaryParams = {},
  overrides?: Partial<StudentSummaryDependencies>,
): Promise<StudentSummaryResponse> {
  const profiles = overrides?.profiles ?? { list: listStudentProfiles };
  const jobs = overrides?.jobs ?? { summaries: getStudentJobSummaries };

  const limit = clampNumber(params.limit ?? DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = Math.max(params.offset ?? 0, 0);
  const order = params.order === 'desc' ? 'desc' : 'asc';

  const result = await profiles.list({
    limit,
    offset,
    order,
  });

  const ids = result.items.map((profile) => profile.id);
  const summaries = await jobs.summaries(ids);
  const summaryMap = new Map(summaries.map((summary) => [summary.studentId, summary]));

  return {
    items: result.items.map((profile) => {
      const summary = summaryMap.get(profile.id);
      return {
        id: profile.id,
        name: profile.student,
        lastLessonAt: summary?.lastLessonAt ? summary.lastLessonAt.toISOString() : null,
        pendingDrafts: summary?.pendingDrafts ?? 0,
      };
    }),
    total: result.total,
    limit: result.limit,
    offset: result.offset,
  };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
