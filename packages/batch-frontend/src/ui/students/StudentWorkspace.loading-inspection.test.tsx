import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS,
  renderWorkspace,
  setupStudentWorkspaceTest,
} from './StudentWorkspace.test-harness';
import * as api from '../../utils/api';

describe('StudentWorkspace loading and inspection', () => {
  beforeEach(() => {
    setupStudentWorkspaceTest();
  });

  it('loads and renders student workspace data', async () => {
    renderWorkspace();

    expect(screen.getByRole('heading', { name: /Student Workspace/i })).toBeTruthy();
    await screen.findByText(
      /Current profile:/i,
      {},
      { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
    );

    expect(screen.getByRole('heading', { name: /Assignment History/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Student Timeline/i })).toBeTruthy();
    expect(api.getStudentMemoryOverview).toHaveBeenCalledWith('student-default', {
      lessonLimit: 3,
      homeworkLimit: 2,
    });
  });

  it('does not refetch assignment history until apply is clicked', async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await waitFor(() => {
      expect(api.listUserJobs).toHaveBeenCalledTimes(1);
    });

    await user.selectOptions(screen.getByRole('combobox', { name: /State/i }), 'failed');
    expect(api.listUserJobs).toHaveBeenCalledTimes(1);

    const applyButtons = screen.getAllByRole('button', { name: /Apply/i });
    await user.click(applyButtons[0]!);

    await waitFor(() => {
      expect(api.listUserJobs).toHaveBeenCalledTimes(2);
    });
    expect(vi.mocked(api.listUserJobs).mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ state: 'failed' }),
    );
  });

  it('does not refetch timeline until apply is clicked', async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await waitFor(() => {
      expect(api.getStudentTimeline).toHaveBeenCalledTimes(1);
    });

    await user.selectOptions(
      screen.getByRole('combobox', { name: /Event type/i }),
      'job_completed',
    );
    expect(api.getStudentTimeline).toHaveBeenCalledTimes(1);

    const applyButtons = screen.getAllByRole('button', { name: /Apply/i });
    await user.click(applyButtons[1]!);

    await waitFor(() => {
      expect(api.getStudentTimeline).toHaveBeenCalledTimes(2);
    });
    expect(vi.mocked(api.getStudentTimeline).mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ type: 'job_completed' }),
    );
  });

  it('inspects a job and loads provenance and lineage', async () => {
    const user = userEvent.setup();
    renderWorkspace();

    const inspectButton = await screen.findByRole(
      'button',
      { name: /Inspect/i },
      { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
    );
    await user.click(inspectButton);

    await waitFor(
      () => {
        expect(api.fetchJobProvenance).toHaveBeenCalledWith('job-1');
      },
      { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
    );
    await waitFor(
      () => {
        expect(api.fetchPromptPackageLineage).toHaveBeenCalledWith('pkg-1');
      },
      { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
    );

    expect(screen.getByText(/Action audit:/i)).toBeTruthy();
    expect(screen.getByText(/Assignment Memory Provenance/i)).toBeTruthy();
    expect(screen.getByText(/Snapshot at creation:/i)).toBeTruthy();
  });

  it('renders the read-only student memory overview near provenance', async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByText(
      /The student is improving fluency but still needs article review\./i,
      {},
      { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
    );
    expect(screen.getByText(/Travel lesson with article corrections\./i)).toBeTruthy();
    expect(screen.getByText(/Travel advice/i)).toBeTruthy();
    expect(screen.getByText(/Article choice/i)).toBeTruthy();

    const inspectButton = await screen.findByRole(
      'button',
      { name: /Inspect/i },
      { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
    );
    await user.click(inspectButton);

    await screen.findByText(/Selected lesson memory IDs:/i, {}, {
      timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS,
    });
    expect(screen.getByText(/student-memory-v1/i)).toBeTruthy();
    expect(screen.getByText(/Selected homework memory IDs:/i)).toBeTruthy();
  });

  it('re-fetches lineage when inspecting the same job repeatedly', async () => {
    const user = userEvent.setup();
    renderWorkspace();

    const inspectButton = await screen.findByRole(
      'button',
      { name: /Inspect/i },
      { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
    );
    await user.click(inspectButton);

    await waitFor(
      () => {
        expect(api.fetchJobProvenance).toHaveBeenCalledTimes(1);
      },
      { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
    );
    await waitFor(
      () => {
        expect(api.fetchPromptPackageLineage).toHaveBeenCalledTimes(1);
      },
      { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
    );
    await screen.findByText(
      /Binding at creation:/i,
      {},
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
        expect(api.fetchJobProvenance).toHaveBeenCalledTimes(2);
      },
      { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
    );
    await waitFor(
      () => {
        expect(api.fetchPromptPackageLineage).toHaveBeenCalledTimes(2);
      },
      { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
    );
    await screen.findByText(
      /Binding at creation:/i,
      {},
      { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
    );
  });

  it('renders a resume link to minimal workflow for each job', async () => {
    renderWorkspace();

    const resumeLink = await screen.findByRole(
      'link',
      { name: /Resume/i },
      { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
    );
    expect(resumeLink.getAttribute('href')).toBe('/?jobId=job-1');
  });
});
