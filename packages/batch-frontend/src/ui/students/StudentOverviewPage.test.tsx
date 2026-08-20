import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
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

  it('renders a factual overview from structured learner profile and memory data', async () => {
    renderOverview();

    expect(await screen.findByText('Active profile')).toBeTruthy();
    expect(screen.queryByText('On track')).toBeNull();
    expect(screen.queryByText('Learning State')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Alex Rivera' })).toBeNull();
    expect(screen.queryByText('Support ID: alex')).toBeNull();
    expect(screen.getByText('B1')).toBeTruthy();
    expect(screen.getAllByText('Speak confidently in workplace meetings.')).toHaveLength(2);
    expect(screen.getByText('Clear ideas')).toBeTruthy();
    expect(screen.getByText('Phrasal verbs')).toBeTruthy();
    expect(screen.getByText('Fluency with natural expression')).toBeTruthy();
    expect(screen.getByText('Suggested focus')).toBeTruthy();
    expect(screen.getByText(/Memory-generated suggestion/)).toBeTruthy();
    expect(screen.getByText(/Snapshot generated/)).toBeTruthy();
    expect(screen.getByText('5 lesson credits')).toBeTruthy();
    expect(screen.getByText('No reminders ready')).toBeTruthy();
    expect(screen.getByText(/USD 120.00/)).toBeTruthy();
    expect(screen.getByText('Profile revision activated')).toBeTruthy();
    expect(screen.getByText('Profile record updated Apr 23')).toBeTruthy();
    expect(screen.getByText('No profile review items')).toBeTruthy();
    expect(
      screen.getByText('There are no profile drafts or candidate updates waiting.'),
    ).toBeTruthy();
    expect(screen.queryByText('No urgent review')).toBeNull();
    expect(screen.queryByText('Learning context is calm')).toBeNull();
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

    expect(await screen.findByRole('region', { name: /Learner profile/i })).toBeTruthy();
    expect(screen.getByRole('region', { name: /Operations/i })).toBeTruthy();
    expect(screen.getByRole('region', { name: /Learner Snapshot/i })).toBeTruthy();
    expect(screen.getByRole('region', { name: /Suggested focus/i })).toBeTruthy();
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

    await screen.findByRole('region', { name: /Learner profile/i });

    const layout = screen.getByTestId('student-overview-layout');
    expect(
      Array.from(layout.querySelectorAll('[data-overview-section]')).map((element) =>
        element.getAttribute('data-overview-section'),
      ),
    ).toEqual([
      'learner-profile',
      'operations',
      'learner-snapshot',
      'suggested-focus',
      'attention',
      'recent-activity',
    ]);

    expect(
      screen
        .getByTestId('student-overview-primary-story')
        .contains(screen.getByText('Active profile')),
    ).toBe(true);
    expect(
      screen
        .getByTestId('student-overview-secondary-operations')
        .getAttribute('data-overview-emphasis'),
    ).toBe('secondary');
  });

  it('renders the profile status as a factual text callout without a standalone icon mark', async () => {
    renderOverview();

    await screen.findByText('Active profile');

    const status = screen.getByTestId('student-overview-status-callout');
    expect(status.querySelector('.student-overview-status-mark')).toBeNull();
    expect(status.textContent).toContain('Active profile');
    expect(status.textContent).toContain(
      'Learner context is available. Review or update it in Learning.',
    );
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

    expect(await screen.findByText('Active profile')).toBeTruthy();
  });

  it('keeps the newer student overview after an older request rejects late', async () => {
    const alexOverview =
      createDeferred<Awaited<ReturnType<typeof apiMocks.getStudentOverviewSurface>>>();
    const boraOverview =
      createDeferred<Awaited<ReturnType<typeof apiMocks.getStudentOverviewSurface>>>();
    const alexSurface = makeOverviewSurface();
    const boraSurface = makeOverviewSurface({
      profile: {
        ...alexSurface.profile,
        id: 'profiles/students/bora.md',
        label: 'Bora',
        currentRevisionId: 'revision-bora',
        structuredContent: {
          ...alexSurface.profile.structuredContent,
          primaryGoals: ['Bora-only learner goal'],
        },
      },
      memory: {
        ...alexSurface.memory,
        studentId: 'student-bora',
        latestReadyStudentMemorySnapshot: {
          ...alexSurface.memory.latestReadyStudentMemorySnapshot,
          id: 'snapshot-bora',
          studentId: 'student-bora',
          recommendedAssignmentDirections: [
            {
              direction: 'Bora-only suggested focus',
              rationale: 'Bora-only rationale',
            },
          ],
        },
      },
      recentTimeline: {
        ...alexSurface.recentTimeline,
        items: [
          {
            ...alexSurface.recentTimeline.items[0],
            studentId: 'student-bora',
            displayName: 'Bora-only authoritative event',
          },
        ],
      },
      scheduleBilling: {
        ...alexSurface.scheduleBilling,
        studentId: 'student-bora',
        reminders: [{ id: 'bora-reminder', kind: 'lesson_followup' }],
      },
    });
    let contextValue = {
      student: {
        id: 'student-alex',
        student: 'Alex Rivera',
        profileId: 'profiles/students/alex.md',
      },
      studentId: 'student-alex',
      studentLoading: false,
      studentError: null,
      refreshStudent: vi.fn(),
    };
    useStudentAreaContextMock.mockImplementation(() => contextValue);
    apiMocks.getStudentOverviewSurface.mockImplementation((studentId: string) => {
      if (studentId === 'student-alex') {
        return alexOverview.promise;
      }
      if (studentId === 'student-bora') {
        return boraOverview.promise;
      }
      return Promise.reject(new Error(`Unexpected student: ${studentId}`));
    });

    const view = render(
      <MemoryRouter initialEntries={['/students/student-alex/overview']}>
        <StudentOverviewPage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('student-overview-pending-canvas')).toBeTruthy();
    await waitFor(() => {
      expect(apiMocks.getStudentOverviewSurface).toHaveBeenNthCalledWith(1, 'student-alex');
    });

    contextValue = {
      ...contextValue,
      student: {
        id: 'student-bora',
        student: 'Bora Nguyen',
        profileId: 'profiles/students/bora.md',
      },
      studentId: 'student-bora',
    };
    view.rerender(
      <MemoryRouter initialEntries={['/students/student-bora/overview']}>
        <StudentOverviewPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(apiMocks.getStudentOverviewSurface).toHaveBeenNthCalledWith(2, 'student-bora');
    });

    boraOverview.resolve(boraSurface);
    expect(await screen.findByText('Bora-only suggested focus')).toBeTruthy();
    expect(screen.getByText('Bora-only authoritative event')).toBeTruthy();

    alexOverview.reject(new Error('Late Student A load failure'));
    await alexOverview.promise.catch(() => undefined);

    await waitFor(() => {
      expect(screen.getByText('Bora-only suggested focus')).toBeTruthy();
      expect(screen.getByText('Bora-only authoritative event')).toBeTruthy();
      expect(screen.queryByText('Late Student A load failure')).toBeNull();
      expect(screen.queryByRole('heading', { name: 'Overview unavailable' })).toBeNull();
      expect(screen.queryByText('Not scheduled yet')).toBeNull();
      expect(screen.queryByText('Not configured yet')).toBeNull();
      expect(screen.queryByText('No reminders ready')).toBeNull();
      expect(screen.queryAllByText('Bora-only learner goal').length).toBeGreaterThan(0);
      expect(screen.queryByText('Alex Rivera')).toBeNull();
    });
  });

  it('does not use an unsourced overview memory issue when no ready snapshot exists', async () => {
    apiMocks.getStudentOverviewSurface.mockResolvedValue(
      makeOverviewSurface({
        memory: {
          ...makeOverviewSurface().memory,
          latestReadyStudentMemorySnapshot: null,
          unresolvedIssues: [
            {
              label: 'Unbounded issue',
              note: 'This issue is not tied to a ready snapshot.',
              priority: 'high',
            },
          ],
        },
      }),
    );

    renderOverview();

    expect(await screen.findByText('No suggested focus yet')).toBeTruthy();
    expect(screen.getByText('Waiting for memory')).toBeTruthy();
    expect(screen.queryByText('Unbounded issue')).toBeNull();
    expect(screen.queryByText('This issue is not tied to a ready snapshot.')).toBeNull();
  });

  it('shows factual memory-pending attention routing to Learning', async () => {
    apiMocks.getStudentOverviewSurface.mockResolvedValue(
      makeOverviewSurface({
        memory: {
          ...makeOverviewSurface().memory,
          latestReadyStudentMemorySnapshot: null,
        },
      }),
    );

    renderOverview();

    const attention = await screen.findByRole('link', { name: /Memory snapshot pending/i });
    expect(attention.getAttribute('href')).toBe('/students/student-alex/learning');
  });

  it('keeps the overview unavailable after a failed load until Retry succeeds', async () => {
    const user = userEvent.setup();
    apiMocks.getStudentOverviewSurface
      .mockRejectedValueOnce(new Error('Overview unavailable'))
      .mockResolvedValueOnce(makeOverviewSurface());

    renderOverview();

    expect(await screen.findByRole('heading', { name: 'Overview unavailable' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Overview unavailable');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByText('Not scheduled yet')).toBeNull();
    expect(screen.queryByText('Not configured yet')).toBeNull();
    expect(screen.queryByText('No reminders ready')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Active profile')).toBeTruthy();
    expect(apiMocks.getStudentOverviewSurface).toHaveBeenCalledTimes(2);
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

  it('does not surface older profile drafts when an active revision is current', async () => {
    apiMocks.getStudentOverviewSurface.mockResolvedValue(
      makeOverviewSurface({
        revisions: {
          items: [
            {
              id: 'revision-active-5',
              profileId: 'profiles/students/alex.md',
              contentHash: 'hash-active-5',
              source: 'update',
              status: 'active',
              versionNumber: 5,
              versionLabel: 'v5',
              activatedAt: NOW,
              deprecatedAt: null,
              createdAt: NOW,
              createdBy: 'teacher-1',
              restoredFromRevisionId: null,
            },
            {
              id: 'revision-draft-old',
              profileId: 'profiles/students/alex.md',
              contentHash: 'hash-draft-old',
              source: 'update',
              status: 'draft',
              versionNumber: 2,
              versionLabel: 'v2',
              activatedAt: null,
              deprecatedAt: null,
              createdAt: '2026-04-20T10:30:00.000Z',
              createdBy: 'teacher-1',
              restoredFromRevisionId: null,
            },
          ],
          total: 2,
          limit: 20,
          offset: 0,
          order: 'desc',
        },
      }),
    );

    renderOverview();

    expect(await screen.findByText('Active profile')).toBeTruthy();
    expect(screen.queryByText('Draft waiting')).toBeNull();
    expect(screen.queryByText('Profile draft waiting')).toBeNull();
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
