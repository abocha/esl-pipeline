import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  renderInspectionPanel,
  renderWorkspaceHistoryPanel,
  renderWorkspaceInspectionReady,
  STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS,
  setupStudentWorkspaceTest,
  studentWorkspaceApiMocks,
} from './StudentWorkspace.test-harness';

describe('StudentWorkspace loading and inspection', () => {
  beforeEach(() => {
    setupStudentWorkspaceTest();
  });

  it('renders the inspection panel without a full workspace boot', () => {
    renderInspectionPanel();

    expect(screen.getByRole('heading', { name: /Lineage & Provenance/i })).toBeTruthy();
    expect(screen.getByText(/Action audit:/i)).toBeTruthy();
    expect(screen.getByText(/Assignment Memory Provenance/i)).toBeTruthy();
    expect(screen.getByText(/student-memory-v1/i)).toBeTruthy();
  });

  it('does not refetch assignment history until apply is clicked', async () => {
    const user = userEvent.setup();
    const onApplyHistoryFilters = vi.fn();
    renderWorkspaceHistoryPanel({ onApplyHistoryFilters });

    await user.selectOptions(screen.getByRole('combobox', { name: /State/i }), 'failed');

    const applyButtons = screen.getAllByRole('button', { name: /Apply/i });
    await user.click(applyButtons[0]!);

    expect(onApplyHistoryFilters).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'failed' }),
    );
  });

  it('does not refetch timeline until apply is clicked', async () => {
    const user = userEvent.setup();
    const onApplyTimelineFilters = vi.fn();
    renderWorkspaceHistoryPanel({ onApplyTimelineFilters });

    await user.selectOptions(
      screen.getByRole('combobox', { name: /Event type/i }),
      'job_completed',
    );

    const applyButtons = screen.getAllByRole('button', { name: /Apply/i });
    await user.click(applyButtons[1]!);

    expect(onApplyTimelineFilters).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'job_completed' }),
    );
  });

  it('inspects a job and loads provenance and lineage', async () => {
    const user = userEvent.setup();
    await renderWorkspaceInspectionReady();

    const inspectButton = await screen.findByRole(
      'button',
      { name: /Inspect/i },
      { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
    );
    await user.click(inspectButton);

    await waitFor(
      () => {
        expect(studentWorkspaceApiMocks.fetchJobProvenance).toHaveBeenCalledWith('job-1');
      },
      { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
    );
    await waitFor(
      () => {
        expect(studentWorkspaceApiMocks.fetchPromptPackageLineage).toHaveBeenCalledWith('pkg-1');
      },
      { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
    );

    expect(screen.getByText(/Action audit:/i)).toBeTruthy();
    expect(screen.getByText(/Binding at creation:/i)).toBeTruthy();
  });

  it('re-fetches lineage when inspecting the same job repeatedly', async () => {
    const user = userEvent.setup();
    await renderWorkspaceInspectionReady();

    const inspectButton = await screen.findByRole(
      'button',
      { name: /Inspect/i },
      { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
    );
    await user.click(inspectButton);

    await waitFor(
      () => {
        expect(studentWorkspaceApiMocks.fetchJobProvenance).toHaveBeenCalledTimes(1);
      },
      { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
    );
    await waitFor(
      () => {
        expect(studentWorkspaceApiMocks.fetchPromptPackageLineage).toHaveBeenCalledTimes(1);
      },
      { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
    );

    await user.click(
      await screen.findByRole(
        'button',
        { name: /Inspect/i },
        { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
      ),
    );

    await waitFor(
      () => {
        expect(studentWorkspaceApiMocks.fetchJobProvenance).toHaveBeenCalledTimes(2);
      },
      { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
    );
    await waitFor(
      () => {
        expect(studentWorkspaceApiMocks.fetchPromptPackageLineage).toHaveBeenCalledTimes(2);
      },
      { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
    );
  });

  it('shows provenance audio notices without requiring log access', async () => {
    const user = userEvent.setup();
    studentWorkspaceApiMocks.fetchJobProvenance.mockResolvedValueOnce({
      job: {
        id: 'job-1',
        state: 'succeeded',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:01:00.000Z',
        startedAt: '2024-01-01T00:00:10.000Z',
        finishedAt: '2024-01-01T00:01:00.000Z',
        sourceJobId: 'job-0',
        manifestPath: '/tmp/manifest.json',
        notionUrl: null,
        anytypeUrl: null,
        error: null,
      },
      sourceJob: null,
      recording: null,
      transcript: null,
      promptPackage: {
        id: 'pkg-1',
        studentId: 'student-default',
        createdAt: null,
        updatedAt: null,
      },
      draft: null,
      tts: null,
      pronunciationWarnings: [
        {
          code: 'rerun_pronunciation_chunk_unknown_previous_provider',
          message:
            'Pronunciation chunk rerun could not confirm the previous clip provider; using provider-scoped fallback resolution instead.',
        },
      ],
      lineage: null,
      actions: [],
    });

    await renderWorkspaceInspectionReady();

    const inspectButton = await screen.findByRole(
      'button',
      { name: /Inspect/i },
      { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
    );
    await user.click(inspectButton);

    expect(await screen.findByText(/Audio notices/i)).toBeTruthy();
    expect(screen.getByText(/using provider-scoped fallback resolution instead/i)).toBeTruthy();
  });
});
