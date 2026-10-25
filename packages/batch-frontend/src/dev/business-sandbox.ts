import type {
  BusinessLessonDto,
  BusinessReminderDto,
  BusinessScheduleSurfaceResponse,
  BusinessSettingsDto,
  BusinessStatsSurfaceResponse,
} from '@esl-pipeline/contracts';

// Fictional, in-memory data for the existing dev-only mock-auth sandbox.
export function createBusinessSandbox() {
  const now = new Date();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(now);
  const date = (offset: number, hour = 9) => {
    const value = new Date(`${today}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + offset);
    value.setUTCHours(hour);
    return value.toISOString();
  };
  let settings: BusinessSettingsDto = {
    workspaceId: 'workspace-sandbox',
    defaultCurrency: 'USD',
    defaultLessonRateMinor: 2000,
    defaultLessonDurationMinutes: 50,
    timezone: 'Asia/Bangkok',
    forecastHorizonDays: 30,
    noShowRateBasisPoints: 0,
    cancellationRateBasisPoints: 0,
    topUpThreshold: 1,
    updatedAt: null,
  };
  const lesson = (index: number, offset: number, hour: number): BusinessLessonDto => ({
    id: `business-lesson-${index}`,
    studentId: index % 2 ? 'student-cora' : 'student-alex',
    studentName: index % 2 ? 'Cora Preview' : 'Alex',
    studentScheduleBillingPath: `/students/${index % 2 ? 'student-cora' : 'student-alex'}/schedule-billing`,
    workspaceId: settings.workspaceId,
    startsAt: date(offset, hour),
    timezone: settings.timezone,
    durationMinutes: index === 2 ? 100 : 50,
    status: 'scheduled',
    consumesCredit: true,
    title: null,
    notes: null,
    creditEventId: null,
    historicalScheduleOrigin: {},
    schedulingSource: 'unmanaged',
    calendarEventUrl: null,
    homework: {
      status: 'not_started',
      assignmentSessionId: null,
      promptPackageId: null,
      draftId: null,
      jobId: null,
      homeworkMemoryEntryId: null,
      transcriptResultSessionId: null,
      htmlUrl: null,
      updatedAt: null,
    },
    createdAt: date(-1),
    updatedAt: date(-1),
  });
  const lessons = [
    lesson(0, 0, 7),
    lesson(1, 0, 9),
    lesson(2, 0, 11),
    lesson(3, 1, 7),
    lesson(4, 1, 9),
    lesson(5, 3, 8),
    lesson(6, 5, 10),
  ];
  const followups: BusinessReminderDto[] = Array.from({ length: 6 }, (_, index) => {
    const item = lesson(index + 10, -index - 1, 8);
    return {
      studentId: item.studentId,
      studentName: item.studentName,
      studentScheduleBillingPath: item.studentScheduleBillingPath,
      remainingCredits: 0,
      type: 'lesson_followup',
      channel: 'manual',
      actionIntent: 'complete_lesson_and_start_assignment',
      severity: 'attention',
      lessonId: item.id,
      lessonStatus: 'completed',
      lessonConsumesCredit: true,
      lessonSummary: {
        lessonId: item.id,
        startsAt: item.startsAt,
        durationMinutes: 50,
        title: index === 0 ? 'Travel plans and past experiences' : null,
      },
      title: 'Finish lesson follow-up',
      message: 'Homework is not published yet.',
      copyText: '',
    };
  });
  const hidden = new Set<string>();
  let latestHiddenReminder: BusinessScheduleSurfaceResponse['latestHiddenReminder'] = null;
  const otherReminders: BusinessReminderDto[] = [
    {
      studentId: 'student-cora',
      studentName: 'Cora Preview',
      studentScheduleBillingPath: '/students/student-cora/schedule-billing',
      remainingCredits: 1,
      type: 'low_balance',
      channel: 'manual',
      actionIntent: 'copy_text',
      severity: 'attention',
      title: 'Lesson credits are low',
      message: '1 lesson credit remaining.',
      copyText: 'Hi Cora, your lesson balance is 1 credit. Would you like to discuss a top-up?',
    },
  ];
  return (
    method: string,
    path: string,
    query: URLSearchParams,
    body: Record<string, unknown>,
  ): unknown => {
    if (path === '/business/settings') {
      if (method === 'put') settings = { ...settings, ...body } as BusinessSettingsDto;
      return { ...settings };
    }
    if (method === 'get' && path === '/business/schedule') {
      const from = query.get('from') || today;
      const to = query.get('to') || date(7).slice(0, 10);
      const inRange = lessons.filter((item) => {
        const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: settings.timezone }).format(
          new Date(item.startsAt),
        );
        return localDate >= from && localDate <= to;
      });
      return {
        workspaceId: settings.workspaceId,
        from,
        to,
        generatedAt: new Date().toISOString(),
        settings,
        lessons: inRange.map((item) => ({ ...item })),
        today: inRange.filter((item) => item.startsAt.slice(0, 10) === today),
        reminders: [...followups.filter((item) => !hidden.has(item.lessonId!)), ...otherReminders],
        latestHiddenReminder,
        creditAlerts: [],
        recentPayments: [
          {
            studentId: 'student-alex',
            studentName: 'Alex',
            studentScheduleBillingPath: '/students/student-alex/schedule-billing',
            amountMinor: 16000,
            currency: 'USD',
            receivedAt: today,
            method: null,
          },
        ],
      } satisfies BusinessScheduleSurfaceResponse;
    }
    if (method === 'get' && path === '/business/stats') {
      return {
        workspaceId: settings.workspaceId,
        month: query.get('month') || today.slice(0, 7),
        generatedAt: new Date().toISOString(),
        settings,
        currency: settings.defaultCurrency,
        collectedMinor: 48000,
        earnedMinor: 24000,
        scheduledGrossMinor: 14000,
        forecastMinor: 14000,
        riskAdjustmentMinor: 0,
        completedLessons: 12,
        taughtMinutes: 650,
        scheduledLessons: lessons.filter((item) => item.status === 'scheduled').length,
        scheduledMinutes: lessons
          .filter((item) => item.status === 'scheduled')
          .reduce((sum, item) => sum + item.durationMinutes, 0),
        noShowLessons: 0,
        canceledLessons: 1,
        forecastFrom: today,
        forecastTo: date(30).slice(0, 10),
        excludedCurrencies: [],
        pipeline: [
          {
            studentId: 'student-cora',
            studentName: 'Cora Preview',
            studentScheduleBillingPath: '/students/student-cora/schedule-billing',
            remainingCredits: 1,
            upcomingChargeableLessons: 3,
            severity: 'urgent',
          },
        ],
        risks: [],
      } satisfies BusinessStatsSurfaceResponse;
    }
    const lessonMatch = /^\/students\/([^/]+)\/lessons\/(business-lesson-\d+)$/.exec(path);
    if (method === 'patch' && lessonMatch) {
      const item = lessons.find((entry) => entry.id === lessonMatch[2]);
      if (item) Object.assign(item, body);
      return {};
    }
    const hideMatch =
      /^\/students\/([^/]+)\/operations\/reminders\/lesson-followup\/(business-lesson-\d+)\/hide$/.exec(
        path,
      );
    if (method === 'put' && hideMatch) {
      const item = followups.find((entry) => entry.lessonId === hideMatch[2]);
      if (item) {
        hidden.add(item.lessonId!);
        latestHiddenReminder = {
          studentId: item.studentId,
          studentName: item.studentName,
          studentScheduleBillingPath: item.studentScheduleBillingPath,
          type: 'lesson_followup',
          lessonId: item.lessonId!,
          lessonSummary: item.lessonSummary ?? null,
          hiddenAt: new Date().toISOString(),
        };
      }
      return {};
    }
    if (
      method === 'put' &&
      path.endsWith('/operations/reminders/latest-hidden/undo') &&
      latestHiddenReminder
    ) {
      hidden.delete(latestHiddenReminder.lessonId);
      latestHiddenReminder = null;
      return {};
    }
    return undefined;
  };
}
