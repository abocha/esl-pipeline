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
  openAdvancedActions,
  openGenerationLimits,
  openGenerationSettings,
  preparePromptReady,
  previewCurrentDraft,
  renderGenerationReadyAssignment,
  renderMinimalAssignment,
  renderResumedAssignment,
  testScreen as screen,
  setupMinimalAssignmentTest,
  UI_WAIT_TIMEOUT_MS,
  testVi as vi,
  testWaitFor as waitFor,
} from './MinimalAssignment.test-harness';

const selectOpenAiGenerationModel = () => {
  openGenerationSettings();
  fireEvent.change(screen.getByRole('combobox', { name: /Generation provider/i }), {
    target: { value: 'openai' },
  });
  fireEvent.change(screen.getByRole('combobox', { name: /Generation model/i }), {
    target: { value: 'gpt-5.2' },
  });
};

export function registerGenerationDefaultsTests() {
  describe('MinimalAssignment - generation defaults', () => {
    beforeEach(() => {
      setupMinimalAssignmentTest();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('initializes generation provider/model from job options defaults', async () => {
      renderMinimalAssignment();

      const providerSelect = await screen.findByRole('combobox', { name: /Generation provider/i });
      const modelSelect = await screen.findByRole('combobox', { name: /Generation model/i });

      await waitFor(() => {
        expect((providerSelect as HTMLSelectElement).value).toBe('openai');
        expect((modelSelect as HTMLSelectElement).value).toBe('gpt-5.2');
      });
    });

    it('shows quota panel from job options before first draft generation', async () => {
      renderMinimalAssignment();

      openGenerationSettings();
      openGenerationLimits();
      await screen.findByText(/Source: Hybrid/i);
      expect(screen.getByText(/RPM: 5/i)).toBeTruthy();
      expect(screen.getByText(/TPM: 250000/i)).toBeTruthy();
      expect(screen.getByText(/RPD: 20/i)).toBeTruthy();
      expect(screen.getByText(/Updated: .*?\(.+?\)/i)).toBeTruthy();
    });

    it('refreshes baseline quota panel values when job options are reloaded', async () => {
      const user = createMinimalUser();
      await renderResumedAssignment({}, { user, waitFor: 'promptReady' });

      openGenerationSettings();
      openGenerationLimits();
      await screen.findByText(/Source: Hybrid/i);
      expect(screen.getByText(/RPM: 5/i)).toBeTruthy();

      vi.mocked(api.fetchJobOptions).mockResolvedValueOnce({
        presets: ['b1-default', 'b2-default'],
        cefrLevels: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
        cefrDefault: 'B1',
        generation: {
          providers: ['openai', 'google_ai_studio', 'openrouter'],
          defaultProvider: 'openai',
          modelOptions: [
            {
              provider: 'openai',
              id: 'gpt-5.2',
              tier: 'primary',
              fallbackRank: 0,
              defaultSelected: true,
              enabled: true,
            },
          ],
          defaultModelByProvider: {
            openai: 'gpt-5.2',
          },
          quota: {
            source: 'configured',
            lastUpdatedAt: '2026-02-18T00:20:00.000Z',
            requestsPerMinute: 99,
            requestsPerDay: 999,
          },
        },
        voiceAccents: ['american'],
        voices: [{ id: 'voice-a', name: 'Voice A', accent: 'american' }],
        ttsStrategies: ['auto', 'dialogue', 'tts'],
        supportedActions: [],
      });

      openAdvancedActions();
      await user.click(screen.getByRole('button', { name: /Refresh actions/i }));

      await waitFor(() => {
        expect(api.fetchJobOptions).toHaveBeenCalledTimes(2);
        expect(screen.getByText(/Source: Configured/i)).toBeTruthy();
        expect(screen.getByText(/RPM: 99/i)).toBeTruthy();
        expect(screen.getByText(/RPD: 999/i)).toBeTruthy();
      });
      expect(screen.queryByText(/RPM: 5/i)).toBeNull();
    });

    it('shows relative and absolute freshness in quota panel', async () => {
      renderMinimalAssignment();

      openGenerationSettings();
      openGenerationLimits();
      await screen.findByText(/Updated: (just now|\d+[mhd] ago) \(.+\)/i);
    });

    it(
      'enables generate draft only after prompt is ready',
      async () => {
        const user = createMinimalUser();
        renderMinimalAssignment();

        const generateDraftButton = screen.getByRole('button', {
          name: /Generate assignment content/i,
        });
        expect((generateDraftButton as HTMLButtonElement).disabled).toBe(true);

        await preparePromptReady(user);
        selectOpenAiGenerationModel();

        await waitFor(() => {
          expect((generateDraftButton as HTMLButtonElement).disabled).toBe(false);
        });
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );

    it(
      'generates draft markdown with selected provider/model',
      async () => {
        const user = createMinimalUser();
        await renderGenerationReadyAssignment();
        selectOpenAiGenerationModel();

        await user.click(screen.getByRole('button', { name: /Generate assignment content/i }));

        await waitFor(() => {
          expect(api.generateDraft).toHaveBeenCalledWith({
            promptPackageId: 'pkg-1',
            provider: 'openai',
            model: 'gpt-5.2',
          });
        });
        expect(await screen.findByDisplayValue('# Generated assignment draft')).toBeTruthy();
        expect(screen.getByText(/Generated with openai\/gpt-5.2/i)).toBeTruthy();
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
      'releases runtime RPM quota lock after minute window rollover',
      async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
          vi.setSystemTime(new Date('2026-02-18T00:00:40.000Z'));
          const user = createTimerAwareMinimalUser();
          vi.mocked(api.generateDraft).mockResolvedValueOnce({
            text: '# Generated assignment draft',
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
          selectOpenAiGenerationModel();

          const generateDraftButton = screen.getByRole('button', {
            name: /Generate assignment content/i,
          });
          await user.click(generateDraftButton);

          await waitFor(() => {
            expect(screen.getByText(/Per-minute request budget exhausted/i)).toBeTruthy();
          });
          expect((generateDraftButton as HTMLButtonElement).disabled).toBe(true);

          vi.setSystemTime(new Date('2026-02-18T00:01:05.000Z'));
          act(() => {
            vi.advanceTimersByTime(15_000);
          });

          await waitFor(() => {
            expect(
              (
                screen.getByRole('button', {
                  name: /Generate assignment content/i,
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
        selectOpenAiGenerationModel();
        await user.click(screen.getByRole('button', { name: /Generate assignment content/i }));

        await waitFor(() => {
          expect(api.generateDraft).toHaveBeenCalledWith({
            promptPackageId: 'pkg-1',
            provider: 'openai',
            model: 'gpt-5.2',
          });
        });

        await screen.findByText(
          /Provider timed out\. Retry or choose a faster model\/provider\. Request ID: req-timeout-1/i,
        );
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );

    it(
      'clears preview readiness and re-gates publish after generated draft replacement',
      async () => {
        const user = createMinimalUser();
        vi.mocked(api.generateDraft).mockResolvedValueOnce({
          text: '# Generated assignment draft',
          provider: 'openai',
          model: 'gpt-5.2',
          quota: {
            source: 'hybrid',
            lastUpdatedAt: now,
          },
        });
        await renderGenerationReadyAssignment();
        selectOpenAiGenerationModel();

        const draftTextarea = screen.getByRole('textbox', { name: /Draft markdown/i });
        fireEvent.change(draftTextarea, { target: { value: '# Existing draft' } });
        await previewCurrentDraft(user);

        const publishButton = screen.getByRole('button', { name: /Share assignment/i });
        expect((publishButton as HTMLButtonElement).disabled).toBe(false);

        const generateDraftButton = screen.getByRole('button', {
          name: /Generate assignment content/i,
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
          expect(screen.getByDisplayValue('# Generated assignment draft')).toBeTruthy();
        });
        expect((publishButton as HTMLButtonElement).disabled).toBe(true);
        expect(screen.getByText('Preview required before sharing.')).toBeTruthy();
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
        selectOpenAiGenerationModel();

        await user.click(screen.getByRole('button', { name: /Generate assignment content/i }));
        await waitFor(() => {
          expect(api.generateDraft).toHaveBeenCalledWith({
            promptPackageId: 'pkg-1',
            provider: 'openai',
            model: 'gpt-5.2',
          });
        });

        await user.click(screen.getByRole('button', { name: /Start new/i }));

        await act(async () => {
          resolveGeneration({
            text: '# Stale generated draft',
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
            expect(screen.queryByDisplayValue('# Stale generated draft')).toBeNull();
          },
          { timeout: UI_WAIT_TIMEOUT_MS },
        );
        expect(screen.queryByText(/Generated with openai\/gpt-5.2/i)).toBeNull();
      },
      INTEGRATION_TEST_TIMEOUT_MS,
    );
  });
}
