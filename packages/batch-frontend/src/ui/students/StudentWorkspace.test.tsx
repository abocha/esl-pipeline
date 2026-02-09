import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as api from '../../utils/api';
import { StudentWorkspace } from './StudentWorkspace';

vi.mock('../../utils/api', () => ({
  activateProfileRevision: vi.fn(),
  createStudentProfile: vi.fn(),
  fetchJobProvenance: vi.fn(),
  fetchPromptPackageLineage: vi.fn(),
  getProfileContent: vi.fn(),
  getStudentProfile: vi.fn(),
  getStudentTimeline: vi.fn(),
  listProfileContents: vi.fn(),
  listProfileRevisions: vi.fn(),
  listStudentProfileBindings: vi.fn(),
  listStudents: vi.fn(),
  listUserJobs: vi.fn(),
  restoreProfileRevision: vi.fn(),
  updateStudentProfile: vi.fn(),
  upsertProfileContent: vi.fn(),
}));

const now = '2026-02-07T12:00:00.000Z';

function renderWorkspace() {
  return render(
    <MemoryRouter>
      <StudentWorkspace />
    </MemoryRouter>,
  );
}

describe('StudentWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(api.listStudents).mockResolvedValue({
      items: [
        {
          id: 'student-default',
          student: 'Default',
          profileId: 'profile-default.md',
        },
      ],
      total: 1,
      limit: 200,
      offset: 0,
      order: 'asc',
    });

    vi.mocked(api.getStudentProfile).mockResolvedValue({
      id: 'student-default',
      student: 'Default',
      profileId: 'profile-default.md',
    });

    vi.mocked(api.listProfileContents).mockResolvedValue({
      profiles: [
        { id: 'profile-default.md', label: 'Default Profile' },
        { id: 'profile-alt.md', label: 'Alt Profile' },
      ],
    });

    vi.mocked(api.getProfileContent).mockResolvedValue({
      id: 'profile-default.md',
      label: 'Default Profile',
      content: 'PROFILE CONTENT',
      currentRevisionId: 'revision-1',
      updatedAt: now,
    });

    vi.mocked(api.listProfileRevisions).mockResolvedValue({
      items: [
        {
          id: 'revision-1',
          profileId: 'profile-default.md',
          contentHash: 'hash-1',
          source: 'create',
          status: 'active',
          versionNumber: 1,
          versionLabel: 'v1',
          activatedAt: now,
          deprecatedAt: null,
          createdAt: now,
          createdBy: 'user-1',
          restoredFromRevisionId: null,
        },
      ],
      total: 1,
      limit: 25,
      offset: 0,
      order: 'desc',
    });

    vi.mocked(api.listUserJobs).mockResolvedValue({
      jobs: [
        {
          jobId: 'job-1',
          md: null,
          mdStorageUri: null,
          recordingId: 'rec-1',
          transcriptId: 'tx-1',
          promptPackageId: 'pkg-1',
          draftId: 'draft-1',
          preset: 'b1-default',
          withTts: true,
          voiceId: null,
          upload: 's3',
          voiceAccent: null,
          forceTts: false,
          notionDatabase: null,
          publishTarget: 'notion',
          ttsStrategy: 'auto',
          autoPublish: false,
          notionUrl: null,
          anytypeUrl: null,
          state: 'succeeded',
          createdAt: now,
          updatedAt: now,
          startedAt: now,
          finishedAt: now,
          error: null,
          manifestPath: null,
        },
      ],
      total: 1,
      limit: 25,
      offset: 0,
    });

    vi.mocked(api.getStudentTimeline).mockResolvedValue({
      items: [
        {
          type: 'job_completed',
          studentId: 'student-default',
          status: 'succeeded',
          createdAt: now,
          displayName: 'Default',
        },
      ],
      total: 1,
      limit: 25,
      offset: 0,
      order: 'desc',
    });

    vi.mocked(api.listStudentProfileBindings).mockResolvedValue({
      items: [
        {
          id: 'binding-1',
          studentId: 'student-default',
          profileId: 'profile-default.md',
          effectiveFrom: now,
          effectiveTo: null,
          reason: null,
          changedBy: 'user-1',
          createdAt: now,
        },
      ],
      total: 1,
      limit: 20,
      offset: 0,
      order: 'desc',
    });

    vi.mocked(api.fetchJobProvenance).mockResolvedValue({
      job: {
        id: 'job-1',
        state: 'succeeded',
        createdAt: now,
        updatedAt: now,
        startedAt: now,
        finishedAt: now,
        sourceJobId: null,
        manifestPath: null,
        notionUrl: null,
        anytypeUrl: null,
        error: null,
      },
      sourceJob: null,
      recording: {
        id: 'rec-1',
        studentId: 'student-default',
        sourcePath: null,
        storageUri: null,
        status: 'transcribed',
        createdAt: now,
      },
      transcript: {
        id: 'tx-1',
        mode: 'timeline',
        model: 'mock-model',
        language: 'en',
        createdAt: now,
      },
      promptPackage: {
        id: 'pkg-1',
        studentId: 'student-default',
        createdAt: now,
        updatedAt: now,
      },
      draft: {
        id: 'draft-1',
        studentId: 'student-default',
        storageUri: 'memory://drafts/draft-1',
        createdAt: now,
        updatedAt: now,
      },
      lineage: null,
      actions: [
        {
          id: 'action-1',
          actionType: 'rerun_audio',
          outcome: 'succeeded',
          requestedAt: now,
          requestedBy: 'user-1',
          message: 'Rerun accepted',
          errorCode: null,
          createdJobId: 'job-2',
        },
      ],
    });

    vi.mocked(api.fetchPromptPackageLineage).mockResolvedValue({
      promptPackageId: 'pkg-1',
      recordingId: 'rec-1',
      transcriptId: 'tx-1',
      studentId: 'student-default',
      createdAt: now,
      updatedAt: now,
      profile: {
        snapshot: {
          profileId: 'profile-default.md',
          revisionId: 'revision-1',
          hash: 'hash-1',
          versionLabel: 'v1',
          status: 'active',
          updatedAt: now,
        },
        current: {
          profileId: 'profile-default.md',
          revisionId: 'revision-1',
          hash: 'hash-1',
          versionLabel: 'v1',
          status: 'active',
          updatedAt: now,
        },
        drift: null,
      },
      template: {
        snapshot: {
          templateId: 'template.md',
          revisionId: 'template-rev-1',
          hash: 'hash-template',
          versionLabel: 'v1',
          status: 'active',
          updatedAt: now,
        },
        current: {
          templateId: 'template.md',
          revisionId: 'template-rev-1',
          hash: 'hash-template',
          versionLabel: 'v1',
          status: 'active',
          updatedAt: now,
        },
        drift: null,
      },
      bindingAtCreation: {
        bindingId: 'binding-1',
        studentId: 'student-default',
        profileId: 'profile-default.md',
        effectiveFrom: now,
        effectiveTo: null,
        reason: null,
        changedBy: 'user-1',
        createdAt: now,
      },
    });

    vi.mocked(api.updateStudentProfile).mockResolvedValue({
      id: 'student-default',
      student: 'Default',
      profileId: 'profile-alt.md',
    });

    vi.mocked(api.upsertProfileContent).mockResolvedValue({
      id: 'profile-default.md',
      label: 'Default Profile',
      content: 'PROFILE CONTENT',
      currentRevisionId: 'revision-1',
      updatedAt: now,
    });

    vi.mocked(api.restoreProfileRevision).mockResolvedValue({
      id: 'profile-default.md',
      label: 'Default Profile',
      content: 'PROFILE CONTENT',
      currentRevisionId: 'revision-1',
      updatedAt: now,
    });

    vi.mocked(api.activateProfileRevision).mockResolvedValue({
      id: 'profile-default.md',
      label: 'Default Profile',
      content: 'PROFILE CONTENT',
      currentRevisionId: 'revision-1',
      updatedAt: now,
    });

    vi.mocked(api.createStudentProfile).mockResolvedValue({
      id: 'student-created',
      student: 'Created Student',
      profileId: null,
    });
  });

  it('loads and renders student workspace data', async () => {
    renderWorkspace();

    expect(screen.getByRole('heading', { name: /Student Workspace/i })).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText(/Current profile:/i)).toBeTruthy();
    });

    expect(screen.getByRole('heading', { name: /Assignment History/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Student Timeline/i })).toBeTruthy();
  });

  it('inspects a job and loads provenance and lineage', async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Inspect/i })).toBeTruthy();
    });

    await user.click(screen.getByRole('button', { name: /Inspect/i }));

    await waitFor(() => {
      expect(api.fetchJobProvenance).toHaveBeenCalledWith('job-1');
    });
    await waitFor(() => {
      expect(api.fetchPromptPackageLineage).toHaveBeenCalledWith('pkg-1');
    });

    expect(screen.getByText(/Action audit:/i)).toBeTruthy();
  });

  it('renders a resume link to minimal workflow for each job', async () => {
    renderWorkspace();

    const resumeLink = await screen.findByRole('link', { name: /Resume/i });
    expect(resumeLink.getAttribute('href')).toBe('/?jobId=job-1');
  });

  it('updates student profile binding', async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Save Student Binding/i })).toBeTruthy();
    });

    await user.selectOptions(
      screen.getByRole('combobox', { name: /Bound profile/i }),
      'profile-alt.md',
    );
    await user.click(screen.getByRole('button', { name: /Save Student Binding/i }));

    await waitFor(() => {
      expect(api.updateStudentProfile).toHaveBeenCalledWith('student-default', {
        profileId: 'profile-alt.md',
      });
    });
  });

  it('validates student creation name before submit', async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Create Student/i })).toBeTruthy();
    });

    await user.click(screen.getByRole('button', { name: /Create Student/i }));
    await user.click(screen.getByRole('button', { name: /^Create Student$/i }));

    expect(screen.getByText(/Student name is required/i)).toBeTruthy();
    expect(api.createStudentProfile).not.toHaveBeenCalled();
  });

  it('creates a student and keeps workspace context updated', async () => {
    const user = userEvent.setup();
    vi.mocked(api.createStudentProfile).mockResolvedValue({
      id: 'student-alex',
      student: 'Alex',
      profileId: 'profile-alt.md',
    });
    vi.mocked(api.getStudentProfile).mockImplementation(async (id: string) => {
      if (id === 'student-alex') {
        return {
          id: 'student-alex',
          student: 'Alex',
          profileId: 'profile-alt.md',
        };
      }
      return {
        id: 'student-default',
        student: 'Default',
        profileId: 'profile-default.md',
      };
    });

    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Create Student/i })).toBeTruthy();
    });

    await user.click(screen.getByRole('button', { name: /Create Student/i }));
    await user.type(screen.getByLabelText(/Student Name/i), 'Alex');
    await user.selectOptions(screen.getByLabelText(/Initial Profile/i), 'profile-alt.md');
    await user.click(screen.getByRole('button', { name: /^Create Student$/i }));

    await waitFor(() => {
      expect(api.createStudentProfile).toHaveBeenCalledWith({
        student: 'Alex',
        profileId: 'profile-alt.md',
      });
    });

    expect(screen.getByText(/Created student Alex/i)).toBeTruthy();
  });

  it('keeps create form values on create failure', async () => {
    const user = userEvent.setup();
    vi.mocked(api.createStudentProfile).mockRejectedValue(new Error('Student already exists'));

    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Create Student/i })).toBeTruthy();
    });

    await user.click(screen.getByRole('button', { name: /Create Student/i }));
    await user.type(screen.getByLabelText(/Student Name/i), 'Existing');
    await user.click(screen.getByText(/Advanced fields/i));
    await user.type(screen.getByLabelText(/Color Preset/i), 'amber');
    await user.click(screen.getByRole('button', { name: /^Create Student$/i }));

    await waitFor(() => {
      expect(screen.getByText(/Student already exists/i)).toBeTruthy();
    });

    expect((screen.getByLabelText(/Student Name/i) as HTMLInputElement).value).toBe('Existing');
    expect((screen.getByLabelText(/Color Preset/i) as HTMLInputElement).value).toBe('amber');
  });
});
