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
