import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StudentLearningPage } from './StudentLearningPage';

const apiMocks = vi.hoisted(() => ({
  activateProfileRevision: vi.fn(),
  approveStudentProfileCandidate: vi.fn(),
  deferStudentProfileCandidate: vi.fn(),
  getProfileContent: vi.fn(),
  getProfileRevision: vi.fn(),
  getStudentLearningSurface: vi.fn(),
  getStudentMemoryHealth: vi.fn(),
  getStudentMemoryOverview: vi.fn(),
  initializeStudentProfileDraft: vi.fn(),
  listProfileRevisions: vi.fn(),
  listStudentProfileBindings: vi.fn(),
  listStudentProfileCandidates: vi.fn(),
  populateFirstProfileFromLesson: vi.fn(),
  promoteStudentProfileCandidates: vi.fn(),
  refreshProfileDraftFromApprovedCandidates: vi.fn(),
  rejectStudentProfileCandidate: vi.fn(),
  restoreProfileRevision: vi.fn(),
  saveProfileDraftRevision: vi.fn(),
}));

const useStudentAreaContextMock = vi.hoisted(() => vi.fn());

vi.mock('../../utils/api', () => apiMocks);

vi.mock('./StudentAreaContext', () => ({
  useStudentAreaContext: useStudentAreaContextMock,
}));

vi.mock('./ProfileCandidatesPanel', () => ({
  ProfileCandidatesPanel: (props: {
    profileCandidates: { id: string; status?: string }[];
    selectedCandidateIds: string[];
    setSelectedCandidateIds: (next: string[] | ((current: string[]) => string[])) => void;
    onPromoteProfileCandidates: () => void | Promise<void>;
    onReviewProfileCandidate: (
      candidate: { id: string; status?: string },
      action: 'approve' | 'reject' | 'defer',
    ) => void | Promise<void>;
  }) => (
    <div>
      Profile candidates panel:{' '}
      {props.profileCandidates.map((candidate) => candidate.id).join(', ')}
      <div>{props.selectedCandidateIds.length} selected for draft revision generation</div>
      {props.profileCandidates.map((candidate) => (
        <div key={candidate.id}>
          {candidate.status === 'approved' ? (
            <button
              type="button"
              onClick={() =>
                props.setSelectedCandidateIds((current) =>
                  current.includes(candidate.id) ? current : [...current, candidate.id],
                )
              }
            >
              Select {candidate.id}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void props.onReviewProfileCandidate(candidate, 'reject')}
          >
            Reject {candidate.id}
          </button>
        </div>
      ))}
      <button type="button" onClick={() => void props.onPromoteProfileCandidates()}>
        Generate Draft Revision
      </button>
    </div>
  ),
}));

const NOW = '2026-04-22T10:00:00.000Z';

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

function seedLearningPageMocks() {
  apiMocks.getProfileContent.mockResolvedValue({
    id: 'profiles/students/alex.md',
    label: 'Alex',
    content: '# Foundational Profile',
    structuredContent: {
      schemaVersion: 'foundational_profile_v1',
      overallLevel: 'B1',
      primaryGoals: ['Lead standups clearly.'],
      communicationContexts: ['Team updates'],
      interestsAndUsefulThemes: ['Product work'],
      stableStrengths: ['High motivation'],
      persistentChallenges: ['Article usage'],
      studyPreferences: ['Short practical review loops'],
      durableConstraints: ['Limited evening time'],
      teacherNotes: 'Responds well to practical speaking tasks.',
    },
    currentRevisionId: 'revision-active-1',
    updatedAt: NOW,
  });

  apiMocks.getProfileRevision.mockResolvedValue({
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
    content: '# Foundational Profile',
    structuredContent: {
      schemaVersion: 'foundational_profile_v1',
      overallLevel: 'B1',
      primaryGoals: ['Lead standups clearly.'],
      communicationContexts: ['Team updates'],
      interestsAndUsefulThemes: ['Product work'],
      stableStrengths: ['High motivation'],
      persistentChallenges: ['Article usage'],
      studyPreferences: ['Short practical review loops'],
      durableConstraints: ['Limited evening time'],
      teacherNotes: 'Responds well to practical speaking tasks.',
    },
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
    limit: 25,
    offset: 0,
    order: 'desc',
  });

  apiMocks.listStudentProfileBindings.mockResolvedValue({
    items: [
      {
        id: 'binding-1',
        studentId: 'student-alex',
        profileId: 'profiles/students/alex.md',
        effectiveFrom: NOW,
        effectiveTo: null,
        reason: null,
        changedBy: 'teacher-1',
        createdAt: NOW,
      },
    ],
    total: 1,
    limit: 5,
    offset: 0,
    order: 'desc',
  });

  apiMocks.getStudentMemoryOverview.mockResolvedValue({
    studentId: 'student-alex',
    latestReadyStudentMemorySnapshot: {
      id: 'snapshot-1',
      studentId: 'student-alex',
      schemaVersion: 'student-memory-snapshot.v1',
      generatedAt: NOW,
      provider: 'openai',
      model: 'gpt-5.4',
      status: 'ready',
      sourceKind: 'student_memory_rollup',
      lessonMemoryEntryIds: ['lesson-1'],
      homeworkMemoryEntryIds: ['homework-1'],
      contentHash: 'snapshot-hash',
      generationNotes: null,
      stableStrengths: [],
      recurringIssues: [],
      activeReviewBacklog: [],
      recentProgress: [],
      personalFacts: [],
      recommendedAssignmentDirections: [],
      unresolvedIssues: [],
      snapshotSummary: 'Recent learner memory summary.',
      supersededById: null,
      supersededAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
    recentReadyLessonMemory: [],
    recentReadyHomeworkMemory: [],
    unresolvedIssues: [],
  });

  apiMocks.getStudentMemoryHealth.mockResolvedValue(makeMemoryHealth());

  apiMocks.listStudentProfileCandidates.mockResolvedValue({
    items: [],
    total: 0,
    limit: 200,
    offset: 0,
    order: 'desc',
  });

  apiMocks.getStudentLearningSurface.mockImplementation(async (studentId: string) => {
    const context = useStudentAreaContextMock();
    const profileId = context.student?.profileId ?? null;
    const [profile, revisions, memory, memoryHealth, bindings, candidates] = await Promise.all([
      profileId ? apiMocks.getProfileContent(profileId) : Promise.resolve(null),
      profileId
        ? apiMocks.listProfileRevisions(profileId, {
            limit: 25,
            offset: 0,
            order: 'desc',
          })
        : Promise.resolve({ items: [], total: 0, limit: 0, offset: 0, order: 'desc' }),
      apiMocks.getStudentMemoryOverview(studentId, { lessonLimit: 3, homeworkLimit: 2 }),
      apiMocks.getStudentMemoryHealth(studentId),
      apiMocks.listStudentProfileBindings(studentId, { limit: 5, offset: 0, order: 'desc' }),
      apiMocks.listStudentProfileCandidates(studentId, { limit: 200, offset: 0, order: 'desc' }),
    ]);
    return {
      profile,
      revisions,
      memory,
      memoryHealth,
      bindings,
      candidates,
    };
  });

  apiMocks.populateFirstProfileFromLesson.mockResolvedValue({
    draftRevisionId: 'revision-draft-2',
    profileId: 'profiles/students/alex.md',
    snapshotId: 'snapshot-1',
    lessonMemoryIds: ['lesson-1'],
    homeworkMemoryIds: [],
    draftRevision: {
      id: 'revision-draft-2',
      profileId: 'profiles/students/alex.md',
      contentHash: 'hash-2',
      source: 'lesson_population',
      status: 'draft',
      versionNumber: 2,
      versionLabel: 'v2',
      activatedAt: null,
      deprecatedAt: null,
      createdAt: NOW,
      createdBy: 'teacher-1',
      restoredFromRevisionId: null,
      content: '# Foundational Profile',
      structuredContent: {
        schemaVersion: 'foundational_profile_v1',
        overallLevel: 'B2',
        primaryGoals: ['Present roadmap updates with confidence.'],
        communicationContexts: ['Stakeholder meetings'],
        interestsAndUsefulThemes: ['Product strategy'],
        stableStrengths: ['Fast comprehension'],
        persistentChallenges: ['Spoken transitions'],
        studyPreferences: ['Short repeatable homework'],
        durableConstraints: ['Busy release weeks'],
        teacherNotes: 'Derived from latest lesson memory.',
      },
    },
  });

  apiMocks.initializeStudentProfileDraft.mockResolvedValue({
    draftRevisionId: 'revision-draft-empty-1',
    profileId: 'profiles/students/alex.md',
    draftRevision: {
      id: 'revision-draft-empty-1',
      profileId: 'profiles/students/alex.md',
      contentHash: 'hash-empty-1',
      source: 'create',
      status: 'draft',
      versionNumber: 1,
      versionLabel: 'v1',
      activatedAt: null,
      deprecatedAt: null,
      createdAt: NOW,
      createdBy: 'teacher-1',
      restoredFromRevisionId: null,
      content: '# Foundational Profile',
      structuredContent: {
        schemaVersion: 'foundational_profile_v1',
        overallLevel: null,
        primaryGoals: [],
        communicationContexts: [],
        interestsAndUsefulThemes: [],
        stableStrengths: [],
        persistentChallenges: [],
        studyPreferences: [],
        durableConstraints: [],
        teacherNotes: null,
      },
    },
  });
}

function renderLearningPage() {
  return render(
    <MemoryRouter>
      <StudentLearningPage />
    </MemoryRouter>,
  );
}

function makeMemoryHealth(overrides: Record<string, unknown> = {}) {
  return {
    studentId: 'student-alex',
    latestSnapshot: {
      id: 'snapshot-1',
      status: 'ready',
      generatedAt: NOW,
      strategy: 'incremental_v1_1',
      trigger: 'lesson-memory-ready',
      triggerSourceKind: 'lesson_memory',
      triggerSourceEntryId: 'lesson-1',
      parentSnapshotId: 'snapshot-parent',
      inputTokenEstimate: 18_500,
      outputTokenEstimate: null,
      promptByteLength: 74_000,
      includedLessonMemoryCount: 2,
      includedHomeworkMemoryCount: 1,
      coveredLessonMemoryCount: 9,
      coveredHomeworkMemoryCount: 4,
      contentHash: 'snapshot-hash',
      materialChange: true,
      budgetDecision: { action: 'allow' },
      candidateRefresh: {
        requested: true,
        triggerProfileWorthyStudentFactCount: 2,
        skippedNoProfileWorthyDeltaCount: 0,
      },
    },
    memoryCounts: {
      lesson: {
        ready: { count: 9, capped: false, limit: 500 },
        pending: { count: 1, capped: false, limit: 500 },
        failed: { count: 0, capped: false, limit: 500 },
      },
      homework: {
        ready: { count: 4, capped: false, limit: 500 },
        pending: { count: 0, capped: false, limit: 500 },
        failed: { count: 1, capped: false, limit: 500 },
      },
    },
    latestFailedReason: {
      source: 'homework',
      artifactId: 'homework-failed',
      message: 'Homework memory extraction failed.',
    },
    profileCandidateCounts: {
      pending: 3,
      approved: 2,
      rejected: 1,
      deferred: 4,
    },
    ...overrides,
  };
}

function makeLearningSurface(overrides: Record<string, unknown> = {}) {
  return {
    profile: {
      id: 'profiles/students/alex.md',
      label: 'Alex',
      content: '# Foundational Profile',
      structuredContent: {
        schemaVersion: 'foundational_profile_v1',
        overallLevel: 'B1',
        primaryGoals: ['Lead standups clearly.'],
        communicationContexts: ['Team updates'],
        interestsAndUsefulThemes: ['Product work'],
        stableStrengths: ['High motivation'],
        persistentChallenges: ['Article usage'],
        studyPreferences: ['Short practical review loops'],
        durableConstraints: ['Limited evening time'],
        teacherNotes: 'Responds well to practical speaking tasks.',
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
      latestReadyStudentMemorySnapshot: null,
      recentReadyLessonMemory: [],
      recentReadyHomeworkMemory: [],
      unresolvedIssues: [],
    },
    memoryHealth: makeMemoryHealth(),
    bindings: {
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
      order: 'desc',
    },
    candidates: {
      items: [{ id: 'candidate-alex' }],
      total: 1,
      limit: 50,
      offset: 0,
      order: 'desc',
    },
    ...overrides,
  };
}

function makeProfileCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'candidate-alex',
    studentId: 'student-alex',
    proposedFact: 'Uses English for product planning.',
    approvedFactText: 'Uses English for product planning.',
    category: 'work context',
    targetSection: 'work_communication_context',
    sourceSummary: 'Latest student-memory snapshot',
    authority: 'teacher_confirmed',
    confidence: 'high',
    evidence: [],
    sourceSnapshotId: 'snapshot-1',
    sourceLessonMemoryIds: [],
    status: 'approved',
    reviewState: 'approved',
    reviewerId: 'teacher-1',
    reviewerNote: null,
    reviewedAt: NOW,
    promotedRevisionId: null,
    promotedAt: null,
    supersededById: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('StudentLearningPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedLearningPageMocks();
    useStudentAreaContextMock.mockReturnValue({
      student: {
        id: 'student-alex',
        student: 'Alex',
        profileId: 'profiles/students/alex.md',
      },
      studentId: 'student-alex',
      studentLoading: false,
      studentError: null,
      refreshStudent: vi.fn(async () => {}),
    });
  });

  it('lets an unbound student start an empty learner profile without falling back to legacy UI', async () => {
    const user = userEvent.setup();
    const refreshStudent = vi.fn(async () => {});

    useStudentAreaContextMock.mockReturnValue({
      student: {
        id: 'student-alex',
        student: 'Alex',
        profileId: null,
      },
      studentId: 'student-alex',
      studentLoading: false,
      studentError: null,
      refreshStudent,
    });

    renderLearningPage();

    expect(await screen.findByText(/does not have an active learner profile yet/i)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Open legacy workspace/i })).toBeNull();

    await user.click(screen.getByRole('button', { name: /Start Empty Profile/i }));

    await waitFor(() => {
      expect(apiMocks.initializeStudentProfileDraft).toHaveBeenCalledWith('student-alex');
    });
    await waitFor(() => {
      expect(refreshStudent).toHaveBeenCalled();
    });
    expect(screen.getByRole('heading', { name: /Foundational Profile/i })).toBeTruthy();
    expect(screen.getByText(/Empty draft created/i)).toBeTruthy();
  });

  it('opens the structured populate-from-lesson draft in the editor', async () => {
    const user = userEvent.setup();

    renderLearningPage();

    expect(await screen.findByDisplayValue('B1')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /Pedagogical Home/i })).toBeNull();
    expect(screen.queryByText('Revision State')).toBeNull();
    expect(screen.getByText('Profile Readiness')).toBeTruthy();
    expect(screen.getByText('Pending Candidates')).toBeTruthy();
    expect(screen.getByText('Promotion Queue')).toBeTruthy();
    expect(
      screen.queryByText(/Review the learner profile, student memory, and candidate facts/i),
    ).toBeNull();
    expect(screen.queryByText('Profile helpers')).toBeNull();
    expect(screen.queryByText('Profile actions')).toBeNull();
    expect(screen.queryByText(/Structured edits here shape future assignments/i)).toBeNull();
    expect(screen.queryByText(/Use automated memory evidence/i)).toBeNull();
    expect(screen.queryByText(/Open earlier versions when you need to compare/i)).toBeNull();
    expect(screen.queryByText(/Use the most useful working label/i)).toBeNull();
    expect(screen.queryAllByText('Support details')).toHaveLength(0);

    await user.click(
      await screen.findByRole('button', { name: /Populate First Profile From Lesson/i }),
    );

    await waitFor(() => {
      expect(apiMocks.populateFirstProfileFromLesson).toHaveBeenCalledWith('student-alex');
    });
    expect(await screen.findByDisplayValue('B2')).toBeTruthy();
    expect(screen.getByDisplayValue('Present roadmap updates with confidence.')).toBeTruthy();
    expect(screen.getByText(/Draft profile populated from the latest lesson memory/i)).toBeTruthy();
  });

  it('keeps operator memory health details collapsed until opened', async () => {
    const user = userEvent.setup();
    apiMocks.getStudentLearningSurface.mockResolvedValueOnce(
      makeLearningSurface({
        memory: {
          studentId: 'student-alex',
          latestReadyStudentMemorySnapshot: {
            id: 'snapshot-1',
            studentId: 'student-alex',
            schemaVersion: 'student-memory-snapshot.v1',
            generatedAt: NOW,
            provider: 'openai',
            model: 'gpt-5.4',
            status: 'ready',
            sourceKind: 'student_memory_rollup',
            lessonMemoryEntryIds: ['lesson-1'],
            homeworkMemoryEntryIds: ['homework-1'],
            contentHash: 'snapshot-hash',
            generationNotes: null,
            stableStrengths: [],
            recurringIssues: [],
            activeReviewBacklog: [],
            recentProgress: [],
            personalFacts: [],
            recommendedAssignmentDirections: [],
            unresolvedIssues: [],
            snapshotSummary: 'Recent learner memory summary.',
            supersededById: null,
            supersededAt: null,
            createdAt: NOW,
            updatedAt: NOW,
          },
          recentReadyLessonMemory: [],
          recentReadyHomeworkMemory: [],
          unresolvedIssues: [],
        },
      }),
    );

    renderLearningPage();

    expect(await screen.findByText('Recent learner memory summary.')).toBeTruthy();
    expect(screen.queryByText('incremental_v1_1')).toBeNull();
    expect(screen.queryByText('snapshot-hash')).toBeNull();

    await user.click(screen.getByRole('button', { name: /Memory support details/i }));

    expect(screen.getByText('incremental_v1_1')).toBeTruthy();
    expect(screen.getByText('snapshot-hash')).toBeTruthy();
    expect(screen.getByText(/Homework memory extraction failed/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /manual full rebuild/i })).toBeNull();
  });

  it('shows non-technical memory fallback states when health details are unavailable', async () => {
    apiMocks.getStudentLearningSurface.mockResolvedValueOnce(
      makeLearningSurface({
        memory: {
          studentId: 'student-alex',
          latestReadyStudentMemorySnapshot: null,
          recentReadyLessonMemory: [],
          recentReadyHomeworkMemory: [],
          unresolvedIssues: [],
        },
        memoryHealth: null,
      }),
    );

    renderLearningPage();

    expect(
      await screen.findByText(/No ready student-memory snapshot is available yet/i),
    ).toBeTruthy();
    expect(screen.queryByText('incremental_v1_1')).toBeNull();
    expect(screen.queryByText('Content hash')).toBeNull();
  });

  it('shows failed latest snapshot details even when no ready snapshot exists', async () => {
    const user = userEvent.setup();
    apiMocks.getStudentLearningSurface.mockResolvedValueOnce(
      makeLearningSurface({
        memory: {
          studentId: 'student-alex',
          latestReadyStudentMemorySnapshot: null,
          recentReadyLessonMemory: [],
          recentReadyHomeworkMemory: [],
          unresolvedIssues: [],
        },
        memoryHealth: makeMemoryHealth({
          latestSnapshot: {
            id: 'snapshot-failed',
            status: 'failed',
            generatedAt: NOW,
            strategy: 'incremental_v1_1',
            trigger: 'lesson-memory-ready',
            triggerSourceKind: 'lesson_memory',
            triggerSourceEntryId: 'lesson-1',
            parentSnapshotId: 'snapshot-parent',
            inputTokenEstimate: 36_200,
            outputTokenEstimate: null,
            promptByteLength: 144_800,
            includedLessonMemoryCount: 2,
            includedHomeworkMemoryCount: 1,
            coveredLessonMemoryCount: 9,
            coveredHomeworkMemoryCount: 4,
            contentHash: 'snapshot-failed-hash',
            materialChange: false,
            budgetDecision: { action: 'fail_before_provider' },
            candidateRefresh: null,
          },
          latestFailedReason: {
            source: 'snapshot',
            artifactId: 'snapshot-failed',
            message: 'Incremental snapshot prompt exceeded the hard budget.',
          },
        }),
      }),
    );

    renderLearningPage();

    expect(
      await screen.findByText(/No ready student-memory snapshot is available yet/i),
    ).toBeTruthy();
    expect(screen.queryByText('incremental_v1_1')).toBeNull();

    await user.click(screen.getByRole('button', { name: /Memory support details/i }));

    expect(screen.getByText('incremental_v1_1')).toBeTruthy();
    expect(screen.getByText('snapshot-failed-hash')).toBeTruthy();
    expect(screen.getByText(/Incremental snapshot prompt exceeded the hard budget/i)).toBeTruthy();
  });

  it('keeps a quiet support fallback when health diagnostics are unavailable', async () => {
    const user = userEvent.setup();
    apiMocks.getStudentLearningSurface.mockResolvedValueOnce(
      makeLearningSurface({
        memory: {
          studentId: 'student-alex',
          latestReadyStudentMemorySnapshot: {
            id: 'snapshot-1',
            studentId: 'student-alex',
            schemaVersion: 'student-memory-snapshot.v1',
            generatedAt: NOW,
            provider: 'openai',
            model: 'gpt-5.4',
            status: 'ready',
            sourceKind: 'student_memory_rollup',
            lessonMemoryEntryIds: ['lesson-1'],
            homeworkMemoryEntryIds: ['homework-1'],
            contentHash: 'snapshot-hash',
            generationNotes: null,
            stableStrengths: [],
            recurringIssues: [],
            activeReviewBacklog: [],
            recentProgress: [],
            personalFacts: [],
            recommendedAssignmentDirections: [],
            unresolvedIssues: [],
            snapshotSummary: 'Recent learner memory summary.',
            supersededById: null,
            supersededAt: null,
            createdAt: NOW,
            updatedAt: NOW,
          },
          recentReadyLessonMemory: [],
          recentReadyHomeworkMemory: [],
          unresolvedIssues: [],
        },
        memoryHealth: null,
      }),
    );

    renderLearningPage();

    expect(await screen.findByText('Recent learner memory summary.')).toBeTruthy();
    expect(screen.queryByText('Content hash')).toBeNull();

    await user.click(screen.getByRole('button', { name: /Memory support details/i }));

    expect(screen.getByText(/Memory support details unavailable/i)).toBeTruthy();
    expect(screen.queryByText('snapshot-hash')).toBeNull();
  });

  it('shows the active revision version label from revision history instead of a synthetic current label', async () => {
    renderLearningPage();

    await screen.findByDisplayValue('B1');

    const currentRevisionCard = screen.getByText('Current Revision').closest('article');
    expect(currentRevisionCard?.querySelector('strong')?.textContent).toBe('v1');
  });

  it('hides restore actions for active profile revisions', async () => {
    renderLearningPage();

    await screen.findByText('Profile Versions');

    expect(screen.queryByRole('button', { name: /^Restore$/i })).toBeNull();
  });

  it('does not show a draft activation success beside a failed profile reload', async () => {
    const user = userEvent.setup();
    const refreshStudent = vi.fn(async () => {});
    useStudentAreaContextMock.mockReturnValue({
      student: {
        id: 'student-alex',
        student: 'Alex',
        profileId: null,
      },
      studentId: 'student-alex',
      studentLoading: false,
      studentError: null,
      refreshStudent,
    });
    apiMocks.activateProfileRevision.mockResolvedValueOnce({
      id: 'revision-draft-empty-1',
      profileId: 'profiles/students/alex.md',
      contentHash: 'hash-empty-1',
      source: 'create',
      status: 'active',
      versionNumber: 1,
      versionLabel: 'v1',
      activatedAt: NOW,
      deprecatedAt: null,
      createdAt: NOW,
      createdBy: 'teacher-1',
      restoredFromRevisionId: null,
      content: '# Foundational Profile',
      structuredContent: {
        schemaVersion: 'foundational_profile_v1',
        overallLevel: null,
        primaryGoals: [],
        communicationContexts: [],
        interestsAndUsefulThemes: [],
        stableStrengths: [],
        persistentChallenges: [],
        studyPreferences: [],
        durableConstraints: [],
        teacherNotes: null,
      },
    });
    apiMocks.getProfileContent.mockRejectedValueOnce(
      new Error('not_found This learner profile has not been structured yet.'),
    );

    renderLearningPage();

    await user.click(await screen.findByRole('button', { name: /Start Empty Profile/i }));
    await screen.findByText(/Empty draft created/i);

    await user.click(await screen.findByRole('button', { name: /Activate Draft/i }));

    expect(await screen.findByText('Draft activated.')).toBeTruthy();
    expect(apiMocks.listStudentProfileCandidates).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByText('not_found This learner profile has not been structured yet.'),
    ).toBeNull();
  });

  it('ignores stale profile, memory, binding, and candidate responses after switching students', async () => {
    const studentAProfile = createDeferred<{
      id: string;
      label: string;
      content: string;
      structuredContent: {
        schemaVersion: 'foundational_profile_v1';
        overallLevel: string | null;
        primaryGoals: string[];
        communicationContexts: string[];
        interestsAndUsefulThemes: string[];
        stableStrengths: string[];
        persistentChallenges: string[];
        studyPreferences: string[];
        durableConstraints: string[];
        teacherNotes: string | null;
      };
      currentRevisionId: string | null;
      updatedAt: string | null;
    }>();
    const studentARevisions = createDeferred<{
      items: {
        id: string;
        profileId: string;
        contentHash: string;
        source: 'update';
        status: 'active';
        versionNumber: number;
        versionLabel: string;
        activatedAt: string;
        deprecatedAt: null;
        createdAt: string;
        createdBy: string | null;
        restoredFromRevisionId: null;
      }[];
      total: number;
      limit: number;
      offset: number;
      order: 'desc';
    }>();
    const studentAMemory = createDeferred<{
      studentId: string;
      latestReadyStudentMemorySnapshot: {
        id: string;
        studentId: string;
        schemaVersion: 'student-memory-snapshot.v1';
        generatedAt: string;
        provider: string;
        model: string;
        status: 'ready';
        sourceKind: string;
        lessonMemoryEntryIds: string[];
        homeworkMemoryEntryIds: string[];
        contentHash: string;
        generationNotes: null;
        stableStrengths: [];
        recurringIssues: [];
        activeReviewBacklog: [];
        recentProgress: [];
        personalFacts: [];
        recommendedAssignmentDirections: [];
        unresolvedIssues: [];
        snapshotSummary: string;
        supersededById: null;
        supersededAt: null;
        createdAt: string;
        updatedAt: string;
      };
      recentReadyLessonMemory: [];
      recentReadyHomeworkMemory: [];
      unresolvedIssues: [];
    }>();
    const studentABindings = createDeferred<{
      items: {
        id: string;
        studentId: string;
        profileId: string;
        effectiveFrom: string;
        effectiveTo: null;
        reason: null;
        changedBy: string | null;
        createdAt: string;
      }[];
      total: number;
      limit: number;
      offset: number;
      order: 'desc';
    }>();
    const studentACandidates = createDeferred<{
      items: {
        id: string;
      }[];
      total: number;
      limit: number;
      offset: number;
      order: 'desc';
    }>();

    apiMocks.getProfileContent.mockImplementation((profileId: string) => {
      if (profileId === 'profiles/students/alex.md') return studentAProfile.promise;
      return Promise.resolve({
        id: 'profiles/students/bora.md',
        label: 'Bora',
        content: '# Foundational Profile',
        structuredContent: {
          schemaVersion: 'foundational_profile_v1',
          overallLevel: 'B2',
          primaryGoals: ['Present status updates clearly.'],
          communicationContexts: ['Stakeholder meetings'],
          interestsAndUsefulThemes: ['Product launches'],
          stableStrengths: ['Fast comprehension'],
          persistentChallenges: ['Spoken transitions'],
          studyPreferences: ['Short practical loops'],
          durableConstraints: ['Busy release weeks'],
          teacherNotes: 'Student B teacher note.',
        },
        currentRevisionId: null,
        updatedAt: NOW,
      });
    });
    apiMocks.listProfileRevisions.mockImplementation((profileId: string) => {
      if (profileId === 'profiles/students/alex.md') return studentARevisions.promise;
      return Promise.resolve({
        items: [
          {
            id: 'revision-b-1',
            profileId: 'profiles/students/bora.md',
            contentHash: 'hash-b-1',
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
        limit: 25,
        offset: 0,
        order: 'desc',
      });
    });
    apiMocks.getStudentMemoryOverview.mockImplementation((studentId: string) => {
      if (studentId === 'student-alex') return studentAMemory.promise;
      return Promise.resolve({
        studentId: 'student-bora',
        latestReadyStudentMemorySnapshot: {
          id: 'snapshot-b',
          studentId: 'student-bora',
          schemaVersion: 'student-memory-snapshot.v1',
          generatedAt: NOW,
          provider: 'openai',
          model: 'gpt-5.4',
          status: 'ready',
          sourceKind: 'student_memory_rollup',
          lessonMemoryEntryIds: [],
          homeworkMemoryEntryIds: [],
          contentHash: 'snapshot-hash-b',
          generationNotes: null,
          stableStrengths: [],
          recurringIssues: [],
          activeReviewBacklog: [],
          recentProgress: [],
          personalFacts: [],
          recommendedAssignmentDirections: [],
          unresolvedIssues: [],
          snapshotSummary: 'Student B memory summary.',
          supersededById: null,
          supersededAt: null,
          createdAt: NOW,
          updatedAt: NOW,
        },
        recentReadyLessonMemory: [],
        recentReadyHomeworkMemory: [],
        unresolvedIssues: [],
      });
    });
    apiMocks.listStudentProfileBindings.mockImplementation((studentId: string) => {
      if (studentId === 'student-alex') return studentABindings.promise;
      return Promise.resolve({
        items: [
          {
            id: 'binding-b',
            studentId: 'student-bora',
            profileId: 'profiles/students/bora.md',
            effectiveFrom: NOW,
            effectiveTo: null,
            reason: null,
            changedBy: 'teacher-1',
            createdAt: NOW,
          },
        ],
        total: 1,
        limit: 5,
        offset: 0,
        order: 'desc',
      });
    });
    apiMocks.listStudentProfileCandidates.mockImplementation((studentId: string) => {
      if (studentId === 'student-alex') return studentACandidates.promise;
      return Promise.resolve({
        items: [
          {
            id: 'candidate-b',
          },
        ],
        total: 1,
        limit: 200,
        offset: 0,
        order: 'desc',
      });
    });

    let contextValue = {
      student: {
        id: 'student-alex',
        student: 'Alex',
        profileId: 'profiles/students/alex.md',
      },
      studentId: 'student-alex',
      studentLoading: false,
      studentError: null,
      refreshStudent: vi.fn(async () => {}),
    };
    useStudentAreaContextMock.mockImplementation(() => contextValue);

    const view = renderLearningPage();

    contextValue = {
      student: {
        id: 'student-bora',
        student: 'Bora',
        profileId: 'profiles/students/bora.md',
      },
      studentId: 'student-bora',
      studentLoading: false,
      studentError: null,
      refreshStudent: vi.fn(async () => {}),
    };

    view.rerender(
      <MemoryRouter>
        <StudentLearningPage />
      </MemoryRouter>,
    );

    expect(await screen.findByDisplayValue('B2')).toBeTruthy();
    expect(screen.getByText('Student B memory summary.')).toBeTruthy();
    expect(screen.getAllByText(/Support ID: bora/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/candidate-b/).length).toBeGreaterThan(0);

    await act(async () => {
      studentAProfile.resolve({
        id: 'profiles/students/alex.md',
        label: 'Alex',
        content: '# Foundational Profile',
        structuredContent: {
          schemaVersion: 'foundational_profile_v1',
          overallLevel: 'A2',
          primaryGoals: ['Student A goal'],
          communicationContexts: ['Student A context'],
          interestsAndUsefulThemes: [],
          stableStrengths: ['Student A strength'],
          persistentChallenges: ['Student A challenge'],
          studyPreferences: [],
          durableConstraints: [],
          teacherNotes: 'Student A note.',
        },
        currentRevisionId: null,
        updatedAt: NOW,
      });
      studentARevisions.resolve({
        items: [
          {
            id: 'revision-a-1',
            profileId: 'profiles/students/alex.md',
            contentHash: 'hash-a-1',
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
        limit: 25,
        offset: 0,
        order: 'desc',
      });
      studentAMemory.resolve({
        studentId: 'student-alex',
        latestReadyStudentMemorySnapshot: {
          id: 'snapshot-a',
          studentId: 'student-alex',
          schemaVersion: 'student-memory-snapshot.v1',
          generatedAt: NOW,
          provider: 'openai',
          model: 'gpt-5.4',
          status: 'ready',
          sourceKind: 'student_memory_rollup',
          lessonMemoryEntryIds: [],
          homeworkMemoryEntryIds: [],
          contentHash: 'snapshot-hash-a',
          generationNotes: null,
          stableStrengths: [],
          recurringIssues: [],
          activeReviewBacklog: [],
          recentProgress: [],
          personalFacts: [],
          recommendedAssignmentDirections: [],
          unresolvedIssues: [],
          snapshotSummary: 'Student A memory summary.',
          supersededById: null,
          supersededAt: null,
          createdAt: NOW,
          updatedAt: NOW,
        },
        recentReadyLessonMemory: [],
        recentReadyHomeworkMemory: [],
        unresolvedIssues: [],
      });
      studentABindings.resolve({
        items: [
          {
            id: 'binding-a',
            studentId: 'student-alex',
            profileId: 'profiles/students/alex.md',
            effectiveFrom: NOW,
            effectiveTo: null,
            reason: null,
            changedBy: 'teacher-1',
            createdAt: NOW,
          },
        ],
        total: 1,
        limit: 5,
        offset: 0,
        order: 'desc',
      });
      studentACandidates.resolve({
        items: [{ id: 'candidate-a' }],
        total: 1,
        limit: 200,
        offset: 0,
        order: 'desc',
      });
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue('B2')).toBeTruthy();
      expect(screen.queryByDisplayValue('A2')).toBeNull();
      expect(screen.getByText('Student B memory summary.')).toBeTruthy();
      expect(screen.queryByText('Student A memory summary.')).toBeNull();
      expect(screen.getAllByText(/Support ID: bora/).length).toBeGreaterThan(0);
      expect(screen.queryByText(/Support ID: alex/)).toBeNull();
      expect(screen.getAllByText(/candidate-b/).length).toBeGreaterThan(0);
      expect(screen.queryByText(/candidate-a/)).toBeNull();
    });
  });

  it('clears the previous student surface when the next student load fails', async () => {
    apiMocks.getStudentLearningSurface
      .mockResolvedValueOnce(makeLearningSurface())
      .mockRejectedValueOnce(new Error('Learning surface failed'));

    let contextValue = {
      student: {
        id: 'student-alex',
        student: 'Alex',
        profileId: 'profiles/students/alex.md',
      },
      studentId: 'student-alex',
      studentLoading: false,
      studentError: null,
      refreshStudent: vi.fn(async () => {}),
    };
    useStudentAreaContextMock.mockImplementation(() => contextValue);

    const view = renderLearningPage();

    expect(await screen.findByDisplayValue('B1')).toBeTruthy();
    expect(screen.getAllByText(/candidate-alex/).length).toBeGreaterThan(0);

    contextValue = {
      student: {
        id: 'student-bora',
        student: 'Bora',
        profileId: 'profiles/students/bora.md',
      },
      studentId: 'student-bora',
      studentLoading: false,
      studentError: null,
      refreshStudent: vi.fn(async () => {}),
    };

    view.rerender(
      <MemoryRouter>
        <StudentLearningPage />
      </MemoryRouter>,
    );

    expect((await screen.findAllByText('Learning surface failed')).length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(screen.queryByDisplayValue('B1')).toBeNull();
      expect(screen.queryByText(/candidate-alex/)).toBeNull();
    });
  });

  it('clears selected profile candidates when switching students', async () => {
    const user = userEvent.setup();
    apiMocks.getStudentLearningSurface
      .mockResolvedValueOnce(
        makeLearningSurface({
          candidates: {
            items: [makeProfileCandidate()],
            total: 1,
            limit: 50,
            offset: 0,
            order: 'desc',
          },
        }),
      )
      .mockResolvedValueOnce(
        makeLearningSurface({
          profile: {
            id: 'profiles/students/bora.md',
            label: 'Bora',
            content: '# Foundational Profile',
            structuredContent: {
              schemaVersion: 'foundational_profile_v1',
              overallLevel: 'B1',
              primaryGoals: ['Student B goal'],
              communicationContexts: ['Student B context'],
              interestsAndUsefulThemes: [],
              stableStrengths: [],
              persistentChallenges: [],
              studyPreferences: [],
              durableConstraints: [],
              teacherNotes: null,
            },
            currentRevisionId: null,
            updatedAt: NOW,
          },
          revisions: { items: [], total: 0, limit: 20, offset: 0, order: 'desc' },
          candidates: {
            items: [],
            total: 0,
            limit: 50,
            offset: 0,
            order: 'desc',
          },
        }),
      );

    let contextValue = {
      student: {
        id: 'student-alex',
        student: 'Alex',
        profileId: 'profiles/students/alex.md',
      },
      studentId: 'student-alex',
      studentLoading: false,
      studentError: null,
      refreshStudent: vi.fn(async () => {}),
    };
    useStudentAreaContextMock.mockImplementation(() => contextValue);

    const view = renderLearningPage();

    await user.click(await screen.findByRole('button', { name: 'Select candidate-alex' }));
    expect(screen.getByText('1 selected for draft revision generation')).toBeTruthy();

    contextValue = {
      student: {
        id: 'student-bora',
        student: 'Bora',
        profileId: 'profiles/students/bora.md',
      },
      studentId: 'student-bora',
      studentLoading: false,
      studentError: null,
      refreshStudent: vi.fn(async () => {}),
    };

    view.rerender(
      <MemoryRouter>
        <StudentLearningPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('0 selected for draft revision generation')).toBeTruthy();
    });

    await user.click(screen.getByRole('button', { name: 'Generate Draft Revision' }));

    expect(apiMocks.promoteStudentProfileCandidates).not.toHaveBeenCalled();
  });

  it('routes draft revision generation to the full profile draft refresh API', async () => {
    const user = userEvent.setup();
    apiMocks.getStudentLearningSurface.mockResolvedValueOnce(
      makeLearningSurface({
        candidates: {
          items: [makeProfileCandidate()],
          total: 1,
          limit: 50,
          offset: 0,
          order: 'desc',
        },
      }),
    );
    apiMocks.refreshProfileDraftFromApprovedCandidates.mockResolvedValueOnce({
      draftRevisionId: 'revision-draft-2',
      profileId: 'profiles/students/alex.md',
      includedCandidateIds: ['candidate-alex'],
      excludedCandidateIds: [],
      contentHash: 'hash-draft-2',
      draftRevision: {
        id: 'revision-draft-2',
        profileId: 'profiles/students/alex.md',
        contentHash: 'hash-draft-2',
        source: 'profile_revision_refresh',
        status: 'draft',
        versionNumber: 2,
        versionLabel: 'v2',
        activatedAt: null,
        deprecatedAt: null,
        createdAt: NOW,
        createdBy: 'teacher-1',
        restoredFromRevisionId: null,
        content: '# Foundational Profile',
        structuredContent: {
          schemaVersion: 'foundational_profile_v1',
          overallLevel: 'B1',
          primaryGoals: ['Lead standups clearly.'],
          communicationContexts: ['Team updates'],
          interestsAndUsefulThemes: ['Product work'],
          stableStrengths: ['High motivation'],
          persistentChallenges: ['Article usage'],
          studyPreferences: ['Short practical review loops'],
          durableConstraints: ['Limited evening time'],
          teacherNotes: 'Refreshed from approved candidates.',
        },
      },
    });

    renderLearningPage();

    await user.click(await screen.findByRole('button', { name: 'Select candidate-alex' }));
    await user.click(screen.getByRole('button', { name: 'Generate Draft Revision' }));

    await waitFor(() => {
      expect(apiMocks.refreshProfileDraftFromApprovedCandidates).toHaveBeenCalledWith(
        'student-alex',
        {
          candidateIds: ['candidate-alex'],
        },
      );
    });
    expect(apiMocks.promoteStudentProfileCandidates).not.toHaveBeenCalled();
    expect(screen.getByText('Profile Draft Changes')).toBeTruthy();
    expect(screen.getAllByText('Teacher Notes').length).toBeGreaterThan(1);
    expect(screen.getByText('Responds well to practical speaking tasks.')).toBeTruthy();
    expect(screen.getAllByText('Refreshed from approved candidates.').length).toBeGreaterThan(0);
  });

  it('removes reviewed candidates from the promotion selection when they are no longer approved', async () => {
    const user = userEvent.setup();
    apiMocks.getStudentLearningSurface.mockResolvedValueOnce(
      makeLearningSurface({
        candidates: {
          items: [makeProfileCandidate()],
          total: 1,
          limit: 50,
          offset: 0,
          order: 'desc',
        },
      }),
    );
    apiMocks.rejectStudentProfileCandidate.mockResolvedValueOnce(
      makeProfileCandidate({
        status: 'rejected',
        reviewState: 'rejected',
        reviewedAt: NOW,
      }),
    );

    renderLearningPage();

    await user.click(await screen.findByRole('button', { name: 'Select candidate-alex' }));
    expect(screen.getByText('1 selected for draft revision generation')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Reject candidate-alex' }));

    await waitFor(() => {
      expect(screen.getByText('0 selected for draft revision generation')).toBeTruthy();
    });

    await user.click(screen.getByRole('button', { name: 'Generate Draft Revision' }));

    expect(apiMocks.promoteStudentProfileCandidates).not.toHaveBeenCalled();
  });
});
