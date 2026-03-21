import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as api from '../../utils/api';
import { StudentWorkspace } from './StudentWorkspace';

vi.mock('../../utils/api', () => ({
  activateProfileRevision: vi.fn(),
  activateTemplateRevision: vi.fn(),
  createStudentProfile: vi.fn(),
  deleteTemplateContent: vi.fn(),
  fetchJobProvenance: vi.fn(),
  fetchPromptPackageLineage: vi.fn(),
  getProfileContent: vi.fn(),
  getStudentMemoryOverview: vi.fn(),
  getStudentProfile: vi.fn(),
  getStudentTimeline: vi.fn(),
  getTemplateContent: vi.fn(),
  listProfileContents: vi.fn(),
  listProfileRevisions: vi.fn(),
  listStudentProfileBindings: vi.fn(),
  listStudents: vi.fn(),
  listTemplateContents: vi.fn(),
  listTemplateRevisions: vi.fn(),
  listUserJobs: vi.fn(),
  restoreProfileRevision: vi.fn(),
  restoreTemplateRevision: vi.fn(),
  updateStudentProfile: vi.fn(),
  upsertProfileContent: vi.fn(),
  upsertTemplateContent: vi.fn(),
}));

const now = '2026-02-07T12:00:00.000Z';
const STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS = 5_000;

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

    vi.mocked(api.listTemplateContents).mockResolvedValue({
      templates: [{ id: 'template-default.md', label: 'Default Template' }],
    });

    vi.mocked(api.getTemplateContent).mockResolvedValue({
      id: 'template-default.md',
      label: 'Default Template',
      content: String.raw`HEADER\nINSERT PROFILE HERE\nFOOTER`,
      currentRevisionId: 'template-revision-1',
      updatedAt: now,
    });

    vi.mocked(api.listTemplateRevisions).mockResolvedValue({
      items: [
        {
          id: 'template-revision-1',
          templateId: 'template-default.md',
          contentHash: 'template-hash-1',
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

    vi.mocked(api.getStudentMemoryOverview).mockResolvedValue({
      studentId: 'student-default',
      latestReadyStudentMemorySnapshot: {
        id: 'snapshot-1',
        studentId: 'student-default',
        schemaVersion: 'student-memory-snapshot.v1',
        generatedAt: now,
        provider: 'openai',
        model: 'gpt-5.4',
        status: 'ready',
        sourceKind: 'student_memory_rollup',
        lessonMemoryEntryIds: ['lesson-1'],
        homeworkMemoryEntryIds: ['homework-1'],
        contentHash: 'snapshot-hash-1',
        generationNotes: null,
        stableStrengths: [],
        recurringIssues: [],
        activeReviewBacklog: [],
        recentProgress: [],
        personalFacts: [],
        recommendedAssignmentDirections: [],
        unresolvedIssues: [
          {
            label: 'Article choice',
            issueType: 'grammar',
            note: 'Still dropping articles in singular noun phrases.',
            priority: 'high',
          },
        ],
        snapshotSummary: 'The student is improving fluency but still needs article review.',
        supersededById: null,
        supersededAt: null,
        createdAt: now,
        updatedAt: now,
      },
      recentReadyLessonMemory: [
        {
          id: 'lesson-1',
          studentId: 'student-default',
          transcriptId: 'tx-older-1',
          recordingId: 'rec-older-1',
          schemaVersion: 'lesson-memory.v1',
          generatedAt: now,
          provider: 'openai',
          model: 'gpt-5.4',
          status: 'ready',
          sourceKind: 'lesson_transcript',
          generationNotes: null,
          lessonSummary: 'Travel lesson with article corrections.',
          topicsDiscussed: [{ topic: 'Travel', note: 'Planned a future trip.' }],
          mistakePatterns: [],
          grammarReviewed: [],
          grammarWatchlist: [],
          vocabularyFocus: [],
          pronunciationFocus: [],
          studentFacts: [],
          progressSignals: [],
          followUpRecommendations: [],
          supersededById: null,
          supersededAt: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
      recentReadyHomeworkMemory: [
        {
          id: 'homework-1',
          studentId: 'student-default',
          jobId: 'job-1',
          assignmentLineageKey: 'assignment-root-1',
          promptPackageId: 'pkg-1',
          draftId: 'draft-1',
          recordingId: 'rec-1',
          transcriptId: 'tx-1',
          schemaVersion: 'homework-memory.v1',
          generatedAt: now,
          provider: 'openrouter',
          model: 'qwen/qwen3.5',
          status: 'ready',
          sourceKind: 'published_assignment',
          contentHash: 'homework-hash-1',
          generationNotes: null,
          homeworkSummary: 'Give advice to a traveler using article prompts.',
          topic: 'Travel advice',
          grammarTargets: [],
          vocabularyTargets: [],
          reviewTargets: [],
          taskList: [],
          pronunciationFocus: [],
          studyTextType: 'dialogue',
          inputType: 'generate',
          communicativeOutcome: 'Give advice',
          teacherFollowUpCues: [],
          publishedAt: now,
          publishTargets: [],
          supersededById: null,
          supersededAt: null,
          createdAt: now,
          updatedAt: now,
        },
      ],
      unresolvedIssues: [
        {
          label: 'Article choice',
          issueType: 'grammar',
          note: 'Still dropping articles in singular noun phrases.',
          priority: 'high',
        },
      ],
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
      tts: null,
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
      memory: {
        studentMemorySnapshotId: 'snapshot-1',
        studentMemorySnapshotHash: 'snapshot-hash-1',
        selectedLessonMemoryIds: ['lesson-1', 'lesson-0'],
        selectedHomeworkMemoryIds: ['homework-1'],
        retrievalPolicyVersion: 'student-memory-v1',
        layerAvailability: {
          studentMemorySnapshot: 'available',
          recentLessonMemory: 'available',
          recentHomeworkMemory: 'available',
          retrievalPolicy: 'available',
        },
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

    vi.mocked(api.upsertTemplateContent).mockResolvedValue({
      id: 'template-default.md',
      label: 'Default Template',
      content: String.raw`HEADER\nINSERT PROFILE HERE\nFOOTER`,
      currentRevisionId: 'template-revision-2',
      updatedAt: now,
    });

    vi.mocked(api.restoreTemplateRevision).mockResolvedValue({
      id: 'template-default.md',
      label: 'Default Template',
      content: String.raw`HEADER\nINSERT PROFILE HERE\nFOOTER`,
      currentRevisionId: 'template-revision-1',
      updatedAt: now,
    });

    vi.mocked(api.activateTemplateRevision).mockResolvedValue({
      id: 'template-revision-1',
      templateId: 'template-default.md',
      contentHash: 'template-hash-1',
      source: 'create',
      status: 'active',
      versionNumber: 1,
      versionLabel: 'v1',
      activatedAt: now,
      deprecatedAt: null,
      createdAt: now,
      createdBy: 'user-1',
      restoredFromRevisionId: null,
      content: String.raw`HEADER\nINSERT PROFILE HERE\nFOOTER`,
    });

    vi.mocked(api.deleteTemplateContent).mockResolvedValue();

    vi.mocked(api.createStudentProfile).mockResolvedValue({
      id: 'student-created',
      student: 'Created Student',
      profileId: null,
    });
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

  it('updates student profile binding', async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByRole(
      'button',
      { name: /Save Student Binding/i },
      { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
    );

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

  it('saves template content from template gallery panel', async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByRole(
      'button',
      { name: /Save Template Content/i },
      { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
    );

    const templateEditor = screen.getByPlaceholderText(
      /Select a template to edit/i,
    ) as HTMLTextAreaElement;
    await user.clear(templateEditor);
    await user.type(templateEditor, String.raw`HEADER\nINSERT PROFILE HERE\nUPDATED`);
    await user.click(screen.getByRole('button', { name: /Save Template Content/i }));

    await waitFor(() => {
      expect(api.upsertTemplateContent).toHaveBeenCalledWith(
        'template-default.md',
        expect.stringContaining('INSERT PROFILE HERE'),
      );
    });
  });

  it('creates template with scaffold marker on its own line', async () => {
    const user = userEvent.setup();
    vi.mocked(api.upsertTemplateContent).mockResolvedValue({
      id: 'hw/custom-template.md',
      label: 'Custom Template',
      content: '## Prompt\n\nINSERT PROFILE HERE\n\n## Transcript\n',
      currentRevisionId: 'template-revision-3',
      updatedAt: now,
    });

    renderWorkspace();

    await screen.findByRole(
      'button',
      { name: /Create Template/i },
      { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
    );

    await user.type(screen.getByLabelText(/New template ID/i), 'hw/custom-template.md');
    await user.click(screen.getByRole('button', { name: /Create Template/i }));

    await waitFor(() => {
      expect(api.upsertTemplateContent).toHaveBeenCalledWith(
        'hw/custom-template.md',
        '## Prompt\n\nINSERT PROFILE HERE\n\n## Transcript\n',
      );
    });
  });

  it('validates student creation name before submit', async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByRole(
      'button',
      { name: /Create Student/i },
      { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
    );

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

    await screen.findByRole(
      'button',
      { name: /Create Student/i },
      { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
    );

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

    await screen.findByRole(
      'button',
      { name: /Create Student/i },
      { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
    );

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
