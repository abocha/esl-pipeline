import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StudentOverviewPage } from './StudentOverviewPage';

const apiMocks = vi.hoisted(() => ({
  getProfileContent: vi.fn(),
  getStudentMemoryOverview: vi.fn(),
  getStudentTimeline: vi.fn(),
  listProfileRevisions: vi.fn(),
  listStudentProfileCandidates: vi.fn(),
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

  apiMocks.getProfileContent.mockResolvedValue({
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
  });

  apiMocks.listProfileRevisions.mockResolvedValue({
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
    limit: 8,
    offset: 0,
    order: 'desc',
  });

  apiMocks.getStudentMemoryOverview.mockResolvedValue({
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
  });

  apiMocks.listStudentProfileCandidates.mockResolvedValue({
    studentId: 'student-alex',
    items: [],
    total: 0,
    limit: 12,
    offset: 0,
    order: 'desc',
  });

  apiMocks.getStudentTimeline.mockResolvedValue({
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
    limit: 4,
    offset: 0,
    order: 'desc',
  });
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

    expect(await screen.findByRole('heading', { name: 'Alex Rivera' })).toBeTruthy();
    expect(screen.getByText('Student ID: alex')).toBeTruthy();
    expect(screen.getByText('B1')).toBeTruthy();
    expect(screen.getAllByText('Speak confidently in workplace meetings.')).toHaveLength(2);
    expect(screen.getByText('Clear ideas')).toBeTruthy();
    expect(screen.getByText('Phrasal verbs')).toBeTruthy();
    expect(screen.getByText('Fluency with natural expression')).toBeTruthy();
    expect(screen.queryByText('5 lessons remaining')).toBeNull();
    expect(screen.getAllByText('Not configured yet')).toHaveLength(1);
    expect(screen.getByText('Telegram and email pending')).toBeTruthy();
    expect(screen.getByText('Profile revision activated')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Open Learning/i }).getAttribute('href')).toBe(
      '/students/student-alex/learning',
    );
    expect(screen.getByRole('link', { name: /View history/i }).getAttribute('href')).toBe(
      '/students/student-alex/history',
    );

    expect(apiMocks.getProfileContent).toHaveBeenCalledWith('profiles/students/alex.md');
    expect(apiMocks.getStudentMemoryOverview).toHaveBeenCalledWith('student-alex', {
      lessonLimit: 1,
      homeworkLimit: 1,
    });
  });

  it('shows a non-readable pending canvas while overview data resolves', async () => {
    const profileDeferred = createDeferred<Awaited<ReturnType<typeof apiMocks.getProfileContent>>>();
    apiMocks.getProfileContent.mockReturnValue(profileDeferred.promise);

    renderOverview();

    expect(screen.getByTestId('student-overview-pending-canvas')).toBeTruthy();
    expect(screen.queryByText('Loading overview')).toBeNull();
    expect(screen.queryByText('Gathering learner profile, memory, and recent activity.')).toBeNull();
    expect(screen.queryByText('Loading strengths')).toBeNull();
    expect(screen.queryByText('Needs first profile')).toBeNull();
    expect(screen.queryByText('Profile needed')).toBeNull();
    expect(screen.queryByText('Not set')).toBeNull();

    profileDeferred.resolve({
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
    });

    expect(await screen.findByText('On track')).toBeTruthy();
  });

  it('surfaces pending profile suggestions as the one attention cue', async () => {
    apiMocks.listStudentProfileCandidates.mockResolvedValue({
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
      limit: 12,
      offset: 0,
      order: 'desc',
    });

    renderOverview();

    expect(await screen.findByText('Profile has suggestions')).toBeTruthy();
    expect(screen.getByText('Learning facts need review')).toBeTruthy();
    expect(screen.getByText('1 candidate profile update waiting.')).toBeTruthy();
  });

  it('handles students without a canonical learner profile', async () => {
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
    expect(apiMocks.getProfileContent).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(apiMocks.getStudentTimeline).toHaveBeenCalledWith('student-no-profile', {
        limit: 4,
        offset: 0,
        order: 'desc',
      });
    });
  });
});
