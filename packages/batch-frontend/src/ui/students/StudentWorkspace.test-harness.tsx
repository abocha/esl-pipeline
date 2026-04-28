import type { RenderResult } from '@testing-library/react';
import { render, screen, waitFor } from '@testing-library/react';
import React, { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

import { CreateStudentDialog, type CreateStudentDialogProps } from './CreateStudentDialog';
import { StudentWorkspace } from './StudentWorkspace';
import {
  type CandidateActionKind,
  type CreateStudentFormState,
  type HistoryFilters,
  INITIAL_CREATE_STUDENT_FORM,
  INITIAL_HISTORY_FILTERS,
  INITIAL_TIMELINE_FILTERS,
  type ProfileCandidateFilter,
  type TimelineFilters,
} from './StudentWorkspace.logic';
import {
  WorkspaceCandidatesPanel,
  type WorkspaceCandidatesPanelProps,
} from './WorkspaceCandidatesPanel';
import { WorkspaceHistoryPanel, type WorkspaceHistoryPanelProps } from './WorkspaceHistoryPanel';
import {
  WorkspaceInspectionPanel,
  type WorkspaceInspectionPanelProps,
} from './WorkspaceInspectionPanel';

type MockFn = ReturnType<typeof vi.fn>;

interface StudentWorkspaceApiMocks {
  activateProfileRevision: MockFn;
  activateTemplateRevision: MockFn;
  approveStudentProfileCandidate: MockFn;
  createStudentProfile: MockFn;
  deferStudentProfileCandidate: MockFn;
  deleteTemplateContent: MockFn;
  fetchJobProvenance: MockFn;
  fetchPromptPackageLineage: MockFn;
  getProfileContent: MockFn;
  getProfileRevision: MockFn;
  getStudentMemoryOverview: MockFn;
  getStudentProfile: MockFn;
  getStudentTimeline: MockFn;
  getTemplateContent: MockFn;
  listProfileContents: MockFn;
  listProfileRevisions: MockFn;
  listStudentProfileBindings: MockFn;
  listStudentProfileCandidates: MockFn;
  listStudents: MockFn;
  listTemplateContents: MockFn;
  listTemplateRevisions: MockFn;
  listUserJobs: MockFn;
  promoteStudentProfileCandidates: MockFn;
  rejectStudentProfileCandidate: MockFn;
  restoreProfileRevision: MockFn;
  saveProfileDraftRevision: MockFn;
  restoreTemplateRevision: MockFn;
  updateStudentProfile: MockFn;
  upsertProfileContent: MockFn;
  upsertTemplateContent: MockFn;
}

const studentWorkspaceApiMocks: StudentWorkspaceApiMocks = vi.hoisted(() => ({
  activateProfileRevision: vi.fn(),
  activateTemplateRevision: vi.fn(),
  approveStudentProfileCandidate: vi.fn(),
  createStudentProfile: vi.fn(),
  deferStudentProfileCandidate: vi.fn(),
  deleteTemplateContent: vi.fn(),
  fetchJobProvenance: vi.fn(),
  fetchPromptPackageLineage: vi.fn(),
  getProfileContent: vi.fn(),
  getProfileRevision: vi.fn(),
  getStudentMemoryOverview: vi.fn(),
  getStudentProfile: vi.fn(),
  getStudentTimeline: vi.fn(),
  getTemplateContent: vi.fn(),
  listProfileContents: vi.fn(),
  listProfileRevisions: vi.fn(),
  listStudentProfileBindings: vi.fn(),
  listStudentProfileCandidates: vi.fn(),
  listStudents: vi.fn(),
  listTemplateContents: vi.fn(),
  listTemplateRevisions: vi.fn(),
  listUserJobs: vi.fn(),
  promoteStudentProfileCandidates: vi.fn(),
  rejectStudentProfileCandidate: vi.fn(),
  restoreProfileRevision: vi.fn(),
  saveProfileDraftRevision: vi.fn(),
  restoreTemplateRevision: vi.fn(),
  updateStudentProfile: vi.fn(),
  upsertProfileContent: vi.fn(),
  upsertTemplateContent: vi.fn(),
}));

export { studentWorkspaceApiMocks };

vi.mock('../../utils/api', () => studentWorkspaceApiMocks);

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
  studentWorkspaceApiMocks.listStudents.mockResolvedValue({
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

  studentWorkspaceApiMocks.getStudentProfile.mockResolvedValue({
    id: 'student-default',
    student: 'Default',
    profileId: 'profile-default.md',
  });

  studentWorkspaceApiMocks.listProfileContents.mockResolvedValue({
    profiles: [
      { id: 'profile-default.md', label: 'Default Profile' },
      { id: 'profile-alt.md', label: 'Alt Profile' },
    ],
  });

  studentWorkspaceApiMocks.getProfileContent.mockResolvedValue({
    id: 'profile-default.md',
    label: 'Default Profile',
    content: 'PROFILE CONTENT',
    structuredContent: {
      schemaVersion: 'foundational_profile_v1',
      overallLevel: 'B1',
      primaryGoals: ['Speak more confidently in meetings.'],
      communicationContexts: ['Client calls'],
      interestsAndUsefulThemes: ['Travel'],
      stableStrengths: ['High motivation'],
      persistentChallenges: ['Article usage'],
      studyPreferences: ['Prefers structured explanations'],
      durableConstraints: ['Short homework windows'],
      teacherNotes: 'Responds well to practical scenarios.',
    },
    currentRevisionId: 'revision-1',
    updatedAt: now,
  });

  studentWorkspaceApiMocks.listProfileRevisions.mockResolvedValue({
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

  studentWorkspaceApiMocks.listTemplateContents.mockResolvedValue({
    templates: [{ id: 'template-default.md', label: 'Default Template' }],
  });

  studentWorkspaceApiMocks.getTemplateContent.mockResolvedValue({
    id: 'template-default.md',
    label: 'Default Template',
    content: CLEAN_TEMPLATE_STARTER_CONTENT,
    currentRevisionId: 'template-revision-1',
    updatedAt: now,
  });

  studentWorkspaceApiMocks.listTemplateRevisions.mockResolvedValue({
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

  studentWorkspaceApiMocks.listUserJobs.mockResolvedValue({
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
        publishTarget: 'html',
        ttsStrategy: 'auto',
        autoPublish: false,
        htmlUrl: null,
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

  studentWorkspaceApiMocks.getStudentTimeline.mockResolvedValue({
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

  studentWorkspaceApiMocks.getStudentMemoryOverview.mockResolvedValue({
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

  studentWorkspaceApiMocks.listStudentProfileBindings.mockResolvedValue({
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

  studentWorkspaceApiMocks.fetchJobProvenance.mockResolvedValue({
    job: {
      id: 'job-1',
      state: 'succeeded',
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      finishedAt: now,
      sourceJobId: null,
      manifestPath: null,
      htmlUrl: null,
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
    pronunciationWarnings: [],
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

  studentWorkspaceApiMocks.fetchPromptPackageLineage.mockResolvedValue({
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

  studentWorkspaceApiMocks.updateStudentProfile.mockResolvedValue({
    id: 'student-default',
    student: 'Default',
    profileId: 'profile-alt.md',
  });

  studentWorkspaceApiMocks.upsertProfileContent.mockResolvedValue({
    id: 'profile-default.md',
    label: 'Default Profile',
    content: 'PROFILE CONTENT',
    structuredContent: {
      schemaVersion: 'foundational_profile_v1',
      overallLevel: 'B1',
      primaryGoals: ['Speak more confidently in meetings.'],
      communicationContexts: ['Client calls'],
      interestsAndUsefulThemes: ['Travel'],
      stableStrengths: ['High motivation'],
      persistentChallenges: ['Article usage'],
      studyPreferences: ['Prefers structured explanations'],
      durableConstraints: ['Short homework windows'],
      teacherNotes: 'Responds well to practical scenarios.',
    },
    currentRevisionId: 'revision-1',
    updatedAt: now,
  });

  studentWorkspaceApiMocks.saveProfileDraftRevision.mockResolvedValue({
    id: 'revision-2',
    profileId: 'profile-default.md',
    contentHash: 'hash-2',
    source: 'update',
    status: 'draft',
    versionNumber: 2,
    versionLabel: 'v2',
    activatedAt: null,
    deprecatedAt: null,
    createdAt: now,
    createdBy: 'user-1',
    restoredFromRevisionId: null,
    content: '# Foundational Profile\n\nStructured draft content',
    structuredContent: {
      schemaVersion: 'foundational_profile_v1',
      overallLevel: 'B2',
      primaryGoals: ['Lead project updates confidently.'],
      communicationContexts: ['Sprint demos'],
      interestsAndUsefulThemes: ['Design systems'],
      stableStrengths: ['Strong listening'],
      persistentChallenges: ['Sentence rhythm'],
      studyPreferences: ['Prefers concise correction'],
      durableConstraints: ['Short homework windows'],
      teacherNotes: 'Needs practical speaking rehearsal.',
    },
  });

  studentWorkspaceApiMocks.getProfileRevision.mockResolvedValue({
    id: 'revision-draft-2',
    profileId: 'profile-default.md',
    contentHash: 'draft-hash-2',
    source: 'candidate_promotion',
    status: 'draft',
    versionNumber: 2,
    versionLabel: 'v2',
    activatedAt: null,
    deprecatedAt: null,
    createdAt: now,
    createdBy: 'user-1',
    restoredFromRevisionId: null,
    content: '# Foundational Profile\n\nGenerated draft content',
    structuredContent: {
      schemaVersion: 'foundational_profile_v1',
      overallLevel: 'B2',
      primaryGoals: ['Lead product demos with more confidence.'],
      communicationContexts: ['Sprint demos', 'Client calls'],
      interestsAndUsefulThemes: ['Travel'],
      stableStrengths: ['High motivation'],
      persistentChallenges: ['Article usage'],
      studyPreferences: ['Prefers structured explanations'],
      durableConstraints: ['Short homework windows'],
      teacherNotes: 'Generated from approved profile candidates.',
    },
  });

  studentWorkspaceApiMocks.restoreProfileRevision.mockResolvedValue({
    id: 'profile-default.md',
    label: 'Default Profile',
    content: 'PROFILE CONTENT',
    structuredContent: {
      schemaVersion: 'foundational_profile_v1',
      overallLevel: 'B1',
      primaryGoals: ['Speak more confidently in meetings.'],
      communicationContexts: ['Client calls'],
      interestsAndUsefulThemes: ['Travel'],
      stableStrengths: ['High motivation'],
      persistentChallenges: ['Article usage'],
      studyPreferences: ['Prefers structured explanations'],
      durableConstraints: ['Short homework windows'],
      teacherNotes: 'Responds well to practical scenarios.',
    },
    currentRevisionId: 'revision-1',
    updatedAt: now,
  });

  studentWorkspaceApiMocks.activateProfileRevision.mockResolvedValue({
    id: 'profile-default.md',
    label: 'Default Profile',
    content: 'PROFILE CONTENT',
    structuredContent: {
      schemaVersion: 'foundational_profile_v1',
      overallLevel: 'B1',
      primaryGoals: ['Speak more confidently in meetings.'],
      communicationContexts: ['Client calls'],
      interestsAndUsefulThemes: ['Travel'],
      stableStrengths: ['High motivation'],
      persistentChallenges: ['Article usage'],
      studyPreferences: ['Prefers structured explanations'],
      durableConstraints: ['Short homework windows'],
      teacherNotes: 'Responds well to practical scenarios.',
    },
    currentRevisionId: 'revision-1',
    updatedAt: now,
  });

  studentWorkspaceApiMocks.upsertTemplateContent.mockResolvedValue({
    id: 'template-default.md',
    label: 'Default Template',
    content: CLEAN_TEMPLATE_STARTER_CONTENT,
    currentRevisionId: 'template-revision-2',
    updatedAt: now,
  });

  studentWorkspaceApiMocks.restoreTemplateRevision.mockResolvedValue({
    id: 'template-default.md',
    label: 'Default Template',
    content: CLEAN_TEMPLATE_STARTER_CONTENT,
    currentRevisionId: 'template-revision-1',
    updatedAt: now,
  });

  studentWorkspaceApiMocks.activateTemplateRevision.mockResolvedValue({
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

  studentWorkspaceApiMocks.deleteTemplateContent.mockResolvedValue(undefined);

  studentWorkspaceApiMocks.listStudentProfileCandidates.mockResolvedValue({
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

  studentWorkspaceApiMocks.approveStudentProfileCandidate.mockImplementation(
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

  studentWorkspaceApiMocks.rejectStudentProfileCandidate.mockImplementation(
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

  studentWorkspaceApiMocks.deferStudentProfileCandidate.mockImplementation(
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

  studentWorkspaceApiMocks.promoteStudentProfileCandidates.mockResolvedValue({
    draftRevisionId: 'revision-draft-2',
    profileId: 'profile-default.md',
    includedCandidateIds: ['candidate-approved'],
    excludedCandidateIds: [],
    contentHash: 'draft-hash-2',
  });

  studentWorkspaceApiMocks.createStudentProfile.mockResolvedValue({
    id: 'student-created',
    student: 'Created Student',
    profileId: null,
  });
}

export function setupStudentWorkspaceTest() {
  vi.resetAllMocks();
  seedStudentWorkspaceMocks();
}

export function renderStudentWorkspace(): RenderResult {
  return render(
    <MemoryRouter>
      <StudentWorkspace />
    </MemoryRouter>,
  );
}

export function renderWorkspace(): RenderResult {
  return renderStudentWorkspace();
}

function formatInspectionDateTime(value?: string | null): string {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'n/a';
  return date.toLocaleString();
}

const DEFAULT_CREATE_STUDENT_DIALOG_PROPS: Omit<
  CreateStudentDialogProps,
  | 'isOpen'
  | 'isBusy'
  | 'error'
  | 'success'
  | 'createStudentForm'
  | 'onToggleOpen'
  | 'onCancel'
  | 'onSubmit'
  | 'setCreateStudentForm'
> & {
  createStudentForm?: CreateStudentFormState;
} = {
  profileOptions: [
    { id: 'profile-default.md', label: 'Default Profile' },
    { id: 'profile-alt.md', label: 'Alt Profile' },
  ],
  createStudentForm: INITIAL_CREATE_STUDENT_FORM,
};

const DEFAULT_HISTORY_PANEL_PROPS: Omit<
  WorkspaceHistoryPanelProps,
  | 'historyFiltersDraft'
  | 'setHistoryFiltersDraft'
  | 'onApplyHistoryFilters'
  | 'timelineFiltersDraft'
  | 'setTimelineFiltersDraft'
  | 'onApplyTimelineFilters'
  | 'onInspectJob'
> = {
  selectedStudentId: 'student-default',
  selectedJobId: 'job-1',
  jobHistory: [
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
      publishTarget: 'html',
      ttsStrategy: 'auto',
      autoPublish: false,
      htmlUrl: null,
      state: 'succeeded',
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      finishedAt: now,
      error: null,
      manifestPath: null,
    },
  ],
  jobsLoading: false,
  jobsError: null,
  timeline: [
    {
      type: 'job_completed',
      studentId: 'student-default',
      status: 'succeeded',
      createdAt: now,
      displayName: 'Default',
    },
  ],
  timelineLoading: false,
  timelineError: null,
};

const DEFAULT_CANDIDATES_PANEL_PROPS: Omit<
  WorkspaceCandidatesPanelProps,
  | 'profileCandidateFilter'
  | 'setProfileCandidateFilter'
  | 'profileCandidateAction'
  | 'profileCandidateDrafts'
  | 'updateProfileCandidateDraft'
  | 'selectedCandidateIds'
  | 'setSelectedCandidateIds'
  | 'profileCandidatePromotionNote'
  | 'setProfileCandidatePromotionNote'
  | 'profileCandidatePromotionBusy'
  | 'profileCandidatePromotionError'
  | 'profileCandidatePromotionSuccess'
  | 'onRefreshCandidates'
  | 'onPromoteProfileCandidates'
  | 'onReviewProfileCandidate'
> = {
  selectedStudentId: 'student-default',
  profileCandidates: [
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
  profileCandidatesLoading: false,
  profileCandidatesError: null,
};

export interface CreateStudentDialogRenderOptions {
  createStudentForm?: Partial<CreateStudentFormState>;
  profileOptions?: CreateStudentDialogProps['profileOptions'];
  isOpen?: boolean;
  isBusy?: boolean;
  error?: string | null;
  success?: string | null;
  onSubmit?: (state: {
    createStudentForm: CreateStudentFormState;
    setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setIsBusy: React.Dispatch<React.SetStateAction<boolean>>;
    setError: React.Dispatch<React.SetStateAction<string | null>>;
    setSuccess: React.Dispatch<React.SetStateAction<string | null>>;
  }) => void | Promise<void>;
}

export function renderCreateStudentDialog(
  options: CreateStudentDialogRenderOptions = {},
): RenderResult {
  function Harness() {
    const [createStudentForm, setCreateStudentForm] = useState<CreateStudentFormState>({
      ...INITIAL_CREATE_STUDENT_FORM,
      ...options.createStudentForm,
    });
    const [isOpen, setIsOpen] = useState(options.isOpen ?? true);
    const [error, setError] = useState(options.error ?? null);
    const [success, setSuccess] = useState(options.success ?? null);
    const [isBusy, setIsBusy] = useState(options.isBusy ?? false);

    return (
      <CreateStudentDialog
        isOpen={isOpen}
        isBusy={isBusy}
        error={error}
        success={success}
        profileOptions={
          options.profileOptions ?? DEFAULT_CREATE_STUDENT_DIALOG_PROPS.profileOptions
        }
        createStudentForm={createStudentForm}
        onToggleOpen={() => setIsOpen((current) => !current)}
        onCancel={() => {
          setCreateStudentForm({ ...INITIAL_CREATE_STUDENT_FORM });
          setIsOpen(false);
        }}
        onSubmit={() => {
          if (options.onSubmit) {
            void options.onSubmit({
              createStudentForm,
              setIsOpen,
              setIsBusy,
              setError,
              setSuccess,
            });
          }
        }}
        setCreateStudentForm={setCreateStudentForm}
      />
    );
  }

  return render(<Harness />);
}

const DEFAULT_INSPECTION_PANEL_PROPS: WorkspaceInspectionPanelProps = {
  selectedJob: { jobId: 'job-1', promptPackageId: 'pkg-1' },
  jobProvenanceLoading: false,
  jobProvenanceError: null,
  jobProvenance: {
    job: {
      id: 'job-1',
      state: 'succeeded',
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      finishedAt: now,
      sourceJobId: null,
      manifestPath: null,
      htmlUrl: null,
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
    pronunciationWarnings: [],
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
  },
  memoryOverviewLoading: false,
  memoryOverviewError: null,
  memoryOverview: {
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
  },
  lineageLoading: false,
  lineageError: null,
  lineage: {
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
  },
  formatDateTime: formatInspectionDateTime,
};

export function renderInspectionPanel(
  overrides: Partial<WorkspaceInspectionPanelProps> = {},
): RenderResult {
  return render(
    <WorkspaceInspectionPanel
      {...DEFAULT_INSPECTION_PANEL_PROPS}
      {...overrides}
      selectedJob={overrides.selectedJob ?? DEFAULT_INSPECTION_PANEL_PROPS.selectedJob}
      jobProvenance={overrides.jobProvenance ?? DEFAULT_INSPECTION_PANEL_PROPS.jobProvenance}
      memoryOverview={overrides.memoryOverview ?? DEFAULT_INSPECTION_PANEL_PROPS.memoryOverview}
      lineage={overrides.lineage ?? DEFAULT_INSPECTION_PANEL_PROPS.lineage}
    />,
  );
}

export interface WorkspaceHistoryPanelRenderOptions {
  historyFiltersDraft?: Partial<HistoryFilters>;
  timelineFiltersDraft?: Partial<TimelineFilters>;
  onApplyHistoryFilters?: (filters: HistoryFilters) => void | Promise<void>;
  onApplyTimelineFilters?: (filters: TimelineFilters) => void | Promise<void>;
  onInspectJob?: (jobId: string, promptPackageId: string | null) => void;
  props?: Partial<WorkspaceHistoryPanelProps>;
}

export function renderWorkspaceHistoryPanel(
  options: WorkspaceHistoryPanelRenderOptions = {},
): RenderResult {
  function Harness() {
    const [historyFiltersDraft, setHistoryFiltersDraft] = useState<HistoryFilters>({
      ...INITIAL_HISTORY_FILTERS,
      ...options.historyFiltersDraft,
    });
    const [timelineFiltersDraft, setTimelineFiltersDraft] = useState<TimelineFilters>({
      ...INITIAL_TIMELINE_FILTERS,
      ...options.timelineFiltersDraft,
    });

    return (
      <WorkspaceHistoryPanel
        {...DEFAULT_HISTORY_PANEL_PROPS}
        {...options.props}
        historyFiltersDraft={historyFiltersDraft}
        setHistoryFiltersDraft={setHistoryFiltersDraft}
        onApplyHistoryFilters={options.onApplyHistoryFilters ?? (() => {})}
        timelineFiltersDraft={timelineFiltersDraft}
        setTimelineFiltersDraft={setTimelineFiltersDraft}
        onApplyTimelineFilters={options.onApplyTimelineFilters ?? (() => {})}
        onInspectJob={options.onInspectJob ?? (() => {})}
      />
    );
  }

  return render(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  );
}

export interface WorkspaceCandidatesPanelRenderOptions {
  profileCandidateFilter?: ProfileCandidateFilter;
  profileCandidateDrafts?: Record<string, { approvedFactText: string; reviewerNote: string }>;
  selectedCandidateIds?: string[];
  profileCandidatePromotionNote?: string;
  profileCandidateAction?: { candidateId: string; action: CandidateActionKind } | null;
  onRefreshCandidates?: () => void | Promise<void>;
  onPromoteProfileCandidates?: () => void | Promise<void>;
  onReviewProfileCandidate?: WorkspaceCandidatesPanelProps['onReviewProfileCandidate'];
  props?: Partial<WorkspaceCandidatesPanelProps>;
}

export function renderWorkspaceCandidatesPanel(
  options: WorkspaceCandidatesPanelRenderOptions = {},
): RenderResult {
  function Harness() {
    const [profileCandidateFilter, setProfileCandidateFilter] = useState<ProfileCandidateFilter>(
      options.profileCandidateFilter ?? 'pending',
    );
    const [profileCandidateDrafts, setProfileCandidateDrafts] = useState<
      Record<string, { approvedFactText: string; reviewerNote: string }>
    >(options.profileCandidateDrafts ?? {});
    const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>(
      options.selectedCandidateIds ?? [],
    );
    const [profileCandidatePromotionNote, setProfileCandidatePromotionNote] = useState(
      options.profileCandidatePromotionNote ?? '',
    );
    const [profileCandidateAction, setProfileCandidateAction] = useState<{
      candidateId: string;
      action: CandidateActionKind;
    } | null>(options.profileCandidateAction ?? null);

    return (
      <WorkspaceCandidatesPanel
        {...DEFAULT_CANDIDATES_PANEL_PROPS}
        {...options.props}
        profileCandidateFilter={profileCandidateFilter}
        setProfileCandidateFilter={setProfileCandidateFilter}
        profileCandidateAction={profileCandidateAction}
        profileCandidateDrafts={profileCandidateDrafts}
        updateProfileCandidateDraft={(candidateId, patch) => {
          setProfileCandidateDrafts((current) => {
            const existing = current[candidateId] ?? {
              approvedFactText: '',
              reviewerNote: '',
            };
            return {
              ...current,
              [candidateId]: {
                approvedFactText: patch.approvedFactText ?? existing.approvedFactText,
                reviewerNote: patch.reviewerNote ?? existing.reviewerNote,
              },
            };
          });
        }}
        selectedCandidateIds={selectedCandidateIds}
        setSelectedCandidateIds={setSelectedCandidateIds}
        profileCandidatePromotionNote={profileCandidatePromotionNote}
        setProfileCandidatePromotionNote={setProfileCandidatePromotionNote}
        profileCandidatePromotionBusy={options.props?.profileCandidatePromotionBusy ?? false}
        profileCandidatePromotionError={options.props?.profileCandidatePromotionError ?? null}
        profileCandidatePromotionSuccess={options.props?.profileCandidatePromotionSuccess ?? null}
        onRefreshCandidates={options.onRefreshCandidates ?? (() => {})}
        onPromoteProfileCandidates={options.onPromoteProfileCandidates ?? (() => {})}
        onReviewProfileCandidate={
          options.onReviewProfileCandidate ??
          ((candidate, action) => {
            setProfileCandidateAction({ candidateId: candidate.id, action });
          })
        }
      />
    );
  }

  return render(<Harness />);
}

export function renderCreateStudentDialogOpen(
  options: CreateStudentDialogRenderOptions = {},
): RenderResult {
  return renderCreateStudentDialog({ ...options, isOpen: true });
}

export async function renderWorkspaceHistoryReady(): Promise<RenderResult> {
  const result = renderStudentWorkspace();
  await screen.findByRole('heading', { name: /Assignment History/i });
  return result;
}

export async function renderWorkspaceInspectionReady(): Promise<RenderResult> {
  const result = await renderWorkspaceHistoryReady();
  await screen.findByRole('heading', { name: /Lineage & Provenance/i });
  return result;
}

export async function renderWorkspaceCandidatesReady(): Promise<RenderResult> {
  const result = await renderWorkspaceHistoryReady();
  await screen.findByRole('heading', { name: /Profile Candidates/i });
  await waitFor(
    () => {
      if (studentWorkspaceApiMocks.listStudentProfileCandidates.mock.calls.length !== 1) {
        throw new Error('Expected the initial candidate load to complete.');
      }
    },
    { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
  );
  await screen.findAllByText(
    /Work and communication context/i,
    {},
    {
      timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS,
    },
  );
  return result;
}

export async function renderLoadedWorkspace(): Promise<RenderResult> {
  const result = await renderWorkspaceInspectionReady();
  await waitFor(
    () => {
      const levelInput = screen.getByLabelText(/Current level/i);
      if (
        !(levelInput instanceof HTMLInputElement) ||
        levelInput.disabled ||
        levelInput.value !== 'B1'
      ) {
        throw new Error('Expected foundational profile form to finish loading.');
      }
    },
    { timeout: STUDENT_WORKSPACE_ASYNC_TIMEOUT_MS },
  );
  return result;
}

export async function renderWorkspaceWithTimelineFilters(): Promise<RenderResult> {
  const result = await renderWorkspaceHistoryReady();
  await screen.findByRole('combobox', { name: /State/i });
  await screen.findByRole('combobox', { name: /Event type/i });
  return result;
}

export async function renderWorkspaceWithProfileCandidates(): Promise<RenderResult> {
  return renderWorkspaceCandidatesReady();
}

export async function renderWorkspaceForStudentCreation(): Promise<RenderResult> {
  const result = await renderWorkspaceHistoryReady();
  await screen.findByRole('button', { name: /Create Student/i });
  return result;
}
