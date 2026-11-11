import { describe, expect, it } from 'vitest';

import { type Lesson, lessonNeedsHomeworkCompletion } from './fixtures';

const lesson: Lesson = {
  id: 'lesson',
  learnerId: 'alex',
  date: '2026-10-31',
  time: '15:00',
  duration: 60,
  state: 'Scheduled',
  notes: '',
  charge: true,
};
const end = new Date('2026-10-31T16:00:00+07:00').getTime();
describe('homework completion eligibility', () => {
  it('uses lesson end rather than lesson start', () => {
    expect(lessonNeedsHomeworkCompletion(lesson, end - 1)).toBe(false);
    expect(lessonNeedsHomeworkCompletion(lesson, end)).toBe(true);
  });
  it('does not complete recorded or canceled outcomes again', () => {
    for (const state of ['Completed', 'No-show', 'Canceled'] as const)
      expect(lessonNeedsHomeworkCompletion({ ...lesson, state }, end)).toBe(false);
    expect(lessonNeedsHomeworkCompletion(undefined, end)).toBe(false);
  });
  it('respects a different lesson duration', () => {
    expect(lessonNeedsHomeworkCompletion({ ...lesson, duration: 90 }, end)).toBe(false);
    expect(lessonNeedsHomeworkCompletion({ ...lesson, duration: 45 }, end)).toBe(true);
  });
});
