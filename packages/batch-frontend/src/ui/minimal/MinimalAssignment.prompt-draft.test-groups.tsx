import { fireEvent, within } from '@testing-library/react';
import { beforeEach, describe, it } from 'vitest';

import {
  testAct as act,
  advanceSourceToCreate,
  advanceSourceToTeachingContext,
  testApi as api,
  createMinimalUser,
  createTimerAwareMinimalUser,
  testExpect as expect,
  makeAssignmentSession,
  makeRecording,
  makeScheduleBillingSurface,
  makeStudentLesson,
  now,
  openRecordingSettings,
  renderMinimalAssignment,
  renderPromptReadyAssignment,
  testScreen as screen,
  setupMinimalAssignmentTest,
  startNewAssignmentForLearner,
  testVi as vi,
  testWaitFor as waitFor,
} from './MinimalAssignment.test-harness';
import {
  assignmentArtifact,
  makeAssignmentText,
  requestEnvelope,
  typedDraftFields,
} from './MinimalAssignment.typed-test-fixtures';

const PROMPT_DRAFT_TEST_TIMEOUT_MS = 15_000;

async function renderResumedDraftSession(user = createMinimalUser()) {
  const session = makeAssignmentSession({
    id: 'session-teacher-notes',
    studentId: 'student-alex',
    recordingId: 'rec-1',
    transcriptId: 'tx-1',
    promptPackageId: 'pkg-1',
    draftId: 'draft-1',
    confirmedStep: 'context',
  });
  vi.mocked(api.listAssignmentSessions).mockResolvedValueOnce({
    sessions: [session],
    total: 1,
    limit: 20,
  });
  vi.mocked(api.fetchAssignmentSession).mockResolvedValue(session);
  vi.mocked(api.updateAssignmentSessionRecovery).mockImplementation(async (id, request) =>
    makeAssignmentSession({
      ...session,
      id,
      ...request.patch,
      revision: request.expectedRevision + 1,
    }),
  );
  globalThis.history.replaceState(null, '', '/?sessionId=session-teacher-notes');
  renderMinimalAssignment();
  await screen.findByRole('button', { name: /^(Generate assignment|Regenerate)$/i });
  return user;
}

export function registerPromptEditorTests() {
  describe('MinimalAssignment - prompt editor flows', {
    timeout: PROMPT_DRAFT_TEST_TIMEOUT_MS,
  }, () => {
    beforeEach(() => {
      setupMinimalAssignmentTest();
    });

    it('confirms changed teacher notes only when the resumed draft context is committed', async () => {
      const user = await renderResumedDraftSession();
      await user.click(screen.getByRole('button', { name: /Teaching context/i }));
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: /Teaching context/i }).getAttribute('aria-current'),
        ).toBe('step'),
      );

      const notes = screen.getByRole('textbox', { name: /Lesson guidance/i });
      await user.clear(notes);
      await user.type(notes, 'Focus on articles.');

      await user.click(
        screen.getByRole('button', { name: /Confirm and continue|Continue to Create/i }),
      );

      await waitFor(() => {
        expect(api.updateAssignmentSessionRecovery).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            expectedRevision: expect.any(Number),
            patch: expect.objectContaining({ teacherNotes: 'Focus on articles.' }),
          }),
        );
        expect(api.confirmAssignmentSessionStep).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ step: 'context', teacherNotes: 'Focus on articles.' }),
        );
      });
    });

    it('keeps changed teacher notes and Teaching context when confirmation fails', async () => {
      const user = await renderResumedDraftSession();
      vi.mocked(api.confirmAssignmentSessionStep).mockRejectedValueOnce(
        new Error('confirmation failed'),
      );
      await user.click(screen.getByRole('button', { name: /Teaching context/i }));
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: /Teaching context/i }).getAttribute('aria-current'),
        ).toBe('step'),
      );

      const notes = screen.getByRole('textbox', { name: /Lesson guidance/i });
      await user.type(notes, 'Focus on articles.');
      await user.click(
        screen.getByRole('button', { name: /Confirm and continue|Continue to Create/i }),
      );

      expect(
        (screen.getByRole('textbox', { name: /Lesson guidance/i }) as HTMLTextAreaElement).value,
      ).toBe('Focus on articles.');
      expect(screen.getByRole('heading', { name: /Learner context/i })).toBeTruthy();
      expect(api.confirmAssignmentSessionStep).toHaveBeenCalled();
      expect((await screen.findByRole('alert')).textContent).toContain(
        'Could not confirm this step: confirmation failed',
      );
    });

    it('preserves the existing draft when saving changed teacher notes fails', async () => {
      const user = await renderResumedDraftSession();
      vi.mocked(api.updateAssignmentSessionRecovery).mockRejectedValueOnce(
        new Error('save failed'),
      );
      await user.click(screen.getByRole('button', { name: /Teaching context/i }));
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: /Teaching context/i }).getAttribute('aria-current'),
        ).toBe('step'),
      );

      await user.type(
        screen.getByRole('textbox', { name: /Lesson guidance/i }),
        'Focus on articles.',
      );
      await user.click(
        screen.getByRole('button', { name: /Confirm and continue|Continue to Create/i }),
      );

      await waitFor(() => expect(api.updateAssignmentSessionRecovery).toHaveBeenCalled());
      expect(
        screen.getByRole('button', { name: /Teaching context/i }).getAttribute('aria-current'),
      ).toBe('step');
      expect(screen.getByText('Draft markdown')).toBeTruthy();
    });

    it('does not let a pending settings save restore stale teacher notes after commit', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = createTimerAwareMinimalUser();
      await renderPromptReadyAssignment({ user });
      await user.click(screen.getByRole('button', { name: /Teaching context/i }));
      await screen.findByRole('textbox', { name: /Lesson guidance/i });
      vi.mocked(api.updateAssignmentSessionRecovery).mockClear();
      vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
      fireEvent.change(screen.getByRole('textbox', { name: /Lesson guidance/i }), {
        target: { value: 'Focus on articles.' },
      });
      await user.click(
        screen.getByRole('button', { name: /Confirm and continue|Continue to Create/i }),
      );
      await waitFor(() =>
        expect(api.updateAssignmentSessionRecovery).toHaveBeenCalledWith(
          'session-1',
          expect.objectContaining({
            patch: expect.objectContaining({ teacherNotes: 'Focus on articles.' }),
          }),
        ),
      );
      const commitCallIndex = vi
        .mocked(api.updateAssignmentSessionRecovery)
        .mock.calls.findIndex(([, request]) => request.patch.teacherNotes === 'Focus on articles.');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });

      const writesAfterCommit = vi
        .mocked(api.updateAssignmentSessionRecovery)
        .mock.calls.slice(commitCallIndex + 1)
        .map(([, request]) => request.patch);
      expect(
        writesAfterCommit.some(
          (patch) => 'teacherNotes' in patch && patch.teacherNotes !== 'Focus on articles.',
        ),
      ).toBe(false);
    });

    it('preserves a newer Context edit queued while confirmation is in flight', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const user = await renderResumedDraftSession(createTimerAwareMinimalUser());
      await user.click(screen.getByRole('button', { name: /Teaching context/i }));
      const notes = await screen.findByRole('textbox', { name: /Lesson guidance/i });
      fireEvent.change(notes, { target: { value: 'Committed note' } });

      let resolveConfirmation!: (
        value: Awaited<ReturnType<typeof api.confirmAssignmentSessionStep>>,
      ) => void;
      vi.mocked(api.confirmAssignmentSessionStep).mockImplementationOnce(
        (_id, request) =>
          new Promise((resolve) => {
            resolveConfirmation = resolve;
            expect(request).toMatchObject({ step: 'context', teacherNotes: 'Committed note' });
          }),
      );

      await user.click(
        screen.getByRole('button', { name: /Confirm and continue|Continue to Create/i }),
      );
      await waitFor(() => expect(api.confirmAssignmentSessionStep).toHaveBeenCalledTimes(1));
      fireEvent.change(notes, { target: { value: 'Newer note' } });

      await act(async () => {
        resolveConfirmation({
          session: makeAssignmentSession({
            id: 'session-teacher-notes',
            studentId: 'student-alex',
            recordingId: 'rec-1',
            transcriptId: 'tx-1',
            promptPackageId: 'pkg-1',
            draftId: 'draft-1',
            confirmedStep: 'context',
            teacherNotes: 'Committed note',
          }),
          invalidated: ['prompt', 'draft', 'preview'],
        });
        await Promise.resolve();
      });
      expect(
        screen.getByRole('button', { name: /Teaching context/i }).getAttribute('aria-current'),
      ).toBe('step');
      expect((notes as HTMLTextAreaElement).value).toBe('Newer note');
      expect(
        screen.queryByRole('button', { name: /^(Generate assignment|Regenerate)$/i }),
      ).toBeNull();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_500);
      });
      expect(api.updateAssignmentSessionRecovery).toHaveBeenLastCalledWith(
        'session-teacher-notes',
        expect.objectContaining({
          patch: expect.objectContaining({ teacherNotes: 'Newer note' }),
        }),
      );
      vi.useRealTimers();
    });

    it('atomically clears durable prompt and draft ids before invalidated work can resume', async () => {
      const session = makeAssignmentSession({
        id: 'session-prompt-only',
        studentId: 'student-alex',
        recordingId: 'rec-1',
        transcriptId: 'tx-1',
        promptPackageId: 'pkg-old',
        draftId: null,
        confirmedStep: 'context',
      });
      let savedSession = session;
      vi.mocked(api.listAssignmentSessions).mockImplementation(async () => ({
        sessions: [savedSession],
        total: 1,
        limit: 20,
      }));
      vi.mocked(api.fetchAssignmentSession).mockImplementation(async () => savedSession);
      vi.mocked(api.updateAssignmentSessionRecovery).mockImplementation(async (id, request) => {
        savedSession = makeAssignmentSession({
          ...savedSession,
          id,
          ...request.patch,
          revision: request.expectedRevision + 1,
        });
        return savedSession;
      });
      vi.mocked(api.confirmAssignmentSessionStep).mockImplementationOnce(async (_id, request) => {
        savedSession = makeAssignmentSession({
          ...savedSession,
          promptPackageId: null,
          draftId: null,
          revision: request.expectedRevision + 1,
          confirmedStep: 'context',
          confirmed: {
            ...savedSession.confirmed,
            context: {
              teacherNotes: request.step === 'context' ? request.teacherNotes : null,
              material: request.step === 'context' ? request.material : undefined,
              profileRevisionId: request.step === 'context' ? request.profileRevisionId : null,
              profileRevisionHash: request.step === 'context' ? request.profileRevisionHash : null,
            },
            create: null,
          },
        });
        return { session: savedSession, invalidated: ['prompt', 'draft', 'preview'] };
      });
      globalThis.history.replaceState(null, '', '/?sessionId=session-prompt-only');
      const firstRender = renderMinimalAssignment();
      const user = createMinimalUser();
      await screen.findByRole('button', { name: /Teaching context/i });
      await user.click(screen.getByRole('button', { name: /Teaching context/i }));
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: /Teaching context/i }).getAttribute('aria-current'),
        ).toBe('step'),
      );
      await user.type(
        screen.getByRole('textbox', { name: /Lesson guidance/i }),
        'Focus on articles.',
      );
      await user.click(
        screen.getByRole('button', { name: /Confirm and continue|Continue to Create/i }),
      );

      await waitFor(() =>
        expect(api.confirmAssignmentSessionStep).toHaveBeenCalledWith(
          'session-prompt-only',
          expect.objectContaining({
            teacherNotes: 'Focus on articles.',
            step: 'context',
          }),
        ),
      );
      firstRender.unmount();
      vi.mocked(api.fetchPromptPackage).mockClear();
      vi.mocked(api.fetchDraft).mockClear();
      renderMinimalAssignment();
      await waitFor(() => expect(api.listAssignmentSessions).toHaveBeenCalledTimes(2));
      await screen.findByRole('button', { name: /^(Generate assignment|Regenerate)$/i });

      expect(api.fetchPromptPackage).not.toHaveBeenCalled();
      expect(api.fetchDraft).not.toHaveBeenCalled();
    });

    it('creates a fresh prompt with committed notes before generating after invalidation', async () => {
      const user = await renderResumedDraftSession();
      await user.click(screen.getByRole('button', { name: /Teaching context/i }));
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: /Teaching context/i }).getAttribute('aria-current'),
        ).toBe('step'),
      );
      await user.type(
        screen.getByRole('textbox', { name: /Lesson guidance/i }),
        'Focus on articles.',
      );
      vi.mocked(api.createPromptPackage).mockClear();
      vi.mocked(api.createPromptPackage).mockResolvedValueOnce({
        requestEnvelope,
        id: 'pkg-fresh',
        recordingId: 'rec-1',
        transcriptId: 'tx-1',
        studentId: null,
        lessonId: null,
        profilePath: null,
        templateVersion: 'v1',
        notes: 'Focus on articles.',
        storageUri: 'memory://prompt/pkg-fresh',
        text: 'Fresh prompt package output',
        createdAt: now,
        updatedAt: now,
      });
      vi.mocked(api.generateDraft).mockClear();
      vi.mocked(api.createDraft).mockClear();
      vi.mocked(api.updateDraft).mockClear();

      await user.click(
        screen.getByRole('button', { name: /Confirm and continue|Continue to Create/i }),
      );
      await screen.findByRole('button', { name: /^(Generate assignment|Regenerate)$/i });
      await user.click(screen.getByRole('button', { name: /^(Generate assignment|Regenerate)$/i }));

      await waitFor(() =>
        expect(api.createPromptPackage).toHaveBeenCalledWith(
          'rec-1',
          expect.objectContaining({
            assignmentSessionId: expect.any(String),
            templateId: 'tpl-default',
          }),
        ),
      );
      expect(api.generateDraft).toHaveBeenCalledWith(
        expect.objectContaining({ promptPackageId: 'pkg-fresh' }),
      );
      expect(api.generateDraft).not.toHaveBeenCalledWith(
        expect.objectContaining({ promptPackageId: 'pkg-1' }),
      );
      expect(api.createDraft).toHaveBeenCalledWith(
        'pkg-fresh',
        makeAssignmentText('# Generated assignment draft'),
      );
      expect(api.updateDraft).not.toHaveBeenCalled();
      expect(api.updateAssignmentSessionRecovery).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          patch: expect.objectContaining({ promptPackageId: 'pkg-fresh', draftId: 'draft-1' }),
        }),
      );
    });

    it('keeps the Create operation locked to one state while generation is running', async () => {
      let resolveGeneration:
        | ((value: Awaited<ReturnType<typeof api.generateDraft>>) => void)
        | null = null;
      vi.mocked(api.generateDraft).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveGeneration = resolve;
          }),
      );
      const user = await renderResumedDraftSession();

      await user.click(screen.getByRole('button', { name: /^(Generate assignment|Regenerate)$/i }));
      await screen.findByRole('button', { name: /Generating assignment/i });

      expect(
        screen
          .getByRole('textbox', { name: /^Assignment title$/i })
          .getAttribute('contenteditable'),
      ).toBe('false');
      await user.click(screen.getByRole('button', { name: /Teaching context/i }));
      expect(
        screen.getByRole('button', { name: /^Step 4Create$/i }).getAttribute('aria-current'),
      ).toBe('step');

      const completeGeneration = resolveGeneration as unknown as (
        value: Awaited<ReturnType<typeof api.generateDraft>>,
      ) => void;
      completeGeneration({
        ...typedDraftFields(makeAssignmentText('# Fresh generated assignment')),
        text: makeAssignmentText('# Fresh generated assignment'),
        provider: 'openai',
        model: 'gpt-5.2',
        quota: { source: 'hybrid', lastUpdatedAt: now },
      });
      await waitFor(() =>
        expect(
          screen
            .getByRole('textbox', { name: /^Assignment title$/i })
            .getAttribute('contenteditable'),
        ).toBe('true'),
      );
    });

    it('uploads an ordinary recording without a topology or provider override', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const user = createTimerAwareMinimalUser();
        renderMinimalAssignment();

        await startNewAssignmentForLearner(user);
        await user.click(screen.getByRole('button', { name: /Drop audio file/i }));

        await waitFor(() => {
          expect(api.uploadRecording).toHaveBeenCalledTimes(1);
        });
        const [, options] = vi.mocked(api.uploadRecording).mock.calls[0]!;
        expect(options).toEqual(expect.objectContaining({ studentId: 'student-alex' }));
        expect(options?.sttProvider).toBeUndefined();
        expect(options?.audioTopology).toBeUndefined();

        await waitFor(() => {
          expect(screen.getByText(/Recording: lesson\.mp3/i)).toBeTruthy();
        });
        expect(screen.getByText(/Status: Ready for review/i)).toBeTruthy();
      } finally {
        vi.useRealTimers();
      }
    });

    it('keeps the metadata-driven provider as an automatic upload default', async () => {
      const defaultOptions = await api.fetchJobOptions();
      vi.mocked(api.fetchJobOptions).mockReset();
      vi.mocked(api.fetchJobOptions).mockResolvedValueOnce({
        ...defaultOptions,
        sttProviders: ['google', 'deepgram'],
        defaultSttProvider: 'google',
      });

      const user = createMinimalUser();
      renderMinimalAssignment();

      await startNewAssignmentForLearner(user);
      openRecordingSettings();
      const sttProviderSelect = await screen.findByRole('combobox', {
        name: /Transcript engine/i,
      });
      await waitFor(() => {
        expect((sttProviderSelect as HTMLSelectElement).value).toBe('auto');
      });
      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));

      await waitFor(() => {
        expect(api.uploadRecording).toHaveBeenCalledTimes(1);
      });
      const [, options] = vi.mocked(api.uploadRecording).mock.calls[0]!;
      expect(options?.sttProvider).toBeUndefined();
      expect(options?.audioTopology).toBeUndefined();
    });

    it('keeps only Deepgram as a trusted split support override', async () => {
      const user = createMinimalUser();
      renderMinimalAssignment();

      await startNewAssignmentForLearner(user);
      openRecordingSettings();
      await user.selectOptions(
        screen.getByRole('combobox', { name: /Audio source/i }),
        'trusted_split_channels',
      );
      const sttProviderSelect = screen.getByRole('combobox', { name: /Transcript engine/i });
      expect(
        Array.from((sttProviderSelect as HTMLSelectElement).options).map((option) => option.value),
      ).toEqual(['auto', 'deepgram']);
      await user.selectOptions(sttProviderSelect, 'deepgram');
      await waitFor(() =>
        expect(
          (screen.getByRole('combobox', { name: /Transcript engine/i }) as HTMLSelectElement).value,
        ).toBe('deepgram'),
      );
      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));

      await waitFor(() => expect(api.uploadRecording).toHaveBeenCalledTimes(1));
      const [, options] = vi.mocked(api.uploadRecording).mock.calls[0]!;
      expect(options).toEqual(
        expect.objectContaining({
          audioTopology: 'trusted_split_channels',
          sttProvider: 'deepgram',
        }),
      );
    });

    it('resets an incompatible mixed support override to Automatic when switched to trusted split', async () => {
      const user = createMinimalUser();
      renderMinimalAssignment();

      await startNewAssignmentForLearner(user);
      openRecordingSettings();
      const sttProviderSelect = screen.getByRole('combobox', { name: /Transcript engine/i });
      await user.selectOptions(sttProviderSelect, 'elevenlabs');
      expect((sttProviderSelect as HTMLSelectElement).value).toBe('elevenlabs');

      await user.selectOptions(
        screen.getByRole('combobox', { name: /Audio source/i }),
        'trusted_split_channels',
      );

      expect(
        (screen.getByRole('combobox', { name: /Transcript engine/i }) as HTMLSelectElement).value,
      ).toBe('auto');
    });

    it('keeps ElevenLabs available as an ordinary mixed support override', async () => {
      const user = createMinimalUser();
      renderMinimalAssignment();

      await startNewAssignmentForLearner(user);
      openRecordingSettings();
      await user.selectOptions(
        screen.getByRole('combobox', { name: /Transcript engine/i }),
        'elevenlabs',
      );
      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));

      await waitFor(() => expect(api.uploadRecording).toHaveBeenCalledTimes(1));
      const [, options] = vi.mocked(api.uploadRecording).mock.calls[0]!;
      expect(options).toEqual(
        expect.objectContaining({
          sttProvider: 'elevenlabs',
          audioTopology: undefined,
        }),
      );
    });

    it('shows a cache-hit notice when transcript reuse is available', async () => {
      const user = createMinimalUser();
      vi.mocked(api.uploadRecording).mockResolvedValueOnce(
        makeRecording({
          cacheHit: true,
          cacheReason: 'transcript_reused',
        }),
      );
      renderMinimalAssignment();

      await startNewAssignmentForLearner(user);
      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));

      await waitFor(() => {
        expect(screen.getByText(/Reused an existing transcript/i)).toBeTruthy();
      });
    });

    it('shows a read-only learner profile preview and deep link instead of inline editing', async () => {
      const user = createMinimalUser();
      vi.mocked(api.fetchAssignmentLearnerContext).mockResolvedValue({
        assignmentSessionId: 'session-1',
        studentId: 'student-alex',
        source: { recordingId: 'rec-1', transcriptId: 'tx-1', transcriptHash: 'a'.repeat(64) },
        eligibility: 'already_enriched',
        state: 'not_applicable',
        operationState: null,
        profile: {
          studentId: 'student-alex',
          revisionId: 'revision-1',
          revisionHash: 'a'.repeat(64),
          content: 'PROFILE CONTENT',
          structuredContent: {
            schemaVersion: 'foundational_profile_v1',
            overallLevel: 'B1',
            primaryGoals: ['Lead project updates clearly.'],
            communicationContexts: ['Weekly team syncs.'],
            interestsAndUsefulThemes: ['Travel and films.'],
            stableStrengths: ['Strong listening comprehension.'],
            persistentChallenges: ['Needs more confident spoken transitions.'],
            studyPreferences: ['Prefers concise, practical homework.'],
            durableConstraints: [],
            teacherNotes: 'Use workplace examples.',
          },
          updatedAt: '2026-02-05T00:00:00.000Z',
        },
        pinned: null,
        confirmationAvailable: true,
        warning: null,
      });
      renderMinimalAssignment();

      await startNewAssignmentForLearner(user);
      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));
      await screen.findByDisplayValue('Student transcript text');
      await advanceSourceToTeachingContext(user);
      await screen.findByRole('heading', { name: /Learner context/i });

      expect(screen.queryByRole('textbox', { name: /Profile content/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /Save profile/i })).toBeNull();
      expect(screen.queryByText(/profiles\/alex\.md/i)).toBeNull();
      expect(screen.getAllByText(/^Edit in Learning$/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/Alex.*B1/)).toBeTruthy();
      await user.click(screen.getByText('More learner context'));
      expect(screen.getAllByText(/^Goals$/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/^Communication contexts$/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/^Strengths$/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/^Challenges$/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/^Study preferences$/i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Lead project updates clearly\./i).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Strong listening comprehension\./i).length).toBeGreaterThan(0);
      expect(
        screen.getAllByRole('link', { name: /Edit in Learning/i })[0]?.getAttribute('href'),
      ).toBe('/students/student-alex/learning');
    });

    it('shows a useful empty state when the selected student has no learner profile', async () => {
      const user = createMinimalUser();
      vi.mocked(api.fetchStudentOptions).mockResolvedValueOnce({
        students: [
          { id: 'student-alex', name: 'Alex' },
          { id: 'student-bella', name: 'Bella' },
        ],
      });

      renderMinimalAssignment();

      await startNewAssignmentForLearner(user);
      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));
      await screen.findByDisplayValue('Student transcript text');
      await advanceSourceToTeachingContext(user);

      await screen.findByText(/No structured Learning page context is available yet\./i);
      expect(screen.queryByRole('button', { name: /Use this transcript/i })).toBeNull();
      expect(screen.queryByText(/^Learner context ready$/i)).toBeNull();
      expect(
        screen.queryByRole('button', { name: /Populate first profile from lesson/i }),
      ).toBeNull();
      expect(screen.queryByText(/Lead project updates clearly\./i)).toBeNull();
    });

    it('treats a draft-only bound profile as unstructured learner context', async () => {
      const user = createMinimalUser();
      vi.mocked(api.fetchStudentOptions).mockResolvedValueOnce({
        students: [
          { id: 'student-alex', name: 'Alex' },
          { id: 'student-bella', name: 'Bella' },
        ],
      });

      renderMinimalAssignment();

      await startNewAssignmentForLearner(user);
      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));
      await screen.findByDisplayValue('Student transcript text');
      await advanceSourceToTeachingContext(user);

      await screen.findByText(/No structured Learning page context is available yet/i);
      expect(screen.queryByText(/^not_found$/i)).toBeNull();
      expect(screen.queryByRole('button', { name: /Use this transcript/i })).toBeNull();

      await user.click(
        screen.getByRole('button', { name: /Confirm and continue|Continue to Create/i }),
      );
      await screen.findByRole('button', { name: /^(Generate assignment|Regenerate)$/i });
      await user.click(screen.getByRole('button', { name: /^(Generate assignment|Regenerate)$/i }));

      await waitFor(() => {
        expect(api.createPromptPackage).toHaveBeenCalledWith(
          'rec-1',
          expect.objectContaining({
            assignmentSessionId: expect.any(String),
            templateId: 'tpl-default',
          }),
        );
      });
    });

    it('does not offer first-profile replacement when the bound profile preview fails to load', async () => {
      const user = createMinimalUser();
      vi.mocked(api.fetchStudentOptions).mockResolvedValueOnce({
        students: [
          { id: 'student-alex', name: 'Alex' },
          { id: 'student-bella', name: 'Bella' },
        ],
      });
      vi.mocked(api.fetchAssignmentLearnerContext).mockRejectedValue(
        new Error('Profile service is temporarily unavailable'),
      );

      renderMinimalAssignment();

      await startNewAssignmentForLearner(user);
      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));
      await screen.findByDisplayValue('Student transcript text');
      await advanceSourceToTeachingContext(user);

      await screen.findByText(/Profile service is temporarily unavailable/i);
      expect(
        screen.queryByRole('button', {
          name: /Use this transcript for Alex's learner context/i,
        }),
      ).toBeNull();
    });

    it('generates a prompt after transcript is ready', async () => {
      await renderPromptReadyAssignment();

      await waitFor(() => {
        expect(api.createPromptPackage).toHaveBeenCalledWith(
          'rec-1',
          expect.objectContaining({
            assignmentSessionId: expect.any(String),
            templateId: 'tpl-default',
          }),
        );
      });
      expect(
        screen.getByRole('button', { name: /^(Generate assignment|Regenerate)$/i }),
      ).toBeTruthy();
      expect(screen.getByRole('textbox', { name: /^Assignment title$/i })).toBeTruthy();
    });

    it('uses the default prompt template without exposing template selection', async () => {
      vi.mocked(api.fetchPromptOptions).mockResolvedValueOnce({
        templates: [
          { id: 'tpl-default', label: 'Default Template' },
          { id: 'tpl-focused', label: 'Focused Follow-up' },
        ],
        defaults: {
          templateId: 'tpl-default',
        },
      });
      const user = createMinimalUser();
      renderMinimalAssignment();

      await startNewAssignmentForLearner(user);
      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));
      await screen.findByDisplayValue('Student transcript text');
      await advanceSourceToCreate(user);

      expect(screen.queryByRole('combobox', { name: /Prompt template/i })).toBeNull();
      expect(screen.queryByText(/Focused Follow-up/i)).toBeNull();
      await user.click(screen.getByRole('button', { name: /^(Generate assignment|Regenerate)$/i }));

      await waitFor(() => {
        expect(api.createPromptPackage).toHaveBeenCalledWith(
          'rec-1',
          expect.objectContaining({
            assignmentSessionId: expect.any(String),
            templateId: 'tpl-default',
          }),
        );
      });
    });

    it('sends teacher notes into prompt package generation', async () => {
      const user = createMinimalUser();
      renderMinimalAssignment();

      await startNewAssignmentForLearner(user);
      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));
      await screen.findByDisplayValue('Student transcript text');
      await advanceSourceToTeachingContext(user);

      const teacherNotesInput = screen.getByRole('textbox', { name: /Lesson guidance/i });
      fireEvent.change(teacherNotesInput, {
        target: { value: ' Focus on article usage and stress patterns. ' },
      });
      await user.click(
        screen.getByRole('button', { name: /Confirm and continue|Continue to Create/i }),
      );
      await screen.findByRole('button', { name: /^(Generate assignment|Regenerate)$/i });
      await user.click(screen.getByRole('button', { name: /^(Generate assignment|Regenerate)$/i }));

      await waitFor(() => {
        expect(api.createPromptPackage).toHaveBeenCalledWith(
          'rec-1',
          expect.objectContaining({
            assignmentSessionId: expect.any(String),
            templateId: 'tpl-default',
          }),
        );
      });
    });
  });
}

export function registerPromptStudentSelectionTests() {
  describe('MinimalAssignment - student selection flows', {
    timeout: PROMPT_DRAFT_TEST_TIMEOUT_MS,
  }, () => {
    beforeEach(() => {
      setupMinimalAssignmentTest();
    });

    it('requires explicit student selection before upload', async () => {
      const user = createMinimalUser();
      renderMinimalAssignment();

      const startButton = await screen.findByRole('button', { name: /Start new assignment/i });
      await waitFor(() => expect((startButton as HTMLButtonElement).disabled).toBe(false));
      await user.click(startButton);

      const studentSelect = await screen.findByRole('combobox', { name: /Choose learner/i });
      expect((studentSelect as HTMLSelectElement).value).toBe('');
      expect(
        (screen.getByRole('button', { name: /^Continue$/i }) as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(api.uploadRecording).not.toHaveBeenCalled();
    });

    it('shows a resumable job without exposing its support metadata', async () => {
      vi.mocked(api.listUserJobs).mockResolvedValueOnce({
        jobs: [
          {
            assignmentArtifact,
            jobId: 'job-rerun-1',
            md: '/tmp/rerun.md',
            recordingId: null,
            transcriptId: null,
            promptPackageId: null,
            draftId: null,
            preset: null,
            withTts: true,
            voiceId: null,
            upload: 's3',
            voiceAccent: null,
            forceTts: false,
            publishTarget: 'html',
            ttsStrategy: 'auto',
            autoPublish: false,
            htmlUrl: null,
            state: 'succeeded',
            createdAt: now,
            updatedAt: now,
            startedAt: now,
            finishedAt: now,
            sourceJobId: 'job-source-1',
            error: null,
            manifestPath: null,
          },
        ],
        total: 1,
        limit: 20,
        offset: 0,
      });

      renderMinimalAssignment();
      await waitFor(() => {
        expect(screen.queryByRole('listbox', { name: /Recent assignments/i })).toBeNull();
      });
      const resumeButton = await screen.findByRole('button', { name: /Resume recent work/i });
      await waitFor(() => expect((resumeButton as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(resumeButton);

      await waitFor(() => {
        expect(screen.getByRole('radio', { name: /Saved assignment/i })).toBeTruthy();
        expect(screen.queryByText(/Audio refresh/i)).toBeNull();
      });
    });

    it('uses the selected student context before prompt generation', async () => {
      const user = createMinimalUser();
      renderMinimalAssignment();

      await startNewAssignmentForLearner(user);
      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));

      await waitFor(() => {
        expect(screen.getByDisplayValue('Student transcript text')).toBeTruthy();
      });

      await advanceSourceToCreate(user);
      await user.click(screen.getByRole('button', { name: /^(Generate assignment|Regenerate)$/i }));

      await waitFor(() => {
        expect(api.createPromptPackage).toHaveBeenCalledWith(
          'rec-1',
          expect.objectContaining({
            assignmentSessionId: expect.any(String),
            templateId: 'tpl-default',
          }),
        );
      });
    });

    it('preserves schedule lesson context when generating the prompt package', async () => {
      globalThis.history.replaceState(
        null,
        '',
        '/?studentId=student-alex&lessonId=lesson-followup-1',
      );
      vi.mocked(api.getStudentScheduleBillingSurface).mockResolvedValueOnce(
        makeScheduleBillingSurface({
          lessons: [
            makeStudentLesson({
              id: 'lesson-followup-1',
              startsAt: '2026-02-04T10:00:00.000Z',
              title: 'Pitch follow-up',
            }),
          ],
        }),
      );
      const user = createMinimalUser();
      renderMinimalAssignment();

      const startButton = await screen.findByRole('button', { name: /Start new assignment/i });
      await waitFor(() => expect((startButton as HTMLButtonElement).disabled).toBe(false));
      await user.click(startButton);
      expect(screen.getByText(/Selected for this assignment/i)).toBeTruthy();

      await user.click(screen.getByRole('button', { name: /^Continue$/i }));
      await screen.findByText(/Lesson context: .*Pitch follow-up.*lesson-followup-1/i);

      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));
      await waitFor(() => {
        expect(screen.getByDisplayValue('Student transcript text')).toBeTruthy();
      });
      await advanceSourceToCreate(user);
      await user.click(screen.getByRole('button', { name: /^(Generate assignment|Regenerate)$/i }));

      await waitFor(() => {
        expect(api.confirmStudentAssignmentSession).toHaveBeenCalledWith(
          expect.objectContaining({
            studentId: 'student-alex',
            lessonId: 'lesson-followup-1',
          }),
        );
        expect(api.createPromptPackage).toHaveBeenCalledWith(
          'rec-1',
          expect.objectContaining({
            assignmentSessionId: expect.any(String),
            templateId: 'tpl-default',
          }),
        );
      });
    });

    it('preserves resumed lesson context when generating the prompt package', async () => {
      vi.mocked(api.getStudentScheduleBillingSurface).mockResolvedValueOnce(
        makeScheduleBillingSurface({
          lessons: [
            makeStudentLesson({
              id: 'lesson-resume-1',
              startsAt: '2026-02-03T09:30:00.000Z',
              title: 'Resume review',
            }),
          ],
        }),
      );
      vi.mocked(api.listAssignmentSessions).mockResolvedValueOnce({
        sessions: [
          makeAssignmentSession({
            id: 'session-linked',
            studentId: 'student-alex',
            lessonId: 'lesson-resume-1',
            confirmedStep: 'student',
          }),
        ],
        total: 1,
        limit: 20,
      });
      vi.mocked(api.fetchAssignmentSession).mockResolvedValueOnce(
        makeAssignmentSession({
          id: 'session-linked',
          studentId: 'student-alex',
          lessonId: 'lesson-resume-1',
          confirmedStep: 'student',
        }),
      );
      const user = createMinimalUser();
      renderMinimalAssignment();

      const resumeButton = await screen.findByRole('button', { name: /Resume recent work/i });
      await waitFor(() => expect((resumeButton as HTMLButtonElement).disabled).toBe(false));
      await user.click(resumeButton);
      const resumeList = await screen.findByRole('group', { name: /Recent assignments/i });
      await user.click(within(resumeList).getByRole('radio', { name: /Alex/i }));
      await user.click(screen.getByRole('button', { name: /Continue assignment/i }));

      await waitFor(() => {
        expect(screen.getByText(/Lesson context: .*Resume review.*lesson-resume-1/i)).toBeTruthy();
      });

      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));
      await waitFor(() => {
        expect(screen.getByDisplayValue('Student transcript text')).toBeTruthy();
      });
      await advanceSourceToCreate(user);
      await user.click(screen.getByRole('button', { name: /^(Generate assignment|Regenerate)$/i }));

      await waitFor(() => {
        expect(api.attachAssignmentSource).toHaveBeenCalledWith(
          'session-linked',
          expect.objectContaining({ recordingId: 'rec-1', transcriptId: 'tx-1' }),
        );
        expect(api.updateAssignmentSessionRecovery).toHaveBeenCalledWith(
          'session-linked',
          expect.objectContaining({
            patch: { lessonId: 'lesson-resume-1' },
          }),
        );
        expect(
          vi
            .mocked(api.updateAssignmentSessionRecovery)
            .mock.calls.every(
              ([, request]) =>
                !Object.hasOwn(request.patch, 'recordingId') &&
                !Object.hasOwn(request.patch, 'transcriptId'),
            ),
        ).toBe(true);
        expect(api.createPromptPackage).toHaveBeenCalledWith(
          'rec-1',
          expect.objectContaining({
            assignmentSessionId: 'session-linked',
            templateId: 'tpl-default',
          }),
        );
      });
    });

    it('suggests recent passed lessons without homework and links the selected lesson', async () => {
      const recentStart = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      vi.mocked(api.getStudentScheduleBillingSurface).mockResolvedValueOnce(
        makeScheduleBillingSurface({
          lessons: [
            makeStudentLesson({
              id: 'lesson-recent-no-homework',
              startsAt: recentStart,
              title: 'Client update practice',
            }),
            makeStudentLesson({
              id: 'lesson-has-homework',
              startsAt: recentStart,
              title: 'Already assigned',
              homework: {
                ...makeStudentLesson().homework,
                status: 'published',
                htmlUrl: 'https://example.test/homework',
              },
            }),
          ],
        }),
      );
      const user = createMinimalUser();
      renderMinimalAssignment();

      await startNewAssignmentForLearner(user);

      await screen.findByText(/Recent lessons without homework/i);
      await user.click(screen.getByRole('button', { name: /Client update practice/i }));
      await screen.findByText(
        /Lesson context: .*Client update practice.*lesson-recent-no-homework/i,
      );

      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));
      await screen.findByDisplayValue('Student transcript text');
      await advanceSourceToCreate(user);
      await user.click(screen.getByRole('button', { name: /^(Generate assignment|Regenerate)$/i }));

      await waitFor(() => {
        expect(api.updateAssignmentSessionRecovery).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            patch: expect.objectContaining({ lessonId: 'lesson-recent-no-homework' }),
          }),
        );
        expect(api.createPromptPackage).toHaveBeenCalledWith(
          'rec-1',
          expect.objectContaining({
            assignmentSessionId: expect.any(String),
            templateId: 'tpl-default',
          }),
        );
      });
      expect(screen.queryByText(/Already assigned/i)).toBeNull();
    });
  });
}
