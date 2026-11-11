import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StudioV2Provider } from '../studio-v2/StudioV2Context';
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
  listProfileChanges: vi.fn(),
  undoProfileChange: vi.fn(),
  listStudentProfileCandidates: vi.fn(),
  promoteStudentProfileCandidates: vi.fn(),
  refreshProfileDraftFromApprovedCandidates: vi.fn(),
  rejectStudentProfileCandidate: vi.fn(),
  restoreProfileRevision: vi.fn(),
  saveProfileDraftRevision: vi.fn(),
  upsertProfileContent: vi.fn(),
}));

const useStudentAreaContextMock = vi.hoisted(() => vi.fn());

vi.mock('../../utils/api', () => apiMocks);

vi.mock('./LearningLessonContext', () => ({ LearningLessonContext: () => null }));

vi.mock('./StudentAreaContext', () => ({
  useStudentAreaContext: useStudentAreaContextMock,
}));

vi.mock('./ProfileCandidatesPanel', () => ({
  ProfileCandidatesPanel: (props: {
    profileCandidates: { id: string; status?: string }[];
    selectedCandidateIds: string[];
    profileCandidatePromotionSuccess: string | null;
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
      {props.profileCandidatePromotionSuccess ? (
        <p>{props.profileCandidatePromotionSuccess}</p>
      ) : null}
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
  apiMocks.listProfileChanges.mockResolvedValue({
    studentId: 'student-alex',
    activeRevisionId: 'revision-active-1',
    items: [],
    nextCursor: null,
  });
  apiMocks.getProfileContent.mockResolvedValue({
    studentId: 'student-alex',
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
    activeRevisionId: 'revision-active-1',
    updatedAt: NOW,
  });

  apiMocks.getProfileRevision.mockResolvedValue({
    id: 'revision-active-1',
    studentId: 'student-alex',
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
    baseActiveRevisionId: null,
    baseActiveRevisionKnown: false,
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
        studentId: 'student-alex',
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
        baseActiveRevisionId: null,
        baseActiveRevisionKnown: false,
      },
    ],
    total: 1,
    limit: 25,
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
    recentReadyLessonMemory: [{ id: 'lesson-1' }],
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
    const [profile, revisions, memory, memoryHealth, candidates] = await Promise.all([
      apiMocks.getProfileContent(studentId),
      apiMocks.listProfileRevisions(studentId, {
        limit: 25,
        offset: 0,
        order: 'desc',
      }),
      apiMocks.getStudentMemoryOverview(studentId, { lessonLimit: 3, homeworkLimit: 2 }),
      apiMocks.getStudentMemoryHealth(studentId),
      apiMocks.listStudentProfileCandidates(studentId, { limit: 200, offset: 0, order: 'desc' }),
    ]);
    return {
      profile,
      revisions,
      memory,
      memoryHealth,
      candidates,
    };
  });

  apiMocks.initializeStudentProfileDraft.mockResolvedValue({
    draftRevisionId: 'revision-draft-empty-1',
    studentId: 'student-alex',
    draftRevision: {
      id: 'revision-draft-empty-1',
      studentId: 'student-alex',
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
      baseActiveRevisionId: null,
      baseActiveRevisionKnown: false,
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
  apiMocks.activateProfileRevision.mockResolvedValue({
    id: 'revision-draft-empty-1',
    studentId: 'student-alex',
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
    baseActiveRevisionId: null,
    baseActiveRevisionKnown: false,
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
}

function renderLearningPage(initialEntry = '/students/student-alex/learning', studioV2 = false) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <StudioV2Provider enabled={studioV2}>
        <StudentLearningPage />
      </StudioV2Provider>
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
      studentId: 'student-alex',
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
      activeRevisionId: 'revision-active-1',
      updatedAt: NOW,
    },
    revisions: {
      items: [
        {
          id: 'revision-active-1',
          studentId: 'student-alex',
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
          baseActiveRevisionId: null,
          baseActiveRevisionKnown: false,
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
      },
      studentId: 'student-alex',
      studentLoading: false,
      studentError: null,
      refreshStudent: vi.fn(async () => {}),
    });
  });

  it('opens automatic profile updates from the default frontend', async () => {
    const user = userEvent.setup();
    renderLearningPage();
    await user.click(await screen.findByRole('button', { name: 'Profile updates' }));
    expect(await screen.findByText('No automatic profile updates yet.')).toBeTruthy();
    expect(apiMocks.listProfileChanges).toHaveBeenCalledWith('student-alex', undefined);
  });

  it('keeps a dirty profile and its original active-head baseline when focus and a rejected save reveal a newer version', async () => {
    const user = userEvent.setup();
    renderLearningPage(undefined, true);
    await user.click(await screen.findByRole('button', { name: 'Edit profile' }));
    await user.clear(screen.getByLabelText('Teacher Notes'));
    await user.type(screen.getByLabelText('Teacher Notes'), 'My local teaching context');
    const original = makeLearningSurface().profile;
    const newer = {
      ...original,
      currentRevisionId: 'revision-active-2',
      activeRevisionId: 'revision-active-2',
      structuredContent: {
        ...original.structuredContent,
        teacherNotes: 'New background teaching context',
      },
    };
    apiMocks.getProfileContent.mockResolvedValue(newer);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await screen.findByText('Profile updated');
    expect((screen.getByLabelText('Teacher Notes') as HTMLTextAreaElement).value).toBe(
      'My local teaching context',
    );
    const conflict = new Error('The learner profile has changed. Your edits are kept.');
    conflict.name = 'ProfileRevisionConflictApiError';
    apiMocks.upsertProfileContent.mockRejectedValueOnce(conflict);
    await user.click(screen.getByRole('button', { name: 'Save learner profile' }));
    await screen.findByRole('region', { name: 'Compare profile versions' });
    expect(apiMocks.upsertProfileContent).toHaveBeenLastCalledWith(
      'student-alex',
      null,
      expect.objectContaining({ teacherNotes: 'My local teaching context' }),
      { expectedActiveRevisionId: 'revision-active-1' },
    );
    expect((screen.getByLabelText('Teacher Notes') as HTMLTextAreaElement).value).toBe(
      'My local teaching context',
    );
    expect(screen.getByText('New background teaching context')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Keep my edits' }));
    await user.click(screen.getByRole('button', { name: 'Save learner profile' }));
    expect(apiMocks.upsertProfileContent).toHaveBeenLastCalledWith(
      'student-alex',
      null,
      expect.objectContaining({ teacherNotes: 'My local teaching context' }),
      { expectedActiveRevisionId: 'revision-active-2' },
    );
  });

  it('keeps unsaved edits when a historical Open or Restore action is requested', async () => {
    const surface = makeLearningSurface();
    apiMocks.getStudentLearningSurface.mockResolvedValueOnce({
      ...surface,
      revisions: {
        ...surface.revisions,
        items: [
          ...surface.revisions.items,
          {
            ...surface.revisions.items[0],
            id: 'historical-revision',
            status: 'deprecated',
            versionLabel: 'v0',
          },
        ],
      },
    });
    const user = userEvent.setup();
    renderLearningPage();
    await user.type(await screen.findByLabelText('Teacher Notes'), ' Local unsaved note.');
    const notes = (screen.getByLabelText('Teacher Notes') as HTMLTextAreaElement).value;
    const restore = screen.getByRole('button', { name: 'Restore' });
    const open = screen.getByRole('button', { name: 'Open' });
    expect((restore as HTMLButtonElement).disabled).toBe(true);
    expect((open as HTMLButtonElement).disabled).toBe(true);
    await user.click(restore);
    await user.click(open);
    expect(apiMocks.restoreProfileRevision).not.toHaveBeenCalled();
    expect(apiMocks.getProfileRevision).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Teacher Notes') as HTMLTextAreaElement).value).toBe(notes);
  });

  it('ignores a completed save from the previous student after the page changes owner', async () => {
    const user = userEvent.setup();
    const pending = createDeferred<unknown>();
    apiMocks.upsertProfileContent.mockReturnValueOnce(pending.promise);
    const view = renderLearningPage(undefined, true);
    await user.click(await screen.findByRole('button', { name: 'Edit profile' }));
    await user.type(screen.getByLabelText('Teacher Notes'), ' Alex local note');
    await user.click(screen.getByRole('button', { name: 'Save learner profile' }));
    await waitFor(() => expect(apiMocks.upsertProfileContent).toHaveBeenCalledTimes(1));
    const surface = makeLearningSurface();
    apiMocks.getStudentLearningSurface.mockResolvedValueOnce({
      ...surface,
      profile: {
        ...surface.profile,
        studentId: 'student-bella',
        currentRevisionId: 'bella-head',
        activeRevisionId: 'bella-head',
        structuredContent: {
          ...surface.profile.structuredContent,
          overallLevel: 'A2',
          teacherNotes: 'Bella teaching context',
        },
      },
      revisions: { ...surface.revisions, items: [] },
    });
    useStudentAreaContextMock.mockReturnValue({
      student: { id: 'student-bella', student: 'Bella' },
      studentId: 'student-bella',
      studentLoading: false,
      studentError: null,
      refreshStudent: vi.fn(async () => {}),
    });
    view.rerender(
      <MemoryRouter>
        <StudioV2Provider enabled>
          <StudentLearningPage />
        </StudioV2Provider>
      </MemoryRouter>,
    );
    await screen.findByText('A2');
    await act(async () => {
      pending.resolve({});
      await pending.promise;
    });
    expect(screen.getByText('A2')).toBeTruthy();
    expect(screen.queryByText('Learner profile saved.')).toBeNull();
    expect(screen.queryByDisplayValue(/Alex local note/)).toBeNull();
  });

  it('requires a newly saved draft after comparing an older durable base instead of blessing its activation', async () => {
    const surface = makeLearningSurface();
    const draft = {
      ...surface.revisions.items[0],
      id: 'draft-old',
      status: 'draft',
      baseActiveRevisionKnown: true,
      baseActiveRevisionId: 'head-old',
      content: 'draft',
      structuredContent: surface.profile.structuredContent,
    };
    apiMocks.getStudentLearningSurface.mockResolvedValueOnce({
      ...surface,
      revisions: { ...surface.revisions, items: [...surface.revisions.items, draft] },
    });
    apiMocks.getProfileRevision.mockResolvedValueOnce(draft);
    apiMocks.saveProfileDraftRevision.mockResolvedValueOnce({
      ...draft,
      id: 'draft-new',
      baseActiveRevisionId: 'revision-active-1',
    });
    const user = userEvent.setup();
    renderLearningPage();
    await user.click(await screen.findByRole('button', { name: 'Open' }));
    await screen.findByRole('region', { name: 'Compare profile versions' });
    expect(
      (screen.getByRole('button', { name: 'Activate Draft' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Keep my edits' }));
    expect(
      (screen.getByRole('button', { name: 'Activate Draft' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Save Draft' }));
    await waitFor(() =>
      expect(apiMocks.saveProfileDraftRevision).toHaveBeenCalledWith(
        'student-alex',
        expect.objectContaining({
          expectedActiveRevisionId: 'revision-active-1',
          inheritCandidateLinksFromRevisionId: 'draft-old',
        }),
      ),
    );
    expect(apiMocks.activateProfileRevision).not.toHaveBeenCalled();
  });

  it('shows the v2 profile and memory, and retains all nine fields through edit, cancel and save', async () => {
    const user = userEvent.setup();
    renderLearningPage(undefined, true);
    await screen.findByRole('heading', { name: 'Learning profile' });
    expect(screen.getByText('Recent learner memory summary.')).toBeTruthy();
    expect(screen.getByText('B1').className).toContain('student-v2-level');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Undo/i })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Edit profile' }));
    const editor = screen.getByRole('dialog', { name: 'Edit profile' });
    expect(within(editor).getAllByRole('textbox')).toHaveLength(9);
    expect(document.activeElement).toBe(screen.getByLabelText('Current Level'));
    await user.clear(screen.getByLabelText('Current Level'));
    await user.type(screen.getByLabelText('Current Level'), 'B2');
    await user.click(screen.getByRole('button', { name: 'Cancel editing' }));
    await user.click(within(editor).getByRole('button', { name: 'Keep editing' }));
    expect((screen.getByLabelText('Current Level') as HTMLInputElement).value).toBe('B2');
    await user.click(within(editor).getByRole('button', { name: 'Close dialog' }));
    await user.click(within(editor).getByRole('button', { name: 'Discard changes' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('B1')).toBeTruthy();
    expect(apiMocks.upsertProfileContent).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Edit profile' }));
    await user.clear(screen.getByLabelText('Teacher Notes'));
    await user.type(screen.getByLabelText('Teacher Notes'), 'Use practical speaking tasks.');
    await user.click(screen.getByRole('button', { name: 'Save learner profile' }));
    await waitFor(() =>
      expect(apiMocks.upsertProfileContent).toHaveBeenCalledWith(
        'student-alex',
        null,
        expect.objectContaining({
          overallLevel: 'B1',
          primaryGoals: ['Lead standups clearly.'],
          communicationContexts: ['Team updates'],
          interestsAndUsefulThemes: ['Product work'],
          stableStrengths: ['High motivation'],
          persistentChallenges: ['Article usage'],
          studyPreferences: ['Short practical review loops'],
          durableConstraints: ['Limited evening time'],
          teacherNotes: 'Use practical speaking tasks.',
        }),
        { expectedActiveRevisionId: 'revision-active-1' },
      ),
    );
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  });

  it('opens v2 versions and suggestions in separate dialogs without changing the profile', async () => {
    const user = userEvent.setup();
    const surface = makeLearningSurface();
    apiMocks.getStudentLearningSurface.mockResolvedValueOnce({
      ...surface,
      candidates: { ...surface.candidates, items: [], total: 0 },
    });
    renderLearningPage(undefined, true);

    await user.click(await screen.findByRole('button', { name: 'Profile versions' }));
    const versions = screen.getByRole('dialog', { name: 'Profile versions' });
    expect(within(versions).getByText('v1')).toBeTruthy();
    expect(within(versions).queryByRole('button', { name: 'Restore' })).toBeNull();
    await user.click(within(versions).getByRole('button', { name: 'Close dialog' }));

    await user.click(screen.getByRole('button', { name: 'Profile suggestions' }));
    const suggestions = screen.getByRole('dialog', { name: 'Profile suggestions' });
    expect(within(suggestions).getByText('No profile suggestions yet.')).toBeTruthy();
    await user.click(within(suggestions).getByRole('button', { name: 'Close dialog' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(apiMocks.restoreProfileRevision).not.toHaveBeenCalled();
    expect(apiMocks.upsertProfileContent).not.toHaveBeenCalled();
  });

  it('keeps available memory visible in v2 before a first profile is created', async () => {
    apiMocks.getProfileContent.mockResolvedValue(null);
    renderLearningPage(undefined, true);
    expect(await screen.findByText('Recent learner memory summary.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create learner profile' })).toBeTruthy();
    expect(apiMocks.initializeStudentProfileDraft).not.toHaveBeenCalled();
  });

  it('keeps a failed initial load unavailable until Retry succeeds', async () => {
    const user = userEvent.setup();
    apiMocks.getStudentLearningSurface.mockRejectedValueOnce(new Error('Learning request failed'));
    renderLearningPage();
    expect(await screen.findByRole('heading', { name: 'Learning unavailable' })).toBeTruthy();
    expect(screen.queryByText('No Snapshot Yet')).toBeNull();
    expect(screen.queryByRole('button', { name: /Save learner profile/i })).toBeNull();
    expect(
      screen.queryByRole('button', { name: /Refresh Draft From Approved Candidates/i }),
    ).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Foundational Profile' })).toBeTruthy();
    expect(apiMocks.getStudentLearningSurface).toHaveBeenCalledTimes(2);
  });

  it.each(['repair_required', 'repository_unavailable'])(
    'explains %s without suggesting a fresh bootstrap',
    async (state) => {
      apiMocks.getStudentMemoryOverview.mockResolvedValue({
        studentId: 'student-alex',
        availability: {
          state,
          reason:
            state === 'repair_required'
              ? 'established_history_ineligible'
              : 'repository_unavailable',
          lessonReferenceCount: 19,
          homeworkReferenceCount: 3,
        },
        latestReadyStudentMemorySnapshot: null,
        recentReadyLessonMemory: [],
        recentReadyHomeworkMemory: [],
        unresolvedIssues: [],
      });
      renderLearningPage();
      await waitFor(() =>
        expect(
          screen.getAllByText(
            state === 'repair_required'
              ? /Stored memory history requires explicit repair/
              : /Memory retrieval is unavailable/,
          ).length,
        ).toBeGreaterThan(0),
      );
      expect(
        screen.queryByText('Generate student memory to strengthen this teaching view.'),
      ).toBeNull();
    },
  );

  it('lets a student without a profile start an empty learner profile without falling back to legacy UI', async () => {
    apiMocks.getProfileContent.mockResolvedValueOnce(null);
    const user = userEvent.setup();
    const refreshStudent = vi.fn(async () => {});

    useStudentAreaContextMock.mockReturnValue({
      student: {
        id: 'student-alex',
        student: 'Alex',
      },
      studentId: 'student-alex',
      studentLoading: false,
      studentError: null,
      refreshStudent,
    });

    renderLearningPage();

    expect(await screen.findByText(/does not have a learner profile yet/i)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Open legacy workspace/i })).toBeNull();

    await user.click(screen.getByRole('button', { name: /Create learner profile/i }));

    await waitFor(() => {
      expect(apiMocks.initializeStudentProfileDraft).toHaveBeenCalledWith('student-alex', {
        expectedActiveRevisionId: null,
      });
    });
    await waitFor(() => {
      expect(refreshStudent).toHaveBeenCalled();
    });
    expect(apiMocks.activateProfileRevision).toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: /Foundational Profile/i })).toBeTruthy();
    expect(screen.getByText(/Learner profile created/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Activate Draft/i })).toBeNull();
  });

  it('bounds an empty open-thread state to the latest memory snapshot', async () => {
    renderLearningPage();

    expect(await screen.findByText('No open threads in the latest memory snapshot.')).toBeTruthy();
    expect(screen.queryByText('No unresolved teaching threads surfaced.')).toBeNull();
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
    expect(screen.queryByText(/Referenced sources:/)).toBeNull();
    expect(screen.queryByText('incremental_v1_1')).toBeNull();
    expect(screen.queryByText('snapshot-hash')).toBeNull();

    await user.click(screen.getByRole('button', { name: /Memory support details/i }));

    expect(screen.getByText('incremental_v1_1')).toBeTruthy();
    expect(screen.getByText('snapshot-hash')).toBeTruthy();
    expect(screen.getByText('Referenced sources: 1 lesson / 1 homework')).toBeTruthy();
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
      (await screen.findAllByText(/No established student-memory snapshot is available yet/i))[0],
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
      (await screen.findAllByText(/No established student-memory snapshot is available yet/i))[0],
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

  it('saves ordinary learner edits as an active profile revision without draft controls', async () => {
    const user = userEvent.setup();
    renderLearningPage();
    await screen.findByDisplayValue('B1');
    expect(screen.queryByRole('button', { name: /Save Draft/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Activate Draft/i })).toBeNull();
    await user.type(screen.getByLabelText(/Current Level/i), ' plus');
    await user.click(screen.getByRole('button', { name: /Save learner profile/i }));
    await waitFor(() =>
      expect(apiMocks.upsertProfileContent).toHaveBeenCalledWith(
        'student-alex',
        null,
        expect.objectContaining({ overallLevel: 'B1 plus' }),
        { expectedActiveRevisionId: 'revision-active-1' },
      ),
    );
    expect(apiMocks.saveProfileDraftRevision).not.toHaveBeenCalled();
  });

  it('reports a failed initial profile activation without a success message', async () => {
    apiMocks.getProfileContent.mockResolvedValueOnce(null);
    const user = userEvent.setup();
    useStudentAreaContextMock.mockReturnValue({
      student: { id: 'student-alex', student: 'Alex' },
      studentId: 'student-alex',
      studentLoading: false,
      studentError: null,
      refreshStudent: vi.fn(async () => {}),
    });
    apiMocks.activateProfileRevision.mockRejectedValueOnce(new Error('Activation failed'));
    renderLearningPage();
    await user.click(await screen.findByRole('button', { name: /Create learner profile/i }));
    expect(await screen.findByText('Activation failed')).toBeTruthy();
    expect(screen.queryByText(/Learner profile created/i)).toBeNull();
  });
  it('ignores stale profile, memory, and candidate responses after switching students', async () => {
    const studentAProfile = createDeferred<{
      studentId: string;
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
      activeRevisionId: string | null;
      updatedAt: string | null;
    }>();
    const studentARevisions = createDeferred<{
      items: {
        id: string;
        studentId: string;
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
        baseActiveRevisionId: string | null;
        baseActiveRevisionKnown: boolean;
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
    const studentACandidates = createDeferred<{
      items: {
        id: string;
      }[];
      total: number;
      limit: number;
      offset: number;
      order: 'desc';
    }>();

    apiMocks.getProfileContent.mockImplementation((profileStudentId: string) => {
      if (profileStudentId === 'student-alex') return studentAProfile.promise;
      return Promise.resolve({
        studentId: 'student-bora',
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
        activeRevisionId: null,
        updatedAt: NOW,
      });
    });
    apiMocks.listProfileRevisions.mockImplementation((profileStudentId: string) => {
      if (profileStudentId === 'student-alex') return studentARevisions.promise;
      return Promise.resolve({
        items: [
          {
            id: 'revision-b-1',
            studentId: 'student-bora',
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
            baseActiveRevisionId: null,
            baseActiveRevisionKnown: false,
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
        studentId: 'student-alex',
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
        activeRevisionId: null,
        updatedAt: NOW,
      });
      studentARevisions.resolve({
        items: [
          {
            id: 'revision-a-1',
            studentId: 'student-alex',
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
            baseActiveRevisionId: null,
            baseActiveRevisionKnown: false,
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
            studentId: 'student-bora',
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
            activeRevisionId: null,
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
      studentId: 'student-alex',
      includedCandidateIds: [],
      contentHash: 'hash-draft-2',
      draftRevision: {
        id: 'revision-draft-2',
        studentId: 'student-alex',
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
        baseActiveRevisionId: 'revision-active-1',
        baseActiveRevisionKnown: true,
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
    apiMocks.saveProfileDraftRevision.mockResolvedValueOnce({
      id: 'revision-draft-3',
      studentId: 'student-alex',
      contentHash: 'hash-draft-3',
      source: 'update',
      status: 'draft',
      versionNumber: 3,
      versionLabel: 'v3',
      activatedAt: null,
      deprecatedAt: null,
      createdAt: NOW,
      createdBy: 'teacher-1',
      restoredFromRevisionId: null,
      baseActiveRevisionId: 'revision-active-1',
      baseActiveRevisionKnown: true,
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
        teacherNotes: 'Manual correction after candidate refresh.',
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
          baseRevisionId: 'revision-active-1',
          expectedActiveRevisionId: 'revision-active-1',
        },
      );
    });
    expect(apiMocks.promoteStudentProfileCandidates).not.toHaveBeenCalled();
    expect(
      await screen.findByText(
        'Draft refreshed. 0 of 1 selected facts applied; 1 omitted. Approved wording is absent or changed in its target field. Review the changes and repeated wording before activating.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Profile Draft Changes')).toBeTruthy();
    expect(
      screen.getByText('Profile Draft Changes').closest('.student-learning-profile-card'),
    ).toBeNull();
    expect(screen.getByText('1 field changed')).toBeTruthy();
    expect(screen.getByText('Review before activating or edit below')).toBeTruthy();
    expect(screen.getAllByText('Current active profile')).toHaveLength(1);
    expect(screen.getAllByText('Proposed draft')).toHaveLength(1);
    expect(screen.getByText('Changed')).toBeTruthy();
    expect(screen.getAllByText('Teacher Notes').length).toBeGreaterThan(1);
    expect(screen.getByText('Responds well to practical speaking tasks.')).toBeTruthy();
    expect(screen.getAllByText('Refreshed from approved candidates.').length).toBeGreaterThan(0);

    await user.clear(screen.getByLabelText('Teacher Notes'));
    await user.type(
      screen.getByLabelText('Teacher Notes'),
      'Manual correction after candidate refresh.',
    );
    await user.click(screen.getByRole('button', { name: 'Save Draft' }));

    await waitFor(() => {
      expect(apiMocks.saveProfileDraftRevision).toHaveBeenCalledWith(
        'student-alex',
        expect.objectContaining({
          inheritCandidateLinksFromRevisionId: 'revision-draft-2',
        }),
      );
    });
    apiMocks.activateProfileRevision.mockResolvedValueOnce({
      id: 'revision-draft-3',
      candidatePromotion: {
        linkedCandidateCount: 1,
        promotedCandidateIds: [],
        omittedCandidates: [{ candidateId: 'candidate-alex', reason: 'fact_not_represented' }],
      },
    });
    await user.click(screen.getByRole('button', { name: 'Activate Draft' }));
    expect(
      await screen.findByText(
        'Draft activated. 0 of 1 linked facts promoted; 1 omitted. Approved wording is absent or changed in its target field.',
      ),
    ).toBeTruthy();
  });

  it('limits older profile versions behind a view-all control', async () => {
    const user = userEvent.setup();
    const revision = (
      id: string,
      versionLabel: string,
      status: 'draft' | 'active' | 'deprecated',
      createdAt: string,
    ) => ({
      id,
      studentId: 'student-alex',
      contentHash: `hash-${id}`,
      source: status === 'draft' ? 'profile_revision_refresh' : 'update',
      status,
      versionNumber: Number(versionLabel.replace('v', '')),
      versionLabel,
      activatedAt: status === 'active' ? createdAt : null,
      deprecatedAt: status === 'deprecated' ? createdAt : null,
      createdAt,
      createdBy: 'teacher-1',
      restoredFromRevisionId: null,
      baseActiveRevisionId: null,
      baseActiveRevisionKnown: false,
    });
    apiMocks.getStudentLearningSurface.mockResolvedValueOnce(
      makeLearningSurface({
        profile: {
          studentId: 'student-alex',
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
          currentRevisionId: 'revision-draft-6',
          activeRevisionId: 'revision-draft-6',
          updatedAt: NOW,
        },
        revisions: {
          items: [
            revision('revision-draft-6', 'v6', 'draft', '2026-04-22T10:06:00.000Z'),
            revision('revision-active-5', 'v5', 'active', '2026-04-22T10:05:00.000Z'),
            revision('revision-old-4', 'v4', 'deprecated', '2026-04-22T10:04:00.000Z'),
            revision('revision-old-3', 'v3', 'deprecated', '2026-04-22T10:03:00.000Z'),
            revision('revision-old-2', 'v2', 'deprecated', '2026-04-22T10:02:00.000Z'),
            revision('revision-old-1', 'v1', 'deprecated', '2026-04-22T10:01:00.000Z'),
          ],
          total: 6,
          limit: 20,
          offset: 0,
          order: 'desc',
        },
      }),
    );

    renderLearningPage();

    expect(await screen.findByText('v6')).toBeTruthy();
    expect(screen.getByText('v5')).toBeTruthy();
    expect(screen.getByText('v4')).toBeTruthy();
    expect(screen.getByText('v3')).toBeTruthy();
    expect(screen.getByText('v2')).toBeTruthy();
    expect(screen.queryByText('v1')).toBeNull();
    expect(screen.getByRole('button', { name: 'View all versions' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'View all versions' }));

    expect(screen.getByText('v1')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide older versions' })).toBeTruthy();
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
