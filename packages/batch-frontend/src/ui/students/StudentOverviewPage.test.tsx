import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StudentOverviewPage } from './StudentOverviewPage';

const apiMocks = vi.hoisted(() => ({
  getStudentOverviewSurface: vi.fn(),
}));

const useStudentAreaContextMock = vi.hoisted(() => vi.fn());

vi.mock('../../utils/api', () => apiMocks);

vi.mock('./StudentAreaContext', () => ({
  useStudentAreaContext: useStudentAreaContextMock,
}));

const NOW = '2026-04-23T10:30:00.000Z';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function seedOverviewMocks() {
  useStudentAreaContextMock.mockReturnValue({
    student: {
      id: 'student-alex',
      student: 'Alex Rivera',
      profileId: 'profiles/students/alex.md',
    },
    studentId: 'student-alex',
    studentLoading: false,
    studentError: null,
    refreshStudent: vi.fn(),
  });

  apiMocks.getStudentOverviewSurface.mockResolvedValue(makeOverviewSurface());
}

function makeOverviewSurface(overrides: Record<string, unknown> = {}) {
  return {
    profile: {
      id: 'profiles/students/alex.md',
      label: 'Alex',
      content: '# Profile',
      structuredContent: {
        schemaVersion: 'foundational_profile_v1',
        overallLevel: 'B1',
        primaryGoals: ['Speak confidently in workplace meetings.'],
        communicationContexts: ['Product team updates'],
        interestsAndUsefulThemes: ['Design critique'],
        stableStrengths: ['Clear ideas', 'High curiosity'],
        persistentChallenges: ['Pronunciation', 'Phrasal verbs'],
        studyPreferences: ['Short practical speaking loops'],
        durableConstraints: ['Limited evening energy'],
        teacherNotes: 'Works best with precise, confidence-building speaking tasks.',
      },
      currentRevisionId: 'revision-active-1',
      updatedAt: NOW,
    },
    revisions: {
      items: [
        {
          id: 'revision-active-1',
          profileId: 'profiles/students/alex.md',
          contentHash: 'hash-1',
          source: 'update',
          status: 'active',
          versionNumber: 1,
          versionLabel: 'v1',
          activatedAt: NOW,
          deprecatedAt: null,
          createdAt: NOW,
          createdBy: 'teacher-1',
          restoredFromRevisionId: null,
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
      order: 'desc',
    },
    memory: {
      studentId: 'student-alex',
      latestReadyStudentMemorySnapshot: {
        id: 'snapshot-1',
        studentId: 'student-alex',
        schemaVersion: 'student_memory_snapshot_v1',
        generatedAt: NOW,
        provider: 'openai',
        model: 'gpt-test',
        status: 'ready',
        sourceKind: 'student_memory_rollup',
        lessonMemoryEntryIds: ['lesson-1'],
        homeworkMemoryEntryIds: ['homework-1'],
        stableStrengths: [],
        recurringIssues: [],
        activeReviewBacklog: [],
        recentProgress: [],
        personalFacts: [],
        recommendedAssignmentDirections: [
          {
            direction: 'Fluency with natural expression',
            rationale: 'Expand vocabulary while keeping speech precise and flowing.',
          },
        ],
        unresolvedIssues: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
      recentReadyLessonMemory: [],
      recentReadyHomeworkMemory: [],
      unresolvedIssues: [],
    },
    pendingCandidates: {
      studentId: 'student-alex',
      items: [],
      total: 0,
      limit: 10,
      offset: 0,
      order: 'desc',
    },
    recentTimeline: {
      items: [
        {
          type: 'profile_revision_activated',
          studentId: 'student-alex',
          status: 'active',
          createdAt: NOW,
          displayName: 'Profile revision activated',
        },
      ],
      total: 1,
      limit: 8,
      offset: 0,
      order: 'desc',
    },
    scheduleBilling: {
      studentId: 'student-alex',
      workspaceId: 'workspace-1',
      lessonPlan: {
        studentId: 'student-alex',
        workspaceId: 'workspace-1',
        timezone: 'Asia/Bangkok',
        defaultDurationMinutes: 60,
        cadence: 'Weekly',
        preferredTimes: null,
        schedulingNotes: null,
        updatedAt: NOW,
      },
      nextLesson: {
        id: 'lesson-1',
        studentId: 'student-alex',
        workspaceId: 'workspace-1',
        startsAt: '2026-05-07T10:00:00.000Z',
        timezone: 'Asia/Bangkok',
        durationMinutes: 60,
        status: 'scheduled',
        consumesCredit: false,
        title: null,
        notes: null,
        creditEventId: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
      lessons: [],
      creditSummary: {
        purchased: 8,
        consumed: 3,
        adjustments: 0,
        remaining: 5,
        lowBalanceThreshold: 2,
        isLow: false,
        isNegative: false,
      },
      creditEvents: [],
      payments: [
        {
          id: 'payment-1',
          studentId: 'student-alex',
          workspaceId: 'workspace-1',
          amountMinor: 12000,
          currency: 'USD',
          method: 'Bank transfer',
          receivedAt: '2026-05-06',
          externalUrl: null,
          note: null,
          voidedAt: null,
          createdAt: NOW,
        },
      ],
      reminders: [],
    },
    ...overrides,
  };
}

function renderOverview() {
  return render(
    <MemoryRouter initialEntries={['/students/student-alex/overview']}>
      <StudentOverviewPage />
    </MemoryRouter>,
  );
}

describe('StudentOverviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedOverviewMocks();
  });

  it('renders a calm overview from structured learner profile and memory data', async () => {
    renderOverview();

    expect(await screen.findByText('On track')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Alex Rivera' })).toBeNull();
    expect(screen.queryByText('Support ID: alex')).toBeNull();
    expect(screen.getByText('B1')).toBeTruthy();
    expect(screen.getAllByText('Speak confidently in workplace meetings.')).toHaveLength(2);
    expect(screen.getByText('Clear ideas')).toBeTruthy();
    expect(screen.getByText('Phrasal verbs')).toBeTruthy();
    expect(screen.getByText('Fluency with natural expression')).toBeTruthy();
    expect(screen.getByText('5 lesson credits')).toBeTruthy();
    expect(screen.getByText('No reminders ready')).toBeTruthy();
    expect(screen.getByText(/USD 120.00/)).toBeTruthy();
    expect(screen.getByText('Profile revision activated')).toBeTruthy();
    expect(
      screen
        .getAllByRole('link', { name: /Open Learning/i })
        .map((link) => link.getAttribute('href')),
    ).toEqual(['/students/student-alex/learning', '/students/student-alex/learning']);
    expect(screen.getByRole('link', { name: /View history/i }).getAttribute('href')).toBe(
      '/students/student-alex/history',
    );

    expect(apiMocks.getStudentOverviewSurface).toHaveBeenCalledWith('student-alex');
  });

  it('exposes the overview as named control-tower regions with stable operations links', async () => {
    renderOverview();

    expect(await screen.findByRole('region', { name: /Learning State/i })).toBeTruthy();
    expect(screen.getByRole('region', { name: /Operations/i })).toBeTruthy();
    expect(screen.getByRole('region', { name: /Learner Snapshot/i })).toBeTruthy();
    expect(screen.getByRole('region', { name: /Current Focus/i })).toBeTruthy();
    expect(screen.getByRole('region', { name: /Recent Activity/i })).toBeTruthy();

    const operations = screen.getByRole('region', { name: /Operations/i });
    const operationLinks = Array.from(operations.querySelectorAll('a'));
    expect(operationLinks).toHaveLength(4);
    expect(operationLinks.map((link) => link.getAttribute('href'))).toEqual([
      '/students/student-alex/schedule-billing',
      '/students/student-alex/schedule-billing',
      '/students/student-alex/schedule-billing',
      '/students/student-alex/schedule-billing',
    ]);
  });

  it('keeps the teacher scan path in the locked overview layout order', async () => {
    renderOverview();

    await screen.findByRole('region', { name: /Learning State/i });

    const layout = screen.getByTestId('student-overview-layout');
    expect(
      Array.from(layout.querySelectorAll('[data-overview-section]')).map((element) =>
        element.getAttribute('data-overview-section'),
      ),
    ).toEqual([
      'learning-state',
      'operations',
      'learner-snapshot',
      'current-focus',
      'attention',
      'recent-activity',
    ]);

    expect(
      screen.getByTestId('student-overview-primary-story').contains(screen.getByText('On track')),
    ).toBe(true);
    expect(
      screen
        .getByTestId('student-overview-secondary-operations')
        .getAttribute('data-overview-emphasis'),
    ).toBe('secondary');
  });

  it('renders the learning status as a text callout without a standalone icon mark', async () => {
    renderOverview();

    await screen.findByText('On track');

    const status = screen.getByTestId('student-overview-status-callout');
    expect(status.querySelector('.student-overview-status-mark')).toBeNull();
    expect(status.textContent).toContain('On track');
    expect(status.textContent).toContain('Keep building fluency and precision.');
  });

  it('shows a non-readable pending canvas while overview data resolves', async () => {
    const overviewDeferred =
      createDeferred<Awaited<ReturnType<typeof apiMocks.getStudentOverviewSurface>>>();
    apiMocks.getStudentOverviewSurface.mockReturnValue(overviewDeferred.promise);

    renderOverview();

    expect(screen.getByTestId('student-overview-pending-canvas')).toBeTruthy();
    expect(document.querySelector('.student-overview-pending-hero')).toBeNull();
    expect(document.querySelector('.student-overview-pending-portrait')).toBeNull();
    expect(screen.queryByRole('link', { name: /Back to all students/i })).toBeNull();
    expect(screen.queryByText('Loading overview')).toBeNull();
    expect(
      screen.queryByText('Gathering learner profile, memory, and recent activity.'),
    ).toBeNull();
    expect(screen.queryByText('Loading strengths')).toBeNull();
    expect(screen.queryByText('Needs first profile')).toBeNull();
    expect(screen.queryByText('Profile needed')).toBeNull();
    expect(screen.queryByText('Not set')).toBeNull();

    overviewDeferred.resolve(makeOverviewSurface());

    expect(await screen.findByText('On track')).toBeTruthy();
  });

  it('surfaces pending profile suggestions as the one attention cue', async () => {
    apiMocks.getStudentOverviewSurface.mockResolvedValue(
      makeOverviewSurface({
        pendingCandidates: {
          studentId: 'student-alex',
          items: [
            {
              id: 'candidate-1',
              studentId: 'student-alex',
              proposedFact: 'Needs more pronunciation work.',
              category: 'learning',
              targetSection: 'persistentChallenges',
              evidence: [],
              sourceLessonMemoryIds: [],
              status: 'pending_review',
              reviewState: 'unreviewed',
              createdAt: NOW,
              updatedAt: NOW,
            },
          ],
          total: 1,
          limit: 10,
          offset: 0,
          order: 'desc',
        },
      }),
    );

    renderOverview();

    expect(await screen.findByText('Profile has suggestions')).toBeTruthy();
    expect(screen.getByText('Learning facts need review')).toBeTruthy();
    expect(screen.getByText('1 candidate profile update waiting.')).toBeTruthy();
  });

  it('handles students without an active learner profile', async () => {
    apiMocks.getStudentOverviewSurface.mockResolvedValue(
      makeOverviewSurface({
        profile: null,
        revisions: {
          items: [],
          total: 0,
          limit: 0,
          offset: 0,
          order: 'desc',
        },
        pendingCandidates: {
          studentId: 'student-no-profile',
          items: [],
          total: 0,
          limit: 10,
          offset: 0,
          order: 'desc',
        },
      }),
    );
    useStudentAreaContextMock.mockReturnValue({
      student: {
        id: 'student-no-profile',
        student: 'No Profile Student',
        profileId: null,
      },
      studentId: 'student-no-profile',
      studentLoading: false,
      studentError: null,
      refreshStudent: vi.fn(),
    });

    renderOverview();

    expect(await screen.findByText('Needs first profile')).toBeTruthy();
    expect(screen.getByText('Profile needed')).toBeTruthy();
    expect(screen.getByText('Not set')).toBeTruthy();
    await waitFor(() => {
      expect(apiMocks.getStudentOverviewSurface).toHaveBeenCalledWith('student-no-profile');
    });
  });
});
