import { fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, it } from 'vitest';

import type * as ApiTypes from '../../utils/api';
import {
  testAct as act,
  testApi as api,
  createMinimalUser,
  createTimerAwareMinimalUser,
  testExpect as expect,
  INTEGRATION_TEST_TIMEOUT_MS,
  now,
  preparePromptReady,
  previewCurrentDraft,
  renderGenerationReadyAssignment,
  renderMinimalAssignment,
  renderPromptReadyAssignment,
  renderResumedAssignment,
  testScreen as screen,
  setupMinimalAssignmentTest,
  UI_WAIT_TIMEOUT_MS,
  testVi as vi,
  testWaitFor as waitFor,
} from './MinimalAssignment.test-harness';
import { makeAssignmentText, typedDraftFields } from './MinimalAssignment.typed-test-fixtures';

export function registerGenerationDefaultsTests() {
  describe('MinimalAssignment - generation defaults', () => {
    beforeEach(() => {
      setupMinimalAssignmentTest();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('uses generation defaults without exposing provider, model, or quota controls', async () => {
      const user = createMinimalUser();
      await renderGenerationReadyAssignment();

      expect(screen.queryByRole('combobox', { name: /Generation provider/i })).toBeNull();
      expect(screen.queryByRole('combobox', { name: /Generation model/i })).toBeNull();
      expect(screen.queryByText(/Generation settings/i)).toBeNull();
      expect(screen.queryByText(/Generation limits/i)).toBeNull();
      expect(screen.queryByText(/RPM:/i)).toBeNull();
      expect(screen.queryByText(/TPM:/i)).toBeNull();
      expect(screen.queryByText(/RPD:/i)).toBeNull();
      expect(screen.getByRole('button', { name: /^Regenerate$/i }).className).toContain(
        'minimal-secondary',
      );
      expect(screen.getByRole('button', { name: /Confirm and continue/i }).className).toContain(
        'product-button--primary',
      );

      await user.click(screen.getByRole('button', { name: /^(Generate assignment|Regenerate)$/i }));

      await waitFor(() => {
        expect(api.generateDraft).toHaveBeenCalledWith({
          promptPackageId: 'pkg-1',
          provider: 'openai',
          model: 'gpt-5.2',
        });
      });
      expect(
        await screen.findByDisplayValue(makeAssignmentText('# Generated assignment draft')),
      ).toBeTruthy();
      expect(screen.getByText(/Assignment draft ready\. Saved automatically\./i)).toBeTruthy();
    });

    it(
      'keeps generate draft hidden until the assignment stage is ready',
      async () => {
        const user = createMinimalUser();
        renderMinimalAssignment();

        expect(screen.queryByRole('button', { name: /^Generate assignment$/i })).toBeNull();

        await preparePromptReady(user);

        expect(
          await screen.findByDisplayValue(makeAssignmentText('# Generated assignment draft')),
        ).toBeTruthy();
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );

    it(
      'generates draft markdown with selected provider/model',
      async () => {
        const user = createMinimalUser();
        await renderGenerationReadyAssignment();

        await user.click(
          screen.getByRole('button', { name: /^(Generate assignment|Regenerate)$/i }),
        );

        await waitFor(() => {
          expect(api.generateDraft).toHaveBeenCalledWith({
            promptPackageId: 'pkg-1',
            provider: 'openai',
            model: 'gpt-5.2',
          });
        });
        expect(
          await screen.findByDisplayValue(makeAssignmentText('# Generated assignment draft')),
        ).toBeTruthy();
        expect(screen.getByText(/Assignment draft ready\. Saved automatically\./i)).toBeTruthy();
        await waitFor(() => {
          expect(api.updateDraft).toHaveBeenCalledWith(
            'draft-1',
            makeAssignmentText('# Generated assignment draft'),
            1,
          );
        });
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );

    it(
      'recovers edited session notes without confirming them',
      async () => {
        const { user } = await renderPromptReadyAssignment();
        await user.click(screen.getByRole('button', { name: /Teaching context/i }));
        await screen.findByRole('textbox', { name: /Teacher notes/i });
        vi.mocked(api.confirmStudentAssignmentSession).mockClear();
        vi.mocked(api.updateAssignmentSessionRecovery).mockClear();
        vi.mocked(api.confirmAssignmentSessionStep).mockClear();
        vi.useFakeTimers();

        fireEvent.change(screen.getByRole('textbox', { name: /Teacher notes/i }), {
          target: { value: 'Use more travel vocabulary.' },
        });

        await act(async () => {
          vi.advanceTimersByTime(1500);
          await Promise.resolve();
        });

        expect(api.updateAssignmentSessionRecovery).toHaveBeenCalledWith(
          'session-1',
          expect.objectContaining({
            patch: expect.objectContaining({ teacherNotes: 'Use more travel vocabulary.' }),
          }),
        );
        expect(api.confirmAssignmentSessionStep).not.toHaveBeenCalled();
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );
  });
}

export function registerGenerationThrottleTests() {
  describe('MinimalAssignment - generation throttle and error flows', () => {
    beforeEach(() => {
      setupMinimalAssignmentTest();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it(
      'preserves the latest manual edit when autosave overlaps an older save',
      async () => {
        const firstSavedDraft = {
          ...typedDraftFields(makeAssignmentText('# First autosave')),
          id: 'draft-1',
          promptPackageId: 'pkg-1',
          studentId: null,
          storageUri: 'memory://drafts/draft-1',
          createdBy: 'user-1',
          text: makeAssignmentText('# First autosave'),
          workingVersion: 2,
          contentHash: 'a'.repeat(64),
          createdAt: now,
          updatedAt: now,
        };
        const finalSavedDraft = {
          ...firstSavedDraft,
          text: makeAssignmentText('# Final autosave'),
          workingVersion: 3,
        };
        let resolveFirstSave: (value: typeof firstSavedDraft) => void = () => {};
        vi.mocked(api.updateDraft)
          .mockImplementationOnce(
            () =>
              new Promise((resolve) => {
                resolveFirstSave = resolve;
              }),
          )
          .mockResolvedValueOnce(finalSavedDraft);

        await renderGenerationReadyAssignment();
        vi.useFakeTimers();
        const draftTextarea = screen.getByRole('textbox', {
          name: /Assignment JSON/i,
        }) as HTMLTextAreaElement;

        fireEvent.change(draftTextarea, {
          target: { value: makeAssignmentText('# First autosave') },
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(5000);
        });
        expect(api.updateDraft).toHaveBeenCalledWith(
          'draft-1',
          makeAssignmentText('# First autosave'),
          1,
        );

        fireEvent.change(draftTextarea, {
          target: { value: makeAssignmentText('# Final autosave') },
        });
        await act(async () => {
          await vi.advanceTimersByTimeAsync(5000);
        });
        expect(api.updateDraft).toHaveBeenCalledTimes(1);

        await act(async () => {
          resolveFirstSave(firstSavedDraft);
          await Promise.resolve();
        });
        expect(draftTextarea.value).toBe(makeAssignmentText('# Final autosave'));

        await act(async () => {
          await vi.advanceTimersByTimeAsync(5000);
        });
        expect(api.updateDraft).toHaveBeenCalledWith(
          'draft-1',
          makeAssignmentText('# Final autosave'),
          2,
        );
        expect(draftTextarea.value).toBe(makeAssignmentText('# Final autosave'));
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );

    it(
      'releases runtime RPM quota lock after minute window rollover',
      async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
          vi.setSystemTime(new Date('2026-02-18T00:00:40.000Z'));
          const user = createTimerAwareMinimalUser();
          vi.mocked(api.generateDraft).mockResolvedValueOnce({
            ...typedDraftFields(makeAssignmentText('# Generated assignment draft')),
            text: makeAssignmentText('# Generated assignment draft'),
            provider: 'openai',
            model: 'gpt-5.2',
            quota: {
              source: 'provider',
              lastUpdatedAt: '2026-02-18T00:00:30.000Z',
              rpmBudget: 5,
              rpmUsed: 5,
              rpmRemaining: 0,
            },
          });

          await renderResumedAssignment();

          const generateDraftButton = screen.getByRole('button', {
            name: /^(Generate assignment|Regenerate)$/i,
          });
          await user.click(generateDraftButton);

          await waitFor(() => {
            expect(screen.getByText(/Per-minute request budget exhausted/i)).toBeTruthy();
          });
          expect(
            (
              screen.getByRole('button', {
                name: /^(Generate assignment|Regenerate)$/i,
              }) as HTMLButtonElement
            ).disabled,
          ).toBe(true);

          vi.setSystemTime(new Date('2026-02-18T00:01:05.000Z'));
          act(() => {
            vi.advanceTimersByTime(15_000);
          });

          await waitFor(() => {
            expect(
              (
                screen.getByRole('button', {
                  name: /^(Generate assignment|Regenerate)$/i,
                }) as HTMLButtonElement
              ).disabled,
            ).toBe(false);
          });
          expect(screen.queryByText(/Per-minute request budget exhausted/i)).toBeNull();
        } finally {
          vi.useRealTimers();
        }
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );

    it(
      'shows mapped timeout generation errors with request id',
      async () => {
        const user = createMinimalUser();
        vi.mocked(api.generateDraft).mockRejectedValueOnce(
          new api.GenerationDraftApiError('Provider timed out', {
            code: 'provider_timeout',
            provider: 'openai',
            model: 'gpt-5.2',
            requestId: 'req-timeout-1',
          }),
        );

        await renderGenerationReadyAssignment();
        await user.click(
          screen.getByRole('button', { name: /^(Generate assignment|Regenerate)$/i }),
        );

        await waitFor(() => {
          expect(api.generateDraft).toHaveBeenCalledWith({
            promptPackageId: 'pkg-1',
            provider: 'openai',
            model: 'gpt-5.2',
          });
        });

        await screen.findByText(
          /Assignment generation timed out\. Retry shortly\. Request ID: req-timeout-1/i,
        );
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );

    it(
      'clears preview readiness and re-gates publish after generated draft replacement',
      async () => {
        const user = createMinimalUser();
        vi.mocked(api.generateDraft).mockResolvedValueOnce({
          ...typedDraftFields(makeAssignmentText('# Generated assignment draft')),
          text: makeAssignmentText('# Generated assignment draft'),
          provider: 'openai',
          model: 'gpt-5.2',
          quota: {
            source: 'hybrid',
            lastUpdatedAt: now,
          },
        });
        await renderGenerationReadyAssignment();

        const draftTextarea = screen.getByRole('textbox', { name: /Assignment JSON/i });
        fireEvent.change(draftTextarea, {
          target: { value: makeAssignmentText('# Existing draft') },
        });
        await user.click(screen.getByRole('button', { name: /Confirm and continue/i }));
        await screen.findByRole('heading', { name: /Review and share/i });
        await previewCurrentDraft(user);

        const publishButton = screen.getByRole('button', { name: /Share assignment/i });
        expect((publishButton as HTMLButtonElement).disabled).toBe(false);

        await user.click(screen.getByRole('button', { name: /Create/i }));
        const generateDraftButton = await screen.findByRole('button', {
          name: /^(Generate assignment|Regenerate)$/i,
        });
        await waitFor(() => {
          expect((generateDraftButton as HTMLButtonElement).disabled).toBe(false);
        });
        await user.click(generateDraftButton);

        await waitFor(() => {
          expect(api.generateDraft).toHaveBeenCalledWith({
            promptPackageId: 'pkg-1',
            provider: 'openai',
            model: 'gpt-5.2',
          });
          expect(
            screen.getByDisplayValue(makeAssignmentText('# Generated assignment draft')),
          ).toBeTruthy();
        });
        await user.click(screen.getByRole('button', { name: /Confirm and continue/i }));
        await waitFor(() =>
          expect(api.confirmAssignmentSessionStep).toHaveBeenCalledWith(
            'session-resumed',
            expect.objectContaining({ step: 'create' }),
          ),
        );
        await screen.findByRole('heading', { name: /Review and share/i });
        const refreshedPublishButton = screen.getByRole('button', { name: /Share assignment/i });
        expect((refreshedPublishButton as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByRole('button', { name: /Preview assignment/i }).className).toContain(
          'minimal-preview-attention',
        );
        expect(screen.queryByText('Preview required before sharing.')).toBeNull();
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );

    it(
      'ignores stale generation responses after flow reset',
      async () => {
        const user = createMinimalUser();
        let resolveGeneration: (value: ApiTypes.GenerateDraftResponse) => void = () => {};
        vi.mocked(api.generateDraft).mockImplementationOnce(
          () =>
            new Promise<ApiTypes.GenerateDraftResponse>((resolve) => {
              resolveGeneration = resolve;
            }),
        );

        await renderResumedAssignment();

        await user.click(
          screen.getByRole('button', { name: /^(Generate assignment|Regenerate)$/i }),
        );
        await waitFor(() => {
          expect(api.generateDraft).toHaveBeenCalledWith({
            promptPackageId: 'pkg-1',
            provider: 'openai',
            model: 'gpt-5.2',
          });
        });

        await user.click(screen.getByRole('button', { name: /Student/i }));
        await user.click(screen.getByRole('button', { name: /Change assignment/i }));

        await act(async () => {
          resolveGeneration({
            ...typedDraftFields(makeAssignmentText('# Stale generated draft')),
            text: makeAssignmentText('# Stale generated draft'),
            provider: 'openai',
            model: 'gpt-5.2',
            quota: {
              source: 'hybrid',
              lastUpdatedAt: now,
            },
          });
          await Promise.resolve();
        });

        await waitFor(
          () => {
            expect(
              screen.queryByDisplayValue(makeAssignmentText('# Stale generated draft')),
            ).toBeNull();
          },
          { timeout: UI_WAIT_TIMEOUT_MS },
        );
        expect(screen.queryByText(/Assignment draft ready/i)).toBeNull();
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );
  });
}
