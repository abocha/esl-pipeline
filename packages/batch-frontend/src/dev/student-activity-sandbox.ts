import type { StudentActivityItem, StudentActivityResponse } from '@esl-pipeline/contracts';

// Fictional UI examples, not a substitute for the backend's recording/paging tests.
const owner = '/students/student-alex';
const link = (label: string, href = `${owner}/schedule-billing`) => [{ label, href }];
const records: StudentActivityItem[] = [
  {
    id: 'activity-homework-v2',
    type: 'homework_published',
    category: 'lessons',
    occurredAt: '2026-10-17T10:30:00Z',
    subject: 'Homework published · Travel plans',
    summary: 'Correction published · version 2',
    evidence: 'retained',
    links: link('Open homework', '/?sessionId=session-sandbox'),
    details: [{ label: 'Version', value: '2 · replaces the earlier published handout' }],
  },
  {
    id: 'activity-completed-again',
    type: 'lesson_completed',
    category: 'lessons',
    occurredAt: '2026-10-17T10:00:00Z',
    subject: 'Lesson completed · Travel plans',
    summary: '50 min · 1 credit used',
    evidence: 'recorded',
    effects: [{ label: 'Credits', value: '−1' }],
    links: link('Open lesson'),
    actor: { kind: 'user', label: 'Tutor' },
    details: [{ label: 'Previous status', value: 'Scheduled' }],
  },
  {
    id: 'activity-restored',
    type: 'lesson_restored',
    category: 'lessons',
    occurredAt: '2026-10-17T09:30:00Z',
    subject: 'Lesson restored to scheduled · Travel plans',
    summary: 'Earlier credit debit reversed',
    evidence: 'recorded',
    effects: [{ label: 'Credits returned', value: '+1' }],
    links: link('Open lesson'),
    details: [{ label: 'Previous status', value: 'Completed' }],
  },
  {
    id: 'activity-first-completion',
    type: 'lesson_completed',
    category: 'lessons',
    occurredAt: '2026-10-17T09:00:00Z',
    subject: 'Lesson completed · Travel plans',
    summary: '50 min · 1 credit used',
    evidence: 'recorded',
    effects: [{ label: 'Credits', value: '−1' }],
    links: link('Open lesson'),
    details: [],
  },
  {
    id: 'activity-rescheduled',
    type: 'lesson_changed',
    category: 'lessons',
    occurredAt: '2026-10-16T09:00:00Z',
    subject: 'Lesson moved · Travel plans',
    summary: 'Oct 17, 2:00 PM → Oct 17, 3:00 PM',
    evidence: 'recorded',
    links: link('Open lesson'),
    details: [{ label: 'Timezone', value: 'Asia/Bangkok' }],
  },
  {
    id: 'activity-approved',
    type: 'candidate_approved',
    category: 'profile',
    occurredAt: '2026-10-16T08:30:00Z',
    subject: 'Profile suggestion approved',
    summary: 'Study preferences · More practice with travel conversations',
    evidence: 'recorded',
    links: link('Open Learning', `${owner}/learning`),
    details: [],
  },
  {
    id: 'activity-payment',
    type: 'payment_recorded',
    category: 'billing',
    occurredAt: '2026-10-15T09:00:00Z',
    effectiveAt: '2026-10-14',
    subject: 'Payment recorded · USD 120.00',
    summary: 'Received Oct 14 · Bank transfer',
    evidence: 'retained',
    links: link('View payment'),
    details: [{ label: 'Note', value: 'October lessons' }],
  },
  {
    id: 'activity-package',
    type: 'credits_added',
    category: 'billing',
    occurredAt: '2026-10-15T08:59:00Z',
    subject: 'Lesson credits added',
    summary: '+8 credits · Lesson package',
    evidence: 'retained',
    links: link('View ledger'),
    details: [],
  },
  {
    id: 'activity-homework-started',
    type: 'homework_started',
    category: 'lessons',
    occurredAt: '2026-10-14T09:00:00Z',
    subject: 'Homework started from a saved transcript',
    evidence: 'retained',
    links: link('Open lesson', '/?sessionId=session-sandbox'),
    details: [],
  },
  {
    id: 'activity-transcript',
    type: 'transcript_saved',
    category: 'lessons',
    occurredAt: '2026-10-13T09:00:00Z',
    subject: 'Transcript saved · No homework planned',
    summary: 'Travel plans · 50 min',
    evidence: 'retained',
    links: link('Open transcript', '/?sessionId=session-sandbox'),
    details: [],
  },
  ...Array.from(
    { length: 24 },
    (_, index): StudentActivityItem => ({
      id: `activity-earlier-${index}`,
      type: 'lesson_created',
      category: 'lessons',
      occurredAt: new Date(Date.UTC(2026, 9, 12 - index, 8)).toISOString(),
      subject: `Lesson scheduled · ${index % 2 ? 'Everyday conversations' : 'Workplace English'}`,
      summary: '50 min',
      evidence: 'legacy',
      links: link('Open lesson'),
      details: [],
    }),
  ),
];

export function studentActivitySandbox(
  studentId: string,
  query: URLSearchParams,
): StudentActivityResponse {
  const category = query.get('category') ?? 'all';
  const from = query.get('from');
  const to = query.get('to');
  const items = (studentId === 'student-alex' ? records : []).filter((item) => {
    const day = item.occurredAt.slice(0, 10);
    return (
      (category === 'all' ||
        item.category === category ||
        (category === 'billing' && Boolean(item.effects?.length))) &&
      (!from || day >= from) &&
      (!to || day <= to)
    );
  });
  const offset = Number(query.get('cursor') ?? 0);
  const limit = Number(query.get('limit') ?? 30);
  const end = offset + limit;
  return {
    items: items.slice(offset, end),
    nextCursor: end < items.length ? String(end) : null,
    timezone: 'Asia/Bangkok',
    coverage: {
      recordingStartedAt: null,
      notice:
        'Earlier changes may not have been recorded. Historical records are shown where available.',
    },
  };
}
