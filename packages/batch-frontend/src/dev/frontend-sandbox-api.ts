import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { AxiosError } from 'axios';

import {
  type AssignmentConfirmedSnapshot,
  type ConfirmAssignmentSessionStepRequest,
  effectiveAssignmentMaterial,
  emptyAssignmentMaterial,
  parseAssignmentV1,
  serializeAssignmentV1,
} from '@esl-pipeline/contracts';

import { editorFixture } from './assignment-editor-fixture';
import assignmentFixture from './assignment-fixture.json';
import { createBusinessSandbox } from './business-sandbox';
import type { FrontendSandboxScenario } from './frontend-sandbox';
import { studentActivitySandbox } from './student-activity-sandbox';

const now = '2026-07-03T00:00:00.000Z';
const sandboxFirstProfileStudentId = 'student-cora';
const sandboxFirstProfileRecordingId = 'recording-cora';
const sandboxFirstProfileTranscriptId = 'transcript-cora';
const sandboxFirstProfileRevisionId = 'profile-revision-cora-first-draft';
let sandboxFirstProfileLessonMemoryConfirmed = false;
let sandboxFirstProfileLessonMemoryHealthPolls = 0;

function responseFor(config: InternalAxiosRequestConfig, data: unknown): AxiosResponse {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  };
}

function notFoundFor(config: InternalAxiosRequestConfig): AxiosError {
  return new AxiosError(
    `Sandbox endpoint not implemented: ${config.method?.toUpperCase() ?? 'GET'} ${config.url}`,
    AxiosError.ERR_BAD_REQUEST,
    config,
    {},
    {
      data: {
        error: 'sandbox_endpoint_not_implemented',
        message: 'This frontend sandbox endpoint has not been implemented yet.',
      },
      status: 404,
      statusText: 'Not Found',
      headers: {},
      config,
    },
  );
}

function scenarioErrorFor(config: InternalAxiosRequestConfig, message: string): AxiosError {
  return new AxiosError(message, AxiosError.ERR_BAD_RESPONSE, config);
}

function isSlowScenarioRequest(
  scenario: FrontendSandboxScenario,
  method: string,
  path: string,
): boolean {
  if (scenario !== 'step-one-slow' || method !== 'get') return false;
  return (
    path === '/config/students' ||
    path === '/user/jobs' ||
    path === '/user/assignment-sessions' ||
    path.startsWith('/assignment-sessions/') ||
    path.startsWith('/jobs/')
  );
}

function delaySandboxResponse(): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, 1500);
  });
}

function resumeStateJobs() {
  return [
    jobStatus({
      jobId: 'job-sandbox-queued',
      state: 'queued',
      startedAt: null,
      finishedAt: null,
      htmlUrl: null,
    }),
    jobStatus({ jobId: 'job-sandbox-running', state: 'running', finishedAt: null, htmlUrl: null }),
    jobStatus({
      jobId: 'job-sandbox-awaiting-approval',
      state: 'awaiting_approval',
      finishedAt: null,
      htmlUrl: null,
    }),
    jobStatus({ jobId: 'job-sandbox-published', state: 'succeeded' }),
    jobStatus({ jobId: 'job-sandbox-unpublished', state: 'succeeded', htmlUrl: null }),
    jobStatus({
      jobId: 'job-sandbox-failed',
      state: 'failed',
      htmlUrl: null,
      finishedAt: now,
      error: 'Sandbox generation failure for Step 1 review.',
    }),
  ];
}

function normalizePath(rawUrl: string | undefined): string {
  const url = new URL(rawUrl ?? '/', 'http://sandbox.local');
  return url.pathname.replace(/^\/api/, '') || '/';
}

function readRequestText(data: unknown, fallback: string): string {
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data) as { text?: unknown };
      return typeof parsed.text === 'string' ? parsed.text : fallback;
    } catch {
      return fallback;
    }
  }
  if (data && typeof data === 'object' && 'text' in data) {
    const text = (data as { text?: unknown }).text;
    return typeof text === 'string' ? text : fallback;
  }
  return fallback;
}

function readRequestBody(data: unknown): Record<string, unknown> {
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
}

function readStudentIdParam(config: InternalAxiosRequestConfig): string | null {
  const params = config.params as Record<string, unknown> | undefined;
  const studentId = params?.studentId;
  return typeof studentId === 'string' && studentId.trim() ? studentId.trim() : null;
}

function assignmentSession(overrides: Record<string, unknown> = {}) {
  const studentId = typeof overrides.studentId === 'string' ? overrides.studentId : 'student-alex';
  const recordingId =
    typeof overrides.recordingId === 'string' ? overrides.recordingId : 'recording-sandbox';
  const transcriptId =
    typeof overrides.transcriptId === 'string' ? overrides.transcriptId : 'transcript-sandbox';
  return {
    id: 'session-sandbox',
    userId: 'sandbox-tutor',
    studentId,
    lessonId: null,
    recordingId,
    transcriptId,
    promptPackageId: null,
    draftId: null,
    revision: 2,
    confirmedStep: 'source',
    confirmed: {
      student: { studentId },
      source: {
        lessonId: null,
        recordingId,
        transcriptId,
        transcriptWorkingVersion: 1,
        transcriptStorageUri: `memory://sandbox/${transcriptId}/content/${'a'.repeat(64)}.txt`,
        transcriptHash: 'a'.repeat(64),
      },
      context: null,
      create: null,
    },
    publishTarget: 'html',
    selectedTtsProvider: 'inworld',
    selectedTtsStrategy: 'auto',
    selectedTtsModel: 'inworld-tts-2',
    selectedPreset: 'general-english',
    selectedGenerationProvider: 'openai',
    selectedGenerationModel: 'gpt-5.2',
    teacherNotes: null,

    material: emptyAssignmentMaterial(),

    selectedProfileId: null,
    selectedProfileRevisionId: null,
    selectedProfileRevisionHash: null,
    shareJobId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function jobStatus(overrides: Record<string, unknown> = {}) {
  return {
    jobId: 'job-sandbox',
    assignmentArtifact: sandboxArtifact,
    assignmentRendererVersion: 3,
    studentId: 'student-alex',
    studentName: 'Alex',
    lessonId: null,
    md: '/tmp/sandbox-assignment.md',
    mdStorageUri: 'memory://sandbox/assignment.md',
    pronunciationMode: null,
    recordingId: 'recording-sandbox',
    transcriptId: 'transcript-sandbox',
    promptPackageId: 'prompt-sandbox',
    draftId: 'draft-sandbox',
    preset: 'general-english',
    learningPresetId: 'general-english',
    learningPresetVersion: 'v1',
    promptSnapshotVersion: 'hw_prompt_v4-2_clean',
    promptAlias: 'current',
    withTts: true,
    voiceId: null,
    upload: 's3',
    voiceAccent: null,
    forceTts: false,
    publishTarget: 'html',
    ttsStrategy: 'auto',
    ttsProvider: 'inworld',
    ttsModel: 'inworld-tts-2',
    autoPublish: false,
    htmlUrl: 'https://example.test/sandbox-assignment.html',
    state: 'succeeded',
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    finishedAt: now,
    sourceJobId: null,
    error: null,
    manifestPath: null,
    ...overrides,
  };
}

function profileContent() {
  return {
    studentId: 'student-alex',
    content: 'Alex is a B1 learner practicing confident workplace updates.',
    structuredContent: {
      schemaVersion: 'foundational_profile_v1',
      overallLevel: 'B1',
      primaryGoals: ['Lead project updates clearly.'],
      communicationContexts: ['Weekly team syncs.', 'Client check-ins.'],
      interestsAndUsefulThemes: ['Travel', 'Films'],
      stableStrengths: ['Strong listening comprehension.'],
      persistentChallenges: ['Needs smoother transitions and article accuracy.'],

      studyPreferences: [] as string[],

      durableConstraints: [] as string[],

      teacherNotes: 'Keep examples grounded in real workplace situations.',
    },
    currentRevisionId: 'profile-revision-sandbox',
    updatedAt: now,
  };
}

function studentProfile() {
  return {
    id: 'student-alex',
    student: 'Alex',
    dbId: null,
    pageParentId: null,
    colorPreset: 'blue',
    accentPreference: 'american',
    voices: {},
    manifestPreset: null,
    archivedAt: null,
    archivedBy: null,
    archiveReason: null,
  };
}

function firstProfileStudentProfile() {
  return {
    id: sandboxFirstProfileStudentId,
    student: 'Cora Preview',
    dbId: null,
    pageParentId: null,
    colorPreset: 'green',
    accentPreference: 'american',
    voices: {},
    manifestPreset: null,
    archivedAt: null,
    archivedBy: null,
    archiveReason: null,
  };
}

function firstProfileContent() {
  return {
    studentId: sandboxFirstProfileStudentId,
    content: 'Cora wants practical English for short client updates.',
    structuredContent: firstProfileDraftStructuredContent(),
    currentRevisionId: sandboxFirstProfileRevisionId,
    updatedAt: now,
  };
}

function profileRevisionSummary() {
  return {
    id: 'profile-revision-sandbox',
    studentId: 'student-alex',
    contentHash: 'profile-hash-sandbox',
    source: 'update',
    status: 'active',
    versionNumber: 5,
    versionLabel: 'v5',
    activatedAt: now,
    deprecatedAt: null,
    createdAt: now,
    createdBy: 'sandbox-tutor',
    restoredFromRevisionId: null,
  };
}

function profileRevisionHistorySummary(versionNumber: number) {
  return {
    id: `profile-revision-sandbox-v${versionNumber}`,
    studentId: 'student-alex',
    contentHash: `profile-hash-sandbox-v${versionNumber}`,
    source: 'update',
    status: 'deprecated',
    versionNumber,
    versionLabel: `v${versionNumber}`,
    activatedAt: null,
    deprecatedAt: now,
    createdAt: now,
    createdBy: 'sandbox-tutor',
    restoredFromRevisionId: null,
  };
}

function profileDraftReviewStructuredContent() {
  return {
    schemaVersion: 'foundational_profile_v1',
    overallLevel: 'B1',
    primaryGoals: [
      'Lead project updates clearly.',
      'Speak with more confidence when explaining changes to clients.',
    ],
    communicationContexts: [
      'Weekly team syncs.',
      'Client check-ins.',
      'Short project-status updates with product and client teams.',
    ],
    interestsAndUsefulThemes: ['Travel', 'Films'],
    stableStrengths: ['Strong listening comprehension.'],
    persistentChallenges: ['Needs smoother transitions and article accuracy.'],
    studyPreferences: [
      'Prefers concise, practical homework.',
      'Prefers short practical review loops.',
    ],
    durableConstraints: [],
    teacherNotes:
      'Keep examples grounded in real workplace situations and include one short role-play loop.',
  };
}

function firstProfileDraftStructuredContent() {
  return {
    schemaVersion: 'foundational_profile_v1',
    overallLevel: 'A2',
    primaryGoals: ['Give short client updates with confidence.'],
    communicationContexts: ['First lessons', 'Simple client status updates'],
    interestsAndUsefulThemes: ['Work routines', 'Everyday clarification phrases'],
    stableStrengths: ['Comfortable asking for clarification when prompted.'],
    persistentChallenges: ['Needs support organizing short spoken updates.'],
    studyPreferences: ['Prefers practical examples connected to current work.'],
    durableConstraints: [],
    teacherNotes:
      'Keep the first assignment short and concrete: introduce, update, ask one clarification question.',
  };
}

function profileDraftReviewRevision(overrides: Record<string, unknown> = {}) {
  return {
    id: 'profile-revision-sandbox-draft',
    studentId: 'student-alex',
    contentHash: 'profile-hash-sandbox-draft',
    source: 'profile_revision_refresh',
    status: 'draft',
    versionNumber: 6,
    versionLabel: 'v6',
    activatedAt: null,
    deprecatedAt: null,
    createdAt: now,
    createdBy: 'sandbox-tutor',
    restoredFromRevisionId: null,
    content: '# Foundational Profile\n\nSandbox profile draft refreshed from approved candidates.',
    structuredContent: profileDraftReviewStructuredContent(),
    ...overrides,
  };
}

function profileRevisionList() {
  return {
    items: [
      profileRevisionSummary(),
      profileRevisionHistorySummary(4),
      profileRevisionHistorySummary(3),
      profileRevisionHistorySummary(2),
      profileRevisionHistorySummary(1),
    ],
    total: 5,
    limit: 25,
    offset: 0,
    order: 'desc',
  };
}

function firstProfileRevisionList() {
  return {
    items: [
      {
        id: sandboxFirstProfileRevisionId,
        studentId: sandboxFirstProfileStudentId,
        contentHash: 'profile-hash-cora-first-draft',
        source: 'lesson_population',
        status: 'draft',
        versionNumber: 1,
        versionLabel: 'v1',
        activatedAt: null,
        deprecatedAt: null,
        createdAt: now,
        createdBy: 'sandbox-tutor',
        restoredFromRevisionId: null,
      },
    ],
    total: 1,
    limit: 25,
    offset: 0,
    order: 'desc',
  };
}

function memoryOverview() {
  return {
    studentId: 'student-alex',
    latestReadyStudentMemorySnapshot: {
      id: 'snapshot-sandbox',
      studentId: 'student-alex',
      schemaVersion: 'student-memory-snapshot.v1',
      generatedAt: now,
      provider: 'openai',
      model: 'gpt-5.2',
      status: 'ready',
      sourceKind: 'student_memory_rollup',
      lessonMemoryEntryIds: ['lesson-memory-sandbox'],
      homeworkMemoryEntryIds: ['homework-memory-sandbox'],
      contentHash: 'snapshot-hash-sandbox',
      generationNotes: null,
      stableStrengths: [{ label: 'Listening', note: 'Strong listening comprehension.' }],
      recurringIssues: [{ label: 'Transitions', note: 'Needs smoother transitions.' }],
      activeReviewBacklog: [],
      recentProgress: [{ label: 'Updates', note: 'Clearer workplace status updates.' }],
      personalFacts: [],
      recommendedAssignmentDirections: [
        {
          direction: 'Practice concise workplace updates.',
          rationale: 'Alex benefits from short, practical speaking loops.',
        },
      ],
      unresolvedIssues: [],
      snapshotSummary: 'Alex is building clearer workplace updates with smoother transitions.',
      supersededById: null,
      supersededAt: null,
      createdAt: now,
      updatedAt: now,
    },
    recentReadyLessonMemory: [
      {
        id: 'lesson-memory-sandbox',
        studentId: 'student-alex',
        lessonId: 'lesson-sandbox-next',
        status: 'ready',
        lessonSummary: 'Practiced concise project updates and a polite follow-up question.',
        createdAt: now,
        updatedAt: now,
      },
    ],
    recentReadyHomeworkMemory: [
      {
        id: 'homework-memory-sandbox',
        studentId: 'student-alex',
        jobId: 'job-sandbox',
        status: 'ready',
        topic: 'Workplace update practice',
        homeworkSummary: 'Assignment focused on linking ideas with first, also, and as a result.',
        createdAt: now,
        updatedAt: now,
      },
    ],
    unresolvedIssues: [],
  };
}

function memoryHealth() {
  return {
    studentId: 'student-alex',
    latestSnapshot: {
      id: 'snapshot-sandbox',
      status: 'ready',
      generatedAt: now,
      strategy: 'incremental_v1_1',
      trigger: 'lesson-memory-ready',
      triggerSourceKind: 'lesson_memory',
      triggerSourceEntryId: 'lesson-memory-sandbox',
      parentSnapshotId: null,
      inputTokenEstimate: 12800,
      outputTokenEstimate: null,
      promptByteLength: 42000,
      includedLessonMemoryCount: 1,
      includedHomeworkMemoryCount: 1,
      coveredLessonMemoryCount: 3,
      coveredHomeworkMemoryCount: 1,
      contentHash: 'snapshot-hash-sandbox',
      materialChange: true,
      budgetDecision: { action: 'allow' },
      candidateRefresh: {
        requested: true,
        triggerProfileWorthyStudentFactCount: 1,
        skippedNoProfileWorthyDeltaCount: 0,
      },
    },
    memoryCounts: {
      lesson: {
        ready: { count: 3, capped: false, limit: 500 },
        pending: { count: 0, capped: false, limit: 500 },
        failed: { count: 0, capped: false, limit: 500 },
      },
      homework: {
        ready: { count: 1, capped: false, limit: 500 },
        pending: { count: 0, capped: false, limit: 500 },
        failed: { count: 0, capped: false, limit: 500 },
      },
    },
    latestFailedReason: null,
    profileCandidateCounts: {
      pending: 0,
      approved: 0,
      rejected: 0,
      deferred: 0,
    },
  };
}

function firstProfileMemoryOverview() {
  return {
    studentId: sandboxFirstProfileStudentId,
    latestReadyStudentMemorySnapshot: null,
    recentReadyLessonMemory: [
      {
        id: 'lesson-memory-cora',
        studentId: sandboxFirstProfileStudentId,
        lessonId: 'lesson-cora-first',
        status: 'ready',
        lessonSummary: 'Cora practiced a short client update and one clarification question.',
        createdAt: now,
        updatedAt: now,
      },
    ],
    recentReadyHomeworkMemory: [],
    unresolvedIssues: [],
  };
}

function firstProfileMemoryHealth() {
  const ready = sandboxFirstProfileLessonMemoryConfirmed
    ? sandboxFirstProfileLessonMemoryHealthPolls > 0
    : false;
  if (sandboxFirstProfileLessonMemoryConfirmed) {
    sandboxFirstProfileLessonMemoryHealthPolls += 1;
  }
  return {
    studentId: sandboxFirstProfileStudentId,
    latestSnapshot: ready
      ? {
          id: null,
          status: null,
          generatedAt: null,
          strategy: null,
          trigger: 'lesson-memory-ready',
          triggerSourceKind: 'lesson_memory',
          triggerSourceEntryId: 'lesson-memory-cora',
          parentSnapshotId: null,
          inputTokenEstimate: 6200,
          outputTokenEstimate: null,
          promptByteLength: 21000,
          includedLessonMemoryCount: 1,
          includedHomeworkMemoryCount: 0,
          coveredLessonMemoryCount: 1,
          coveredHomeworkMemoryCount: 0,
          contentHash: null,
          materialChange: true,
          budgetDecision: { action: 'allow' },
          candidateRefresh: null,
        }
      : null,
    memoryCounts: {
      lesson: {
        ready: { count: ready ? 1 : 0, capped: false, limit: 500 },
        pending: {
          count: sandboxFirstProfileLessonMemoryConfirmed && !ready ? 1 : 0,
          capped: false,
          limit: 500,
        },
        failed: { count: 0, capped: false, limit: 500 },
      },
      homework: {
        ready: { count: 0, capped: false, limit: 500 },
        pending: { count: 0, capped: false, limit: 500 },
        failed: { count: 0, capped: false, limit: 500 },
      },
    },
    latestFailedReason: null,
    profileCandidateCounts: {
      pending: 0,
      approved: 0,
      rejected: 0,
      deferred: 0,
    },
  };
}

function emptyCandidateList() {
  return {
    items: [],
    total: 0,
    limit: 200,
    offset: 0,
    order: 'desc',
  };
}

function profileCandidateList() {
  return {
    items: [
      {
        id: 'candidate-sandbox-work-context',
        studentId: 'student-alex',
        proposedFact: 'Uses English for project updates with product and client teams.',
        approvedFactText: null,
        category: 'work_context',
        targetSection: 'work_communication_context',
        sourceSummary: 'Recent lessons mention project updates and client follow-ups.',
        authority: 'student_stated',
        confidence: 'high',
        evidence: [
          {
            quote: 'I need to explain project changes to clients more clearly.',
            speakerRole: 'student',
            transcriptSpan: '00:08-00:15',
            evidenceNote: 'Direct workplace communication need.',
            sourceKind: 'lesson_memory',
            sourceArtifactId: 'lesson-memory-sandbox',
          },
        ],
        sourceSnapshotId: 'snapshot-sandbox',
        sourceLessonMemoryIds: ['lesson-memory-sandbox'],
        sourceLessonId: 'lesson-sandbox-next',
        sourceLessonStartedAt: '2026-07-04T11:00:00.000Z',
        sourceLessonTitle: 'Workplace update practice',
        sourceMemoryIds: ['lesson-memory-sandbox'],
        provenance: { sourceKind: 'latest_lesson_memory' },
        dedupDecision: {
          decision: 'created',
          reason: 'Sandbox candidate for Learning page inspection.',
        },
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
        id: 'candidate-sandbox-study-preference',
        studentId: 'student-alex',
        proposedFact: 'Prefers short practical review loops.',
        approvedFactText: 'Prefers short practical review loops.',
        category: 'study_preferences',
        targetSection: 'learning_preferences_study_habits',
        sourceSummary: 'Repeated preference across recent lesson and homework memory.',
        authority: 'teacher_confirmed',
        confidence: 'high',
        evidence: [
          {
            quote: 'Short review tasks help me remember the grammar.',
            speakerRole: 'student',
            transcriptSpan: '00:30-00:35',
            evidenceNote: 'Direct study preference.',
            sourceKind: 'student_memory_snapshot',
            sourceArtifactId: 'snapshot-sandbox',
          },
        ],
        sourceSnapshotId: 'snapshot-sandbox',
        sourceLessonMemoryIds: ['lesson-memory-sandbox'],
        sourceLessonId: 'lesson-sandbox-next',
        sourceLessonStartedAt: '2026-07-04T11:00:00.000Z',
        sourceLessonTitle: 'Workplace update practice',
        sourceMemoryIds: ['snapshot-sandbox'],
        provenance: { sourceKind: 'student_memory_snapshot' },
        dedupDecision: {
          decision: 'created',
          reason: 'Sandbox approved candidate for draft promotion inspection.',
        },
        status: 'approved',
        reviewState: 'approved',
        reviewerId: 'sandbox-tutor',
        reviewerNote: 'Useful durable preference.',
        reviewedAt: now,
        promotedRevisionId: null,
        promotedAt: null,
        supersededById: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'candidate-sandbox-interests-deferred',
        studentId: 'student-alex',
        proposedFact: 'May enjoy product-design vocabulary tasks.',
        approvedFactText: null,
        category: 'interests',
        targetSection: 'interests_personal_context',
        sourceSummary: 'Mentioned design tools once during a lesson warm-up.',
        authority: 'model_inferred',
        confidence: 'medium',
        evidence: [
          {
            quote: 'I sometimes read product-design articles for work.',
            speakerRole: 'student',
            transcriptSpan: '00:42-00:47',
            evidenceNote: 'Single interest signal.',
            sourceKind: 'lesson_memory',
            sourceArtifactId: 'lesson-memory-sandbox',
          },
        ],
        sourceSnapshotId: 'snapshot-sandbox',
        sourceLessonMemoryIds: ['lesson-memory-sandbox'],
        sourceLessonId: 'lesson-sandbox-next',
        sourceLessonStartedAt: '2026-07-04T11:00:00.000Z',
        sourceLessonTitle: 'Workplace update practice',
        sourceMemoryIds: ['lesson-memory-sandbox'],
        provenance: { sourceKind: 'latest_lesson_memory' },
        dedupDecision: {
          decision: 'created',
          reason: 'Sandbox deferred candidate for Learning page inspection.',
        },
        status: 'pending_review',
        reviewState: 'deferred',
        reviewerId: 'sandbox-tutor',
        reviewerNote: 'Wait for another signal before adding to the profile.',
        reviewedAt: now,
        promotedRevisionId: null,
        promotedAt: null,
        supersededById: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'candidate-sandbox-rejected',
        studentId: 'student-alex',
        proposedFact: 'Needs long grammar lectures before each assignment.',
        approvedFactText: null,
        category: 'study_preferences',
        targetSection: 'learning_preferences_study_habits',
        sourceSummary: 'Rejected because stronger signals favor short practical review loops.',
        authority: 'model_inferred',
        confidence: 'low',
        evidence: [],
        sourceSnapshotId: 'snapshot-sandbox',
        sourceLessonMemoryIds: ['lesson-memory-sandbox'],
        sourceLessonId: 'lesson-sandbox-next',
        sourceLessonStartedAt: '2026-07-04T11:00:00.000Z',
        sourceLessonTitle: 'Workplace update practice',
        sourceMemoryIds: ['snapshot-sandbox'],
        provenance: { sourceKind: 'student_memory_snapshot' },
        dedupDecision: {
          decision: 'created',
          reason: 'Sandbox rejected candidate for Learning page inspection.',
        },
        status: 'rejected',
        reviewState: 'rejected',
        reviewerId: 'sandbox-tutor',
        reviewerNote: 'Contradicts the durable study preference.',
        reviewedAt: now,
        promotedRevisionId: null,
        promotedAt: null,
        supersededById: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'candidate-sandbox-promoted',
        studentId: 'student-alex',
        proposedFact: 'Uses role-play to prepare for client conversations.',
        approvedFactText: 'Uses role-play to prepare for client conversations.',
        category: 'study_preferences',
        targetSection: 'learning_preferences_study_habits',
        sourceSummary: 'Already promoted into the active profile.',
        authority: 'teacher_confirmed',
        confidence: 'high',
        evidence: [
          {
            quote: 'Role-play helps me prepare for client conversations.',
            speakerRole: 'student',
            transcriptSpan: '00:55-01:01',
            evidenceNote: 'Durable practice preference.',
            sourceKind: 'student_memory_snapshot',
            sourceArtifactId: 'snapshot-sandbox',
          },
        ],
        sourceSnapshotId: 'snapshot-sandbox',
        sourceLessonMemoryIds: ['lesson-memory-sandbox'],
        sourceLessonId: 'lesson-sandbox-next',
        sourceLessonStartedAt: '2026-07-04T11:00:00.000Z',
        sourceLessonTitle: 'Workplace update practice',
        sourceMemoryIds: ['snapshot-sandbox'],
        provenance: { sourceKind: 'student_memory_snapshot' },
        dedupDecision: {
          decision: 'created',
          reason: 'Sandbox promoted candidate for Learning page inspection.',
        },
        status: 'promoted',
        reviewState: 'approved',
        reviewerId: 'sandbox-tutor',
        reviewerNote: 'Already reflected in the active profile.',
        reviewedAt: now,
        promotedRevisionId: 'profile-revision-sandbox',
        promotedAt: now,
        supersededById: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    total: 5,
    limit: 200,
    offset: 0,
    order: 'desc',
  };
}

function scheduleBillingSurface() {
  return {
    studentId: 'student-alex',
    workspaceId: 'workspace-sandbox',
    lessonPlan: {
      studentId: 'student-alex',
      workspaceId: 'workspace-sandbox',
      timezone: 'Asia/Saigon',
      defaultDurationMinutes: 60,
      schedulingNotes: 'Sandbox lesson data for local UI testing.',
      updatedAt: now,
    },
    nextLesson: {
      id: 'lesson-sandbox-next',
      studentId: 'student-alex',
      workspaceId: 'workspace-sandbox',
      startsAt: '2026-07-04T11:00:00.000Z',
      timezone: 'Asia/Saigon',
      durationMinutes: 60,
      status: 'scheduled',
      consumesCredit: true,
      title: 'Workplace update practice',
      notes: null,
      creditEventId: null,
      historicalScheduleOrigin: {},
      schedulingSource: 'unmanaged',
      calendarEventUrl: null,
      homework: {
        status: 'not_started',
        assignmentSessionId: null,
        promptPackageId: null,
        draftId: null,
        jobId: null,
        homeworkMemoryEntryId: null,
        transcriptResultSessionId: null,
        htmlUrl: null,
        updatedAt: null,
      },
      createdAt: now,
      updatedAt: now,
    },
    lessons: [],
    creditSummary: {
      purchased: 8,
      consumed: 3,
      adjustments: 0,
      remaining: 5,
      lowBalanceThreshold: 2,
      isLow: false,
      isNegative: false,
    },
    creditEvents: [],
    payments: [],
    reminders: [],
    latestHiddenReminder: null,
  };
}

const sandboxAssignment = parseAssignmentV1(JSON.stringify(assignmentFixture));
const sandboxContext = {
  studentName: 'Alex',
  inputKind: sandboxAssignment.input.kind,
  suppliedUrls: [],
};
const sandboxArtifact = {
  format: 'assignment_v1' as const,
  schemaVersion: 1 as const,
  serializationVersion: 1 as const,
  workingVersion: 1,
  storageUri: `memory://sandbox/content/${'b'.repeat(64)}.json`,
  contentHash: 'b'.repeat(64),
};

const promptPackage = {
  requestEnvelope: { promptVersion: 'assignment_v1', assignmentContext: sandboxContext },
  id: 'prompt-sandbox',
  recordingId: 'recording-sandbox',
  transcriptId: 'transcript-sandbox',
  studentId: 'student-alex',
  lessonId: null,
  profilePath: null,
  templateVersion: 'v1',
  notes: 'Sandbox teacher notes',
  storageUri: 'memory://sandbox/prompt-sandbox',
  text: [
    '## Sandbox Prompt Package',
    '',
    '[LATEST_TRANSCRIPT]',
    'Alex practiced giving a concise project update and asking a follow-up question.',
    '',
    '[STUDENT_MEMORY_SNAPSHOT]',
    'Alex is B1 and benefits from transition phrases for workplace updates.',
  ].join('\n'),
  createdAt: now,
  updatedAt: now,
};

const draft = {
  id: 'draft-sandbox',
  promptPackageId: 'prompt-sandbox',
  studentId: 'student-alex',
  lessonId: null,
  storageUri: 'memory://sandbox/draft-sandbox',
  createdBy: 'sandbox-tutor',
  format: 'assignment_v1',
  assignment: sandboxAssignment,
  validationContext: { ...sandboxContext, studentName: 'Alex' },
  artifact: sandboxArtifact,
  text: JSON.stringify(sandboxAssignment, null, 2),
  workingVersion: 1,
  contentHash: 'b'.repeat(64),
  createdAt: now,
  updatedAt: now,
};

const firstProfilePromptPackage = {
  requestEnvelope: {
    promptVersion: 'assignment_v1',
    assignmentContext: { ...sandboxContext, studentName: 'Cora' },
  },
  id: 'prompt-cora',
  recordingId: sandboxFirstProfileRecordingId,
  transcriptId: sandboxFirstProfileTranscriptId,
  studentId: sandboxFirstProfileStudentId,
  lessonId: null,
  profilePath: null,
  templateVersion: 'v1',
  notes: 'Sandbox first-profile teacher notes',
  storageUri: 'memory://sandbox/prompt-cora',
  text: [
    '## Sandbox Prompt Package',
    '',
    '[LATEST_TRANSCRIPT]',
    'Cora practiced a short client update and asked for one clarification phrase.',
    '',
    '[STUDENT_PROFILE]',
    'Cora is A2 and wants practical English for short client updates.',
  ].join('\n'),
  createdAt: now,
  updatedAt: now,
};

const firstProfileDraft = {
  id: 'draft-cora',
  promptPackageId: 'prompt-cora',
  studentId: sandboxFirstProfileStudentId,
  lessonId: null,
  storageUri: 'memory://sandbox/draft-cora',
  createdBy: 'sandbox-tutor',
  format: 'assignment_v1',
  assignment: {
    ...sandboxAssignment,
    metadata: { ...sandboxAssignment.metadata, student: 'Cora' },
  },
  validationContext: { ...sandboxContext, studentName: 'Cora' },
  artifact: sandboxArtifact,
  text: JSON.stringify(
    { ...sandboxAssignment, metadata: { ...sandboxAssignment.metadata, student: 'Cora' } },
    null,
    2,
  ),
  workingVersion: 1,
  contentHash: 'c'.repeat(64),
  createdAt: now,
  updatedAt: now,
};

function jobProvenance() {
  return {
    job: {
      id: 'job-sandbox',
      state: 'succeeded',
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      finishedAt: now,
      sourceJobId: null,
      manifestPath: null,
      htmlUrl: 'https://example.test/sandbox-assignment.html',
      error: null,
    },
    sourceJob: null,
    recording: {
      id: 'recording-sandbox',
      status: 'transcribed',
      displayName: 'sandbox-lesson.mp3',
      durationSec: 180,
      createdAt: now,
      updatedAt: now,
    },
    transcript: {
      id: 'transcript-sandbox',
      recordingId: 'recording-sandbox',
      text: 'Alex practiced giving a concise project update and asking one follow-up question.',
      createdAt: now,
      updatedAt: now,
    },
    promptPackage: {
      id: 'prompt-sandbox',
      storageUri: 'memory://sandbox/prompt-sandbox',
      createdAt: now,
      updatedAt: now,
    },
    draft: {
      id: 'draft-sandbox',
      storageUri: 'memory://sandbox/draft-sandbox',
      createdAt: now,
      updatedAt: now,
    },
    tts: {
      provider: 'inworld',
      generatedCharacters: 420,
      cachedCharacters: 0,
      estimatedSpendUsd: 0.0042,
    },
    pronunciationWarnings: [],
    lineage: {
      profile: {
        snapshot: {
          revisionId: 'profile-revision-sandbox',
        },
      },
      template: {
        snapshot: {
          revisionId: 'template-revision-sandbox',
        },
      },
    },
    actions: [],
  };
}

export function createFrontendSandboxApiAdapter(
  options: { scenario?: FrontendSandboxScenario } = {},
): AxiosAdapter {
  const scenario = options.scenario ?? 'default';
  sandboxFirstProfileLessonMemoryConfirmed = false;
  sandboxFirstProfileLessonMemoryHealthPolls = 0;
  const businessSandbox = createBusinessSandbox();

  // New students belong to this sandbox instance, never to a seeded learner.

  const createdStudents = new Map<
    string,
    {
      student: ReturnType<typeof studentProfile>;

      profile: ReturnType<typeof profileContent> | null;
    }
  >();

  const createdSessions = new Map<string, Record<string, unknown>>();

  let manualTranscriptText = '';
  let manualTranscriptStudentId = 'student-alex';
  let manualTranscriptDisplayName = 'Pasted lesson transcript';
  let editorDraft = {
    ...draft,
    id: 'draft-editor',
    assignment: editorFixture(),
    text: serializeAssignmentV1(editorFixture()),
  };
  const baseEditorSession = assignmentSession({
    id: 'session-editor',
    promptPackageId: 'prompt-sandbox',
    draftId: 'draft-editor',
    confirmedStep: 'context',
    teacherNotes: 'Sandbox teacher notes',
  });
  let editorSession: Record<string, unknown> = {
    ...baseEditorSession,
    confirmed: {
      ...baseEditorSession.confirmed,
      context: {
        teacherNotes: 'Sandbox teacher notes',
        profileId: null,
        profileRevisionId: null,
        profileRevisionHash: null,
      },
    },
  };
  return async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    const method = (config.method ?? 'get').toLowerCase();
    const path = normalizePath(config.url);

    if (method === 'post' && path === '/students') {
      const body = readRequestBody(config.data);

      const id = `student-local-${createdStudents.size + 1}`;

      const student = { ...studentProfile(), id, student: String(body.student).trim() };

      const starter = readRequestBody(body.starterProfile);

      const text = (key: string) => (typeof starter[key] === 'string' ? starter[key].trim() : '');

      const items = (key: string) =>
        text(key)
          .split('\n')

          .map((line) => line.trim())

          .filter(Boolean);

      const profile = Object.keys(starter).length
        ? {
            studentId: id,

            currentRevisionId: `profile-${id}-v1`,

            updatedAt: now,

            content: Object.entries(starter)

              .map(([key, value]) => `${key}: ${value}`)

              .join('\n'),

            structuredContent: {
              schemaVersion: 'foundational_profile_v1',

              overallLevel: text('overallLevel'),

              primaryGoals: items('primaryGoals'),

              communicationContexts: items('communicationContexts'),

              interestsAndUsefulThemes: items('interestsAndUsefulThemes'),

              stableStrengths: items('stableStrengths'),

              persistentChallenges: items('persistentChallenges'),

              studyPreferences: items('studyPreferences'),

              durableConstraints: items('durableConstraints'),

              teacherNotes: text('teacherNotes'),
            },
          }
        : null;

      createdStudents.set(id, { student, profile });

      return responseFor(config, student);
    }

    const studentRoute = path.match(/^\/students\/([^/]+)(.*)$/);

    const createdStudent = studentRoute && createdStudents.get(studentRoute[1]!);

    if (createdStudent && method === 'get') {
      const { student, profile } = createdStudent;

      const revision = profile
        ? {
            ...profileRevisionSummary(),

            id: profile.currentRevisionId,

            studentId: student.id,

            contentHash: `hash-${profile.currentRevisionId}`,

            source: 'create',

            versionNumber: 1,

            versionLabel: 'v1',

            content: profile.content,

            structuredContent: profile.structuredContent,
          }
        : null;

      const revisions = {
        items: revision ? [revision] : [],

        total: revision ? 1 : 0,

        limit: 25,

        offset: 0,

        order: 'desc',
      };

      const memory = {
        studentId: student.id,

        latestReadyStudentMemorySnapshot: null,

        recentReadyLessonMemory: [],

        recentReadyHomeworkMemory: [],

        unresolvedIssues: [],
      };

      if (studentRoute[2] === '') return responseFor(config, student);

      if (studentRoute[2] === '/profile') return responseFor(config, profile);

      if (studentRoute[2] === '/profile/revisions') return responseFor(config, revisions);

      if (revision && studentRoute[2] === `/profile/revisions/${revision.id}`)
        return responseFor(config, revision);

      if (studentRoute[2] === '/surfaces/learning')
        return responseFor(config, {
          profile,

          revisions,

          memory,

          memoryHealth: null,

          candidates: emptyCandidateList(),
        });

      if (studentRoute[2] === '/memory') return responseFor(config, memory);
    }

    if (method === 'post' && path === '/assignment-sessions/confirm-student') {
      const body = readRequestBody(config.data);

      if (typeof body.studentId === 'string' && createdStudents.has(body.studentId)) {
        const session = assignmentSession({
          id: `session-local-${createdSessions.size + 1}`,

          studentId: body.studentId,

          recordingId: null,

          transcriptId: null,

          revision: 1,

          confirmedStep: 'student',

          confirmed: {
            student: { studentId: body.studentId },

            source: null,

            context: null,

            create: null,
          },
        });

        createdSessions.set(session.id, structuredClone(session));

        return responseFor(config, session);
      }
    }

    const sessionRoute = path.match(/^\/assignment-sessions\/([^/]+)(.*)$/);

    const createdSession = sessionRoute && createdSessions.get(sessionRoute[1]!);

    if (sessionRoute && method === 'post' && sessionRoute[2] === '/material-transcript') {
      const body = readRequestBody(config.data);

      const sourceUrl = String(body.sourceUrl ?? '');

      await new Promise((resolve) => setTimeout(resolve, 300));

      if (sourceUrl.includes('ESL84fail01')) {
        throw new AxiosError(
          'Transcript unavailable',
          AxiosError.ERR_BAD_REQUEST,
          config,
          {},
          {
            ...responseFor(config, {
              error: 'transcript_unavailable',
              message: 'We couldn’t fetch a transcript. Paste it below, or get it manually.',
            }),
            status: 503,
          },
        );
      }

      return responseFor(config, {
        sourceUrl,
        sourceText:
          'Start your update with the most important change. Explain what happened, why it matters, and what the team needs to do next. Keep the details relevant to your audience. Finish with a clear question or next step.',
      });
    }

    if (createdSession) {
      const suffix = sessionRoute[2];

      const body = readRequestBody(config.data);

      const confirmed = createdSession.confirmed as AssignmentConfirmedSnapshot;

      if (method === 'get' && suffix === '')
        return responseFor(config, structuredClone(createdSession));

      if (method === 'patch' && suffix === '/recovery') {
        Object.assign(createdSession, body.patch, {
          revision: Number(createdSession.revision) + 1,
        });

        return responseFor(config, structuredClone(createdSession));
      }

      if (method === 'post' && suffix === '/source-attachment') {
        Object.assign(createdSession, {
          recordingId: body.recordingId,

          transcriptId: body.transcriptId,

          revision: Number(createdSession.revision) + 1,
        });

        return responseFor(config, {
          outcome: 'source_attached',

          session: structuredClone(createdSession),
        });
      }

      if (method === 'post' && suffix === '/confirm') {
        if (body.step === 'source') {
          createdSession.confirmed = {
            ...confirmed,

            source: {
              lessonId: body.lessonId,

              recordingId: body.recordingId,

              transcriptId: body.transcriptId,

              transcriptWorkingVersion: body.transcriptWorkingVersion,

              transcriptStorageUri: 'memory://sandbox/manual-transcript.txt',

              transcriptHash: 'd'.repeat(64),
            },

            context: null,

            create: null,
          };
        } else if (body.step === 'context') {
          Object.assign(createdSession, {
            teacherNotes: body.teacherNotes,

            material: body.material,

            selectedProfileRevisionId: body.profileRevisionId,

            selectedProfileRevisionHash: body.profileRevisionHash,

            confirmed: {
              ...confirmed,

              context: {
                teacherNotes: body.teacherNotes,

                material: body.material
                  ? effectiveAssignmentMaterial(
                      body.material as Parameters<typeof effectiveAssignmentMaterial>[0],
                    )
                  : undefined,

                profileRevisionId: body.profileRevisionId,

                profileRevisionHash: body.profileRevisionHash,
              },
            },
          });
        } else throw notFoundFor(config);

        Object.assign(createdSession, {
          confirmedStep: body.step,

          revision: Number(createdSession.revision) + 1,
        });

        return responseFor(config, { session: structuredClone(createdSession), invalidated: [] });
      }

      if (method === 'get' && suffix === '/learner-context') {
        const profile = createdStudents.get(String(createdSession.studentId))!.profile;

        return responseFor(config, {
          assignmentSessionId: createdSession.id,

          studentId: createdSession.studentId,

          source: {
            recordingId: createdSession.recordingId,

            transcriptId: createdSession.transcriptId,

            transcriptHash: 'd'.repeat(64),
          },

          eligibility: 'unknown_provenance',

          state: 'not_applicable',

          operationState: null,

          profile: profile
            ? {
                ...profile,

                revisionId: profile.currentRevisionId,

                revisionHash: `hash-${profile.currentRevisionId}`,
              }
            : null,

          pinned: null,

          confirmationAvailable: true,

          warning: null,
        });
      }
    }

    // Focused current editor entry; bypasses no application hooks or final preview gates.
    if (scenario === 'assignment-editor') {
      if (method === 'get' && path === '/assignment-sessions/session-editor')
        return responseFor(config, editorSession);
      if (method === 'patch' && path === '/assignment-sessions/session-editor/recovery') {
        editorSession = {
          ...editorSession,
          ...(readRequestBody(config.data).patch as object),
          revision: Number(editorSession.revision) + 1,
        };
        return responseFor(config, editorSession);
      }
      if (method === 'post' && path === '/assignment-sessions/session-editor/confirm') {
        const body = readRequestBody(config.data) as unknown as ConfirmAssignmentSessionStepRequest;
        const confirmed = editorSession.confirmed as AssignmentConfirmedSnapshot;
        if (body.step === 'context') {
          editorSession = {
            ...editorSession,
            teacherNotes: body.teacherNotes,

            material: body.material,

            selectedProfileRevisionId: body.profileRevisionId,
            selectedProfileRevisionHash: body.profileRevisionHash,
            confirmed: {
              ...confirmed,
              context: {
                teacherNotes: body.teacherNotes,

                material: body.material
                  ? effectiveAssignmentMaterial(
                      body.material as Parameters<typeof effectiveAssignmentMaterial>[0],
                    )
                  : undefined,

                profileRevisionId: body.profileRevisionId,
                profileRevisionHash: body.profileRevisionHash,
              },
            },
          };
        } else if (body.step === 'create') {
          editorSession = {
            ...editorSession,
            promptPackageId: body.promptPackageId,
            draftId: body.draftId,
            confirmed: {
              ...confirmed,
              create: {
                promptPackageId: body.promptPackageId,
                draftId: body.draftId,
                draftWorkingVersion: editorDraft.workingVersion,
                draftStorageUri: editorDraft.storageUri,
                draftHash: editorDraft.contentHash,
              },
            },
          };
        } else if (body.step === 'source') {
          editorSession = {
            ...editorSession,
            lessonId: body.lessonId,
            recordingId: body.recordingId,
            transcriptId: body.transcriptId,
            confirmed: {
              ...confirmed,
              source: {
                ...confirmed.source,
                lessonId: body.lessonId,
                recordingId: body.recordingId,
                transcriptId: body.transcriptId,
                transcriptWorkingVersion: body.transcriptWorkingVersion,
                transcriptStorageUri: baseEditorSession.confirmed.source.transcriptStorageUri,
                transcriptHash: baseEditorSession.confirmed.source.transcriptHash,
              },
            },
          };
        } else throw notFoundFor(config);
        editorSession = {
          ...editorSession,
          confirmedStep: body.step,
          revision: Number(editorSession.revision) + 1,
        };
        return responseFor(config, { session: editorSession, invalidated: [] });
      }
      if (method === 'get' && path === '/drafts/draft-editor')
        return responseFor(config, editorDraft);
      if (method === 'put' && path === '/drafts/draft-editor') {
        const text = readRequestText(config.data, editorDraft.text);
        const assignment = parseAssignmentV1(text, sandboxContext);
        editorDraft = {
          ...editorDraft,
          text: serializeAssignmentV1(assignment),
          assignment: assignment as typeof editorDraft.assignment,
          workingVersion: editorDraft.workingVersion + 1,
          contentHash: String(editorDraft.workingVersion + 1).padStart(64, '0'),
        };
        return responseFor(config, editorDraft);
      }
    }
    if (method === 'get' && /^\/workspaces\/[^/]+\/calendar\/connection$/.test(path))
      return responseFor(config, {
        enabled: false,
        canManage: true,
        canSchedule: true,
        unavailableReason: 'google_calendar_disabled',
        connection: null,
        grant: null,
      });
    if (method === 'get' && /^\/workspaces\/[^/]+\/calendar\/scheduling-status$/.test(path))
      return responseFor(config, {
        state: 'disconnected',
        connectionId: null,
        calendarName: null,
        googleEmail: null,
        lastSyncedAt: null,
        errorCode: null,
        operations: [],
      });
    const businessData = businessSandbox(
      method,
      path,
      new URL(config.url ?? '/', 'http://sandbox.local').searchParams,
      readRequestBody(config.data),
    );
    if (businessData !== undefined) return responseFor(config, businessData);

    // A reproducible Student availability preview, without mutating real data.
    if (
      scenario === 'student-availability' &&
      method === 'get' &&
      path.startsWith('/students/student-alex/') &&
      path !== '/students/student-alex/surfaces/overview'
    ) {
      throw scenarioErrorFor(config, 'Student data is unavailable in this preview scenario.');
    }

    const activityMatch = /^\/students\/(student-alex|student-cora)\/activity$/.exec(path);
    if (method === 'get' && activityMatch) {
      const query = new URL(config.url ?? '/', 'http://sandbox.local').searchParams;
      for (const [name, value] of Object.entries(config.params ?? {})) {
        if (value !== undefined) query.set(name, String(value));
      }
      return responseFor(config, studentActivitySandbox(activityMatch[1]!, query));
    }

    if (isSlowScenarioRequest(scenario, method, path)) {
      await delaySandboxResponse();
    }

    if (method === 'get' && path === '/config/students') {
      if (scenario === 'step-one-learner-error') {
        throw scenarioErrorFor(config, 'Sandbox learners are unavailable for this scenario.');
      }
      return responseFor(config, {
        students:
          scenario === 'step-one-no-learners'
            ? []
            : [
                { id: 'student-alex', name: 'Alex' },
                { id: 'student-bella', name: 'Bella' },
                { id: sandboxFirstProfileStudentId, name: 'Cora Preview' },

                ...Array.from(createdStudents.values(), ({ student }) => ({
                  id: student.id,

                  name: student.student,
                })),
              ],
      });
    }

    if (method === 'get' && path === '/students') {
      const params = new URL(config.url ?? '/', 'http://sandbox.local').searchParams;
      for (const [key, value] of Object.entries(config.params ?? {})) {
        if (value !== undefined) params.set(key, String(value));
      }
      const query = (params.get('q') ?? '').trim().toLowerCase();
      const limit = Number(params.get('limit') ?? 200);
      const offset = Number(params.get('offset') ?? 0);
      const order = params.get('order') === 'desc' ? 'desc' : 'asc';
      const items =
        params.get('status') === 'archived'
          ? []
          : [
              studentProfile(),

              firstProfileStudentProfile(),

              ...Array.from(createdStudents.values(), ({ student }) => student),
            ]

              .filter((student) => student.student.toLowerCase().includes(query))
              .sort((a, b) =>
                order === 'asc'
                  ? a.student.localeCompare(b.student)
                  : b.student.localeCompare(a.student),
              );
      return responseFor(config, {
        items: items.slice(offset, offset + limit),
        total: items.length,
        limit,
        offset,
        order,
      });
    }

    if (method === 'get' && path === '/students/student-alex') {
      return responseFor(config, studentProfile());
    }

    if (method === 'get' && path === `/students/${sandboxFirstProfileStudentId}`) {
      return responseFor(config, firstProfileStudentProfile());
    }

    if (method === 'get' && path === '/students/student-alex/surfaces/overview') {
      return responseFor(config, {
        profile: profileContent(),
        revisions: profileRevisionList(),
        memory:
          scenario === 'student-availability'
            ? {
                ...memoryOverview(),
                latestReadyStudentMemorySnapshot: null,
                availability: {
                  state: 'repair_required',
                  reason: 'established_history_ineligible',
                  lessonReferenceCount: 3,
                  homeworkReferenceCount: 1,
                },
              }
            : memoryOverview(),
        pendingCandidates: emptyCandidateList(),
        recentTimeline: {
          items: [
            {
              type: 'lesson_memory_ready',
              displayName: 'Lesson memory ready',
              createdAt: now,
            },
          ],
          total: 1,
          limit: 10,
          offset: 0,
          order: 'desc',
        },
        scheduleBilling: scheduleBillingSurface(),
      });
    }

    if (method === 'get' && path === '/students/student-alex/surfaces/learning') {
      return responseFor(config, {
        profile: profileContent(),
        revisions: profileRevisionList(),
        memory: memoryOverview(),
        memoryHealth: memoryHealth(),
        candidates: profileCandidateList(),
      });
    }

    if (
      method === 'get' &&
      path === `/students/${sandboxFirstProfileStudentId}/surfaces/learning`
    ) {
      return responseFor(config, {
        profile: null,
        revisions: { items: [], total: 0, limit: 25, offset: 0, order: 'desc' },
        memory: firstProfileMemoryOverview(),
        memoryHealth: firstProfileMemoryHealth(),
        candidates: emptyCandidateList(),
      });
    }

    if (method === 'get' && path === `/students/${sandboxFirstProfileStudentId}/memory/health`) {
      return responseFor(config, firstProfileMemoryHealth());
    }

    if (
      method === 'post' &&
      path === `/students/${sandboxFirstProfileStudentId}/lesson-memory/requests`
    ) {
      sandboxFirstProfileLessonMemoryConfirmed = true;
      sandboxFirstProfileLessonMemoryHealthPolls = 0;
      return responseFor(config, {
        outcome: 'created',
        lessonMemoryEntryId: 'lesson-memory-cora',
        lessonTitle: null,
      });
    }

    if (method === 'get' && path === '/config/prompts') {
      return responseFor(config, {
        templates: [{ id: 'hw/default.md', label: 'Default Homework Template' }],
        defaults: {
          templateId: 'hw/default.md',
        },
      });
    }

    if (method === 'get' && path === '/config/job-options') {
      return responseFor(config, {
        presets: ['b1-default', 'b2-default'],
        learningPresets: [
          {
            id: 'general-english',
            version: 'v1',
            alias: 'current',
            title: 'General English',
            track: 'general-english',
            status: 'active',
            promptSnapshotVersion: 'hw_prompt_v4-2_clean',
          },
        ],
        cefrLevels: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'],
        cefrDefault: 'B1',
        generation: {
          providers: ['openai'],
          defaultProvider: 'openai',
          modelOptions: [
            {
              provider: 'openai',
              id: 'gpt-5.2',

              defaultSelected: true,
              enabled: true,
            },
          ],
          defaultModelByProvider: { openai: 'gpt-5.2' },
          quota: {
            source: 'hybrid',
            lastUpdatedAt: now,
            requestsPerMinute: 5,
            tokensPerMinute: 250000,
            requestsPerDay: 20,
          },
        },
        voiceAccents: ['american'],
        voices: [{ id: 'voice-a', name: 'Voice A', accent: 'american' }],
        sttProviders: ['deepgram'],
        defaultSttProvider: 'deepgram',
        sttModelOptionsByProvider: { deepgram: ['nova-3'] },
        defaultSttModelByProvider: { deepgram: 'nova-3' },
        ttsStrategies: ['auto', 'dialogue', 'tts'],
        ttsProviders: ['inworld'],
        ttsModelOptionsByProvider: { inworld: ['inworld-tts-2'] },
        defaultTtsProvider: 'inworld',
        defaultTtsModelByProvider: { inworld: 'inworld-tts-2' },
        supportedActions: [
          {
            type: 'rerun',
            label: 'Rerun',
            description: 'Republish published version or selectively regenerate audio families',
            implemented: true,
          },
          {
            type: 'cancel',
            label: 'Cancel',
            description: 'Cancel active job',
            implemented: true,
          },
        ],
      });
    }

    if (method === 'get' && path === '/user/jobs') {
      if (scenario === 'step-one-resume-error') {
        throw scenarioErrorFor(config, 'Sandbox recent work is unavailable for this scenario.');
      }
      if (scenario === 'step-one-no-recent') {
        return responseFor(config, { jobs: [], total: 0, limit: 20, offset: 0 });
      }
      if (scenario === 'step-one-resume-states') {
        const jobs = resumeStateJobs();
        return responseFor(config, { jobs, total: jobs.length, limit: 20, offset: 0 });
      }
      return responseFor(config, { jobs: [jobStatus()], total: 1, limit: 20, offset: 0 });
    }

    if (method === 'get' && path === '/user/assignment-sessions') {
      if (scenario === 'step-one-resume-error') {
        throw scenarioErrorFor(config, 'Sandbox recent work is unavailable for this scenario.');
      }
      if (scenario === 'step-one-no-recent') {
        return responseFor(config, { sessions: [], total: 0, limit: 20 });
      }
      if (scenario === 'step-one-resume-states') {
        return responseFor(config, {
          sessions: [
            assignmentSession({
              id: 'session-sandbox-resume',
              studentId: 'student-alex',
              recordingId: 'recording-sandbox',
              transcriptId: 'transcript-sandbox',
            }),
          ],
          total: 1,
          limit: 20,
        });
      }
      return responseFor(config, {
        sessions: [
          assignmentSession({
            id: 'session-cora',
            studentId: sandboxFirstProfileStudentId,
            recordingId: sandboxFirstProfileRecordingId,
            transcriptId: sandboxFirstProfileTranscriptId,
          }),
        ],
        total: 1,
        limit: 20,
      });
    }

    if (method === 'post' && path === '/assignment-sessions/confirm-student') {
      const body = readRequestBody(config.data);
      const studentId = typeof body.studentId === 'string' ? body.studentId : 'student-alex';
      return responseFor(
        config,
        assignmentSession({
          studentId,
          lessonId: typeof body.lessonId === 'string' ? body.lessonId : null,
          recordingId: null,
          transcriptId: null,
          revision: 1,
          confirmedStep: 'student',
          confirmed: {
            student: { studentId },
            source: null,
            context: null,
            create: null,
          },
        }),
      );
    }

    if (method === 'get' && path === '/assignment-sessions/session-cora') {
      return responseFor(
        config,
        assignmentSession({
          id: 'session-cora',
          studentId: sandboxFirstProfileStudentId,
          recordingId: sandboxFirstProfileRecordingId,
          transcriptId: sandboxFirstProfileTranscriptId,
        }),
      );
    }

    if (method === 'get' && path.endsWith('/learner-context')) {
      const assignmentSessionId = path.split('/')[2] ?? 'session-sandbox';
      const firstProfile = assignmentSessionId === 'session-cora';
      const source = firstProfile
        ? {
            recordingId: sandboxFirstProfileRecordingId,
            transcriptId: sandboxFirstProfileTranscriptId,
            transcriptHash: 'a'.repeat(64),
          }
        : {
            recordingId: 'recording-sandbox',
            transcriptId: 'transcript-sandbox',
            transcriptHash: 'a'.repeat(64),
          };
      return responseFor(config, {
        assignmentSessionId,
        studentId: firstProfile ? sandboxFirstProfileStudentId : 'student-alex',
        source,
        eligibility: firstProfile ? 'eligible' : 'unknown_provenance',
        state: firstProfile ? 'preparing' : 'not_applicable',
        operationState: firstProfile ? 'waiting_evidence' : null,
        profile: firstProfile
          ? null
          : {
              studentId: 'student-alex',
              revisionId: 'profile-revision-sandbox',
              revisionHash: 'profile-hash-sandbox',
              content: profileContent().content,
              structuredContent: profileContent().structuredContent,
              updatedAt: now,
            },
        pinned: null,
        confirmationAvailable: true,
        warning: null,
      });
    }

    if (method === 'patch' && path === '/assignment-sessions/session-sandbox/recovery') {
      const body = readRequestBody(config.data);
      const patch =
        body.patch && typeof body.patch === 'object' ? (body.patch as Record<string, unknown>) : {};
      return responseFor(config, assignmentSession({ ...patch, revision: 3, updatedAt: now }));
    }

    if (method === 'patch' && path === '/assignment-sessions/session-cora/recovery') {
      const body = readRequestBody(config.data);
      const patch =
        body.patch && typeof body.patch === 'object' ? (body.patch as Record<string, unknown>) : {};
      return responseFor(
        config,
        assignmentSession({
          id: 'session-cora',
          studentId: sandboxFirstProfileStudentId,
          recordingId: sandboxFirstProfileRecordingId,
          transcriptId: sandboxFirstProfileTranscriptId,
          ...patch,
          revision: 3,
          updatedAt: now,
        }),
      );
    }

    if (
      method === 'post' &&
      (path === '/assignment-sessions/session-sandbox/confirm' ||
        path === '/assignment-sessions/session-cora/confirm')
    ) {
      const body = readRequestBody(config.data);
      const step = body.step;
      const base = assignmentSession({
        id: path.includes('session-cora') ? 'session-cora' : 'session-sandbox',
      });
      return responseFor(config, {
        session: assignmentSession({
          ...base,
          revision: 3,
          confirmedStep: step,
          confirmed:
            step === 'context'
              ? {
                  ...base.confirmed,
                  context: {
                    teacherNotes: typeof body.teacherNotes === 'string' ? body.teacherNotes : null,

                    material: body.material
                      ? effectiveAssignmentMaterial(
                          body.material as Parameters<typeof effectiveAssignmentMaterial>[0],
                        )
                      : undefined,

                    profileRevisionId:
                      typeof body.profileRevisionId === 'string' ? body.profileRevisionId : null,
                    profileRevisionHash:
                      typeof body.profileRevisionHash === 'string'
                        ? body.profileRevisionHash
                        : null,
                  },
                }
              : base.confirmed,
        }),
        invalidated: [],
      });
    }

    if (
      method === 'post' &&
      (path === '/assignment-sessions/session-sandbox/share' ||
        path === '/assignment-sessions/session-cora/share')
    ) {
      return responseFor(config, {
        session: assignmentSession({
          id: path.includes('session-cora') ? 'session-cora' : 'session-sandbox',
          revision: 4,
          confirmedStep: 'share',
          shareJobId: 'job-sandbox',
        }),
        job: jobStatus(),
      });
    }

    if (method === 'post' && path === '/recordings/upload') {
      const requestedStudentId = readStudentIdParam(config);
      if (requestedStudentId === sandboxFirstProfileStudentId) {
        return responseFor(config, {
          recordingId: sandboxFirstProfileRecordingId,
          status: 'transcribed',
          transcriptId: sandboxFirstProfileTranscriptId,
          error: null,
          source: 'upload',
          studentId: sandboxFirstProfileStudentId,
          displayName: 'cora-preview-lesson.mp3',
          durationSec: 150,
          channels: 1,
          bytes: 1024,
          createdAt: now,
          updatedAt: now,
        });
      }

      return responseFor(config, {
        recordingId: 'recording-sandbox',
        status: 'transcribed',
        transcriptId: 'transcript-sandbox',
        error: null,
        source: 'upload',
        studentId: 'student-alex',
        displayName: 'sandbox-lesson.mp3',
        durationSec: 180,
        channels: 1,
        bytes: 1024,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (method === 'post' && path === '/recordings/transcript-source') {
      const body = readRequestBody(config.data);
      manualTranscriptText = typeof body.text === 'string' ? body.text.trim() : '';
      manualTranscriptStudentId =
        typeof body.studentId === 'string' && body.studentId.trim()
          ? body.studentId.trim()
          : 'student-alex';
      manualTranscriptDisplayName =
        typeof body.displayName === 'string' && body.displayName.trim()
          ? body.displayName.trim()
          : 'Pasted lesson transcript';
      return responseFor(config, {
        recordingId: 'recording-manual-sandbox',
        status: 'transcribed',
        transcriptId: 'transcript-manual-sandbox',
        error: null,
        source: 'manual_transcript',
        studentId: manualTranscriptStudentId,
        displayName: manualTranscriptDisplayName,
        durationSec: null,
        channels: null,
        bytes: new TextEncoder().encode(manualTranscriptText).byteLength,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (method === 'get' && path === '/recordings/recording-manual-sandbox') {
      return responseFor(config, {
        recordingId: 'recording-manual-sandbox',
        status: 'transcribed',
        transcriptId: 'transcript-manual-sandbox',
        error: null,
        source: 'manual_transcript',
        studentId: manualTranscriptStudentId,
        displayName: manualTranscriptDisplayName,
        durationSec: null,
        channels: null,
        bytes: new TextEncoder().encode(manualTranscriptText).byteLength,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (method === 'get' && path === '/recordings/recording-manual-sandbox/transcript') {
      return responseFor(config, {
        recordingId: 'recording-manual-sandbox',
        transcriptId: 'transcript-manual-sandbox',
        text: manualTranscriptText,
        summaryJson: { provider: 'manual', origin: 'tutor_paste' },
        sttProvider: 'manual',
        model: 'manual-entry',
        language: 'und',
        mode: 'timeline',
        workingVersion: 1,
        contentHash: 'd'.repeat(64),
        createdAt: now,
        updatedAt: now,
      });
    }

    if (method === 'get' && path === `/recordings/${sandboxFirstProfileRecordingId}`) {
      return responseFor(config, {
        recordingId: sandboxFirstProfileRecordingId,
        status: 'transcribed',
        transcriptId: sandboxFirstProfileTranscriptId,
        error: null,
        source: 'upload',
        studentId: sandboxFirstProfileStudentId,
        displayName: 'cora-preview-lesson.mp3',
        durationSec: 150,
        channels: 1,
        bytes: 1024,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (method === 'get' && path === '/recordings/recording-sandbox') {
      return responseFor(config, {
        recordingId: 'recording-sandbox',
        status: 'transcribed',
        transcriptId: 'transcript-sandbox',
        error: null,
        source: 'upload',
        studentId: 'student-alex',
        displayName: 'sandbox-lesson.mp3',
        durationSec: 180,
        channels: 1,
        bytes: 1024,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (method === 'get' && path === `/recordings/${sandboxFirstProfileRecordingId}/transcript`) {
      return responseFor(config, {
        recordingId: sandboxFirstProfileRecordingId,
        transcriptId: sandboxFirstProfileTranscriptId,
        text: 'Cora practiced a short client update and one polite clarification question.',
        summaryJson: null,
        sttProvider: 'deepgram',
        model: 'nova-3',
        language: 'en',
        mode: 'timeline',
        workingVersion: 1,
        contentHash: 'e'.repeat(64),
        createdAt: now,
        updatedAt: now,
      });
    }

    if (method === 'get' && path === '/recordings/recording-sandbox/transcript') {
      return responseFor(config, {
        recordingId: 'recording-sandbox',
        transcriptId: 'transcript-sandbox',
        text: 'Alex practiced giving a concise project update and asking one follow-up question.',
        summaryJson: null,
        sttProvider: 'deepgram',
        model: 'nova-3',
        language: 'en',
        mode: 'timeline',
        workingVersion: 1,
        contentHash: 'a'.repeat(64),
        createdAt: now,
        updatedAt: now,
      });
    }

    if (method === 'get' && path === '/students/student-alex/profile') {
      return responseFor(config, profileContent());
    }

    if (method === 'get' && path === `/students/${sandboxFirstProfileStudentId}/profile`) {
      return responseFor(config, firstProfileContent());
    }

    if (method === 'put' && path.match(/^\/students\/[^/]+\/profile$/)) {
      const body = readRequestBody(config.data);
      const existing = path.includes(sandboxFirstProfileStudentId)
        ? firstProfileContent()
        : profileContent();
      return responseFor(config, {
        ...existing,
        content: typeof body.content === 'string' ? body.content : existing.content,
        structuredContent:
          body.structuredContent && typeof body.structuredContent === 'object'
            ? body.structuredContent
            : existing.structuredContent,
        updatedAt: now,
      });
    }

    if (method === 'get' && path.match(/^\/students\/[^/]+\/profile\/revisions$/)) {
      if (path.includes(sandboxFirstProfileStudentId)) {
        return responseFor(config, firstProfileRevisionList());
      }
      return responseFor(config, profileRevisionList());
    }

    if (
      method === 'get' &&
      path === '/students/student-alex/profile/revisions/profile-revision-sandbox'
    ) {
      return responseFor(config, {
        ...profileRevisionSummary(),
        content: profileContent().content,
        structuredContent: profileContent().structuredContent,
      });
    }

    if (
      method === 'get' &&
      path === '/students/student-alex/profile/revisions/profile-revision-sandbox-draft'
    ) {
      return responseFor(config, profileDraftReviewRevision());
    }

    if (
      method === 'get' &&
      path ===
        `/students/${sandboxFirstProfileStudentId}/profile/revisions/${sandboxFirstProfileRevisionId}`
    ) {
      return responseFor(
        config,
        profileDraftReviewRevision({
          id: sandboxFirstProfileRevisionId,
          studentId: sandboxFirstProfileStudentId,
          contentHash: 'profile-hash-cora-first-draft',
          source: 'lesson_population',
          versionNumber: 1,
          versionLabel: 'v1',
          content: '# Foundational Profile\n\nSandbox first profile draft from Cora lesson memory.',
          structuredContent: firstProfileDraftStructuredContent(),
        }),
      );
    }

    if (
      method === 'post' &&
      path === '/students/student-alex/profile-drafts/populate-first-from-lesson'
    ) {
      const draftRevision = profileDraftReviewRevision({
        id: 'profile-revision-sandbox-first-draft',
        source: 'lesson_population',
        structuredContent: {
          ...profileDraftReviewStructuredContent(),
          primaryGoals: ['Practice concise workplace updates from recent lessons.'],
          teacherNotes:
            'First draft from sandbox lesson memory. Review before activating for real learners.',
        },
      });

      return responseFor(config, {
        draftRevisionId: draftRevision.id,
        studentId: 'student-alex',
        snapshotId: 'snapshot-sandbox',
        lessonMemoryIds: ['lesson-memory-sandbox'],
        homeworkMemoryIds: ['homework-memory-sandbox'],
        draftRevision,
      });
    }

    if (
      method === 'post' &&
      path === `/students/${sandboxFirstProfileStudentId}/profile-drafts/populate-first-from-lesson`
    ) {
      const draftRevision = profileDraftReviewRevision({
        id: sandboxFirstProfileRevisionId,
        studentId: sandboxFirstProfileStudentId,
        contentHash: 'profile-hash-cora-first-draft',
        source: 'lesson_population',
        versionNumber: 1,
        versionLabel: 'v1',
        content: '# Foundational Profile\n\nSandbox first profile draft from Cora lesson memory.',
        structuredContent: firstProfileDraftStructuredContent(),
      });

      return responseFor(config, {
        draftRevisionId: draftRevision.id,
        studentId: sandboxFirstProfileStudentId,
        snapshotId: null,
        lessonMemoryIds: ['lesson-memory-cora'],
        homeworkMemoryIds: [],
        draftRevision,
      });
    }

    if (
      method === 'post' &&
      path === '/students/student-alex/profile-drafts/refresh-from-approved-candidates'
    ) {
      const body = readRequestBody(config.data);
      const candidateIds = Array.isArray(body.candidateIds)
        ? body.candidateIds.filter((id): id is string => typeof id === 'string')
        : ['candidate-sandbox-study-preference'];
      const includedCandidateIds =
        candidateIds.length > 0 ? candidateIds : ['candidate-sandbox-study-preference'];

      return responseFor(config, {
        draftRevisionId: 'profile-revision-sandbox-draft',
        studentId: 'student-alex',
        includedCandidateIds,
        excludedCandidateIds: [],
        contentHash: 'profile-hash-sandbox-draft',
        draftRevision: profileDraftReviewRevision(),
      });
    }

    if (method === 'post' && path.match(/^\/students\/[^/]+\/profile\/revisions$/)) {
      const body = readRequestBody(config.data);
      return responseFor(
        config,
        profileDraftReviewRevision({
          id: 'profile-revision-sandbox-saved-draft',
          contentHash: 'profile-hash-sandbox-saved-draft',
          source: 'update',
          structuredContent:
            body.structuredContent && typeof body.structuredContent === 'object'
              ? body.structuredContent
              : profileDraftReviewStructuredContent(),
        }),
      );
    }

    if (
      method === 'post' &&
      (path ===
        '/students/student-alex/profile/revisions/profile-revision-sandbox-draft/activate' ||
        path ===
          '/students/student-alex/profile/revisions/profile-revision-sandbox-saved-draft/activate')
    ) {
      return responseFor(config, {
        ...profileDraftReviewRevision(),
        id: path.includes('saved-draft')
          ? 'profile-revision-sandbox-saved-draft'
          : 'profile-revision-sandbox-draft',
        status: 'active',
        activatedAt: now,
        structuredContent: profileDraftReviewStructuredContent(),
      });
    }

    if (
      method === 'post' &&
      path ===
        `/students/${sandboxFirstProfileStudentId}/profile/revisions/${sandboxFirstProfileRevisionId}/activate`
    ) {
      return responseFor(config, {
        ...firstProfileRevisionList().items[0],
        status: 'active',
        activatedAt: now,
        content: firstProfileContent().content,
        structuredContent: firstProfileDraftStructuredContent(),
      });
    }

    if (method === 'get' && path === '/students/student-alex/surfaces/schedule-billing') {
      return responseFor(config, scheduleBillingSurface());
    }

    if (
      method === 'get' &&
      path === `/students/${sandboxFirstProfileStudentId}/surfaces/schedule-billing`
    ) {
      return responseFor(config, {
        ...scheduleBillingSurface(),
        studentId: sandboxFirstProfileStudentId,
        student: {
          studentId: sandboxFirstProfileStudentId,
          displayName: 'Cora Preview',
          defaultRateMinor: 4000,
          packageBalance: 0,
          lowCreditThreshold: 2,
          archivedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      });
    }

    if (method === 'post' && path === '/recordings/recording-sandbox/prompt-package') {
      return responseFor(config, promptPackage);
    }

    if (
      method === 'post' &&
      path === `/recordings/${sandboxFirstProfileRecordingId}/prompt-package`
    ) {
      return responseFor(config, firstProfilePromptPackage);
    }

    if (method === 'post' && path === '/generation/drafts') {
      const body = readRequestBody(config.data);
      if (body.promptPackageId === firstProfilePromptPackage.id) {
        return responseFor(config, {
          ...firstProfileDraft,
          provider: 'openai',
          model: 'gpt-5.2',
          quota: {
            source: 'hybrid',
            lastUpdatedAt: now,
          },
        });
      }

      return responseFor(config, {
        ...draft,
        provider: 'openai',
        model: 'gpt-5.2',
        quota: {
          source: 'hybrid',
          lastUpdatedAt: now,
        },
      });
    }

    if (method === 'get' && path === '/prompt-packages/prompt-sandbox') {
      return responseFor(config, promptPackage);
    }

    if (method === 'get' && path === '/prompt-packages/prompt-cora') {
      return responseFor(config, firstProfilePromptPackage);
    }

    if (method === 'get' && path === '/drafts/draft-sandbox') {
      return responseFor(config, draft);
    }

    if (method === 'put' && path === '/recordings/recording-sandbox/transcript') {
      return responseFor(config, {
        recordingId: 'recording-sandbox',
        transcriptId: 'transcript-sandbox',
        text: readRequestText(config.data, ''),
        summaryJson: null,
        sttProvider: 'deepgram',
        model: 'nova-3',
        language: 'en',
        mode: 'timeline',
        workingVersion: 2,
        contentHash: 'f'.repeat(64),
        createdAt: now,
        updatedAt: now,
      });
    }

    if (method === 'put' && path === '/drafts/draft-sandbox') {
      return responseFor(config, {
        ...draft,
        text: readRequestText(config.data, draft.text),
        assignment: parseAssignmentV1(readRequestText(config.data, draft.text), sandboxContext),
        workingVersion: 2,
        contentHash: 'f'.repeat(64),
        updatedAt: now,
      });
    }

    if (method === 'post' && path === '/validation/markdown') {
      throw scenarioErrorFor(config, 'legacy_assignment_read_only');
    }

    if (method === 'post' && path === '/prompt-packages/prompt-sandbox/draft') {
      const text = readRequestText(config.data, draft.text);
      return responseFor(config, {
        ...draft,
        text,
        assignment: parseAssignmentV1(text, sandboxContext),
      });
    }

    if (method === 'post' && path === '/preview/html') {
      if (!readRequestBody(config.data).assignment)
        throw scenarioErrorFor(config, 'legacy_assignment_read_only');
      return responseFor(config, {
        html: '<article><h1>Alex - Workplace Update Practice</h1><p>Sandbox preview.</p></article>',
      });
    }

    if (method === 'post' && path === '/drafts/draft-sandbox/materialize') {
      return responseFor(config, {
        draftId: 'draft-sandbox',
        jobId: 'job-sandbox',
        mdPath: '/tmp/sandbox-assignment.md',
        mdStorageUri: 'memory://sandbox/assignment.md',
      });
    }

    if (method === 'post' && path === '/jobs/job-sandbox/approve') {
      return responseFor(config, jobStatus());
    }

    if (method === 'get' && path === '/jobs/job-sandbox') {
      return responseFor(config, jobStatus());
    }

    if (method === 'get' && path === '/jobs/job-sandbox/provenance') {
      return responseFor(config, jobProvenance());
    }

    throw notFoundFor(config);
  };
}
