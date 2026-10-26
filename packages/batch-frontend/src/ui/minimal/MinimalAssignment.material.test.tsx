// @vitest-environment jsdom

import { fireEvent } from '@testing-library/react';
import { beforeEach, describe, it } from 'vitest';

import { emptyAssignmentMaterial } from '@esl-pipeline/contracts';

import {
  testAct as act,
  testApi as api,
  createMinimalUser,
  testExpect as expect,
  makeAssignmentSession,
  renderMinimalAssignment,
  testScreen as screen,
  setupMinimalAssignmentTest,
  testVi as vi,
  testWaitFor as waitFor,
} from './MinimalAssignment.test-harness';

function openContext(overrides: Parameters<typeof makeAssignmentSession>[0] = {}) {
  const session = makeAssignmentSession({
    id: 'session-maya-material',
    studentId: 'student-maya',
    recordingId: 'rec-1',
    transcriptId: 'tx-1',
    confirmedStep: 'source',
    ...overrides,
  });
  vi.mocked(api.listAssignmentSessions).mockResolvedValue({
    sessions: [session],
    total: 1,
    limit: 20,
  });
  vi.mocked(api.fetchAssignmentSession).mockResolvedValue(session);
  globalThis.history.replaceState(null, '', '/?sessionId=session-maya-material');
  const view = renderMinimalAssignment();
  return { session, ...view };
}
async function ready() {
  await screen.findByRole('heading', { name: 'Material & guidance' });
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Continue to Create' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
}
describe('assignment material workflow', () => {
  beforeEach(setupMinimalAssignmentTest);

  it('preserves newer local material and guidance when a same-session focus read finishes', async () => {
    const { session } = openContext({ material: emptyAssignmentMaterial() });
    await ready();
    let resolveRead!: (value: typeof session) => void;
    vi.mocked(api.fetchAssignmentSession).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
    );
    await act(async () => globalThis.dispatchEvent(new Event('focus')));
    const user = createMinimalUser();
    await user.click(screen.getByRole('radio', { name: /Authentic/ }));
    fireEvent.change(screen.getByLabelText('Source link'), {
      target: { value: 'https://example.com/new-local' },
    });
    fireEvent.change(screen.getByLabelText('Transcript or source text'), {
      target: { value: 'New tutor edits during refresh.' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Lesson guidance' }), {
      target: { value: 'New guidance during refresh.' },
    });
    await act(async () =>
      resolveRead({
        ...session,
        revision: session.revision + 1,
        teacherNotes: 'Remote guidance.',
        material: {
          mode: 'authentic',
          sourceUrl: 'https://example.com/remote',
          sourceText: 'Remote text.',
          sourceTextUrl: 'https://example.com/remote',
        },
      }),
    );
    expect((screen.getByLabelText('Transcript or source text') as HTMLTextAreaElement).value).toBe(
      'New tutor edits during refresh.',
    );
    expect(
      (screen.getByRole('textbox', { name: 'Lesson guidance' }) as HTMLTextAreaElement).value,
    ).toBe('New guidance during refresh.');
    expect(screen.getByText('Newer saved work found')).toBeTruthy();
  });

  it.each(['focus', 'confirmation'] as const)(
    'ignores an old %s response after starting another learner assignment',
    async (operation) => {
      const { session } = openContext({ material: emptyAssignmentMaterial() });
      await ready();
      let resolveOld!: () => void;
      if (operation === 'focus') {
        vi.mocked(api.fetchAssignmentSession).mockReturnValueOnce(
          new Promise((resolve) => {
            resolveOld = () =>
              resolve({
                ...session,
                revision: 99,
                material: {
                  mode: 'authentic',
                  sourceUrl: 'https://example.com/old',
                  sourceText: 'Old learner private material.',
                  sourceTextUrl: 'https://example.com/old',
                },
              });
          }),
        );
        await act(async () => globalThis.dispatchEvent(new Event('focus')));
      } else {
        vi.mocked(api.confirmAssignmentSessionStep).mockReturnValueOnce(
          new Promise((resolve) => {
            resolveOld = () =>
              resolve({
                session: makeAssignmentSession({
                  ...session,
                  revision: 99,
                  confirmedStep: 'context',
                  material: emptyAssignmentMaterial(),
                }),
                invalidated: [],
              });
          }),
        );
        fireEvent.click(screen.getByRole('button', { name: 'Continue to Create' }));
        await waitFor(() => expect(api.confirmAssignmentSessionStep).toHaveBeenCalled());
      }
      vi.mocked(api.confirmStudentAssignmentSession).mockResolvedValueOnce(
        makeAssignmentSession({
          id: 'session-new-learner',
          studentId: 'student-bella',
          confirmedStep: 'student',
          material: emptyAssignmentMaterial(),
        }),
      );
      fireEvent.click(screen.getByRole('button', { name: /Step 1Student/ }));
      fireEvent.click(screen.getByRole('button', { name: /Change assignment/ }));
      fireEvent.click(screen.getByRole('button', { name: /Start new assignment/ }));
      fireEvent.change(await screen.findByRole('combobox', { name: /Choose learner/ }), {
        target: { value: 'student-bella' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
      await screen.findByRole('heading', { name: /Add lesson source/ });
      await act(async () => resolveOld());
      expect(screen.getByRole('heading', { name: /Add lesson source/ })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /Drop audio file/ }));
      await waitFor(() =>
        expect(api.attachAssignmentSource).toHaveBeenCalledWith(
          'session-new-learner',
          expect.anything(),
        ),
      );
    },
  );
  it('confirms fresh Generated with empty guidance without initiating generation', async () => {
    openContext();
    await ready();
    const user = createMinimalUser();
    expect((screen.getByRole('radio', { name: /Generated/ }) as HTMLInputElement).checked).toBe(
      true,
    );
    await user.click(screen.getByRole('button', { name: 'Continue to Create' }));
    await waitFor(() =>
      expect(api.confirmAssignmentSessionStep).toHaveBeenCalledWith(
        'session-maya-material',
        expect.objectContaining({
          step: 'context',
          teacherNotes: null,
          material: { mode: 'generated', sourceUrl: '', sourceText: '', sourceTextUrl: '' },
        }),
      ),
    );
    expect(api.generateDraft).not.toHaveBeenCalled();
    expect(api.createPromptPackage).not.toHaveBeenCalled();
  });
  it('keeps package-composed material tags out of the editable lesson guidance', async () => {
    const createPackage = vi.mocked(api.createPromptPackage).getMockImplementation()!;
    vi.mocked(api.createPromptPackage).mockImplementationOnce(async (...args) => ({
      ...(await createPackage(...args)),
      notes: 'Input Type: generate\n\nLesson guidance:\nKeep examples practical.',
    }));
    openContext({ material: emptyAssignmentMaterial(), teacherNotes: 'Keep examples practical.' });
    await ready();
    const user = createMinimalUser();
    await user.click(screen.getByRole('button', { name: 'Continue to Create' }));
    await user.click(await screen.findByRole('button', { name: /^Generate assignment$/ }));
    await screen.findByText('Generated assignment draft');
    await user.click(screen.getByRole('button', { name: /Teaching context/ }));
    expect(
      (screen.getByRole('textbox', { name: 'Lesson guidance' }) as HTMLTextAreaElement).value,
    ).toBe('Keep examples practical.');
  });
  it('saves exact authentic URL, edited source and guidance before continuing; returns with edits intact', async () => {
    openContext();
    await ready();
    const user = createMinimalUser();
    await user.click(screen.getByRole('radio', { name: /Authentic/ }));
    fireEvent.change(screen.getByLabelText('Source link'), {
      target: { value: 'https://example.com/project-update' },
    });
    fireEvent.change(screen.getByLabelText('Transcript or source text'), {
      target: {
        value: 'The team finished the first stage. Input Type: generate is quoted source text.',
      },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Lesson guidance' }), {
      target: { value: 'Practise past tense.' },
    });
    await user.click(screen.getByRole('button', { name: 'Continue to Create' }));
    const material = {
      mode: 'authentic',
      sourceUrl: 'https://example.com/project-update',
      sourceText: 'The team finished the first stage. Input Type: generate is quoted source text.',
      sourceTextUrl: 'https://example.com/project-update',
    };
    await waitFor(() =>
      expect(api.confirmAssignmentSessionStep).toHaveBeenCalledWith(
        'session-maya-material',
        expect.objectContaining({
          step: 'context',
          material,
          teacherNotes: 'Practise past tense.',
        }),
      ),
    );
    expect(api.updateAssignmentSessionRecovery).toHaveBeenCalledWith(
      'session-maya-material',
      expect.objectContaining({ patch: expect.objectContaining({ material }) }),
    );
    await user.click(screen.getByRole('button', { name: /Teaching context/ }));
    expect((screen.getByLabelText('Transcript or source text') as HTMLTextAreaElement).value).toBe(
      material.sourceText,
    );
    expect(api.fetchAssignmentMaterialTranscript).not.toHaveBeenCalled();
  });
  it('preserves local material after overlapping remote revision changes', async () => {
    const { session } = openContext({ material: emptyAssignmentMaterial() });
    await ready();
    const user = createMinimalUser();
    const remote = {
      mode: 'authentic' as const,
      sourceUrl: 'https://example.com/remote',
      sourceText: 'Other tutor content.',
      sourceTextUrl: 'https://example.com/remote',
    };
    vi.mocked(api.updateAssignmentSessionRecovery).mockRejectedValueOnce(
      new api.AssignmentSessionConflictApiError({
        ...session,
        revision: session.revision + 1,
        material: remote,
      }),
    );
    await user.click(screen.getByRole('radio', { name: /Authentic/ }));
    fireEvent.change(screen.getByLabelText('Source link'), {
      target: { value: 'https://example.com/local' },
    });
    fireEvent.change(screen.getByLabelText('Transcript or source text'), {
      target: { value: 'Keep my local source.' },
    });
    await user.click(screen.getByRole('button', { name: 'Continue to Create' }));
    await screen.findByText(/Could not save this step/);
    expect((screen.getByLabelText('Transcript or source text') as HTMLTextAreaElement).value).toBe(
      'Keep my local source.',
    );
    expect((screen.getByLabelText('Source link') as HTMLInputElement).value).toBe(
      'https://example.com/local',
    );
    expect(api.confirmAssignmentSessionStep).not.toHaveBeenCalled();
  });
  it.each(['source', 'context'] as const)(
    'adopts old authentic manual tags after %s without rewriting stored evidence on resume',
    async (confirmedStep) => {
      openContext({
        confirmedStep,
        teacherNotes:
          'Input Type: authentic\nLink: https://example.com/old\n\nAuthentic source text:\nOriginal excerpt.\n\nLesson guidance:\nDiscuss the decision.',
      });
      const user = createMinimalUser();
      await screen.findByRole('button', { name: /Teaching context/ });
      await user.click(screen.getByRole('button', { name: /Teaching context/ }));
      await ready();
      expect((screen.getByRole('radio', { name: /Authentic/ }) as HTMLInputElement).checked).toBe(
        true,
      );
      expect(
        (screen.getByLabelText('Transcript or source text') as HTMLTextAreaElement).value,
      ).toBe('Original excerpt.');
      expect(
        (screen.getByRole('textbox', { name: 'Lesson guidance' }) as HTMLTextAreaElement).value,
      ).toBe('Discuss the decision.');
      expect(api.updateAssignmentSessionRecovery).not.toHaveBeenCalled();
      expect(api.confirmAssignmentSessionStep).not.toHaveBeenCalled();
    },
  );
});
