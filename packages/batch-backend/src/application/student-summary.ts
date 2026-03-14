import type { StudentSummaryResponse } from '@esl-pipeline/contracts';

import { getStudentJobSummaries } from '../domain/job-repository.js';
import { type StudentProfileListParams, listStudentProfiles } from './student-profiles-store.js';

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
const PROFILE_SCAN_LIMIT = 500;

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
    limit: PROFILE_SCAN_LIMIT,
    offset: 0,
    order: 'asc',
  });

  const ids = result.items.map((profile) => profile.id);
  const summaries = await jobs.summaries(ids);
  const summaryMap = new Map(summaries.map((summary) => [summary.studentId, summary]));
  const merged = result.items
    .map((profile) => {
      const summary = summaryMap.get(profile.id);
      return {
        id: profile.id,
        name: profile.student,
        lastLessonAt: summary?.lastLessonAt ? summary.lastLessonAt.toISOString() : null,
        pendingDrafts: summary?.pendingDrafts ?? 0,
      };
    })
    .sort((left, right) => compareStudentActivity(left, right, order));
  const items = merged.slice(offset, offset + limit);

  return {
    items,
    total: merged.length,
    limit,
    offset,
  };
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function compareStudentActivity(
  left: StudentSummaryResponse['items'][number],
  right: StudentSummaryResponse['items'][number],
  order: 'asc' | 'desc',
): number {
  const leftTime = left.lastLessonAt ? Date.parse(left.lastLessonAt) : null;
  const rightTime = right.lastLessonAt ? Date.parse(right.lastLessonAt) : null;

  if (leftTime === null && rightTime === null) {
    return left.name.localeCompare(right.name);
  }
  if (leftTime === null) {
    return 1;
  }
  if (rightTime === null) {
    return -1;
  }
  if (leftTime !== rightTime) {
    return order === 'asc' ? leftTime - rightTime : rightTime - leftTime;
  }
  return left.name.localeCompare(right.name);
}
