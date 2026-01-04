import { describe, expect, it, vi } from 'vitest';

import { getStudentSummaryWithDefaults } from '../src/application/student-summary.js';

describe('application/student-summary', () => {
  it('merges student profiles with job summary metrics', async () => {
    const listProfiles = vi.fn().mockResolvedValue({
      items: [
        {
          id: 'student-1',
          student: 'Anna',
          dbId: null,
          pageParentId: null,
          colorPreset: null,
          accentPreference: null,
          voices: {},
          manifestPreset: null,
          profileId: null,
        },
        {
          id: 'student-2',
          student: 'Bob',
          dbId: null,
          pageParentId: null,
          colorPreset: null,
          accentPreference: null,
          voices: {},
          manifestPreset: null,
          profileId: null,
        },
      ],
      total: 2,
      limit: 2,
      offset: 0,
      order: 'asc',
    });

    const summaries = vi.fn().mockResolvedValue([
      {
        studentId: 'student-1',
        lastLessonAt: new Date('2024-02-01T10:00:00.000Z'),
        pendingDrafts: 2,
      },
    ]);

    const result = await getStudentSummaryWithDefaults(
      { limit: 2, offset: 0, order: 'asc' },
      {
        profiles: { list: listProfiles },
        jobs: { summaries },
      },
    );

    expect(result).toEqual({
      items: [
        {
          id: 'student-1',
          name: 'Anna',
          lastLessonAt: '2024-02-01T10:00:00.000Z',
          pendingDrafts: 2,
        },
        {
          id: 'student-2',
          name: 'Bob',
          lastLessonAt: null,
          pendingDrafts: 0,
        },
      ],
      total: 2,
      limit: 2,
      offset: 0,
    });

    expect(summaries).toHaveBeenCalledWith(['student-1', 'student-2']);
  });
});
