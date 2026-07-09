import type { InternalAxiosRequestConfig } from 'axios';
import { AxiosError } from 'axios';
import { describe, expect, it } from 'vitest';

import { createFrontendSandboxApiAdapter } from './frontend-sandbox-api';

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
  it('serves seeded students through the same endpoint shape as the real API', async () => {
    const adapter = createFrontendSandboxApiAdapter();

    const response = await adapter(requestConfig('get', '/api/config/students'));

    expect(response.status).toBe(200);
    expect(response.data).toEqual({
      students: [
        { id: 'student-alex', name: 'Alex', profileId: 'profiles/alex.md' },
        { id: 'student-bella', name: 'Bella', profileId: 'profiles/bella.md' },
        { id: 'student-cora', name: 'Cora Preview', profileId: null },
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
          profileId: 'profiles/alex.md',
        }),
      ]),
      total: 2,
    });
    expect(student.data).toMatchObject({
      id: 'student-alex',
      student: 'Alex',
      profileId: 'profiles/alex.md',
    });
    expect(learning.data).toMatchObject({
      profile: expect.objectContaining({ id: 'profiles/alex.md' }),
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
      bindings: {
        items: [expect.objectContaining({ studentId: 'student-alex' })],
      },
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
      requestConfig('get', '/api/profiles/revisions', undefined, {
        profileId: 'profiles/cora.md',
      }),
    );
    const revision = await adapter(
      requestConfig('get', '/api/profiles/revisions/profile-revision-cora-first-draft', undefined, {
        profileId: 'profiles/cora.md',
      }),
    );
    const activated = await adapter(
      requestConfig('post', '/api/profiles/revisions/profile-revision-cora-first-draft/activate', {
        profileId: 'profiles/cora.md',
      }),
    );

    expect(students.data).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({
          id: 'student-cora',
          student: 'Cora Preview',
          profileId: null,
        }),
      ]),
      total: 2,
    });
    expect(student.data).toMatchObject({
      id: 'student-cora',
      student: 'Cora Preview',
      profileId: null,
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
      currentStage: 'context',
    });
    expect(recording.data).toMatchObject({
      recordingId: 'recording-cora',
      transcriptId: 'transcript-cora',
      studentId: 'student-cora',
    });
    expect(transcript.data.text).toContain('Cora practiced a short client update');
    expect(populated.data).toMatchObject({
      draftRevisionId: 'profile-revision-cora-first-draft',
      profileId: 'profiles/cora.md',
      lessonMemoryIds: ['lesson-memory-cora'],
      homeworkMemoryIds: [],
      draftRevision: expect.objectContaining({
        id: 'profile-revision-cora-first-draft',
        profileId: 'profiles/cora.md',
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
      profileId: 'profiles/cora.md',
      status: 'draft',
      structuredContent: expect.objectContaining({
        overallLevel: 'A2',
      }),
    });
    expect(activated.data).toMatchObject({
      id: 'profiles/cora.md',
      currentRevisionId: 'profile-revision-cora-first-draft',
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
      requestConfig('post', '/api/profiles/revisions', {
        profileId: 'profiles/alex.md',
        structuredContent: refresh.data.draftRevision.structuredContent,
        inheritCandidateLinksFromRevisionId: refresh.data.draftRevision.id,
      }),
    );
    const activated = await adapter(
      requestConfig('post', `/api/profiles/revisions/${saved.data.id}/activate`, {
        profileId: 'profiles/alex.md',
      }),
    );

    expect(populated.data).toMatchObject({
      draftRevisionId: 'profile-revision-sandbox-first-draft',
      profileId: 'profiles/alex.md',
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
      id: 'profiles/alex.md',
      currentRevisionId: 'profile-revision-sandbox-saved-draft',
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
    expect(draft.data.text).toContain('Workplace Update Practice');
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
});
