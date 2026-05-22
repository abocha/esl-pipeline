import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StudentHistoryPage } from './StudentHistoryPage';

const apiMocks = vi.hoisted(() => ({
  getStudentHistorySurface: vi.fn(),
  getStudentTimeline: vi.fn(),
  listStudentProfileCandidates: vi.fn(),
  listStudentHomeworkMemoryEntries: vi.fn(),
  listStudentLessonMemoryEntries: vi.fn(),
}));

const useStudentAreaContextMock = vi.hoisted(() => vi.fn());

vi.mock('../../utils/api', () => apiMocks);

vi.mock('./StudentAreaContext', () => ({
  useStudentAreaContext: useStudentAreaContextMock,
}));

const LESSON_TIME = '2026-04-23T14:05:00.000Z';
const HOMEWORK_TIME = '2026-04-23T15:20:00.000Z';
const PROFILE_TIME = '2026-04-22T11:26:05.864Z';

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

function seedHistoryContext() {
  useStudentAreaContextMock.mockReturnValue({
    student: {
      id: 'student-daria',
      student: 'Daria',
      profileId: 'dasha.md',
    },
    studentId: 'student-daria',
    studentLoading: false,
    studentError: null,
    refreshStudent: vi.fn(),
  });
}

function seedHistoryMocks() {
  apiMocks.getStudentHistorySurface.mockImplementation(async (studentId: string) => {
    const [timeline, lessonMemory, homeworkMemory] = await Promise.all([
      apiMocks.getStudentTimeline(studentId, { limit: 100, offset: 0, order: 'desc' }),
      apiMocks.listStudentLessonMemoryEntries(studentId, {
        status: 'ready',
        limit: 60,
        offset: 0,
        order: 'desc',
      }),
      apiMocks.listStudentHomeworkMemoryEntries(studentId, {
        status: 'ready',
        limit: 60,
        offset: 0,
        order: 'desc',
      }),
    ]);
    return { timeline, lessonMemory, homeworkMemory };
  });

  apiMocks.listStudentLessonMemoryEntries.mockResolvedValue({
    studentId: 'student-daria',
    items: [
      {
        id: 'lesson-memory-1',
        studentId: 'student-daria',
        transcriptId: 'transcript-1',
        recordingId: 'recording-1',
        schemaVersion: 'lesson_memory_v1',
        generatedAt: LESSON_TIME,
        provider: 'openai',
        model: 'gpt-test',
        status: 'ready',
        sourceKind: 'lesson_transcript',
        generationNotes: null,
        lessonSummary:
          'Practiced expanding ideas with connectors and natural phrasing in workplace stories.',
        topicsDiscussed: [
          {
            topic: 'Fluency with natural expression',
            note: 'Built longer answers from short prompts without losing precision.',
          },
          {
            topic: 'Connectors',
            note: 'Used contrast and cause-effect linking phrases.',
          },
        ],
        mistakePatterns: [],
        grammarReviewed: [{ name: 'Past Simple', note: 'Kept narratives anchored in time.' }],
        grammarWatchlist: [],
        vocabularyFocus: [{ text: 'to bring up', note: 'Used for workplace topics.' }],
        pronunciationFocus: [],
        studentFacts: [],
        progressSignals: [{ label: 'More fluent turns', note: 'Needed fewer pauses.' }],
        followUpRecommendations: [
          {
            label: 'Opinion expansion',
            note: 'Ask for a reason, example, and counterpoint in the next speaking task.',
          },
        ],
        supersededById: null,
        supersededAt: null,
        createdAt: LESSON_TIME,
        updatedAt: LESSON_TIME,
      },
    ],
    limit: 60,
    offset: 0,
    order: 'desc',
    statuses: ['ready'],
  });

  apiMocks.listStudentHomeworkMemoryEntries.mockResolvedValue({
    studentId: 'student-daria',
    items: [
      {
        id: 'homework-memory-1',
        studentId: 'student-daria',
        jobId: 'job-homework-1',
        assignmentLineageKey: 'lineage-1',
        promptPackageId: 'prompt-1',
        draftId: 'draft-1',
        recordingId: 'recording-1',
        transcriptId: 'transcript-1',
        schemaVersion: 'homework_memory_v1',
        generatedAt: HOMEWORK_TIME,
        provider: 'openai',
        model: 'gpt-test',
        status: 'ready',
        sourceKind: 'published_assignment',
        contentHash: 'hash-1',
        generationNotes: null,
        homeworkSummary:
          'A speaking practice assignment about telling a personal story with clearer sentence openers.',
        topic: 'Speaking practice: Tell a personal story',
        grammarTargets: [
          { name: 'Past tense anchors', note: 'Keep the timeline clear.', targetKind: 'review' },
        ],
        vocabularyTargets: [],
        reviewTargets: [{ label: 'Sentence openers', note: 'Vary first words in longer turns.' }],
        taskList: [
          {
            section: 'Warm-up',
            task: 'Retell the story in four steps.',
            taskType: 'roadmap',
            review: true,
          },
          {
            section: 'Mission',
            task: 'Record a two-minute version.',
            taskType: 'mission',
            review: false,
          },
        ],
        pronunciationFocus: [],
        studyTextType: 'monologue',
        inputType: 'generate',
        communicativeOutcome: 'Tell a short story clearly.',
        teacherFollowUpCues: [
          {
            cueType: 'warm_up',
            note: 'Start next lesson by asking for the same story with one new detail.',
          },
        ],
        publishedAt: HOMEWORK_TIME,
        publishTargets: [
          {
            target: 'html',
            url: 'https://example.test/homework.html',
            jobId: 'job-homework-1',
            publishedAt: HOMEWORK_TIME,
          },
        ],
        supersededById: null,
        supersededAt: null,
        createdAt: HOMEWORK_TIME,
        updatedAt: HOMEWORK_TIME,
      },
    ],
    limit: 60,
    offset: 0,
    order: 'desc',
    statuses: ['ready'],
  });

  apiMocks.getStudentTimeline.mockResolvedValue({
    items: [
      {
        type: 'recording_ingested',
        studentId: 'student-daria',
        recordingId: 'recording-1',
        status: 'ready',
        createdAt: '2026-04-23T13:50:00.000Z',
        displayName: 'recording-1.webm',
      },
      {
        type: 'transcript_ready',
        studentId: 'student-daria',
        recordingId: 'recording-1',
        transcriptId: 'transcript-1',
        status: 'ready',
        createdAt: '2026-04-23T14:00:00.000Z',
        displayName: 'recording-1.webm',
      },
      {
        type: 'job_completed',
        studentId: 'student-daria',
        jobId: 'job-homework-1',
        status: 'succeeded',
        createdAt: HOMEWORK_TIME,
        displayName: 'job-homework-1',
      },
      {
        type: 'profile_revision_activated',
        studentId: 'student-daria',
        status: 'active',
        createdAt: PROFILE_TIME,
        displayName: 'dasha.md',
        details: {
          profileRevisionId: 'revision-6',
          profileId: 'dasha.md',
          source: 'legacy_normalization',
          versionLabel: 'v6',
        },
      },
      {
        type: 'prompt_package_created',
        studentId: 'student-daria',
        promptPackageId: 'prompt-2',
        status: 'ready',
        createdAt: '2026-04-21T09:10:00.000Z',
        displayName: 'Conversation prompts',
      },
      {
        type: 'job_action_rerun',
        studentId: 'student-daria',
        jobId: 'job-previous',
        status: 'succeeded',
        createdAt: '2026-04-20T08:30:00.000Z',
        displayName: 'job-previous',
        details: {
          actionType: 'rerun',
          message: 'Regenerated homework after teacher edit.',
        },
      },
      {
        type: 'lesson_completed',
        studentId: 'student-daria',
        status: 'completed',
        createdAt: '2026-04-20T07:30:00.000Z',
        displayName: 'Pitch practice',
        details: {
          lessonId: 'lesson-1',
          title: 'Pitch practice',
          startsAt: '2026-04-20T07:00:00.000Z',
          durationMinutes: 60,
        },
      },
      {
        type: 'credit_event_recorded',
        studentId: 'student-daria',
        status: 'credit_added',
        createdAt: '2026-04-19T10:00:00.000Z',
        displayName: 'Credit event credit-1',
        details: {
          creditEventId: 'credit-1',
          quantityDelta: 8,
          note: 'Package purchase',
        },
      },
      {
        type: 'payment_recorded',
        studentId: 'student-daria',
        status: 'received',
        createdAt: '2026-04-19T09:55:00.000Z',
        displayName: 'Payment payment-1',
        details: {
          paymentId: 'payment-1',
          amountMinor: 120000,
          currency: 'USD',
          receivedAt: '2026-04-19',
        },
      },
      {
        type: 'business_settings_updated',
        studentId: 'student-daria',
        status: 'updated',
        createdAt: '2026-04-18T09:55:00.000Z',
        displayName: 'Business settings',
        details: {
          workspaceId: 'workspace-1',
          defaultCurrency: 'USD',
        },
      },
      {
        type: 'reminder_hidden',
        studentId: 'student-daria',
        status: 'lesson_followup',
        createdAt: '2026-04-17T09:55:00.000Z',
        displayName: 'Hidden lesson follow-up reminder',
        details: {
          lessonId: 'lesson-1',
          reminderKey: 'lesson_followup:lesson-1',
        },
      },
    ],
    total: 11,
    limit: 100,
    offset: 0,
    order: 'desc',
  });

  apiMocks.listStudentProfileCandidates.mockResolvedValue({
    studentId: 'student-daria',
    items: [
      {
        id: 'candidate-dropped-1',
        studentId: 'student-daria',
        proposedFact: 'Already uses English in client meetings.',
        approvedFactText: null,
        category: 'work',
        targetSection: 'work_communication_context',
        sourceSummary: 'Client practice',
        authority: 'teacher_confirmed',
        confidence: 'high',
        evidence: [],
        sourceSnapshotId: 'snapshot-1',
        sourceLessonMemoryIds: ['lesson-memory-2'],
        sourceLessonId: 'lesson-2',
        sourceLessonStartedAt: '2026-04-18T08:00:00.000Z',
        sourceLessonTitle: 'Client practice',
        sourceMemoryIds: ['lesson-memory-2'],
        provenance: {
          sourceKind: 'latest_lesson_memory',
        },
        dedupDecision: {
          decision: 'duplicate',
          reason: 'Existing profile candidate already covers this fact.',
        },
        status: 'rejected',
        reviewState: 'rejected',
        createdAt: '2026-04-18T08:30:00.000Z',
        updatedAt: '2026-04-18T08:30:00.000Z',
      },
    ],
    total: 1,
    limit: 100,
    offset: 0,
    order: 'desc',
  });
}

function renderHistory() {
  return render(
    <MemoryRouter initialEntries={['/students/student-daria/history']}>
      <StudentHistoryPage />
    </MemoryRouter>,
  );
}

describe('StudentHistoryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedHistoryContext();
    seedHistoryMocks();
  });

  it('renders a teacher-readable chronological ledger from memory and timeline sources', async () => {
    renderHistory();

    expect(await screen.findByText('About this history')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Daria' })).toBeNull();
    expect(screen.queryByText('Student ID: daria')).toBeNull();
    expect(screen.getByText('About this history')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Lessons' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Homework' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Profile' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Materials' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Billing' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Business' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Operations' })).toBeTruthy();

    expect(screen.getByText('Lesson memory created')).toBeTruthy();
    expect(
      screen.getByText(
        'Practiced expanding ideas with connectors and natural phrasing in workplace stories.',
      ),
    ).toBeTruthy();
    expect(screen.getAllByText('Fluency with natural expression').length).toBeGreaterThan(0);
    expect(screen.getByText('duration pending · format pending')).toBeTruthy();
    expect(screen.getByText('Homework assigned')).toBeTruthy();
    expect(screen.getByText('Speaking practice: Tell a personal story')).toBeTruthy();
    expect(screen.getByText('2 tasks')).toBeTruthy();
    expect(screen.getByText('Profile revision activated')).toBeTruthy();
    expect(screen.getByText('Material generated')).toBeTruthy();
    expect(screen.getByText('Rerun requested')).toBeTruthy();
    expect(screen.getByText('Lesson completed')).toBeTruthy();
    expect(screen.getByText('Lesson credits added')).toBeTruthy();
    expect(screen.getByText('Payment received')).toBeTruthy();
    expect(screen.getByText('Business settings updated')).toBeTruthy();
    expect(screen.getByText('Reminder hidden')).toBeTruthy();
    expect(screen.getByText('Profile candidate dropped as duplicate')).toBeTruthy();
    expect(screen.getAllByText(/^\d{2}:\d{2}$/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/\b(?:AM|PM)\b/)).toBeNull();
    expect(screen.queryByText('recording_ingested')).toBeNull();
    expect(screen.queryByText('transcript_ready')).toBeNull();
    expect(screen.queryByText('job_completed')).toBeNull();
    const visibleTags = [...document.querySelectorAll('.student-history-tags span')].map(
      (element) => element.textContent,
    );
    expect(visibleTags).not.toContain('legacy_normalization');
    expect(visibleTags).not.toContain('candidate_promotion');
    expect(visibleTags).not.toContain('deprecated');
    expect(visibleTags).not.toContain('succeeded');

    expect(apiMocks.getStudentTimeline).toHaveBeenCalledWith('student-daria', {
      limit: 100,
      offset: 0,
      order: 'desc',
    });
    expect(apiMocks.listStudentLessonMemoryEntries).toHaveBeenCalledWith('student-daria', {
      status: 'ready',
      limit: 60,
      offset: 0,
      order: 'desc',
    });
    expect(apiMocks.listStudentHomeworkMemoryEntries).toHaveBeenCalledWith('student-daria', {
      status: 'ready',
      limit: 60,
      offset: 0,
      order: 'desc',
    });
    expect(apiMocks.listStudentProfileCandidates).toHaveBeenCalledWith('student-daria', {
      limit: 100,
      offset: 0,
      order: 'desc',
    });
  });

  it('filters the ledger by teacher-facing event domain', async () => {
    const user = userEvent.setup();
    renderHistory();

    expect(await screen.findByText('Lesson memory created')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Homework' }));

    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Homework' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByText('Homework assigned')).toBeTruthy();
    expect(screen.queryByText('Lesson memory created')).toBeNull();
    expect(screen.queryByText('Profile revision activated')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Profile' }));

    expect(screen.getByText('Profile revision activated')).toBeTruthy();
    expect(screen.queryByText('Homework assigned')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Billing' }));

    expect(screen.getByText('Lesson credits added')).toBeTruthy();
    expect(screen.getByText('Payment received')).toBeTruthy();
    expect(screen.queryByText('Profile revision activated')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Business' }));

    expect(screen.getByText('Business settings updated')).toBeTruthy();
    expect(screen.queryByText('Payment received')).toBeNull();
  });

  it('shows a non-readable pending canvas while history sources resolve', async () => {
    const lessonDeferred =
      createDeferred<Awaited<ReturnType<typeof apiMocks.listStudentLessonMemoryEntries>>>();
    apiMocks.listStudentLessonMemoryEntries.mockReturnValue(lessonDeferred.promise);

    renderHistory();

    expect(screen.getByTestId('student-history-pending-canvas')).toBeTruthy();
    expect(document.querySelector('.student-history-pending-hero')).toBeNull();
    expect(document.querySelector('.skeleton-portrait')).toBeNull();
    expect(screen.queryByText('Loading history')).toBeNull();
    expect(screen.queryByText('No history yet')).toBeNull();
    expect(screen.queryByText('Lesson memory created')).toBeNull();

    lessonDeferred.resolve({
      studentId: 'student-daria',
      items: [],
      limit: 60,
      offset: 0,
      order: 'desc',
      statuses: ['ready'],
    });

    expect(await screen.findByText('Homework assigned')).toBeTruthy();
  });

  it('keeps partial history visible when one source fails', async () => {
    apiMocks.getStudentTimeline.mockRejectedValue(new Error('Timeline unavailable'));

    renderHistory();

    expect(await screen.findByText('Lesson memory created')).toBeTruthy();
    expect(screen.getByText('Some history context could not be loaded.')).toBeTruthy();
    expect(screen.queryByText('Profile revision activated')).toBeNull();
  });

  it('renders a calm empty state when no history sources have entries', async () => {
    apiMocks.getStudentTimeline.mockResolvedValue({
      items: [],
      total: 0,
      limit: 100,
      offset: 0,
      order: 'desc',
    });
    apiMocks.listStudentLessonMemoryEntries.mockResolvedValue({
      studentId: 'student-daria',
      items: [],
      limit: 60,
      offset: 0,
      order: 'desc',
      statuses: ['ready'],
    });
    apiMocks.listStudentHomeworkMemoryEntries.mockResolvedValue({
      studentId: 'student-daria',
      items: [],
      limit: 60,
      offset: 0,
      order: 'desc',
      statuses: ['ready'],
    });
    apiMocks.listStudentProfileCandidates.mockResolvedValue({
      studentId: 'student-daria',
      items: [],
      total: 0,
      limit: 100,
      offset: 0,
      order: 'desc',
    });

    renderHistory();

    expect(await screen.findByText('History will collect here')).toBeTruthy();
    expect(
      screen.getByText(
        'Lesson, homework, profile, material, billing, business, and operations events will appear as this student works through the new flow.',
      ),
    ).toBeTruthy();
  });
});
