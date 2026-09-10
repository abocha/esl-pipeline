import { act, fireEvent } from '@testing-library/react';
import { describe, it } from 'vitest';

import {
  testApi as api,
  createMinimalUser,
  testExpect as expect,
  makeAssignmentSession,
  makeJobStatus,
  renderMinimalAssignment,
  testScreen as screen,
  setupMinimalAssignmentTest,
  testVi as vi,
  testWaitFor as waitFor,
} from './MinimalAssignment.test-harness';

function prepareCompletedSession() {
  const status = makeJobStatus({
    state: 'succeeded',
    assignmentSessionId: 'session-completed',
    studentId: 'student-alex',
    promptPackageId: 'prompt-1',
    draftId: 'draft-1',
    htmlUrl: 'https://example.test/assignment',
  });
  const session = makeAssignmentSession({
    id: 'session-completed',
    studentId: 'student-alex',
    recordingId: 'rec-1',
    transcriptId: 'tx-1',
    promptPackageId: 'prompt-1',
    draftId: 'draft-1',
    confirmedStep: 'share',
    shareJobId: 'job-1',
  });
  vi.mocked(api.listAssignmentSessions).mockResolvedValue({ sessions: [], total: 0, limit: 20 });
  vi.mocked(api.listUserJobs).mockResolvedValue({ jobs: [status], total: 1, limit: 20, offset: 0 });
  vi.mocked(api.fetchAssignmentSession).mockResolvedValue(session);
  vi.mocked(api.getJobStatus).mockResolvedValue(status);
  vi.mocked(api.fetchPromptPackage).mockResolvedValue({
    id: 'prompt-1',
    recordingId: 'rec-1',
    transcriptId: 'tx-1',
    studentId: 'student-alex',
    lessonId: null,
    profilePath: null,
    templateVersion: 'v1',
    notes: null,
    storageUri: 'memory://prompt-1',
    text: 'Prompt package output',
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
  });
  vi.mocked(api.fetchDraft).mockResolvedValue({
    id: 'draft-1',
    promptPackageId: 'prompt-1',
    studentId: 'student-alex',
    lessonId: null,
    storageUri: 'memory://draft-1',
    createdBy: 'user-1',
    text: '# Published draft',
    workingVersion: 1,
    contentHash: 'b'.repeat(64),
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
  });
  return status;
}

describe('MinimalAssignment post-share correction UI', () => {
  it('opens a completed session in reference mode with an explicit correction entry', async () => {
    setupMinimalAssignmentTest();
    const user = createMinimalUser();
    prepareCompletedSession();

    renderMinimalAssignment();
    await user.click(await screen.findByRole('button', { name: /Resume recent work/i }));
    await user.click((await screen.findAllByRole('radio'))[0]!);
    await user.click(
      screen.getByRole('button', { name: /Review assignment|Review progress|Open assignment/i }),
    );

    await screen.findByRole('heading', { name: /Review and share/i });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Correct published assignment/i })).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: /Confirm and continue/i })).toBeNull();
    await user.click(screen.getByRole('button', { name: /Step 4Create/i }));
    const referenceDraft = screen.getByRole('textbox', { name: /Draft markdown/i });
    expect((referenceDraft as HTMLTextAreaElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: /Review & share/i }));
    await user.click(screen.getByRole('button', { name: /Correct published assignment/i }));
    const correctionDraft = screen.getByRole('textbox', { name: /Draft markdown/i });
    expect((correctionDraft as HTMLTextAreaElement).disabled).toBe(false);
    expect(screen.queryByRole('button', { name: /Generate assignment/i })).toBeNull();
  });

  it('offers same-identity publication recovery instead of correction for a failed root', async () => {
    setupMinimalAssignmentTest();
    const failed = prepareCompletedSession();
    const user = createMinimalUser();
    const failedRoot = { ...failed, state: 'failed' as const, htmlUrl: null, error: 'cancelled' };
    vi.mocked(api.listUserJobs).mockResolvedValue({
      jobs: [failedRoot],
      total: 1,
      limit: 20,
      offset: 0,
    });
    vi.mocked(api.getJobStatus).mockResolvedValue(failedRoot);
    vi.mocked(api.shareAssignmentSession).mockResolvedValue({
      session: makeAssignmentSession({
        id: 'session-completed',
        studentId: 'student-alex',
        recordingId: 'rec-1',
        transcriptId: 'tx-1',
        promptPackageId: 'prompt-1',
        draftId: 'draft-1',
        confirmedStep: 'share',
        shareJobId: 'job-1',
      }),
      job: { ...failedRoot, state: 'queued', error: null },
    });

    renderMinimalAssignment();
    await user.click(await screen.findByRole('button', { name: /Resume recent work/i }));
    await user.click((await screen.findAllByRole('radio'))[0]!);
    await user.click(
      screen.getByRole('button', {
        name: /Review assignment|Review progress|Open assignment|Review issue/i,
      }),
    );

    const retry = await screen.findByRole('button', { name: /Retry publication/i });
    expect(screen.queryByRole('button', { name: /Correct published assignment/i })).toBeNull();
    await user.click(retry);
    await waitFor(() => {
      expect(api.shareAssignmentSession).toHaveBeenCalledWith('session-completed', {
        expectedRevision: 1,
        requestId: 'job-1',
      });
    });
    expect(api.publishAssignmentCorrection).not.toHaveBeenCalled();
    expect(api.updateAssignmentSessionRecovery).not.toHaveBeenCalled();
  });

  it('reloads a valid publication ancestor instead of recovering a failed correction child', async () => {
    setupMinimalAssignmentTest();
    const root = prepareCompletedSession();
    const user = createMinimalUser();
    const failedChild = makeJobStatus({
      jobId: 'child-1',
      assignmentSessionId: 'session-completed',
      sourceJobId: 'job-1',
      studentId: 'student-alex',
      promptPackageId: 'prompt-1',
      draftId: 'draft-1',
      state: 'failed',
      publishTarget: 'html',
      htmlUrl: null,
      error: 'correction failed',
    });
    vi.mocked(api.listUserJobs).mockResolvedValue({
      jobs: [failedChild],
      total: 1,
      limit: 20,
      offset: 0,
    });
    let ancestorLoads = 0;
    vi.mocked(api.getJobStatus).mockImplementation(async (jobId) => {
      if (jobId === 'child-1') return failedChild;
      ancestorLoads += 1;
      return { ...root };
    });

    renderMinimalAssignment();
    await user.click(await screen.findByRole('button', { name: /Resume recent work/i }));
    await user.click((await screen.findAllByRole('radio'))[0]!);
    await user.click(screen.getByRole('button', { name: /Review issue/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Correct published assignment/i })).toBeTruthy();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByRole('button', { name: /Retry publication/i })).toBeNull();
    expect(api.getJobStatus).toHaveBeenCalledWith('job-1');
    expect(ancestorLoads).toBe(1);
  });

  it('drains draft autosave and publishes the authoritative saved version/hash', async () => {
    setupMinimalAssignmentTest();
    prepareCompletedSession();
    const user = createMinimalUser();
    const updatedDraft = {
      id: 'draft-1',
      promptPackageId: 'prompt-1',
      studentId: 'student-alex',
      lessonId: null,
      storageUri: 'memory://draft-1',
      createdBy: 'user-1',
      text: '# Corrected draft',
      workingVersion: 2,
      contentHash: 'c'.repeat(64),
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    };
    vi.mocked(api.updateDraft).mockResolvedValue(updatedDraft);
    vi.mocked(api.publishAssignmentCorrection)
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockResolvedValueOnce({
        job: makeJobStatus({ jobId: 'child-1', state: 'queued' }),
      });

    renderMinimalAssignment();
    await user.click(await screen.findByRole('button', { name: /Resume recent work/i }));
    await user.click((await screen.findAllByRole('radio'))[0]!);
    await user.click(
      screen.getByRole('button', { name: /Review assignment|Review progress|Open assignment/i }),
    );
    await screen.findByRole('heading', { name: /Review and share/i });
    await user.click(screen.getByRole('button', { name: /Correct published assignment/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /Draft markdown/i }), {
      target: { value: '# Corrected draft' },
    });
    await user.click(screen.getByRole('button', { name: /Review & share/i }));
    await screen.findByRole('heading', { name: /Review and share/i });
    await waitFor(() => {
      const publishButton = screen.getByRole('button', { name: /Publish corrected version/i });
      expect((publishButton as HTMLButtonElement).disabled).toBe(false);
    });
    await user.click(screen.getByRole('button', { name: /Publish corrected version/i }));
    await screen.findByText(/Network Error/i);
    await user.click(screen.getByRole('button', { name: /Step 4Create/i }));
    expect(screen.getByRole('textbox', { name: /Draft markdown/i })).toHaveProperty(
      'value',
      '# Corrected draft',
    );
    const firstRequest = vi.mocked(api.publishAssignmentCorrection).mock.calls[0]?.[1];
    expect(firstRequest).toMatchObject({
      draftId: 'draft-1',
      draftWorkingVersion: 2,
      draftHash: 'c'.repeat(64),
    });
    await user.click(screen.getByRole('button', { name: /Review & share/i }));
    await screen.findByRole('heading', { name: /Review and share/i });
    await waitFor(() => {
      const publishButton = screen.getByRole('button', { name: /Publish corrected version/i });
      expect((publishButton as HTMLButtonElement).disabled).toBe(false);
    });
    await user.click(screen.getByRole('button', { name: /Publish corrected version/i }));
    await waitFor(() => {
      expect(api.publishAssignmentCorrection).toHaveBeenCalledTimes(2);
      expect(vi.mocked(api.publishAssignmentCorrection).mock.calls[1]?.[1]).toEqual(firstRequest);
    });
    expect(screen.getAllByText('Job ID: child-1').length).toBeGreaterThan(0);
    expect(api.confirmAssignmentSessionStep).not.toHaveBeenCalled();
    expect(api.updateAssignmentSessionRecovery).not.toHaveBeenCalled();
    expect(api.shareAssignmentSession).not.toHaveBeenCalled();
  });

  it('preserves local correction text and requires reconciliation after a stale-draft conflict', async () => {
    setupMinimalAssignmentTest();
    prepareCompletedSession();
    const user = createMinimalUser();
    vi.mocked(api.updateDraft).mockResolvedValue({
      id: 'draft-1',
      promptPackageId: 'prompt-1',
      studentId: 'student-alex',
      lessonId: null,
      storageUri: 'memory://draft-1-v2',
      createdBy: 'user-1',
      text: '# Corrected draft',
      workingVersion: 2,
      contentHash: 'c'.repeat(64),
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:01:00.000Z',
    });
    vi.mocked(api.publishAssignmentCorrection).mockRejectedValue(
      new Error('HTTP 409: assignment_correction_draft_conflict'),
    );
    vi.mocked(api.fetchDraft).mockResolvedValue({
      id: 'draft-1',
      promptPackageId: 'prompt-1',
      studentId: 'student-alex',
      lessonId: null,
      storageUri: 'memory://draft-1-v3',
      createdBy: 'user-1',
      text: '# Newer saved draft',
      workingVersion: 3,
      contentHash: 'd'.repeat(64),
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:02:00.000Z',
    });

    renderMinimalAssignment();
    await user.click(await screen.findByRole('button', { name: /Resume recent work/i }));
    await user.click((await screen.findAllByRole('radio'))[0]!);
    await user.click(
      screen.getByRole('button', { name: /Review assignment|Review progress|Open assignment/i }),
    );
    await screen.findByRole('heading', { name: /Review and share/i });
    await user.click(screen.getByRole('button', { name: /Correct published assignment/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /Draft markdown/i }), {
      target: { value: '# Corrected draft' },
    });
    await user.click(screen.getByRole('button', { name: /Review & share/i }));
    await waitFor(() => {
      expect(
        (screen.getByRole('button', { name: /Publish corrected version/i }) as HTMLButtonElement)
          .disabled,
      ).toBe(false);
    });
    await user.click(screen.getByRole('button', { name: /Publish corrected version/i }));
    await screen.findByText(/assignment_correction_draft_conflict/i);
    await user.click(screen.getByRole('button', { name: /Step 4Create/i }));

    expect(screen.getByRole('textbox', { name: /Draft markdown/i })).toHaveProperty(
      'value',
      '# Corrected draft',
    );
    expect(screen.getByText(/Newer saved draft work was found/i)).toBeTruthy();
    expect(api.fetchDraft).toHaveBeenCalledWith('draft-1');
  });
});
