import type { InternalAxiosRequestConfig } from 'axios';
import { AxiosError } from 'axios';
import { describe, expect, it } from 'vitest';

import { createFrontendSandboxApiAdapter } from './frontend-sandbox-api';

function requestConfig(method: string, url: string, data?: unknown): InternalAxiosRequestConfig {
  return {
    method,
    url,
    data,
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
      items: [{ id: 'student-alex', student: 'Alex', profileId: 'profiles/alex.md' }],
      total: 1,
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
