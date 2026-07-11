import { fireEvent, within } from '@testing-library/react';
import { beforeEach, describe, it } from 'vitest';

import {
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
  testVi as vi,
  testWaitFor as waitFor,
} from './MinimalAssignment.test-harness';

const PROMPT_DRAFT_TEST_TIMEOUT_MS = 15_000;

async function renderResumedDraftSession() {
  const session = makeAssignmentSession({
    id: 'session-teacher-notes',
    studentId: 'student-alex',
    recordingId: 'rec-1',
    transcriptId: 'tx-1',
    promptPackageId: 'pkg-1',
    draftId: 'draft-1',
    currentStage: 'assignment',
  });
  vi.mocked(api.listAssignmentSessions).mockResolvedValueOnce({
    sessions: [session],
    total: 1,
    limit: 20,
  });
  vi.mocked(api.updateAssignmentSession).mockImplementation(async (id, patch) =>
    makeAssignmentSession({ ...session, id, ...patch }),
  );
  globalThis.history.replaceState(null, '', '/?sessionId=session-teacher-notes');
  const user = createMinimalUser();
  renderMinimalAssignment();
  await screen.findByRole('button', { name: /^Generate assignment$/i });
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
      const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
      const user = await renderResumedDraftSession();
      await user.click(screen.getByRole('button', { name: /Teaching context/i }));
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: /Teaching context/i }).getAttribute('aria-current'),
        ).toBe('step'),
      );

      const notes = screen.getByRole('textbox', { name: /Teacher notes/i });
      await user.clear(notes);
      await user.type(notes, 'Focus on articles.');

      expect(confirmSpy).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: /Confirm and continue/i }));

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(confirmSpy).toHaveBeenCalledWith(
        'This will require a new assignment draft. Your lesson source and transcript will stay saved.',
      );
      await waitFor(() => {
        expect(api.updateAssignmentSession).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            teacherNotes: 'Focus on articles.',
            currentStage: 'assignment',
          }),
        );
      });
    });

    it('keeps changed teacher notes and Teaching context when invalidation is cancelled', async () => {
      const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(false);
      const user = await renderResumedDraftSession();
      await user.click(screen.getByRole('button', { name: /Teaching context/i }));
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: /Teaching context/i }).getAttribute('aria-current'),
        ).toBe('step'),
      );

      const notes = screen.getByRole('textbox', { name: /Teacher notes/i });
      await user.type(notes, 'Focus on articles.');
      await user.click(screen.getByRole('button', { name: /Confirm and continue/i }));

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(
        (screen.getByRole('textbox', { name: /Teacher notes/i }) as HTMLTextAreaElement).value,
      ).toBe('Focus on articles.');
      expect(screen.getByRole('heading', { name: /Learner context/i })).toBeTruthy();
      expect(api.updateAssignmentSession).not.toHaveBeenCalled();
    });

    it('preserves the existing draft when saving changed teacher notes fails', async () => {
      const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
      const user = await renderResumedDraftSession();
      vi.mocked(api.updateAssignmentSession).mockRejectedValueOnce(new Error('save failed'));
      await user.click(screen.getByRole('button', { name: /Teaching context/i }));
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: /Teaching context/i }).getAttribute('aria-current'),
        ).toBe('step'),
      );

      await user.type(screen.getByRole('textbox', { name: /Teacher notes/i }), 'Focus on articles.');
      await user.click(screen.getByRole('button', { name: /Confirm and continue/i }));

      expect(confirmSpy).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(api.updateAssignmentSession).toHaveBeenCalled());
      expect(
        screen.getByRole('button', { name: /Teaching context/i }).getAttribute('aria-current'),
      ).toBe('step');
      expect(screen.getByDisplayValue('# Draft markdown')).toBeTruthy();
    });

    it('uploads a recording and shows recording metadata', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const user = createTimerAwareMinimalUser();
        renderMinimalAssignment();

        await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
        const studentSelect = await screen.findByRole('combobox', { name: /^Student$/i });
        await screen.findByRole('option', { name: 'Alex' });
        await user.selectOptions(studentSelect, 'student-alex');
        await user.click(screen.getByRole('button', { name: /Drop audio file/i }));

        await waitFor(() => {
          expect(api.uploadRecording).toHaveBeenCalledTimes(1);
        });
        expect(api.uploadRecording).toHaveBeenCalledWith(
          expect.any(File),
          expect.objectContaining({ studentId: 'student-alex', sttProvider: 'deepgram' }),
        );

        await waitFor(() => {
          expect(screen.getByText(/Recording: lesson\.mp3/i)).toBeTruthy();
        });
        expect(screen.getByText(/Status: transcribed/i)).toBeTruthy();
      } finally {
        vi.useRealTimers();
      }
    });

    it('uses metadata-driven STT default provider for upload payloads', async () => {
      const defaultOptions = await api.fetchJobOptions();
      vi.mocked(api.fetchJobOptions).mockReset();
      vi.mocked(api.fetchJobOptions).mockResolvedValueOnce({
        ...defaultOptions,
        sttProviders: ['google', 'deepgram'],
        defaultSttProvider: 'google',
      });

      const user = createMinimalUser();
      renderMinimalAssignment();

      await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
      openRecordingSettings();
      const sttProviderSelect = await screen.findByRole('combobox', {
        name: /Transcript engine/i,
      });
      await waitFor(() => {
        expect((sttProviderSelect as HTMLSelectElement).value).toBe('google');
      });
      await screen.findByRole('option', { name: 'Alex' });
      await user.selectOptions(
        screen.getByRole('combobox', { name: /^Student$/i }),
        'student-alex',
      );
      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));

      await waitFor(() => {
        expect(api.uploadRecording).toHaveBeenCalledTimes(1);
      });
      expect(api.uploadRecording).toHaveBeenCalledWith(
        expect.any(File),
        expect.objectContaining({ sttProvider: 'google' }),
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

      await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
      await screen.findByRole('option', { name: 'Alex' });
      await user.selectOptions(
        screen.getByRole('combobox', { name: /^Student$/i }),
        'student-alex',
      );
      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));

      await waitFor(() => {
        expect(screen.getByText(/Reused an existing transcript/i)).toBeTruthy();
      });
    });

    it('shows a read-only learner profile preview and deep link instead of inline editing', async () => {
      const user = createMinimalUser();
      renderMinimalAssignment();

      await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
      await screen.findByRole('option', { name: 'Alex' });
      await user.selectOptions(
        screen.getByRole('combobox', { name: /^Student$/i }),
        'student-alex',
      );
      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));
      await screen.findByDisplayValue('Student transcript text');
      await screen.findByRole('heading', { name: /Learner context/i });

      expect(screen.queryByRole('textbox', { name: /Profile content/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /Save profile/i })).toBeNull();
      expect(screen.queryByText(/profiles\/alex\.md/i)).toBeNull();
      expect(screen.getAllByText(/^Student Learning page$/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/^Selected$/i)).toBeTruthy();
      expect(screen.getByText(/^Goals$/i)).toBeTruthy();
      expect(screen.getByText(/^Communication contexts$/i)).toBeTruthy();
      expect(screen.getByText(/^Strengths$/i)).toBeTruthy();
      expect(screen.getByText(/^Challenges$/i)).toBeTruthy();
      expect(screen.getByText(/^Study preferences$/i)).toBeTruthy();
      expect(screen.getByText(/Lead project updates clearly\./i)).toBeTruthy();
      expect(screen.getByText(/Strong listening comprehension\./i)).toBeTruthy();
      expect(screen.getByRole('link', { name: /Open Learning page/i }).getAttribute('href')).toBe(
        '/students/student-alex/learning',
      );
    });

    it('shows a useful empty state when the selected student has no learner profile', async () => {
      const user = createMinimalUser();
      vi.mocked(api.fetchStudentOptions).mockResolvedValueOnce({
        students: [
          { id: 'student-alex', name: 'Alex', profileId: null },
          { id: 'student-bella', name: 'Bella', profileId: 'profiles/bella.md' },
        ],
      });

      renderMinimalAssignment();

      await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
      await screen.findByRole('option', { name: 'Alex' });
      await user.selectOptions(
        screen.getByRole('combobox', { name: /^Student$/i }),
        'student-alex',
      );
      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));
      await screen.findByDisplayValue('Student transcript text');

      await screen.findByText(/No structured Learning page context is available yet\./i);
      expect(
        screen.getByRole('button', {
          name: /Use this transcript for Alex's learner context/i,
        }),
      ).toBeTruthy();
      expect(screen.queryByRole('status')).toBeNull();
      expect(
        screen.queryByRole('button', { name: /Populate first profile from lesson/i }),
      ).toBeNull();
      expect(screen.queryByText(/Lead project updates clearly\./i)).toBeNull();
    });

    it('treats a draft-only bound profile as unstructured learner context', async () => {
      const user = createMinimalUser();
      vi.mocked(api.fetchStudentOptions).mockResolvedValueOnce({
        students: [
          { id: 'student-alex', name: 'Alex', profileId: 'profiles/alex.md' },
          { id: 'student-bella', name: 'Bella', profileId: 'profiles/bella.md' },
        ],
      });
      vi.mocked(api.getProfileContent).mockRejectedValueOnce(new Error('not_found'));

      renderMinimalAssignment();

      await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
      await screen.findByRole('option', { name: 'Alex' });
      await user.selectOptions(
        screen.getByRole('combobox', { name: /^Student$/i }),
        'student-alex',
      );
      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));
      await screen.findByDisplayValue('Student transcript text');

      await screen.findByText(/Learning page context has not been structured yet/i);
      expect(screen.queryByText(/^not_found$/i)).toBeNull();
      expect(
        screen.getByRole('button', {
          name: /Use this transcript for Alex's learner context/i,
        }),
      ).toBeTruthy();

      await user.click(screen.getByRole('button', { name: /^Generate assignment$/i }));

      await waitFor(() => {
        expect(api.createPromptPackage).toHaveBeenCalledWith('rec-1', {
          templateId: 'tpl-default',
        });
      });
    });

    it('does not offer first-profile replacement when the bound profile preview fails to load', async () => {
      const user = createMinimalUser();
      vi.mocked(api.fetchStudentOptions).mockResolvedValueOnce({
        students: [
          { id: 'student-alex', name: 'Alex', profileId: 'profiles/alex.md' },
          { id: 'student-bella', name: 'Bella', profileId: 'profiles/bella.md' },
        ],
      });
      vi.mocked(api.getProfileContent).mockRejectedValueOnce(
        new Error('Profile service is temporarily unavailable'),
      );

      renderMinimalAssignment();

      await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
      await screen.findByRole('option', { name: 'Alex' });
      await user.selectOptions(
        screen.getByRole('combobox', { name: /^Student$/i }),
        'student-alex',
      );
      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));
      await screen.findByDisplayValue('Student transcript text');

      await screen.findByText(/Profile service is temporarily unavailable/i);
      expect(
        screen.queryByRole('button', {
          name: /Use this transcript for Alex's learner context/i,
        }),
      ).toBeNull();
    });

    it('offers first-profile drafting and approval after lesson memory is ready', async () => {
      const user = createMinimalUser();
      vi.mocked(api.fetchStudentOptions).mockResolvedValueOnce({
        students: [
          { id: 'student-alex', name: 'Alex', profileId: null },
          { id: 'student-bella', name: 'Bella', profileId: 'profiles/bella.md' },
        ],
      });
      vi.mocked(api.getStudentMemoryHealth).mockResolvedValue({
        studentId: 'student-alex',
        latestSnapshot: null,
        memoryCounts: {
          lesson: {
            ready: { count: 1, capped: false, limit: 20 },
            pending: { count: 0, capped: false, limit: 20 },
            failed: { count: 0, capped: false, limit: 20 },
          },
          homework: {
            ready: { count: 0, capped: false, limit: 20 },
            pending: { count: 0, capped: false, limit: 20 },
            failed: { count: 0, capped: false, limit: 20 },
          },
        },
        latestFailedReason: null,
        profileCandidateCounts: {
          pending: 0,
          approved: 0,
          rejected: 0,
          deferred: 0,
        },
      });

      renderMinimalAssignment();

      await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
      await screen.findByRole('option', { name: 'Alex' });
      await user.selectOptions(
        screen.getByRole('combobox', { name: /^Student$/i }),
        'student-alex',
      );
      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));
      await screen.findByDisplayValue('Student transcript text');
      await user.click(
        screen.getByRole('button', {
          name: /Use this transcript for Alex's learner context/i,
        }),
      );
      await waitFor(() => {
        expect(api.requestLessonMemoryFromTranscript).toHaveBeenCalledWith('student-alex', {
          recordingId: 'rec-1',
          transcriptId: 'tx-1',
          lessonId: null,
        });
      });

      const populateButton = await screen.findByRole('button', {
        name: /Populate first profile from lesson/i,
      });
      await user.click(populateButton);

      await waitFor(() => {
        expect(api.populateFirstProfileFromLesson).toHaveBeenCalledWith('student-alex');
      });
      expect(await screen.findByText(/^First profile draft$/i)).toBeTruthy();
      expect(screen.getByText(/^Draft ready$/i)).toBeTruthy();
      expect(screen.getByText(/^Goals$/i)).toBeTruthy();
      expect(screen.getByText(/^Communication contexts$/i)).toBeTruthy();
      expect(screen.getByText(/^Strengths$/i)).toBeTruthy();
      expect(screen.getByText(/^Challenges$/i)).toBeTruthy();
      expect(screen.getByText(/^Study preferences$/i)).toBeTruthy();
      expect(screen.getByText(/^Built from first lesson memory$/i)).toBeTruthy();
      expect(screen.getByText(/^Transcript ready$/i)).toBeTruthy();
      expect(screen.getByText(/Lead project updates clearly\./i)).toBeTruthy();
      expect(screen.getByText(/Strong listening comprehension\./i)).toBeTruthy();
      expect(
        screen.getByText(/Keep examples grounded in real workplace situations\./i),
      ).toBeTruthy();
      expect(
        screen.getByRole('link', { name: /Edit in Learning page/i }).getAttribute('href'),
      ).toBe(
        '/students/student-alex/learning?profileId=profiles%2Falex.md&draftRevisionId=revision-draft-1',
      );

      const approveButton = await screen.findByRole('button', { name: /Approve profile draft/i });
      await user.click(approveButton);

      await waitFor(() => {
        expect(api.activateProfileRevision).toHaveBeenCalledWith(
          'profiles/alex.md',
          'revision-draft-1',
        );
      });
      expect((await screen.findAllByText(/^Student Learning page$/i)).length).toBeGreaterThan(0);
      expect(screen.getByText(/^Selected$/i)).toBeTruthy();
      expect(await screen.findByText(/Lead project updates clearly\./i)).toBeTruthy();

      await user.click(screen.getByRole('button', { name: /^Generate assignment$/i }));

      await waitFor(() => {
        expect(api.createPromptPackage).toHaveBeenCalledWith('rec-1', {
          templateId: 'tpl-default',
          profileId: 'profiles/alex.md',
        });
      });
    });

    it('reloads an already-selected draft-only profile after approving the first draft', async () => {
      const user = createMinimalUser();
      vi.mocked(api.fetchStudentOptions).mockResolvedValueOnce({
        students: [
          { id: 'student-alex', name: 'Alex', profileId: 'profiles/alex.md' },
          { id: 'student-bella', name: 'Bella', profileId: 'profiles/bella.md' },
        ],
      });
      vi.mocked(api.getProfileContent)
        .mockRejectedValueOnce(new Error('not_found'))
        .mockResolvedValueOnce({
          id: 'profiles/alex.md',
          label: 'Alex Profile',
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
            teacherNotes: 'Keep examples grounded in real workplace situations.',
          },
          currentRevisionId: 'revision-draft-1',
          updatedAt: now,
        });
      vi.mocked(api.getStudentMemoryHealth).mockResolvedValue({
        studentId: 'student-alex',
        latestSnapshot: null,
        memoryCounts: {
          lesson: {
            ready: { count: 1, capped: false, limit: 20 },
            pending: { count: 0, capped: false, limit: 20 },
            failed: { count: 0, capped: false, limit: 20 },
          },
          homework: {
            ready: { count: 0, capped: false, limit: 20 },
            pending: { count: 0, capped: false, limit: 20 },
            failed: { count: 0, capped: false, limit: 20 },
          },
        },
        latestFailedReason: null,
        profileCandidateCounts: {
          pending: 0,
          approved: 0,
          rejected: 0,
          deferred: 0,
        },
      });

      renderMinimalAssignment();

      await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
      await screen.findByRole('option', { name: 'Alex' });
      await user.selectOptions(
        screen.getByRole('combobox', { name: /^Student$/i }),
        'student-alex',
      );
      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));
      await screen.findByDisplayValue('Student transcript text');
      expect(
        await screen.findByText(/Learning page context has not been structured yet/i),
      ).toBeTruthy();
      expect(screen.queryByText(/^not_found$/i)).toBeNull();

      await user.click(
        screen.getByRole('button', {
          name: /Use this transcript for Alex's learner context/i,
        }),
      );
      const populateButton = await screen.findByRole('button', {
        name: /Populate first profile from lesson/i,
      });
      await user.click(populateButton);
      await screen.findByText(/^First profile draft$/i);

      await user.click(await screen.findByRole('button', { name: /Approve profile draft/i }));

      await waitFor(() => {
        expect(api.getProfileContent).toHaveBeenCalledTimes(2);
      });
      expect((await screen.findAllByText(/^Student Learning page$/i)).length).toBeGreaterThan(0);
      expect(screen.getByText(/^Selected$/i)).toBeTruthy();
      expect(screen.queryByText(/^not_found$/i)).toBeNull();
      expect(await screen.findByText(/Lead project updates clearly\./i)).toBeTruthy();
    });

    it('generates a prompt after transcript is ready', async () => {
      await renderPromptReadyAssignment();

      await waitFor(() => {
        expect(api.createPromptPackage).toHaveBeenCalledWith('rec-1', {
          templateId: 'tpl-default',
          profileId: 'profiles/alex.md',
        });
      });
      expect(screen.getByRole('button', { name: /^Generate assignment$/i })).toBeTruthy();
      expect(screen.getByRole('textbox', { name: /Draft markdown/i })).toBeTruthy();
    });

    it('uses the default prompt template without exposing template selection', async () => {
      vi.mocked(api.fetchPromptOptions).mockResolvedValueOnce({
        templates: [
          { id: 'tpl-default', label: 'Default Template' },
          { id: 'tpl-focused', label: 'Focused Follow-up' },
        ],
        profiles: [{ id: 'profiles/alex.md', label: 'Alex active profile' }],
        defaults: {
          templateId: 'tpl-default',
          profileId: null,
        },
      });
      const user = createMinimalUser();
      renderMinimalAssignment();

      await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
      await screen.findByRole('option', { name: 'Alex' });
      await user.selectOptions(
        screen.getByRole('combobox', { name: /^Student$/i }),
        'student-alex',
      );
      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));
      await screen.findByDisplayValue('Student transcript text');

      expect(screen.queryByRole('combobox', { name: /Prompt template/i })).toBeNull();
      expect(screen.queryByText(/Focused Follow-up/i)).toBeNull();
      await user.click(screen.getByRole('button', { name: /^Generate assignment$/i }));

      await waitFor(() => {
        expect(api.createPromptPackage).toHaveBeenCalledWith('rec-1', {
          templateId: 'tpl-default',
          profileId: 'profiles/alex.md',
        });
      });
    });

    it('sends teacher notes into prompt package generation', async () => {
      const user = createMinimalUser();
      renderMinimalAssignment();

      await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
      await screen.findByRole('option', { name: 'Alex' });
      await user.selectOptions(
        screen.getByRole('combobox', { name: /^Student$/i }),
        'student-alex',
      );
      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));
      await screen.findByDisplayValue('Student transcript text');

      const teacherNotesInput = screen.getByRole('textbox', { name: /Teacher notes/i });
      fireEvent.change(teacherNotesInput, {
        target: { value: ' Focus on article usage and stress patterns. ' },
      });
      await user.click(screen.getByRole('button', { name: /^Generate assignment$/i }));

      await waitFor(() => {
        expect(api.createPromptPackage).toHaveBeenCalledWith('rec-1', {
          notes: 'Focus on article usage and stress patterns.',
          templateId: 'tpl-default',
          profileId: 'profiles/alex.md',
        });
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

      expect(screen.getByRole('combobox', { name: /^Student$/i })).toBeTruthy();
      await user.click(screen.getByRole('button', { name: /Start new assignment/i }));

      const studentSelect = await screen.findByRole('combobox', { name: /^Student$/i });
      expect((studentSelect as HTMLSelectElement).value).toBe('');
      expect(
        (screen.getByRole('button', { name: /Confirm and continue/i }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      expect(api.uploadRecording).not.toHaveBeenCalled();
    });

    it('labels audio rerun jobs as audio regeneration in recent jobs', async () => {
      vi.mocked(api.listUserJobs).mockResolvedValueOnce({
        jobs: [
          {
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
      fireEvent.click(screen.getByRole('button', { name: /Resume recent work/i }));

      await waitFor(() => {
        expect(screen.getByRole('option', { name: /Audio refresh/i })).toBeTruthy();
      });
    });

    it('syncs profile to selected student binding before prompt generation', async () => {
      const user = createMinimalUser();
      renderMinimalAssignment();

      await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
      const studentSelect = await screen.findByRole('combobox', { name: /^Student$/i });
      await screen.findByRole('option', { name: 'Alex' });
      await user.selectOptions(studentSelect, 'student-alex');
      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));

      await waitFor(() => {
        expect(screen.getByDisplayValue('Student transcript text')).toBeTruthy();
      });

      await user.click(screen.getByRole('button', { name: /^Generate assignment$/i }));

      await waitFor(() => {
        expect(api.createPromptPackage).toHaveBeenCalledWith('rec-1', {
          templateId: 'tpl-default',
          profileId: 'profiles/alex.md',
        });
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

      await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
      const studentSelect = await screen.findByRole('combobox', { name: /^Student$/i });
      await screen.findByRole('option', { name: 'Alex' });
      expect((studentSelect as HTMLSelectElement).value).toBe('student-alex');
      expect((studentSelect as HTMLSelectElement).disabled).toBe(true);
      await screen.findByText(/Lesson context: .*Pitch follow-up.*lesson-followup-1/i);

      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));
      await waitFor(() => {
        expect(screen.getByDisplayValue('Student transcript text')).toBeTruthy();
      });
      await user.click(screen.getByRole('button', { name: /^Generate assignment$/i }));

      await waitFor(() => {
        expect(api.createAssignmentSession).toHaveBeenCalledWith(
          expect.objectContaining({
            studentId: 'student-alex',
            recordingId: 'rec-1',
            lessonId: 'lesson-followup-1',
          }),
        );
        expect(api.createPromptPackage).toHaveBeenCalledWith('rec-1', {
          templateId: 'tpl-default',
          profileId: 'profiles/alex.md',
          lessonId: 'lesson-followup-1',
        });
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
            currentStage: 'source',
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
          currentStage: 'source',
        }),
      );
      const user = createMinimalUser();
      renderMinimalAssignment();

      await user.click(screen.getByRole('button', { name: /Resume recent work/i }));
      const resumeList = await screen.findByRole('listbox', { name: /Recent assignments/i });
      await user.click(within(resumeList).getByRole('option', { name: /Alex/i }));
      await user.click(screen.getByRole('button', { name: /Resume selected assignment/i }));

      await waitFor(() => {
        expect(screen.getByText(/Lesson context: .*Resume review.*lesson-resume-1/i)).toBeTruthy();
      });

      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));
      await waitFor(() => {
        expect(screen.getByDisplayValue('Student transcript text')).toBeTruthy();
      });
      await user.click(screen.getByRole('button', { name: /^Generate assignment$/i }));

      await waitFor(() => {
        expect(api.updateAssignmentSession).toHaveBeenCalledWith(
          'session-linked',
          expect.objectContaining({
            recordingId: 'rec-1',
            lessonId: 'lesson-resume-1',
          }),
        );
        expect(api.createPromptPackage).toHaveBeenCalledWith('rec-1', {
          templateId: 'tpl-default',
          profileId: 'profiles/alex.md',
          lessonId: 'lesson-resume-1',
        });
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

      await user.click(screen.getByRole('button', { name: /Start new assignment/i }));
      await screen.findByRole('option', { name: 'Alex' });
      await user.selectOptions(
        screen.getByRole('combobox', { name: /^Student$/i }),
        'student-alex',
      );

      await screen.findByText(/Recent lessons without homework/i);
      await user.click(screen.getByRole('button', { name: /Client update practice/i }));
      await screen.findByText(
        /Lesson context: .*Client update practice.*lesson-recent-no-homework/i,
      );

      await user.click(screen.getByRole('button', { name: /Drop audio file/i }));
      await screen.findByDisplayValue('Student transcript text');
      await user.click(screen.getByRole('button', { name: /^Generate assignment$/i }));

      await waitFor(() => {
        expect(api.createAssignmentSession).toHaveBeenCalledWith(
          expect.objectContaining({
            studentId: 'student-alex',
            lessonId: 'lesson-recent-no-homework',
          }),
        );
        expect(api.createPromptPackage).toHaveBeenCalledWith('rec-1', {
          templateId: 'tpl-default',
          profileId: 'profiles/alex.md',
          lessonId: 'lesson-recent-no-homework',
        });
      });
      expect(screen.queryByText(/Already assigned/i)).toBeNull();
    });
  });
}
