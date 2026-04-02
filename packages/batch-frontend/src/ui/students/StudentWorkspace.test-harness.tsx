import { render, screen, waitFor } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

import * as api from '../../utils/api';
import { StudentWorkspace } from './StudentWorkspace';

vi.mock('../../utils/api', () => ({
  activateProfileRevision: vi.fn(),
  activateTemplateRevision: vi.fn(),
  approveStudentProfileCandidate: vi.fn(),
  createStudentProfile: vi.fn(),
  deferStudentProfileCandidate: vi.fn(),
  deleteTemplateContent: vi.fn(),
  fetchJobProvenance: vi.fn(),
  fetchPromptPackageLineage: vi.fn(),
  getProfileContent: vi.fn(),
  getStudentMemoryOverview: vi.fn(),
  getStudentProfile: vi.fn(),
  getStudentTimeline: vi.fn(),
  getTemplateContent: vi.fn(),
  listStudentProfileCandidates: vi.fn(),
  listProfileContents: vi.fn(),
  listProfileRevisions: vi.fn(),
  listStudentProfileBindings: vi.fn(),
  listStudents: vi.fn(),
  listTemplateContents: vi.fn(),
  listTemplateRevisions: vi.fn(),
  listUserJobs: vi.fn(),
  promoteStudentProfileCandidates: vi.fn(),
  rejectStudentProfileCandidate: vi.fn(),
  restoreProfileRevision: vi.fn(),
  restoreTemplateRevision: vi.fn(),
  updateStudentProfile: vi.fn(),
  upsertProfileContent: vi.fn(),
  upsertTemplateContent: vi.fn(),
}));

export const STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS = 5_000;
export const CLEAN_TEMPLATE_STARTER_CONTENT = String.raw`## **System Prompt: ESL Homework Generator**

**Role & Scope**
You are an Expert ESL Content Assistant operating in a stateless backend runtime. Produce one complete homework assignment for one adult ESL student.

**Working Context Contract**
Treat the labeled context blocks appended after these instructions as the complete runtime context for this request.

**Context Priority Rules**
Use the runtime blocks in this order:
1. **[LATEST_TRANSCRIPT]**
2. **[TEACHER_NOTES]**
3. **[UNRESOLVED_ISSUES]**, **[RECENT_LESSON_MEMORY]**, **[RECENT_HOMEWORK_MEMORY]**
4. **[STUDENT_MEMORY_SNAPSHOT]**
5. **[FOUNDATIONAL_PROFILE]**

**Task-Specific Generation Rules**
1. Produce one coherent homework mission.
2. Use one primary input source.
3. If no input type is specified, default to \`generate\`.

**Output Formatting Rules**
- Return one Markdown code block with YAML front matter.
- Use the required section structure.
`;

const now = '2026-02-07T12:00:00.000Z';

function seedStudentWorkspaceMocks() {
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
    content: CLEAN_TEMPLATE_STARTER_CONTENT,
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
        actionType: 'rerun',
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
    content: CLEAN_TEMPLATE_STARTER_CONTENT,
    currentRevisionId: 'template-revision-2',
    updatedAt: now,
  });

  vi.mocked(api.restoreTemplateRevision).mockResolvedValue({
    id: 'template-default.md',
    label: 'Default Template',
    content: CLEAN_TEMPLATE_STARTER_CONTENT,
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
    content: CLEAN_TEMPLATE_STARTER_CONTENT,
  });

  vi.mocked(api.deleteTemplateContent).mockResolvedValue();

  vi.mocked(api.listStudentProfileCandidates).mockResolvedValue({
    studentId: 'student-default',
    items: [
      {
        id: 'candidate-pending',
        studentId: 'student-default',
        proposedFact: 'Uses English with product and engineering teams at work.',
        approvedFactText: null,
        category: 'work_context',
        targetSection: 'work_communication_context',
        sourceSummary: 'Repeatedly mentioned sprint planning and client calls.',
        authority: 'student_stated',
        confidence: 'high',
        evidence: [
          {
            quote: 'I have meetings with developers and clients every week.',
            speakerRole: 'student',
            transcriptSpan: '00:14-00:19',
            evidenceNote: 'Direct work-context statement.',
            sourceKind: 'lesson_memory',
            sourceArtifactId: 'lesson-1',
          },
        ],
        sourceSnapshotId: 'snapshot-1',
        sourceLessonMemoryIds: ['lesson-1'],
        status: 'pending_review',
        reviewState: 'unreviewed',
        reviewerId: null,
        reviewerNote: null,
        reviewedAt: null,
        promotedRevisionId: null,
        promotedAt: null,
        supersededById: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'candidate-approved',
        studentId: 'student-default',
        proposedFact: 'Prefers structured homework with clear review blocks.',
        approvedFactText: 'Prefers structured homework with built-in review blocks.',
        category: 'study_preferences',
        targetSection: 'learning_preferences_study_habits',
        sourceSummary: 'Consistent request across recent assignments.',
        authority: 'teacher_confirmed',
        confidence: 'high',
        evidence: [
          {
            quote: 'Please include review tasks so I do not forget old material.',
            speakerRole: 'student',
            transcriptSpan: '00:31-00:35',
            evidenceNote: 'Direct study preference.',
            sourceKind: 'student_memory_snapshot',
            sourceArtifactId: 'snapshot-1',
          },
        ],
        sourceSnapshotId: 'snapshot-1',
        sourceLessonMemoryIds: ['lesson-1'],
        status: 'approved',
        reviewState: 'approved',
        reviewerId: 'user-1',
        reviewerNote: 'Matches long-running pattern.',
        reviewedAt: now,
        promotedRevisionId: null,
        promotedAt: null,
        supersededById: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'candidate-deferred',
        studentId: 'student-default',
        proposedFact: 'Might be interested in pickleball strategy vocabulary.',
        approvedFactText: null,
        category: 'interests',
        targetSection: 'interests_personal_context',
        sourceSummary: 'Mentioned once; needs another corroborating lesson.',
        authority: 'model_inferred',
        confidence: 'medium',
        evidence: [
          {
            quote: 'I played pickleball with my wife yesterday.',
            speakerRole: 'student',
            transcriptSpan: '00:51-00:54',
            evidenceNote: 'Single mention so far.',
            sourceKind: 'lesson_memory',
            sourceArtifactId: 'lesson-1',
          },
        ],
        sourceSnapshotId: 'snapshot-1',
        sourceLessonMemoryIds: ['lesson-1'],
        status: 'pending_review',
        reviewState: 'deferred',
        reviewerId: 'user-1',
        reviewerNote: 'Need another signal before promoting.',
        reviewedAt: now,
        promotedRevisionId: null,
        promotedAt: null,
        supersededById: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    total: 3,
    limit: 200,
    offset: 0,
    order: 'desc',
  });

  vi.mocked(api.approveStudentProfileCandidate).mockImplementation(
    async (_studentId, candidateId, payload) => ({
      id: candidateId,
      studentId: 'student-default',
      proposedFact: 'Uses English with product and engineering teams at work.',
      approvedFactText:
        payload?.approvedFactText ?? 'Uses English with product and engineering teams at work.',
      category: 'work_context',
      targetSection: 'work_communication_context',
      sourceSummary: 'Repeatedly mentioned sprint planning and client calls.',
      authority: 'student_stated',
      confidence: 'high',
      evidence: [
        {
          quote: 'I have meetings with developers and clients every week.',
          speakerRole: 'student',
          transcriptSpan: '00:14-00:19',
          evidenceNote: 'Direct work-context statement.',
          sourceKind: 'lesson_memory',
          sourceArtifactId: 'lesson-1',
        },
      ],
      sourceSnapshotId: 'snapshot-1',
      sourceLessonMemoryIds: ['lesson-1'],
      status: 'approved',
      reviewState: 'approved',
      reviewerId: 'user-1',
      reviewerNote: payload?.reviewerNote ?? null,
      reviewedAt: now,
      promotedRevisionId: null,
      promotedAt: null,
      supersededById: null,
      createdAt: now,
      updatedAt: now,
    }),
  );

  vi.mocked(api.rejectStudentProfileCandidate).mockImplementation(
    async (_studentId, candidateId, payload) => ({
      id: candidateId,
      studentId: 'student-default',
      proposedFact: 'Uses English with product and engineering teams at work.',
      approvedFactText: null,
      category: 'work_context',
      targetSection: 'work_communication_context',
      sourceSummary: 'Repeatedly mentioned sprint planning and client calls.',
      authority: 'student_stated',
      confidence: 'high',
      evidence: [],
      sourceSnapshotId: 'snapshot-1',
      sourceLessonMemoryIds: ['lesson-1'],
      status: 'rejected',
      reviewState: 'rejected',
      reviewerId: 'user-1',
      reviewerNote: payload?.reviewerNote ?? null,
      reviewedAt: now,
      promotedRevisionId: null,
      promotedAt: null,
      supersededById: null,
      createdAt: now,
      updatedAt: now,
    }),
  );

  vi.mocked(api.deferStudentProfileCandidate).mockImplementation(
    async (_studentId, candidateId, payload) => ({
      id: candidateId,
      studentId: 'student-default',
      proposedFact: 'Uses English with product and engineering teams at work.',
      approvedFactText: null,
      category: 'work_context',
      targetSection: 'work_communication_context',
      sourceSummary: 'Repeatedly mentioned sprint planning and client calls.',
      authority: 'student_stated',
      confidence: 'high',
      evidence: [],
      sourceSnapshotId: 'snapshot-1',
      sourceLessonMemoryIds: ['lesson-1'],
      status: 'pending_review',
      reviewState: 'deferred',
      reviewerId: 'user-1',
      reviewerNote: payload?.reviewerNote ?? null,
      reviewedAt: now,
      promotedRevisionId: null,
      promotedAt: null,
      supersededById: null,
      createdAt: now,
      updatedAt: now,
    }),
  );

  vi.mocked(api.promoteStudentProfileCandidates).mockResolvedValue({
    draftRevisionId: 'revision-draft-2',
    profileId: 'profile-default.md',
    includedCandidateIds: ['candidate-approved'],
    excludedCandidateIds: [],
    contentHash: 'draft-hash-2',
  });

  vi.mocked(api.createStudentProfile).mockResolvedValue({
    id: 'student-created',
    student: 'Created Student',
    profileId: null,
  });
}

export function setupStudentWorkspaceTest() {
  vi.clearAllMocks();
  seedStudentWorkspaceMocks();
}

export function renderStudentWorkspace(): RenderResult {
  return render(
    <MemoryRouter>
      <StudentWorkspace />
    </MemoryRouter>,
  );
}

async function waitForLoadedWorkspace() {
  await screen.findByText(
    /Current profile:/i,
    {},
    { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
  );
  await screen.findByRole(
    'heading',
    { name: /Assignment History/i },
    { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
  );
  await screen.findByRole(
    'heading',
    { name: /Student Timeline/i },
    { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
  );
}

async function waitForTimelineFilters() {
  await waitFor(
    () => {
      if (vi.mocked(api.listUserJobs).mock.calls.length !== 1) {
        throw new Error('Expected the initial assignment history load to complete.');
      }
    },
    { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
  );
  await waitFor(
    () => {
      if (vi.mocked(api.getStudentTimeline).mock.calls.length !== 1) {
        throw new Error('Expected the initial student timeline load to complete.');
      }
    },
    { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
  );
  await screen.findByRole(
    'combobox',
    { name: /State/i },
    { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
  );
  await screen.findByRole(
    'combobox',
    { name: /Event type/i },
    { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
  );
  await screen.findAllByRole(
    'button',
    { name: /Apply/i },
    { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
  );
}

async function waitForProfileCandidates() {
  await waitFor(
    () => {
      if (vi.mocked(api.listStudentProfileCandidates).mock.calls.length !== 1) {
        throw new Error('Expected the initial candidate load to complete.');
      }
    },
    { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
  );
  await screen.findByRole(
    'heading',
    { name: /Profile Candidates/i },
    { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
  );
  await screen.findByLabelText(
    /Profile Candidate Review Bucket/i,
    {},
    { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
  );
  await screen.findAllByText(
    /Work and communication context/i,
    {},
    { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
  );
}

async function waitForStudentCreation() {
  await screen.findByRole(
    'button',
    { name: /Create Student/i },
    { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
  );
}

export async function renderLoadedWorkspace(): Promise<RenderResult> {
  const result = renderStudentWorkspace();
  await waitForLoadedWorkspace();
  return result;
}

export async function renderWorkspaceWithTimelineFilters(): Promise<RenderResult> {
  const result = await renderLoadedWorkspace();
  await waitForTimelineFilters();
  return result;
}

export async function renderWorkspaceWithProfileCandidates(): Promise<RenderResult> {
  const result = await renderLoadedWorkspace();
  await waitForProfileCandidates();
  return result;
}

export async function renderWorkspaceForStudentCreation(): Promise<RenderResult> {
  const result = await renderLoadedWorkspace();
  await waitForStudentCreation();
  return result;
}

export function renderWorkspace(): RenderResult {
  return renderStudentWorkspace();
}
