import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { AxiosError } from 'axios';

const now = '2026-07-03T00:00:00.000Z';

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

function assignmentSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-sandbox',
    userId: 'sandbox-tutor',
    studentId: null,
    lessonId: null,
    recordingId: null,
    transcriptId: null,
    promptPackageId: null,
    draftId: null,
    currentStage: 'source',
    publishTarget: 'html',
    selectedTtsProvider: 'inworld',
    selectedTtsStrategy: 'auto',
    selectedTtsModel: 'inworld-tts-2',
    selectedPreset: 'general-english',
    selectedGenerationProvider: 'openai',
    selectedGenerationModel: 'gpt-5.2',
    teacherNotes: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    ...overrides,
  };
}

function jobStatus(overrides: Record<string, unknown> = {}) {
  return {
    jobId: 'job-sandbox',
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
    id: 'profiles/alex.md',
    label: 'Alex Profile',
    content: 'Alex is a B1 learner practicing confident workplace updates.',
    structuredContent: {
      schemaVersion: 'foundational_profile_v1',
      overallLevel: 'B1',
      primaryGoals: ['Lead project updates clearly.'],
      communicationContexts: ['Weekly team syncs.', 'Client check-ins.'],
      interestsAndUsefulThemes: ['Travel', 'Films'],
      stableStrengths: ['Strong listening comprehension.'],
      persistentChallenges: ['Needs smoother transitions and article accuracy.'],
      studyPreferences: ['Prefers concise, practical homework.'],
      durableConstraints: [],
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
    profileId: 'profiles/alex.md',
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

function profileRevisionSummary() {
  return {
    id: 'profile-revision-sandbox',
    profileId: 'profiles/alex.md',
    contentHash: 'profile-hash-sandbox',
    source: 'update',
    status: 'active',
    versionNumber: 1,
    versionLabel: 'v1',
    activatedAt: now,
    deprecatedAt: null,
    createdAt: now,
    createdBy: 'sandbox-tutor',
    restoredFromRevisionId: null,
  };
}

function profileRevisionList() {
  return {
    items: [profileRevisionSummary()],
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

function bindingHistory() {
  return {
    items: [
      {
        id: 'binding-sandbox',
        studentId: 'student-alex',
        profileId: 'profiles/alex.md',
        effectiveFrom: now,
        effectiveTo: null,
        reason: 'Sandbox seed',
        changedBy: 'sandbox-tutor',
        createdAt: now,
      },
    ],
    total: 1,
    limit: 5,
    offset: 0,
    order: 'desc',
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
      cadence: null,
      preferredTimes: null,
      schedulingNotes: 'Sandbox lesson data for local UI testing.',
      updatedAt: now,
    },
    recurrenceRule: null,
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
      recurrenceRuleId: null,
      recurrenceSlotId: null,
      recurrenceOccurrenceKey: null,
      recurrenceOrigin: 'manual',
      recurrenceOverrideKind: null,
      homework: {
        status: 'not_started',
        assignmentSessionId: null,
        promptPackageId: null,
        draftId: null,
        jobId: null,
        homeworkMemoryEntryId: null,
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

const promptPackage = {
  id: 'prompt-sandbox',
  recordingId: 'recording-sandbox',
  transcriptId: 'transcript-sandbox',
  studentId: 'student-alex',
  lessonId: null,
  profilePath: 'profiles/alex.md',
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
  text: [
    '# Alex - Workplace Update Practice',
    '',
    '## Warm-up',
    'Practice three ways to connect ideas: first, also, as a result.',
    '',
    '## Mission',
    'Write a short project update and one polite follow-up question.',
  ].join('\n'),
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
      bindingAtCreation: {
        profileId: 'profiles/alex.md',
        effectiveFrom: now,
      },
    },
    actions: [],
  };
}

export function createFrontendSandboxApiAdapter(): AxiosAdapter {
  return async (config: InternalAxiosRequestConfig): Promise<AxiosResponse> => {
    const method = (config.method ?? 'get').toLowerCase();
    const path = normalizePath(config.url);

    if (method === 'get' && path === '/config/students') {
      return responseFor(config, {
        students: [
          { id: 'student-alex', name: 'Alex', profileId: 'profiles/alex.md' },
          { id: 'student-bella', name: 'Bella', profileId: 'profiles/bella.md' },
        ],
      });
    }

    if (method === 'get' && path === '/students') {
      return responseFor(config, {
        items: [studentProfile()],
        total: 1,
        limit: 200,
        offset: 0,
        order: 'asc',
      });
    }

    if (method === 'get' && path === '/students/student-alex') {
      return responseFor(config, studentProfile());
    }

    if (method === 'get' && path === '/students/student-alex/surfaces/overview') {
      return responseFor(config, {
        profile: profileContent(),
        revisions: profileRevisionList(),
        memory: memoryOverview(),
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
        bindings: bindingHistory(),
        candidates: profileCandidateList(),
      });
    }

    if (method === 'get' && path === '/config/prompts') {
      return responseFor(config, {
        templates: [{ id: 'hw/default.md', label: 'Default Homework Template' }],
        profiles: [
          { id: 'profiles/alex.md', label: 'Alex Profile' },
          { id: 'profiles/bella.md', label: 'Bella Profile' },
        ],
        defaults: {
          templateId: 'hw/default.md',
          profileId: 'profiles/alex.md',
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
              tier: 'primary',
              fallbackRank: 0,
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
            description: 'Republish current draft or selectively regenerate audio families',
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
      return responseFor(config, { jobs: [jobStatus()], total: 1, limit: 20, offset: 0 });
    }

    if (method === 'get' && path === '/user/assignment-sessions') {
      return responseFor(config, { sessions: [], total: 0, limit: 20 });
    }

    if (method === 'post' && path === '/assignment-sessions') {
      return responseFor(config, assignmentSession());
    }

    if (method === 'patch' && path === '/assignment-sessions/session-sandbox') {
      return responseFor(config, assignmentSession({ updatedAt: now }));
    }

    if (method === 'post' && path === '/recordings/upload') {
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
        createdAt: now,
        updatedAt: now,
      });
    }

    if (method === 'get' && path === '/profiles/profiles%2Falex.md') {
      return responseFor(config, profileContent());
    }

    if (method === 'get' && path === '/students/student-alex/surfaces/schedule-billing') {
      return responseFor(config, scheduleBillingSurface());
    }

    if (method === 'post' && path === '/recordings/recording-sandbox/prompt-package') {
      return responseFor(config, promptPackage);
    }

    if (method === 'post' && path === '/generation/drafts') {
      return responseFor(config, {
        id: draft.id,
        promptPackageId: draft.promptPackageId,
        text: draft.text,
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

    if (method === 'get' && path === '/drafts/draft-sandbox') {
      return responseFor(config, draft);
    }

    if (method === 'post' && path === '/validation/markdown') {
      return responseFor(config, { ok: true, errors: [], warnings: [] });
    }

    if (method === 'post' && path === '/prompt-packages/prompt-sandbox/draft') {
      return responseFor(config, {
        id: 'draft-sandbox',
        promptPackageId: 'prompt-sandbox',
        studentId: 'student-alex',
        lessonId: null,
        storageUri: 'memory://sandbox/draft-sandbox',
        createdBy: 'sandbox-tutor',
        text: readRequestText(config.data, '# Alex - Workplace Update Practice'),
        createdAt: now,
        updatedAt: now,
      });
    }

    if (method === 'post' && path === '/preview/html') {
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
