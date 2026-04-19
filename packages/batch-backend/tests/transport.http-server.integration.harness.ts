/* eslint-disable @typescript-eslint/no-explicit-any */
import { request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { CONTRACT_VERSIONS, DB_MIGRATION_HEAD } from '@esl-pipeline/contracts';
import { validateMarkdown } from '@esl-pipeline/md-validator';

import * as approveJobModule from '../src/application/approve-job.js';
import * as createDraftModule from '../src/application/create-draft.js';
import * as createPromptPackageModule from '../src/application/create-prompt-package.js';
import * as generateDraftModule from '../src/application/generate-draft.js';
import { getJobOptions } from '../src/application/get-job-options.js';
import * as getJobProvenanceModule from '../src/application/get-job-provenance.js';
import * as getJobStatusModule from '../src/application/get-job-status.js';
import * as getPromptPackageModule from '../src/application/get-prompt-package.js';
import * as getRecordingModule from '../src/application/get-recording.js';
import * as getRecordingTranscriptModule from '../src/application/get-recording-transcript.js';
import * as jobSummaryModule from '../src/application/job-summary.js';
import * as listJobsModule from '../src/application/list-jobs.js';
import * as listRecordingsModule from '../src/application/list-recordings.js';
import * as materializeDraftModule from '../src/application/materialize-draft.js';
import * as profileCandidatePromotionModule from '../src/application/profile-candidate-promotion.js';
import * as profileContentModule from '../src/application/profile-content.js';
import { ProfilePathError } from '../src/application/profile-path.js';
import * as readinessMetricsModule from '../src/application/readiness-metrics.js';
import * as retryRecordingModule from '../src/application/retry-recording-transcription.js';
import * as studentMemoryInspectionModule from '../src/application/student-memory-inspection.js';
import * as studentBindingsModule from '../src/application/student-profile-bindings.js';
import * as studentProfileCandidatesModule from '../src/application/student-profile-candidates.js';
import * as studentStoreModule from '../src/application/student-profiles-store.js';
import * as studentSummaryModule from '../src/application/student-summary.js';
import * as studentTimelineModule from '../src/application/student-timeline.js';
import * as submitJobModule from '../src/application/submit-job.js';
import * as templateContentModule from '../src/application/template-content.js';
import * as updateRecordingTranscriptModule from '../src/application/update-recording-transcript.js';
import { getVersionMeta } from '../src/application/version-meta.js';
import { publishJobEvent } from '../src/domain/job-events.js';
import { publishRecordingEvent } from '../src/domain/recording-events.js';
import * as recordingRepositoryModule from '../src/domain/recording-repository.js';
import * as settingsRepositoryModule from '../src/domain/settings-repository.js';
import { deriveStudentId } from '../src/domain/student-utils.js';
import * as transcriptRepositoryModule from '../src/domain/transcript-repository.js';
import * as loggerModule from '../src/infrastructure/logger.js';
import * as transcriptionStorageModule from '../src/infrastructure/transcription-storage.js';
import { createHttpServer } from '../src/transport/http-server.js';

vi.mock('../src/transport/auth-middleware.js', async () => {
  const actual = await vi.importActual<typeof import('../src/transport/auth-middleware.js')>(
    '../src/transport/auth-middleware.js',
  );
  return {
    ...actual,
    authenticate: vi.fn((request, reply, done) => {
      (request as any).user = {
        id: 'test-user-id',
        email: 'test@example.com',
        role: 'user',
      };
      done?.();
    }),
    requireRole: vi.fn(() =>
      vi.fn((request, reply, done) => {
        done?.();
      }),
    ),
    getAuthenticatedUser: vi.fn((request) => (request as any).user),
  };
});

vi.mock('../src/transport/rate-limit-middleware', async () => {
  const actual = await vi.importActual<typeof import('../src/transport/rate-limit-middleware.js')>(
    '../src/transport/rate-limit-middleware',
  );
  return {
    ...actual,
    createUploadRateLimitMiddleware: vi.fn(() =>
      vi.fn((request, reply, done) => {
        done?.();
      }),
    ),
  };
});

vi.mock('../src/infrastructure/logger', async () => {
  const actual = await vi.importActual<typeof loggerModule>('../src/infrastructure/logger');
  return {
    ...actual,
    logger: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      child: vi.fn().mockReturnValue({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      }),
    },
  };
});

vi.mock('../src/infrastructure/orchestrator-service', () => {
  const orchestratorJobOptionsMock = {
    presets: ['b1-default'],
    cefrLevels: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const,
    cefrDefault: 'B1' as const,
    generation: {
      providers: ['openai', 'google_ai_studio', 'openrouter'] as const,
      defaultProvider: 'openai' as const,
      modelOptions: [
        {
          provider: 'openai' as const,
          id: 'gpt-5.2',
          tier: 'primary' as const,
          fallbackRank: 0,
          defaultSelected: true,
          enabled: true,
        },
      ],
      defaultModelByProvider: {
        openai: 'gpt-5.2',
      },
      quota: {
        source: 'hybrid' as const,
        lastUpdatedAt: '2026-02-18T00:00:00.000Z',
        requestsPerMinute: 5,
        tokensPerMinute: 250000,
        requestsPerDay: 20,
      },
    },
    voiceAccents: ['american_female'],
    voices: [{ id: 'voice-1', name: 'Voice One', accent: 'american_female', gender: 'female' }],
    uploadOptions: ['auto', 's3', 'none'] as const,
    ttsStrategies: ['auto', 'dialogue', 'tts'] as const,
  };
  return {
    getJobOptionsFromOrchestrator: vi.fn().mockResolvedValue(orchestratorJobOptionsMock),
  };
});

vi.mock('@esl-pipeline/md-validator', () => {
  return {
    validateMarkdown: vi.fn(),
  };
});

vi.mock('../src/application/student-profiles-store', async () => {
  const actual = await vi.importActual<
    typeof import('../src/application/student-profiles-store.js')
  >('../src/application/student-profiles-store.js');
  return {
    ...actual,
    listStudentProfiles: vi.fn(),
    getStudentProfileById: vi.fn(),
    createStudentProfile: vi.fn(),
    updateStudentProfile: vi.fn(),
    deleteStudentProfile: vi.fn(),
  };
});

vi.mock('../src/application/profile-content', () => {
  return {
    listProfileContents: vi.fn(),
    getProfileContent: vi.fn(),
    upsertProfileContent: vi.fn(),
    deleteProfileContent: vi.fn(),
    listProfileRevisionsForProfile: vi.fn(),
    getProfileRevisionForProfile: vi.fn(),
    restoreProfileRevision: vi.fn(),
    activateProfileRevisionForProfile: vi.fn(),
  };
});

vi.mock('../src/application/template-content', () => {
  return {
    listTemplateContents: vi.fn(),
    getTemplateContent: vi.fn(),
    upsertTemplateContent: vi.fn(),
    deleteTemplateContent: vi.fn(),
    listTemplateRevisionsForTemplate: vi.fn(),
    getTemplateRevisionForTemplate: vi.fn(),
    restoreTemplateRevision: vi.fn(),
    activateTemplateRevisionForTemplate: vi.fn(),
  };
});

vi.mock('../src/application/student-timeline', () => {
  return {
    getStudentTimeline: vi.fn(),
  };
});

vi.mock('../src/application/student-memory-inspection', () => {
  return {
    getStudentMemoryOverview: vi.fn(),
    listStudentLessonMemory: vi.fn(),
    listStudentHomeworkMemory: vi.fn(),
    listStudentMemorySnapshotsForStudent: vi.fn(),
    listStudentProfileCandidatesForStudent: vi.fn(),
  };
});

vi.mock('../src/application/student-profile-candidates', () => {
  return {
    approveStudentProfileCandidate: vi.fn(),
    rejectStudentProfileCandidate: vi.fn(),
    deferStudentProfileCandidate: vi.fn(),
    StudentProfileCandidateServiceError: class StudentProfileCandidateServiceError extends Error {
      code: string;
      status: number;

      constructor(args: { code: string; status: number; message: string }) {
        super(args.message);
        this.code = args.code;
        this.status = args.status;
      }
    },
  };
});

vi.mock('../src/application/profile-candidate-promotion', () => {
  return {
    promoteStudentProfileCandidates: vi.fn(),
    ProfileCandidatePromotionError: class ProfileCandidatePromotionError extends Error {
      code: string;
      status: number;

      constructor(message: string, code = 'promotion_error', status = 400) {
        super(message);
        this.code = code;
        this.status = status;
      }
    },
  };
});

vi.mock('../src/application/student-profile-bindings', () => {
  return {
    listStudentProfileBindingsForStudent: vi.fn(),
    getActiveStudentProfileBindingForStudent: vi.fn(),
    resolveStudentProfileBindingAt: vi.fn(),
  };
});

vi.mock('../src/application/get-job-provenance.js', () => {
  return {
    getJobProvenance: vi.fn(),
  };
});

vi.mock('../src/application/get-prompt-options.js', () => {
  return {
    getPromptOptions: vi.fn().mockResolvedValue({
      templates: [{ id: 'template.md', label: 'Template' }],
      profiles: [{ id: 'profile.md', label: 'Profile' }],
      defaults: { templateId: 'template.md', profileId: 'profile.md' },
    }),
  };
});

export function describeHttpServerIntegrationSuite(
  title: string,
  register: (ctx: any) => void,
): void {
  describe(title, () => {
    let app: Awaited<ReturnType<typeof createHttpServer>>;
    const mockListStudentProfiles = vi.mocked(studentStoreModule.listStudentProfiles);
    const mockGetStudentProfileById = vi.mocked(studentStoreModule.getStudentProfileById);
    const mockCreateStudentProfile = vi.mocked(studentStoreModule.createStudentProfile);
    const mockUpdateStudentProfile = vi.mocked(studentStoreModule.updateStudentProfile);
    const mockDeleteStudentProfile = vi.mocked(studentStoreModule.deleteStudentProfile);
    const mockListProfileContents = vi.mocked(profileContentModule.listProfileContents);
    const mockGetProfileContent = vi.mocked(profileContentModule.getProfileContent);
    const mockUpsertProfileContent = vi.mocked(profileContentModule.upsertProfileContent);
    const mockDeleteProfileContent = vi.mocked(profileContentModule.deleteProfileContent);
    const mockListProfileRevisionsForProfile = vi.mocked(
      profileContentModule.listProfileRevisionsForProfile,
    );
    const mockGetProfileRevisionForProfile = vi.mocked(
      profileContentModule.getProfileRevisionForProfile,
    );
    const mockRestoreProfileRevision = vi.mocked(profileContentModule.restoreProfileRevision);
    const mockActivateProfileRevisionForProfile = vi.mocked(
      profileContentModule.activateProfileRevisionForProfile,
    );
    const mockListTemplateContents = vi.mocked(templateContentModule.listTemplateContents);
    const mockGetTemplateContent = vi.mocked(templateContentModule.getTemplateContent);
    const mockUpsertTemplateContent = vi.mocked(templateContentModule.upsertTemplateContent);
    const mockDeleteTemplateContent = vi.mocked(templateContentModule.deleteTemplateContent);
    const mockListTemplateRevisionsForTemplate = vi.mocked(
      templateContentModule.listTemplateRevisionsForTemplate,
    );
    const mockGetTemplateRevisionForTemplate = vi.mocked(
      templateContentModule.getTemplateRevisionForTemplate,
    );
    const mockRestoreTemplateRevision = vi.mocked(templateContentModule.restoreTemplateRevision);
    const mockActivateTemplateRevisionForTemplate = vi.mocked(
      templateContentModule.activateTemplateRevisionForTemplate,
    );
    const mockGetStudentTimeline = vi.mocked(studentTimelineModule.getStudentTimeline);
    const mockGetStudentMemoryOverview = vi.mocked(
      studentMemoryInspectionModule.getStudentMemoryOverview,
    );
    const mockListStudentLessonMemory = vi.mocked(
      studentMemoryInspectionModule.listStudentLessonMemory,
    );
    const mockListStudentHomeworkMemory = vi.mocked(
      studentMemoryInspectionModule.listStudentHomeworkMemory,
    );
    const mockListStudentMemorySnapshotsForStudent = vi.mocked(
      studentMemoryInspectionModule.listStudentMemorySnapshotsForStudent,
    );
    const mockListStudentProfileCandidatesForStudent = vi.mocked(
      studentMemoryInspectionModule.listStudentProfileCandidatesForStudent,
    );
    const mockApproveStudentProfileCandidate = vi.mocked(
      studentProfileCandidatesModule.approveStudentProfileCandidate,
    );
    const mockRejectStudentProfileCandidate = vi.mocked(
      studentProfileCandidatesModule.rejectStudentProfileCandidate,
    );
    const mockDeferStudentProfileCandidate = vi.mocked(
      studentProfileCandidatesModule.deferStudentProfileCandidate,
    );
    const mockPromoteStudentProfileCandidates = vi.mocked(
      profileCandidatePromotionModule.promoteStudentProfileCandidates,
    );
    const mockListStudentProfileBindingsForStudent = vi.mocked(
      studentBindingsModule.listStudentProfileBindingsForStudent,
    );
    const mockGetActiveStudentProfileBindingForStudent = vi.mocked(
      studentBindingsModule.getActiveStudentProfileBindingForStudent,
    );
    const mockGetJobProvenance = vi.mocked(getJobProvenanceModule.getJobProvenance);

    beforeAll(async () => {
      vi.clearAllMocks();
      mockListStudentProfiles.mockResolvedValue({
        items: [
          {
            id: deriveStudentId('Anna'),
            student: 'Anna',
            dbId: null,
            pageParentId: null,
            colorPreset: null,
            accentPreference: null,
            voices: {},
            manifestPreset: null,
            profileId: null,
          },
          {
            id: deriveStudentId('Bob'),
            student: 'Bob',
            dbId: null,
            pageParentId: null,
            colorPreset: null,
            accentPreference: null,
            voices: {},
            manifestPreset: null,
            profileId: null,
          },
        ],
        total: 2,
        limit: 50,
        offset: 0,
        order: 'asc',
      });
      mockGetStudentProfileById.mockResolvedValue({
        id: deriveStudentId('Anna'),
        student: 'Anna',
        dbId: null,
        pageParentId: null,
        colorPreset: null,
        accentPreference: null,
        voices: {},
        manifestPreset: null,
        profileId: null,
      });
      mockCreateStudentProfile.mockResolvedValue({
        id: deriveStudentId('New Student'),
        student: 'New Student',
        dbId: null,
        pageParentId: null,
        colorPreset: null,
        accentPreference: null,
        voices: {},
        manifestPreset: null,
        profileId: null,
      });
      mockUpdateStudentProfile.mockResolvedValue({
        id: deriveStudentId('Anna'),
        student: 'Anna',
        dbId: null,
        pageParentId: null,
        colorPreset: 'b1-default',
        accentPreference: null,
        voices: {},
        manifestPreset: null,
        profileId: 'profile.md',
      });
      mockDeleteStudentProfile.mockResolvedValue(true);
      mockListProfileContents.mockResolvedValue({
        profiles: [{ id: 'profile.md', label: 'Profile' }],
      });
      mockGetProfileContent.mockResolvedValue({
        id: 'profile.md',
        label: 'Profile',
        content: 'Profile content',
        currentRevisionId: 'revision-1',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
      mockUpsertProfileContent.mockResolvedValue({
        id: 'profile.md',
        label: 'Profile',
        content: 'Updated content',
        currentRevisionId: 'revision-latest',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
      mockDeleteProfileContent.mockResolvedValue(true);
      mockListProfileRevisionsForProfile.mockResolvedValue({
        items: [
          {
            id: 'revision-1',
            profileId: 'profile.md',
            contentHash: 'hash-1',
            source: 'create',
            status: 'active',
            versionNumber: 1,
            versionLabel: 'v1',
            activatedAt: '2024-01-01T00:00:00.000Z',
            deprecatedAt: null,
            createdAt: '2024-01-01T00:00:00.000Z',
            createdBy: null,
            restoredFromRevisionId: null,
          },
        ],
        total: 1,
        limit: 50,
        offset: 0,
        order: 'desc',
      });
      mockGetProfileRevisionForProfile.mockResolvedValue({
        id: 'revision-1',
        profileId: 'profile.md',
        contentHash: 'hash-1',
        source: 'create',
        status: 'active',
        versionNumber: 1,
        versionLabel: 'v1',
        activatedAt: '2024-01-01T00:00:00.000Z',
        deprecatedAt: null,
        createdAt: '2024-01-01T00:00:00.000Z',
        createdBy: null,
        restoredFromRevisionId: null,
        content: 'Profile content',
      });
      mockRestoreProfileRevision.mockResolvedValue({
        id: 'profile.md',
        label: 'Profile',
        content: 'Restored content',
        currentRevisionId: 'revision-2',
        updatedAt: '2024-01-02T00:00:00.000Z',
      });
      mockListTemplateContents.mockResolvedValue({
        templates: [{ id: 'template.md', label: 'Template' }],
      });
      mockGetTemplateContent.mockResolvedValue({
        id: 'template.md',
        label: 'Template',
        content: String.raw`Template content`,
        currentRevisionId: 'template-revision-1',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
      mockUpsertTemplateContent.mockResolvedValue({
        id: 'template.md',
        label: 'Template',
        content: String.raw`Updated template content`,
        currentRevisionId: 'template-revision-2',
        updatedAt: '2024-01-02T00:00:00.000Z',
      });
      mockDeleteTemplateContent.mockResolvedValue(true);
      mockListTemplateRevisionsForTemplate.mockResolvedValue({
        items: [
          {
            id: 'template-revision-1',
            templateId: 'template.md',
            contentHash: 'template-hash-1',
            source: 'create',
            status: 'active',
            versionNumber: 1,
            versionLabel: 'v1',
            activatedAt: '2024-01-01T00:00:00.000Z',
            deprecatedAt: null,
            createdAt: '2024-01-01T00:00:00.000Z',
            createdBy: null,
            restoredFromRevisionId: null,
          },
        ],
        total: 1,
        limit: 50,
        offset: 0,
        order: 'desc',
      });
      mockGetTemplateRevisionForTemplate.mockResolvedValue({
        id: 'template-revision-1',
        templateId: 'template.md',
        contentHash: 'template-hash-1',
        source: 'create',
        status: 'active',
        versionNumber: 1,
        versionLabel: 'v1',
        activatedAt: '2024-01-01T00:00:00.000Z',
        deprecatedAt: null,
        createdAt: '2024-01-01T00:00:00.000Z',
        createdBy: null,
        restoredFromRevisionId: null,
        content: 'Template content',
      });
      mockRestoreTemplateRevision.mockResolvedValue({
        id: 'template.md',
        label: 'Template',
        content: 'Restored template',
        currentRevisionId: 'template-revision-2',
        updatedAt: '2024-01-02T00:00:00.000Z',
      });
      mockActivateTemplateRevisionForTemplate.mockResolvedValue({
        id: 'template-revision-1',
        templateId: 'template.md',
        contentHash: 'template-hash-1',
        source: 'create',
        status: 'active',
        versionNumber: 1,
        versionLabel: 'v1',
        activatedAt: '2024-01-01T00:00:00.000Z',
        deprecatedAt: null,
        createdAt: '2024-01-01T00:00:00.000Z',
        createdBy: null,
        restoredFromRevisionId: null,
        content: 'Template content',
      });
      mockGetStudentTimeline.mockResolvedValue({
        items: [
          {
            type: 'recording_ingested',
            studentId: deriveStudentId('Anna'),
            recordingId: 'recording-1',
            transcriptId: null,
            promptPackageId: null,
            draftId: null,
            jobId: null,
            status: 'queued',
            createdAt: '2024-01-01T00:00:00.000Z',
            displayName: 'recording-1.opus',
          },
        ],
        total: 1,
        limit: 20,
        offset: 0,
        order: 'desc',
      });
      mockGetStudentMemoryOverview.mockResolvedValue({
        studentId: deriveStudentId('Anna'),
        latestReadyStudentMemorySnapshot: null,
        recentReadyLessonMemory: [],
        recentReadyHomeworkMemory: [],
        unresolvedIssues: [],
      });
      mockListStudentLessonMemory.mockResolvedValue({
        studentId: deriveStudentId('Anna'),
        items: [],
        limit: 50,
        offset: 0,
        order: 'desc',
        statuses: null,
      });
      mockListStudentHomeworkMemory.mockResolvedValue({
        studentId: deriveStudentId('Anna'),
        items: [],
        limit: 50,
        offset: 0,
        order: 'desc',
        statuses: null,
      });
      mockListStudentMemorySnapshotsForStudent.mockResolvedValue({
        studentId: deriveStudentId('Anna'),
        items: [],
        limit: 50,
        offset: 0,
        order: 'desc',
        statuses: null,
      });
      mockListStudentProfileCandidatesForStudent.mockResolvedValue({
        studentId: deriveStudentId('Anna'),
        items: [],
        total: 0,
        limit: 50,
        offset: 0,
        order: 'desc',
        statuses: null,
        reviewStates: null,
      });
      mockApproveStudentProfileCandidate.mockResolvedValue({
        id: 'candidate-1',
        studentId: deriveStudentId('Anna'),
        targetSection: 'goals_motivation',
        candidateKey: 'goals_motivation:example',
        fact: 'Wants to speak English more confidently at work.',
        approvedFact: 'Wants to speak English more confidently at work.',
        category: 'goals',
        authority: 'student_stated',
        confidence: 'high',
        reviewNeeded: false,
        sourceSnapshotId: 'snapshot-1',
        sourceLessonMemoryIds: ['lesson-1'],
        evidence: [],
        status: 'approved',
        reviewState: 'approved',
        reviewerId: 'test-user-id',
        reviewerNote: null,
        reviewedAt: new Date('2024-01-01T00:00:00.000Z'),
        promotedRevisionId: null,
        promotedAt: null,
        supersededById: null,
        supersededAt: null,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      });
      mockRejectStudentProfileCandidate.mockResolvedValue({
        id: 'candidate-1',
        studentId: deriveStudentId('Anna'),
        targetSection: 'goals_motivation',
        candidateKey: 'goals_motivation:example',
        fact: 'Wants to speak English more confidently at work.',
        approvedFact: null,
        category: 'goals',
        authority: 'student_stated',
        confidence: 'high',
        reviewNeeded: false,
        sourceSnapshotId: 'snapshot-1',
        sourceLessonMemoryIds: ['lesson-1'],
        evidence: [],
        status: 'rejected',
        reviewState: 'rejected',
        reviewerId: 'test-user-id',
        reviewerNote: null,
        reviewedAt: new Date('2024-01-01T00:00:00.000Z'),
        promotedRevisionId: null,
        promotedAt: null,
        supersededById: null,
        supersededAt: null,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      });
      mockDeferStudentProfileCandidate.mockResolvedValue({
        id: 'candidate-1',
        studentId: deriveStudentId('Anna'),
        targetSection: 'goals_motivation',
        candidateKey: 'goals_motivation:example',
        fact: 'Wants to speak English more confidently at work.',
        approvedFact: null,
        category: 'goals',
        authority: 'student_stated',
        confidence: 'high',
        reviewNeeded: false,
        sourceSnapshotId: 'snapshot-1',
        sourceLessonMemoryIds: ['lesson-1'],
        evidence: [],
        status: 'pending_review',
        reviewState: 'deferred',
        reviewerId: 'test-user-id',
        reviewerNote: null,
        reviewedAt: new Date('2024-01-01T00:00:00.000Z'),
        promotedRevisionId: null,
        promotedAt: null,
        supersededById: null,
        supersededAt: null,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      });
      mockPromoteStudentProfileCandidates.mockResolvedValue({
        studentId: deriveStudentId('Anna'),
        profileId: 'profiles/anna.md',
        baseRevisionId: 'profile-revision-active',
        draftRevision: {
          id: 'profile-revision-draft',
          profileId: 'profiles/anna.md',
          contentHash: 'profile-draft-hash',
          source: 'candidate_promotion',
          status: 'draft',
          versionNumber: 3,
          versionLabel: 'v3',
          activatedAt: null,
          deprecatedAt: null,
          createdAt: '2024-01-01T00:00:00.000Z',
          createdBy: 'test-user-id',
          restoredFromRevisionId: null,
          content: '# Draft profile',
        },
        includedCandidateIds: ['candidate-1'],
        provider: 'google_ai_studio',
        model: 'gemini-3-flash-preview',
      });
      mockGetJobProvenance.mockResolvedValue({
        job: {
          id: 'test-job-1',
          state: 'succeeded',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:01:00.000Z',
          startedAt: '2024-01-01T00:00:10.000Z',
          finishedAt: '2024-01-01T00:01:00.000Z',
          sourceJobId: null,
          manifestPath: '/tmp/manifest.json',
          htmlUrl: null,
          error: null,
        },
        sourceJob: null,
        recording: null,
        transcript: null,
        promptPackage: null,
        draft: null,
        tts: null,
        pronunciationWarnings: [],
        lineage: null,
        actions: [],
      });
      mockListStudentProfileBindingsForStudent.mockResolvedValue({
        items: [
          {
            id: 'binding-1',
            studentId: deriveStudentId('Anna'),
            profileId: 'profile.md',
            effectiveFrom: '2024-01-01T00:00:00.000Z',
            effectiveTo: null,
            reason: 'sync_student_profile',
            changedBy: null,
            createdAt: '2024-01-01T00:00:00.000Z',
          },
        ],
        total: 1,
        limit: 50,
        offset: 0,
        order: 'desc',
      });
      mockGetActiveStudentProfileBindingForStudent.mockResolvedValue({
        id: 'binding-1',
        studentId: deriveStudentId('Anna'),
        profileId: 'profile.md',
        effectiveFrom: '2024-01-01T00:00:00.000Z',
        effectiveTo: null,
        reason: 'sync_student_profile',
        changedBy: null,
        createdAt: '2024-01-01T00:00:00.000Z',
      });

      app = await createHttpServer();
    });

    afterAll(async () => {
      await app.close();
    });

    const appProxy = new Proxy({} as Awaited<ReturnType<typeof createHttpServer>>, {
      get(_target, propertyKey) {
        const value = (app as any)[propertyKey];
        return typeof value === 'function' ? value.bind(app) : value;
      },
    });

    register({
      app: appProxy,
      expect,
      it,
      vi,
      httpRequest,
      Readable,
      validateMarkdown,
      CONTRACT_VERSIONS,
      DB_MIGRATION_HEAD,
      approveJobModule,
      createDraftModule,
      createPromptPackageModule,
      generateDraftModule,
      getJobOptions,
      getJobProvenanceModule,
      getJobStatusModule,
      getPromptPackageModule,
      getRecordingTranscriptModule,
      getRecordingModule,
      jobSummaryModule,
      listJobsModule,
      listRecordingsModule,
      materializeDraftModule,
      readinessMetricsModule,
      getVersionMeta,
      ProfilePathError,
      retryRecordingModule,
      studentStoreModule,
      studentBindingsModule,
      studentSummaryModule,
      studentMemoryInspectionModule,
      studentTimelineModule,
      submitJobModule,
      templateContentModule,
      updateRecordingTranscriptModule,
      publishJobEvent,
      publishRecordingEvent,
      recordingRepositoryModule,
      deriveStudentId,
      transcriptRepositoryModule,
      settingsRepositoryModule,
      transcriptionStorageModule,
      createHttpServer,
      mockListStudentProfiles,
      mockGetStudentProfileById,
      mockCreateStudentProfile,
      mockUpdateStudentProfile,
      mockDeleteStudentProfile,
      mockListProfileContents,
      mockGetProfileContent,
      mockUpsertProfileContent,
      mockDeleteProfileContent,
      mockListProfileRevisionsForProfile,
      mockGetProfileRevisionForProfile,
      mockRestoreProfileRevision,
      mockActivateProfileRevisionForProfile,
      mockListTemplateContents,
      mockGetTemplateContent,
      mockUpsertTemplateContent,
      mockDeleteTemplateContent,
      mockListTemplateRevisionsForTemplate,
      mockGetTemplateRevisionForTemplate,
      mockRestoreTemplateRevision,
      mockActivateTemplateRevisionForTemplate,
      mockGetStudentTimeline,
      mockGetStudentMemoryOverview,
      mockListStudentLessonMemory,
      mockListStudentHomeworkMemory,
      mockListStudentMemorySnapshotsForStudent,
      mockListStudentProfileCandidatesForStudent,
      mockApproveStudentProfileCandidate,
      mockRejectStudentProfileCandidate,
      mockDeferStudentProfileCandidate,
      mockPromoteStudentProfileCandidates,
      mockListStudentProfileBindingsForStudent,
      mockGetActiveStudentProfileBindingForStudent,
      mockGetJobProvenance,
    });
  });
}

export type { JobRecord } from '../src/domain/job-model.js';
export type { RecordingRecord } from '../src/domain/recording-model.js';
