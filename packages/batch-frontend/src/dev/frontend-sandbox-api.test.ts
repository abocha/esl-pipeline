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
