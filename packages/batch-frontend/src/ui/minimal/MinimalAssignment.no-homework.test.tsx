// @vitest-environment jsdom

import { fireEvent } from '@testing-library/react';
import { beforeEach, describe, it } from 'vitest';

import { isTranscriptFinishApplied } from './MinimalAssignment.no-homework';
import {
  testApi as api,
  createMinimalUser,
  testExpect as expect,
  makeAssignmentSession,
  makeRecording,
  makeTranscript,
  renderMinimalAssignment,
  testScreen as screen,
  setupMinimalAssignmentTest,
  startNewAssignmentForLearner,
  testVi as vi,
  testWaitFor as waitFor,
} from './MinimalAssignment.test-harness';

async function freshSource() {
  const user = createMinimalUser();
  renderMinimalAssignment();
  await startNewAssignmentForLearner(user);
  fireEvent.click(screen.getByRole('button', { name: /Drop audio file/i }));
  await screen.findByDisplayValue('Student transcript text');
  return user;
}

async function review() {
  const user = await freshSource();
  await user.click(screen.getByRole('checkbox', { name: 'No homework for this lesson' }));
  await user.click(await screen.findByRole('button', { name: 'Review transcript' }));
  await screen.findByRole('heading', { name: 'Review & finish' });
  return user;
}

function finishedSession() {
  const session = makeAssignmentSession({
    homeworkIntent: 'none',
    recordingId: 'rec-1',
    transcriptId: 'tx-1',
    confirmedStep: 'source',
    revision: 7,
    transcriptCompletedAt: '2026-10-07T00:00:00.000Z',
    completionKind: 'transcript_only',
    transcriptProcessing: { lessonMemory: 'ready', snapshot: 'failed', enrichment: 'not_eligible' },
  });
  return {
    ...session,
    transcriptCompletionHistory: [
      {
        completedAt: session.transcriptCompletedAt!,
        expectedRevision: 6,
        resultingRevision: 7,
        studentId: session.studentId,
        source: session.confirmed.source!,
      },
    ],
  };
}

describe('no-homework lesson workflow', () => {
  beforeEach(setupMinimalAssignmentTest);

  it('defaults unchecked and saves none intent without confirmation, then finishes the exact reviewed version', async () => {
    const user = await freshSource();
    expect(
      (screen.getByRole('checkbox', { name: 'No homework for this lesson' }) as HTMLInputElement)
        .checked,
    ).toBe(false);
    await user.click(screen.getByRole('checkbox', { name: 'No homework for this lesson' }));
    await user.click(await screen.findByRole('button', { name: 'Review transcript' }));
    const transcript = await screen.findByRole('textbox', { name: 'Reviewed transcript' });
    expect((transcript as HTMLTextAreaElement).readOnly).toBe(true);
    expect(api.confirmAssignmentSessionStep).not.toHaveBeenCalled();
    expect(api.finishTranscriptAssignmentSession).not.toHaveBeenCalled();
    const skipped = document.querySelectorAll('[data-status="skipped"]');
    expect(skipped).toHaveLength(2);
    expect([...skipped].every((step) => step.textContent?.includes('Skipped'))).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Confirm transcript and finish' }));
    await screen.findByRole('heading', { name: 'Transcript confirmed — no homework planned' });
    expect(api.finishTranscriptAssignmentSession).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        recordingId: 'rec-1',
        transcriptId: 'tx-1',
        transcriptWorkingVersion: 1,
        transcriptHash: 'a'.repeat(64),
        lessonId: null,
      }),
    );
    expect(api.createPromptPackage).not.toHaveBeenCalled();
    expect(api.generateDraft).not.toHaveBeenCalled();
    expect(api.shareAssignmentSession).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: /Preview assignment|Share assignment/i }),
    ).toBeNull();
  });

  it('saves transcript edits before review and back skips Context/Create without confirming', async () => {
    const user = await freshSource();
    vi.mocked(api.updateRecordingTranscript).mockImplementation(async (_id, text, version) =>
      makeTranscript({ text, workingVersion: version + 1, contentHash: 'b'.repeat(64) }),
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Transcript text' }), {
      target: { value: 'Edited source text' },
    });
    await user.click(screen.getByRole('checkbox', { name: 'No homework for this lesson' }));
    await user.click(await screen.findByRole('button', { name: 'Review transcript' }));
    expect(
      ((await screen.findByRole('textbox', { name: 'Reviewed transcript' })) as HTMLTextAreaElement)
        .value,
    ).toBe('Edited source text');
    expect(api.updateRecordingTranscript).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByRole('textbox', { name: 'Transcript text' });
    expect(api.confirmAssignmentSessionStep).not.toHaveBeenCalled();
  });

  it('unchecks during review and retains the normal Source confirmation boundary', async () => {
    const user = await review();
    await user.click(screen.getByRole('checkbox', { name: 'No homework for this lesson' }));
    await user.click(await screen.findByRole('button', { name: 'Confirm and continue' }));
    await screen.findByRole('heading', { name: /Learner context/i });
    expect(api.confirmAssignmentSessionStep).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ step: 'source' }),
    );
    expect(api.finishTranscriptAssignmentSession).not.toHaveBeenCalled();
  });

  it('restores saved unfinished none after refresh and still requires final finish', async () => {
    const session = makeAssignmentSession({
      id: 'resumed-none',
      homeworkIntent: 'none',
      recordingId: 'rec-1',
      transcriptId: 'tx-1',
    });
    vi.mocked(api.fetchAssignmentSession).mockResolvedValue(session);
    globalThis.history.replaceState(null, '', '/?sessionId=resumed-none');
    const user = createMinimalUser();
    renderMinimalAssignment();
    const checkbox = await screen.findByRole('checkbox', { name: 'No homework for this lesson' });
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Review transcript' }));
    await screen.findByRole('heading', { name: 'Review & finish' });
    expect(api.confirmAssignmentSessionStep).not.toHaveBeenCalled();
    expect(api.finishTranscriptAssignmentSession).not.toHaveBeenCalled();
  });

  it('opens a finished entry without a Share job and presents separate truthful processing states', async () => {
    vi.mocked(api.fetchAssignmentSession).mockResolvedValue(finishedSession());
    globalThis.history.replaceState(null, '', '/?sessionId=session-1');
    renderMinimalAssignment();
    await screen.findByRole('heading', { name: 'Transcript confirmed — no homework planned' });
    expect(screen.getByText('failed')).toBeTruthy();
    expect(screen.getByText('not eligible')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Confirm transcript and finish' })).toBeNull();
    expect(api.getJobStatus).not.toHaveBeenCalled();
    expect(api.updateAssignmentSessionRecovery).not.toHaveBeenCalled();
  });

  it('allows an eligible already-confirmed Source but explains why downstream work cannot switch', async () => {
    const session = makeAssignmentSession({
      id: 'confirmed-source',
      recordingId: 'rec-1',
      transcriptId: 'tx-1',
      confirmedStep: 'source',
    });
    vi.mocked(api.fetchAssignmentSession).mockResolvedValue(session);
    globalThis.history.replaceState(null, '', '/?sessionId=confirmed-source');
    const user = createMinimalUser();
    renderMinimalAssignment();
    await user.click(await screen.findByRole('button', { name: /Lesson source$/i }));
    const checkbox = await screen.findByRole('checkbox', { name: 'No homework for this lesson' });
    expect((checkbox as HTMLInputElement).disabled).toBe(false);
    await user.click(checkbox);
    await user.click(await screen.findByRole('button', { name: 'Review transcript' }));
    await screen.findByRole('heading', { name: 'Review & finish' });
    expect(api.confirmAssignmentSessionStep).not.toHaveBeenCalled();
  });

  it('requires a new review after another tab changes the reviewed source or intent', async () => {
    const user = await review();
    const latest = makeAssignmentSession({
      revision: 12,
      recordingId: 'rec-1',
      transcriptId: 'tx-1',
      confirmedStep: 'source',
    });
    vi.mocked(api.finishTranscriptAssignmentSession).mockRejectedValueOnce(
      new api.AssignmentSessionConflictApiError(latest),
    );
    await user.click(screen.getByRole('button', { name: 'Confirm transcript and finish' }));
    await screen.findByRole('heading', { name: /Learner context/i });
    expect(
      screen.queryByRole('heading', { name: 'Transcript confirmed — no homework planned' }),
    ).toBeNull();
    expect(api.confirmAssignmentSessionStep).not.toHaveBeenCalled();
  });

  it('disables the choice with an explanation when Context work already exists', async () => {
    vi.mocked(api.fetchAssignmentSession).mockResolvedValue(
      makeAssignmentSession({
        id: 'with-context',
        recordingId: 'rec-1',
        transcriptId: 'tx-1',
        confirmedStep: 'context',
      }),
    );
    globalThis.history.replaceState(null, '', '/?sessionId=with-context');
    const user = createMinimalUser();
    renderMinimalAssignment();
    await user.click(await screen.findByRole('button', { name: /Lesson source$/i }));
    expect(
      (screen.getByRole('checkbox', { name: 'No homework for this lesson' }) as HTMLInputElement)
        .disabled,
    ).toBe(true);
    expect(
      screen.getByText(/Homework has already started. Existing teaching context/),
    ).toBeTruthy();
    expect(api.finishTranscriptAssignmentSession).not.toHaveBeenCalled();
  });

  it('promotes using the same owner and reselecting none stays unfinished until explicit finish', async () => {
    const user = await review();
    await user.click(screen.getByRole('button', { name: 'Confirm transcript and finish' }));
    await user.click(await screen.findByRole('button', { name: 'Create homework' }));
    await screen.findByRole('heading', { name: /Learner context/i });
    expect(api.startHomeworkAssignmentSession).toHaveBeenCalledWith('session-1', expect.anything());
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(await screen.findByRole('checkbox', { name: 'No homework for this lesson' }));
    await user.click(await screen.findByRole('button', { name: 'Review transcript' }));
    await screen.findByRole('heading', { name: 'Review & finish' });
    expect(api.finishTranscriptAssignmentSession).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Confirm transcript and finish' }));
    await screen.findByRole('heading', { name: 'Transcript confirmed — no homework planned' });
    expect(api.finishTranscriptAssignmentSession).toHaveBeenCalledTimes(2);
  });

  it('recovers a lost finish response only for the exact current operation', async () => {
    const user = await review();
    const real = vi.mocked(api.finishTranscriptAssignmentSession).getMockImplementation()!;
    vi.mocked(api.finishTranscriptAssignmentSession).mockImplementationOnce(async (id, request) => {
      const response = await real(id, request);
      vi.mocked(api.fetchAssignmentSession).mockResolvedValue(response.session);
      throw new Error('Response lost');
    });
    await user.click(screen.getByRole('button', { name: 'Confirm transcript and finish' }));
    await screen.findByRole('heading', { name: 'Transcript confirmed — no homework planned' });
    expect(api.finishTranscriptAssignmentSession).toHaveBeenCalledTimes(1);
  });

  it('preserves an ambiguous operation for retry when status cannot be fetched', async () => {
    const user = await review();
    vi.mocked(api.finishTranscriptAssignmentSession).mockRejectedValueOnce(
      new Error('Response lost'),
    );
    vi.mocked(api.fetchAssignmentSession).mockRejectedValueOnce(new Error('Offline'));
    await user.click(screen.getByRole('button', { name: 'Confirm transcript and finish' }));
    await screen.findByText(/Retry to check the same operation/i);
    const first = vi.mocked(api.finishTranscriptAssignmentSession).mock.calls[0]?.[1];
    await user.click(screen.getByRole('button', { name: 'Confirm transcript and finish' }));
    await screen.findByRole('heading', { name: 'Transcript confirmed — no homework planned' });
    expect(vi.mocked(api.finishTranscriptAssignmentSession).mock.calls[1]?.[1]).toEqual(first);
  });

  it('keeps unchanged reviewed content retryable after a confirmed pre-commit failure', async () => {
    const user = await review();
    vi.mocked(api.finishTranscriptAssignmentSession).mockRejectedValueOnce(
      new Error('Transaction rolled back'),
    );
    await user.click(screen.getByRole('button', { name: 'Confirm transcript and finish' }));
    await screen.findByText(/Could not finish this transcript: Transaction rolled back/);
    expect(screen.getByRole('heading', { name: 'Review & finish' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Confirm transcript and finish' }));
    await screen.findByRole('heading', { name: 'Transcript confirmed — no homework planned' });
  });

  it('lets the tutor retry a failed choice save', async () => {
    const user = await freshSource();
    vi.mocked(api.updateAssignmentSessionRecovery).mockRejectedValueOnce(new Error('Offline'));
    await user.click(screen.getByRole('checkbox', { name: 'No homework for this lesson' }));
    await screen.findByText(/Could not save this step: Offline/);
    await user.click(screen.getByRole('checkbox', { name: 'No homework for this lesson' }));
    await screen.findByRole('button', { name: 'Review transcript' });
    expect(
      (screen.getByRole('checkbox', { name: 'No homework for this lesson' }) as HTMLInputElement)
        .checked,
    ).toBe(true);
  });

  it.each(['edited', 'replaced'] as const)(
    'reviews a %s source after promotion and re-entry instead of treating old history as completion',
    async (change) => {
      const user = await review();
      await user.click(screen.getByRole('button', { name: 'Confirm transcript and finish' }));
      await user.click(await screen.findByRole('button', { name: 'Create homework' }));
      await screen.findByRole('heading', { name: /Learner context/i });
      await user.click(screen.getByRole('button', { name: 'Back' }));
      if (change === 'edited') {
        vi.mocked(api.updateRecordingTranscript).mockImplementation(async (_id, text, version) =>
          makeTranscript({ text, workingVersion: version + 1, contentHash: 'b'.repeat(64) }),
        );
        fireEvent.change(screen.getByRole('textbox', { name: 'Transcript text' }), {
          target: { value: 'Second exact source' },
        });
      } else {
        vi.mocked(api.getRecording).mockImplementation(async (id) =>
          makeRecording({
            recordingId: id,
            transcriptId: id === 'rec-2' ? 'tx-2' : 'tx-1',
            studentId: 'student-alex',
            status: 'transcribed',
          }),
        );
        vi.mocked(api.uploadRecording).mockResolvedValue(
          makeRecording({ recordingId: 'rec-2', transcriptId: 'tx-2', studentId: 'student-alex' }),
        );
        vi.mocked(api.fetchRecordingTranscript).mockResolvedValue(
          makeTranscript({
            recordingId: 'rec-2',
            transcriptId: 'tx-2',
            text: 'Second exact source',
            contentHash: 'b'.repeat(64),
          }),
        );
        await user.click(screen.getByRole('button', { name: /Replace audio/i }));
        fireEvent.click(screen.getByRole('button', { name: /Drop replacement audio/i }));
        await screen.findByDisplayValue('Second exact source');
      }
      await user.click(screen.getByRole('checkbox', { name: 'No homework for this lesson' }));
      await user.click(await screen.findByRole('button', { name: 'Review transcript' }));
      await screen.findByRole('heading', { name: 'Review & finish' });
      expect(
        (screen.getByRole('textbox', { name: 'Reviewed transcript' }) as HTMLTextAreaElement).value,
      ).toBe('Second exact source');
      expect(api.finishTranscriptAssignmentSession).toHaveBeenCalledTimes(1);
      await user.click(screen.getByRole('button', { name: 'Confirm transcript and finish' }));
      await screen.findByRole('heading', { name: 'Transcript confirmed — no homework planned' });
      expect(api.finishTranscriptAssignmentSession).toHaveBeenLastCalledWith(
        'session-1',
        expect.objectContaining({
          recordingId: change === 'replaced' ? 'rec-2' : 'rec-1',
          transcriptHash: 'b'.repeat(64),
        }),
      );
    },
  );

  it('finds an unlinked finished result through history without adding it to unfinished sessions', async () => {
    vi.mocked(api.listAssignmentSessions).mockImplementation(async (_limit, scope) =>
      scope === 'history'
        ? { sessions: [finishedSession()], total: 1, limit: _limit ?? 20 }
        : { sessions: [], total: 0, limit: _limit ?? 20 },
    );
    vi.mocked(api.fetchAssignmentSession).mockResolvedValue(finishedSession());
    const user = createMinimalUser();
    renderMinimalAssignment();
    await user.click(screen.getByText('Confirmed transcript results'));
    await user.click(await screen.findByRole('button', { name: /View transcript/i }));
    await screen.findByRole('heading', { name: 'Transcript confirmed — no homework planned' });
    expect(api.listAssignmentSessions).toHaveBeenCalledWith(20, 'history', 0);
  });

  it('pages past fifty mixed history entries using server offsets and preserves every transcript result', async () => {
    const history = Array.from({ length: 65 }, (_, index) =>
      index === 21 || index === 61
        ? { ...finishedSession(), id: `result-${index}` }
        : makeAssignmentSession({
            id: `shared-${index}`,
            confirmedStep: 'share',
            shareJobId: `job-${index}`,
          }),
    );
    vi.mocked(api.listAssignmentSessions).mockImplementation(
      async (limit = 20, scope, offset = 0) =>
        scope === 'history'
          ? { sessions: history.slice(offset, offset + limit), total: history.length, limit }
          : { sessions: [], total: 0, limit },
    );
    const user = createMinimalUser();
    renderMinimalAssignment();
    await user.click(screen.getByText('Confirmed transcript results'));
    await user.click(await screen.findByRole('button', { name: 'Show older results' }));
    await screen.findByRole('button', { name: /View transcript/ });
    await user.click(screen.getByRole('button', { name: 'Show older results' }));
    await user.click(await screen.findByRole('button', { name: 'Show older results' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Show older results' })).toBeNull(),
    );
    expect(screen.getAllByRole('button', { name: /View transcript/ })).toHaveLength(2);
    expect(
      vi.mocked(api.listAssignmentSessions).mock.calls.filter((call) => call[1] === 'history'),
    ).toEqual([
      [20, 'history', 0],
      [20, 'history', 20],
      [20, 'history', 40],
      [20, 'history', 60],
    ]);
  });

  it('does not interpret historical matching evidence or a different expected revision as current success', () => {
    const session = finishedSession();
    const request = {
      expectedRevision: 6,
      lessonId: null,
      recordingId: 'rec-1',
      transcriptId: 'tx-1',
      transcriptWorkingVersion: 1,
      transcriptHash: makeTranscript().contentHash,
    };
    expect(isTranscriptFinishApplied(session, request)).toBe(true);
    expect(isTranscriptFinishApplied(session, { ...request, expectedRevision: 2 })).toBe(false);
    expect(
      isTranscriptFinishApplied(
        { ...session, homeworkIntent: 'create', transcriptCompletedAt: null },
        request,
      ),
    ).toBe(false);
    expect(isTranscriptFinishApplied({ ...session, transcriptCompletedAt: null }, request)).toBe(
      false,
    );
  });
});
