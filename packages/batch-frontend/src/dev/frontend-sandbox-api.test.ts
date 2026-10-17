import type { InternalAxiosRequestConfig } from 'axios';
import { AxiosError } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFrontendSandboxApiAdapter } from './frontend-sandbox-api';

afterEach(() => {
  vi.useRealTimers();
});

function requestConfig(
  method: string,
  url: string,
  data?: unknown,
  params?: Record<string, unknown>,
): InternalAxiosRequestConfig {
  return {
    method,
    url,
    data,
    params,
    headers: {} as InternalAxiosRequestConfig['headers'],
  };
}

describe('frontend sandbox API adapter', () => {
  it('serves the Business preview and persists hide/undo and status changes within one sandbox', async () => {
    const adapter = createFrontendSandboxApiAdapter();
    const initial = await adapter(requestConfig('get', '/api/business/schedule'));
    const lesson = initial.data.lessons[0];
    await adapter(
      requestConfig('patch', `/api/students/${lesson.studentId}/lessons/${lesson.id}`, {
        status: 'completed',
        consumesCredit: true,
      }),
    );
    const reminder = initial.data.reminders[0];
    await adapter(
      requestConfig(
        'put',
        `/api/students/${reminder.studentId}/operations/reminders/lesson-followup/${reminder.lessonId}/hide`,
      ),
    );
    const hidden = await adapter(requestConfig('get', '/api/business/schedule'));
    expect(hidden.data.lessons[0].status).toBe('completed');
    expect(
      hidden.data.reminders.some(
        (item: { lessonId?: string }) => item.lessonId === reminder.lessonId,
      ),
    ).toBe(false);
    expect(hidden.data.latestHiddenReminder.lessonId).toBe(reminder.lessonId);
    await adapter(
      requestConfig(
        'put',
        `/api/students/${reminder.studentId}/operations/reminders/latest-hidden/undo`,
      ),
    );
    const restored = await adapter(requestConfig('get', '/api/business/schedule'));
    expect(
      restored.data.reminders.some(
        (item: { lessonId?: string }) => item.lessonId === reminder.lessonId,
      ),
    ).toBe(true);
    expect(restored.data.latestHiddenReminder).toBeNull();
  });

  it('creates and serves a manual transcript source', async () => {
    const adapter = createFrontendSandboxApiAdapter();

    const created = await adapter(
      requestConfig('post', '/api/recordings/transcript-source', {
        studentId: 'student-alex',
        text: 'Existing lesson transcript',
        displayName: 'Lesson on travel',
      }),
    );
    const transcript = await adapter(
      requestConfig('get', '/api/recordings/recording-manual-sandbox/transcript'),
    );

    expect(created.data).toMatchObject({
      recordingId: 'recording-manual-sandbox',
      transcriptId: 'transcript-manual-sandbox',
      status: 'transcribed',
      source: 'manual_transcript',
      studentId: 'student-alex',
      displayName: 'Lesson on travel',
    });
    expect(transcript.data).toMatchObject({
      recordingId: 'recording-manual-sandbox',
      transcriptId: 'transcript-manual-sandbox',
      text: 'Existing lesson transcript',
      sttProvider: 'manual',
      model: 'manual-entry',
    });
  });

  it('serves seeded students through the same endpoint shape as the real API', async () => {
    const adapter = createFrontendSandboxApiAdapter();

    const response = await adapter(requestConfig('get', '/api/config/students'));

    expect(response.status).toBe(200);
    expect(response.data).toEqual({
      students: [
        { id: 'student-alex', name: 'Alex' },
        { id: 'student-bella', name: 'Bella' },
        { id: 'student-cora', name: 'Cora Preview' },
      ],
    });
  });

  it('serves a routed student and learning surface for the browser sandbox', async () => {
    const adapter = createFrontendSandboxApiAdapter();

    const students = await adapter(requestConfig('get', '/api/students?limit=200&status=active'));
    const student = await adapter(requestConfig('get', '/api/students/student-alex'));
    const learning = await adapter(
      requestConfig('get', '/api/students/student-alex/surfaces/learning'),
    );

    expect(students.data).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          id: 'student-alex',
          student: 'Alex',
        }),
      ]),
      total: 2,
    });
    expect(student.data).toMatchObject({
      id: 'student-alex',
      student: 'Alex',
    });
    expect(learning.data).toMatchObject({
      profile: expect.objectContaining({ studentId: 'student-alex' }),
      revisions: {
        items: expect.arrayContaining([
          expect.objectContaining({ id: 'profile-revision-sandbox', status: 'active' }),
          expect.objectContaining({ id: 'profile-revision-sandbox-v4', status: 'deprecated' }),
        ]),
      },
      memory: expect.objectContaining({
        studentId: 'student-alex',
        latestReadyStudentMemorySnapshot: expect.objectContaining({
          id: 'snapshot-sandbox',
          status: 'ready',
        }),
      }),
      candidates: {
        items: [
          expect.objectContaining({
            id: 'candidate-sandbox-work-context',
            proposedFact: 'Uses English for project updates with product and client teams.',
            targetSection: 'work_communication_context',
          }),
          expect.objectContaining({
            id: 'candidate-sandbox-study-preference',
            proposedFact: 'Prefers short practical review loops.',
            targetSection: 'learning_preferences_study_habits',
          }),
          expect.objectContaining({
            id: 'candidate-sandbox-interests-deferred',
            proposedFact: 'May enjoy product-design vocabulary tasks.',
            targetSection: 'interests_personal_context',
          }),
          expect.objectContaining({
            id: 'candidate-sandbox-rejected',
            proposedFact: 'Needs long grammar lectures before each assignment.',
            targetSection: 'learning_preferences_study_habits',
          }),
          expect.objectContaining({
            id: 'candidate-sandbox-promoted',
            proposedFact: 'Uses role-play to prepare for client conversations.',
            targetSection: 'learning_preferences_study_habits',
          }),
        ],
      },
    });
  });

  it('serves a no-profile first-lesson path for assignment-flow UI iteration', async () => {
    const adapter = createFrontendSandboxApiAdapter();

    const students = await adapter(requestConfig('get', '/api/students?limit=200&status=active'));
    const student = await adapter(requestConfig('get', '/api/students/student-cora'));
    const health = await adapter(requestConfig('get', '/api/students/student-cora/memory/health'));
    const confirmed = await adapter(
      requestConfig('post', '/api/students/student-cora/lesson-memory/requests', {
        recordingId: 'recording-cora',
        transcriptId: 'transcript-cora',
        lessonId: null,
      }),
    );
    const healthAfterConfirm = await adapter(
      requestConfig('get', '/api/students/student-cora/memory/health'),
    );
    const session = await adapter(requestConfig('get', '/api/assignment-sessions/session-cora'));
    const recording = await adapter(
      requestConfig('post', '/api/recordings/upload', undefined, { studentId: 'student-cora' }),
    );
    const transcript = await adapter(
      requestConfig('get', '/api/recordings/recording-cora/transcript'),
    );
    const populated = await adapter(
      requestConfig('post', '/api/students/student-cora/profile-drafts/populate-first-from-lesson'),
    );
    const revisions = await adapter(
      requestConfig('get', '/api/students/student-cora/profile/revisions'),
    );
    const revision = await adapter(
      requestConfig(
        'get',
        '/api/students/student-cora/profile/revisions/profile-revision-cora-first-draft',
        undefined,
        {},
      ),
    );
    const activated = await adapter(
      requestConfig(
        'post',
        '/api/students/student-cora/profile/revisions/profile-revision-cora-first-draft/activate',
        {},
      ),
    );

    expect(students.data).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          id: 'student-cora',
          student: 'Cora Preview',
        }),
      ]),
      total: 2,
    });
    expect(student.data).toMatchObject({
      id: 'student-cora',
      student: 'Cora Preview',
    });
    expect(health.data).toMatchObject({
      studentId: 'student-cora',
      memoryCounts: { lesson: { ready: { count: 0 } } },
    });
    expect(confirmed.data).toMatchObject({
      outcome: 'created',
      lessonMemoryEntryId: 'lesson-memory-cora',
    });
    expect(healthAfterConfirm.data).toMatchObject({
      studentId: 'student-cora',
      memoryCounts: { lesson: { pending: { count: 1 } } },
    });
    expect(session.data).toMatchObject({
      id: 'session-cora',
      studentId: 'student-cora',
      recordingId: 'recording-cora',
      transcriptId: 'transcript-cora',
      confirmedStep: 'source',
      revision: 2,
    });
    expect(recording.data).toMatchObject({
      recordingId: 'recording-cora',
      transcriptId: 'transcript-cora',
      studentId: 'student-cora',
    });
    expect(transcript.data.text).toContain('Cora practiced a short client update');
    expect(populated.data).toMatchObject({
      draftRevisionId: 'profile-revision-cora-first-draft',
      studentId: 'student-cora',
      lessonMemoryIds: ['lesson-memory-cora'],
      homeworkMemoryIds: [],
      draftRevision: expect.objectContaining({
        id: 'profile-revision-cora-first-draft',
        studentId: 'student-cora',
        status: 'draft',
        source: 'lesson_population',
        structuredContent: expect.objectContaining({
          overallLevel: 'A2',
          primaryGoals: ['Give short client updates with confidence.'],
        }),
      }),
    });
    expect(revisions.data).toMatchObject({
      items: [
        expect.objectContaining({
          id: 'profile-revision-cora-first-draft',
          status: 'draft',
        }),
      ],
      total: 1,
    });
    expect(revision.data).toMatchObject({
      id: 'profile-revision-cora-first-draft',
      studentId: 'student-cora',
      status: 'draft',
      structuredContent: expect.objectContaining({
        overallLevel: 'A2',
      }),
    });
    expect(activated.data).toMatchObject({
      studentId: 'student-cora',
      id: 'profile-revision-cora-first-draft',
      structuredContent: expect.objectContaining({
        overallLevel: 'A2',
      }),
    });
  });

  it('creates prompt and draft responses so the browser sandbox can reach review state', async () => {
    const adapter = createFrontendSandboxApiAdapter();

    const prompt = await adapter(
      requestConfig('post', '/api/recordings/recording-sandbox/prompt-package'),
    );
    const draft = await adapter(
      requestConfig('post', '/api/generation/drafts', {
        promptPackageId: prompt.data.id,
      }),
    );

    expect(prompt.data.text).toContain('[STUDENT_MEMORY_SNAPSHOT]');
    expect(draft.data).toMatchObject({
      id: 'draft-sandbox',
      promptPackageId: 'prompt-sandbox',
      text: expect.stringContaining('Alex'),
    });
  });

  it('serves profile draft review endpoints for local Learning page UI iteration', async () => {
    const adapter = createFrontendSandboxApiAdapter();

    const populated = await adapter(
      requestConfig('post', '/api/students/student-alex/profile-drafts/populate-first-from-lesson'),
    );
    const refresh = await adapter(
      requestConfig(
        'post',
        '/api/students/student-alex/profile-drafts/refresh-from-approved-candidates',
        { candidateIds: ['candidate-sandbox-study-preference'] },
      ),
    );
    const saved = await adapter(
      requestConfig('post', '/api/students/student-alex/profile/revisions', {
        structuredContent: refresh.data.draftRevision.structuredContent,
        inheritCandidateLinksFromRevisionId: refresh.data.draftRevision.id,
      }),
    );
    const activated = await adapter(
      requestConfig(
        'post',
        `/api/students/student-alex/profile/revisions/${saved.data.id}/activate`,
        {},
      ),
    );

    expect(populated.data).toMatchObject({
      draftRevisionId: 'profile-revision-sandbox-first-draft',
      studentId: 'student-alex',
      snapshotId: 'snapshot-sandbox',
      lessonMemoryIds: ['lesson-memory-sandbox'],
      homeworkMemoryIds: ['homework-memory-sandbox'],
      draftRevision: expect.objectContaining({
        id: 'profile-revision-sandbox-first-draft',
        status: 'draft',
        source: 'lesson_population',
        structuredContent: expect.objectContaining({
          overallLevel: 'B1',
          primaryGoals: expect.arrayContaining([
            'Practice concise workplace updates from recent lessons.',
          ]),
        }),
      }),
    });
    expect(refresh.data).toMatchObject({
      draftRevisionId: 'profile-revision-sandbox-draft',
      includedCandidateIds: ['candidate-sandbox-study-preference'],
      draftRevision: expect.objectContaining({
        id: 'profile-revision-sandbox-draft',
        status: 'draft',
        source: 'profile_revision_refresh',
        structuredContent: expect.objectContaining({
          studyPreferences: expect.arrayContaining(['Prefers short practical review loops.']),
        }),
      }),
    });
    expect(saved.data).toMatchObject({
      id: 'profile-revision-sandbox-saved-draft',
      status: 'draft',
      structuredContent: refresh.data.draftRevision.structuredContent,
    });
    expect(activated.data).toMatchObject({
      studentId: 'student-alex',
      id: 'profile-revision-sandbox-saved-draft',
      status: 'active',
    });
  });

  it('serves a completed resume fixture for the all-stages-unlocked sandbox path', async () => {
    const adapter = createFrontendSandboxApiAdapter();

    const jobs = await adapter(requestConfig('get', '/api/user/jobs'));
    const job = await adapter(requestConfig('get', '/api/jobs/job-sandbox'));
    const prompt = await adapter(requestConfig('get', '/api/prompt-packages/prompt-sandbox'));
    const draft = await adapter(requestConfig('get', '/api/drafts/draft-sandbox'));
    const provenance = await adapter(requestConfig('get', '/api/jobs/job-sandbox/provenance'));

    expect(jobs.data).toMatchObject({
      jobs: [expect.objectContaining({ jobId: 'job-sandbox', state: 'succeeded' })],
      total: 1,
    });
    expect(job.data).toMatchObject({
      jobId: 'job-sandbox',
      recordingId: 'recording-sandbox',
      transcriptId: 'transcript-sandbox',
      promptPackageId: 'prompt-sandbox',
      draftId: 'draft-sandbox',
    });
    expect(prompt.data.text).toContain('[STUDENT_MEMORY_SNAPSHOT]');
    expect(draft.data.format).toBe('assignment_v1');
    expect(JSON.parse(draft.data.text).schemaVersion).toBe(1);
    expect(provenance.data).toMatchObject({
      job: expect.objectContaining({ id: 'job-sandbox', state: 'succeeded' }),
      promptPackage: expect.objectContaining({ id: 'prompt-sandbox' }),
      draft: expect.objectContaining({ id: 'draft-sandbox' }),
    });
  });

  it('returns a 404-style Axios error for uncovered endpoints', async () => {
    const adapter = createFrontendSandboxApiAdapter();

    await expect(adapter(requestConfig('get', '/api/not-covered'))).rejects.toMatchObject({
      name: AxiosError.name,
      response: {
        status: 404,
        data: {
          error: 'sandbox_endpoint_not_implemented',
        },
      },
    });
  });

  it('uses the default Step 1 seeded responses when no scenario is selected', async () => {
    const adapter = createFrontendSandboxApiAdapter();

    const students = await adapter(requestConfig('get', '/api/config/students'));
    const jobs = await adapter(requestConfig('get', '/api/user/jobs'));
    const sessions = await adapter(requestConfig('get', '/api/user/assignment-sessions'));

    expect(students.data.students).toHaveLength(3);
    expect(jobs.data.jobs).toEqual([expect.objectContaining({ state: 'succeeded' })]);
    expect(sessions.data.sessions).toEqual([
      expect.objectContaining({ confirmedStep: 'source', revision: 2 }),
    ]);
  });

  it('returns empty recent work for the no-recent Step 1 scenario', async () => {
    const adapter = createFrontendSandboxApiAdapter({ scenario: 'step-one-no-recent' });

    await expect(adapter(requestConfig('get', '/api/user/jobs'))).resolves.toMatchObject({
      data: { jobs: [], total: 0 },
    });
    await expect(
      adapter(requestConfig('get', '/api/user/assignment-sessions')),
    ).resolves.toMatchObject({
      data: { sessions: [], total: 0 },
    });
  });

  it('returns every Step 1 resume status alongside a resumable session', async () => {
    const adapter = createFrontendSandboxApiAdapter({ scenario: 'step-one-resume-states' });

    const jobs = await adapter(requestConfig('get', '/api/user/jobs'));
    const sessions = await adapter(requestConfig('get', '/api/user/assignment-sessions'));

    expect(jobs.data.jobs.map((job: { state: string }) => job.state)).toEqual([
      'queued',
      'running',
      'awaiting_approval',
      'succeeded',
      'succeeded',
      'failed',
    ]);
    expect(jobs.data.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ jobId: 'job-sandbox-published', htmlUrl: expect.any(String) }),
        expect.objectContaining({ jobId: 'job-sandbox-unpublished', htmlUrl: null }),
      ]),
    );
    expect(sessions.data.sessions).toEqual([
      expect.objectContaining({ id: 'session-sandbox-resume', confirmedStep: 'source' }),
    ]);
  });

  it('mirrors revisioned assignment recovery, confirmation, and Share routes', async () => {
    const adapter = createFrontendSandboxApiAdapter();

    const created = await adapter(
      requestConfig('post', '/api/assignment-sessions/confirm-student', {
        requestId: 'request-1',
        studentId: 'student-alex',
      }),
    );
    const recovered = await adapter(
      requestConfig('patch', '/api/assignment-sessions/session-sandbox/recovery', {
        expectedRevision: 2,
        patch: { teacherNotes: 'Recovered automatically' },
      }),
    );
    const confirmed = await adapter(
      requestConfig('post', '/api/assignment-sessions/session-sandbox/confirm', {
        step: 'context',
        expectedRevision: 2,
        teacherNotes: 'Recovered automatically',
        profileRevisionId: null,
        profileRevisionHash: null,
      }),
    );
    const shared = await adapter(
      requestConfig('post', '/api/assignment-sessions/session-sandbox/share', {
        expectedRevision: 3,
        requestId: 'job-sandbox',
      }),
    );

    expect(created.data).toMatchObject({ confirmedStep: 'student', revision: 1 });
    expect(recovered.data).toMatchObject({
      confirmedStep: 'source',
      revision: 3,
      teacherNotes: 'Recovered automatically',
    });
    expect(confirmed.data).toMatchObject({
      session: {
        confirmedStep: 'context',
        confirmed: { context: { teacherNotes: 'Recovered automatically' } },
      },
      invalidated: [],
    });
    expect(shared.data).toMatchObject({
      session: { confirmedStep: 'share', shareJobId: 'job-sandbox' },
      job: { jobId: 'job-sandbox' },
    });
  });

  it('returns contextual sandbox collection errors for the error scenarios', async () => {
    const recentWorkAdapter = createFrontendSandboxApiAdapter({
      scenario: 'step-one-resume-error',
    });
    const learnerAdapter = createFrontendSandboxApiAdapter({ scenario: 'step-one-learner-error' });

    await expect(recentWorkAdapter(requestConfig('get', '/api/user/jobs'))).rejects.toThrow(
      'Sandbox recent work is unavailable for this scenario.',
    );
    await expect(learnerAdapter(requestConfig('get', '/api/config/students'))).rejects.toThrow(
      'Sandbox learners are unavailable for this scenario.',
    );
  });

  it('returns an empty learner collection for the no-learners Step 1 scenario', async () => {
    const adapter = createFrontendSandboxApiAdapter({ scenario: 'step-one-no-learners' });

    await expect(adapter(requestConfig('get', '/api/config/students'))).resolves.toMatchObject({
      data: { students: [] },
    });
  });

  it('delays Step 1 collections and assignment opens only for the slow scenario', async () => {
    vi.useFakeTimers();
    const adapter = createFrontendSandboxApiAdapter({ scenario: 'step-one-slow' });
    const request = adapter(requestConfig('get', '/api/user/assignment-sessions'));
    let settled = false;
    void request.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(1499);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(request).resolves.toMatchObject({ data: { sessions: expect.any(Array) } });

    const assignmentOpen = adapter(requestConfig('get', '/api/assignment-sessions/session-cora'));
    await vi.advanceTimersByTimeAsync(1500);
    await expect(assignmentOpen).resolves.toMatchObject({ data: { id: 'session-cora' } });
  });
});
