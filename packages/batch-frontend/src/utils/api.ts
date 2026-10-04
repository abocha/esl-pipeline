/**
 * Typed client for @esl-pipeline/batch-backend.
 *
 * This frontend uses the documented public HTTP API with authentication:
 * - POST /auth/login, /auth/register, /auth/refresh
 * - POST /jobs (authenticated)
 * - GET /jobs/:jobId (authenticated)
 * - GET /jobs/:jobId/provenance (authenticated)
 * - GET /user/jobs, /user/jobs/summary (authenticated)
 * - GET /students/summary (authenticated)
 * - POST /uploads (authenticated)
 * - POST /recordings/upload (authenticated)
 * - POST /recordings/:id/transcribe (authenticated)
 * - GET /config/job-options for metadata
 * - GET /config/students for student profiles
 * - GET /config/prompts for prompt templates
 * - GET /students, /students/:id, /students/:id/timeline
 * - POST /students, PUT /students/:id, DELETE /students/:id
 * - POST /generation/drafts
 * - GET /drafts/:id
 * - GET /jobs/events (SSE) for live updates
 * - GET /user/profile, /user/files (authenticated)
 */
import { type AxiosError, type AxiosProgressEvent, isAxiosError } from 'axios';

import type {
  ActionCapability,
  AddStudentPackageRequest,
  AdjustStudentCreditsRequest,
  BusinessScheduleSurfaceResponse,
  BusinessSettingsDto,
  BusinessStatsSurfaceResponse,
  ArtifactWorkingContentDto as ContractArtifactWorkingContentDto,
  AssignmentLearnerContextDto as ContractAssignmentLearnerContextDto,
  AssignmentSessionDto as ContractAssignmentSessionDto,
  AssignmentSessionListResponse as ContractAssignmentSessionListResponse,
  AssignmentValidationResponse as ContractAssignmentValidationResponse,
  AttachAssignmentSourceRequest as ContractAttachAssignmentSourceRequest,
  AttachAssignmentSourceResponse as ContractAttachAssignmentSourceResponse,
  ConfirmAssignmentSessionShareRequest as ContractConfirmAssignmentSessionShareRequest,
  ConfirmAssignmentSessionShareResponse as ContractConfirmAssignmentSessionShareResponse,
  ConfirmAssignmentSessionStepRequest as ContractConfirmAssignmentSessionStepRequest,
  ConfirmAssignmentSessionStepResponse as ContractConfirmAssignmentSessionStepResponse,
  ConfirmStudentAssignmentSessionRequest as ContractConfirmStudentAssignmentSessionRequest,
  ElevenLabsTtsModelId as ContractElevenLabsTtsModelId,
  GenerateDraftRequest as ContractGenerateDraftRequest,
  GenerateDraftResponse as ContractGenerateDraftResponse,
  GenerationProvider as ContractGenerationProvider,
  GoogleTtsModel as ContractGoogleTtsModel,
  InworldTtsModel as ContractInworldTtsModel,
  JobConfigOverrides as ContractJobConfigOverrides,
  JobEventPayload as ContractJobEventPayload,
  JobEventType as ContractJobEventType,
  JobListResponse as ContractJobListResponse,
  JobOptionsPayload as ContractJobOptionsPayload,
  JobState as ContractJobState,
  JobSummaryResponse as ContractJobSummaryResponse,
  PronunciationChunkTtsProviderId as ContractPronunciationChunkTtsProviderId,
  PublishAssignmentCorrectionRequest as ContractPublishAssignmentCorrectionRequest,
  PublishAssignmentCorrectionResponse as ContractPublishAssignmentCorrectionResponse,
  RecordingDto as ContractRecordingDto,
  RecordingStatus as ContractRecordingStatus,
  RerunJobPayload as ContractRerunJobPayload,
  SttProviderId as ContractSttProviderId,
  StudentSummaryResponse as ContractStudentSummaryResponse,
  SubmitJobRequest as ContractSubmitJobRequest,
  TranscriptProviderId as ContractTranscriptProviderId,
  TtsModelId as ContractTtsModelId,
  TtsProviderId as ContractTtsProviderId,
  TtsStrategy as ContractTtsStrategy,
  UpdateAssignmentSessionRecoveryRequest as ContractUpdateAssignmentSessionRecoveryRequest,
  VoiceOption as ContractVoiceOption,
  CreateStudentLessonRequest,
  GenerationErrorCategory,
  JobActionRequest,
  JobStatusDto,
  PublishTarget,
  RecordingErrorCode,
  RecordStudentPaymentRequest,
  StreamEventMessage,
  StudentScheduleBillingSurfaceResponse,
  TemplateControlPlaneListDto,
  UpdateBusinessSettingsRequest,
  UpdateStudentLessonPlanRequest,
  UpdateStudentLessonRequest,
  UpsertStudentLessonRecurrenceRequest,
} from '@esl-pipeline/contracts';
import { DEFAULT_RECORDING_UPLOAD_MAX_BYTES, JobActionType } from '@esl-pipeline/contracts';

import apiClient, {
  buildApiProxyPath,
  getApiAuthToken,
  handleApiError,
  isAuthError,
} from './api-client';
import { getRecordingErrorAction } from './recording-state';

export type JobState = ContractJobState;
export type TtsStrategy = ContractTtsStrategy;
export type RecordingStatus = ContractRecordingStatus;
export type SttProvider = ContractSttProviderId;
export type AudioInputTopology = 'mixed_recording' | 'trusted_split_channels';
export type UserRole = 'admin' | 'user' | 'viewer';
export type RegisterRole = Exclude<UserRole, 'admin'>;

export type JobStatus = JobStatusDto;
export type JobEventType = ContractJobEventType;
export type JobEventPayload = ContractJobEventPayload;
export type JobEvent = StreamEventMessage;
export type SubmitJobRequest = ContractSubmitJobRequest;
export type JobListResponse = ContractJobListResponse;
export type JobSummaryResponse = ContractJobSummaryResponse;
export type StudentSummaryResponse = ContractStudentSummaryResponse;
export type JobConfigOverrides = ContractJobConfigOverrides;
export type AssignmentSession = ContractAssignmentSessionDto;
export type AssignmentSessionListResponse = ContractAssignmentSessionListResponse;
export type AttachAssignmentSourceRequest = ContractAttachAssignmentSourceRequest;
export type AttachAssignmentSourceResponse = ContractAttachAssignmentSourceResponse;
export type ConfirmStudentAssignmentSessionRequest = ContractConfirmStudentAssignmentSessionRequest;
export type UpdateAssignmentSessionRecoveryRequest = ContractUpdateAssignmentSessionRecoveryRequest;
export type ConfirmAssignmentSessionStepRequest = ContractConfirmAssignmentSessionStepRequest;
export type ConfirmAssignmentSessionStepResponse = ContractConfirmAssignmentSessionStepResponse;
export type ConfirmAssignmentSessionShareRequest = ContractConfirmAssignmentSessionShareRequest;
export type ConfirmAssignmentSessionShareResponse = ContractConfirmAssignmentSessionShareResponse;
export type PublishAssignmentCorrectionRequest = ContractPublishAssignmentCorrectionRequest;
export type PublishAssignmentCorrectionResponse = ContractPublishAssignmentCorrectionResponse;
export type TtsProviderId = ContractTtsProviderId;
export type TtsModelId = ContractTtsModelId;
export type GoogleTtsModel = ContractGoogleTtsModel;
export type InworldTtsModel = ContractInworldTtsModel;
export type ElevenLabsTtsModelId = ContractElevenLabsTtsModelId;
export type PronunciationChunkTtsProviderId = ContractPronunciationChunkTtsProviderId;
export type AssignmentValidationResponse = ContractAssignmentValidationResponse;
export type GenerateDraftRequest = ContractGenerateDraftRequest;
export type RecordingSourceAcquisitionResult =
  | RecordingListItem
  | { outcome: 'existing_assignment_resumed'; session: AssignmentSession };

export class AssignmentSessionConflictApiError extends Error {
  constructor(public readonly latestSession: AssignmentSession) {
    super('Newer saved assignment work was found. Review it before confirming again.');
    this.name = 'AssignmentSessionConflictApiError';
  }
}

export class AssignmentSourceOwnershipApiError extends Error {
  constructor(public readonly canonicalSession: AssignmentSession) {
    super('This lesson already has an assignment. Reopening the saved assignment.');
    this.name = 'AssignmentSourceOwnershipApiError';
  }
}

export class ArtifactWorkingConflictApiError extends Error {
  constructor(public readonly latestArtifact: ContractArtifactWorkingContentDto) {
    super('Newer saved artifact content was found. Review it before confirming again.');
    this.name = 'ArtifactWorkingConflictApiError';
  }
}

export class AssignmentSpeakerRoleMappingRequiredApiError extends Error {
  constructor() {
    super('Speaker roles are required. Assign every speaker before confirming this source.');
    this.name = 'AssignmentSpeakerRoleMappingRequiredApiError';
  }
}
export type GenerateDraftResponse = ContractGenerateDraftResponse;
export type GenerationDraftErrorCode = GenerationErrorCategory;
export type GenerationProvider = ContractGenerationProvider;
export type RerunJobPayload = ContractRerunJobPayload;
export type BusinessScheduleSurface = BusinessScheduleSurfaceResponse;
export type BusinessSettings = BusinessSettingsDto;
export type BusinessStatsSurface = BusinessStatsSurfaceResponse;
export type BusinessSettingsUpdate = UpdateBusinessSettingsRequest;

const GENERATE_DRAFT_REQUEST_TIMEOUT_MS = 240_000;

export interface RecordingTranscriptResponse {
  recordingId: string;
  transcriptId: string;
  text: string;
  summaryJson: Record<string, unknown> | null;
  sttProvider: ContractTranscriptProviderId;
  model: string;
  language: string;
  mode: 'timeline' | 'stack';
  workingVersion: number;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecordingListItem extends ContractRecordingDto {
  cacheHit?: boolean;
  cacheReason?: 'transcript_reused' | null;
  cacheRecordingId?: string | null;
}

export interface RecordingsListResponse {
  items: RecordingListItem[];
  limit: number;
  offset: number;
  total: number;
  order: 'asc' | 'desc';
}

export interface CreateManualTranscriptSourceInput {
  studentId: string;
  text: string;
  displayName?: string;
}

export interface StudentOption {
  id: string;
  name: string;
}

export interface StudentOptionsResponse {
  students: StudentOption[];
}

export interface StudentProfile {
  id: string;
  student: string;
  dbId?: string | null;
  pageParentId?: string | null;
  colorPreset?: string | null;
  accentPreference?: string | null;
  voices?: Record<string, string>;
  manifestPreset?: string | null;
  archivedAt?: string | null;
  archivedBy?: string | null;
  archiveReason?: string | null;
}

export interface StarterProfileInput {
  overallLevel?: string | null;
  primaryGoals?: string | null;
  communicationContexts?: string | null;
  interestsAndUsefulThemes?: string | null;
  stableStrengths?: string | null;
  persistentChallenges?: string | null;
  studyPreferences?: string | null;
  durableConstraints?: string | null;
  teacherNotes?: string | null;
}

export interface StudentProfileInput {
  student: string;
  dbId?: string | null;
  pageParentId?: string | null;
  voices?: Record<string, string>;
  starterProfile?: StarterProfileInput | null;
}
export type StudentProfileUpdate = Partial<StudentProfileInput>;

export interface StudentProfileListResponse {
  items: StudentProfile[];
  total: number;
  limit: number;
  offset: number;
  order: 'asc' | 'desc';
}

export interface ProfileContentResponse {
  studentId: string;
  content: string;
  structuredContent?: FoundationalProfile | null;
  currentRevisionId: string | null;
  updatedAt: string | null;
}

export interface FoundationalProfile {
  schemaVersion: 'foundational_profile_v1';
  overallLevel: string | null;
  primaryGoals: string[];
  communicationContexts: string[];
  interestsAndUsefulThemes: string[];
  stableStrengths: string[];
  persistentChallenges: string[];
  studyPreferences: string[];
  durableConstraints: string[];
  teacherNotes: string | null;
}

export interface ProfileRevisionSummaryResponse {
  id: string;
  studentId: string;
  contentHash: string;
  source:
    | 'create'
    | 'update'
    | 'restore'
    | 'starter_profile_form'
    | 'candidate_promotion'
    | 'legacy_normalization'
    | 'lesson_population'
    | 'profile_revision_refresh';
  status?: 'draft' | 'active' | 'deprecated';
  versionNumber?: number;
  versionLabel?: string;
  activatedAt?: string | null;
  deprecatedAt?: string | null;
  createdAt: string;
  createdBy: string | null;
  restoredFromRevisionId: string | null;
}

export interface ProfileRevisionDetailResponse extends ProfileRevisionSummaryResponse {
  content: string;
  structuredContent?: ProfileContentResponse['structuredContent'];
}

export interface SaveProfileDraftRevisionRequest {
  content?: string;
  structuredContent?: FoundationalProfile;
  inheritCandidateLinksFromRevisionId?: string | null;
}

export interface ProfileRevisionListResponse {
  items: ProfileRevisionSummaryResponse[];
  total: number;
  limit: number;
  offset: number;
  order: 'asc' | 'desc';
}

export interface TemplateContentOption {
  id: string;
  label: string;
}

export interface TemplateContentListResponse {
  templates: TemplateContentOption[];
  defaultTemplateId?: string | null;
}

export interface TemplateContentResponse {
  id: string;
  label: string;
  content: string;
  currentRevisionId: string | null;
  updatedAt: string | null;
}

export interface TemplateRevisionSummaryResponse {
  id: string;
  templateId: string;
  contentHash: string;
  source: 'create' | 'update' | 'restore';
  status?: 'draft' | 'active' | 'deprecated';
  versionNumber?: number;
  versionLabel?: string;
  activatedAt?: string | null;
  deprecatedAt?: string | null;
  createdAt: string;
  createdBy: string | null;
  restoredFromRevisionId: string | null;
}

export interface TemplateRevisionDetailResponse extends TemplateRevisionSummaryResponse {
  content: string;
}

export interface TemplateRevisionListResponse {
  items: TemplateRevisionSummaryResponse[];
  total: number;
  limit: number;
  offset: number;
  order: 'asc' | 'desc';
}

export type StudentTimelineType =
  | 'recording_ingested'
  | 'transcript_ready'
  | 'prompt_package_created'
  | 'draft_saved'
  | 'job_awaiting_approval'
  | 'job_completed'
  | 'profile_revision_saved'
  | 'profile_revision_restored'
  | 'profile_revision_activated'
  | 'template_revision_saved'
  | 'template_revision_restored'
  | 'template_revision_activated'
  | 'job_action_rerun'
  | 'job_action_cancel'
  | 'job_action_edit_metadata'
  | 'lesson_created'
  | 'lesson_updated'
  | 'lesson_completed'
  | 'lesson_canceled'
  | 'lesson_no_show'
  | 'lesson_plan_updated'
  | 'lesson_recurrence_updated'
  | 'credit_event_recorded'
  | 'payment_recorded'
  | 'reminder_hidden'
  | 'business_settings_updated';

export interface StudentTimelineItem {
  type: StudentTimelineType;
  studentId: string;
  recordingId?: string | null;
  transcriptId?: string | null;
  promptPackageId?: string | null;
  draftId?: string | null;
  jobId?: string | null;
  status: string;
  createdAt: string;
  displayName: string;
  details?: Record<string, unknown>;
}

export interface StudentTimelineResponse {
  items: StudentTimelineItem[];
  total: number;
  limit: number;
  offset: number;
  order: 'asc' | 'desc';
}

export type MemoryConfidence = 'low' | 'medium' | 'high';
export type StudentFactAuthority = 'teacher_confirmed' | 'student_stated' | 'model_inferred';
export type LessonMemoryEntryStatus = 'pending' | 'ready' | 'failed' | 'superseded';
export type HomeworkMemoryEntryStatus = 'pending' | 'ready' | 'failed' | 'superseded';
export type StudentMemorySnapshotStatus = 'pending' | 'ready' | 'failed' | 'superseded';
export type StudentMemoryIssueType =
  | 'grammar'
  | 'vocabulary'
  | 'pronunciation'
  | 'fluency'
  | 'communication'
  | 'review_loop'
  | 'other';
export type StudentMemoryPriority = 'low' | 'medium' | 'high';
export type HomeworkMemoryInputType = 'generate' | 'authentic';
export type HomeworkMemoryStudyTextType = 'monologue' | 'dialogue';
export type HomeworkMemoryTaskType =
  | 'roadmap'
  | 'input'
  | 'grammar'
  | 'vocabulary'
  | 'controlled_practice'
  | 'comprehension'
  | 'pronunciation'
  | 'mission'
  | 'teacher_follow_up'
  | 'other';
export type HomeworkMemoryTargetKind = 'new' | 'review' | 'mixed';
export type HomeworkMemoryFollowUpCueType = 'warm_up' | 'error_focus' | 'monitoring' | 'other';
export type HomeworkMemoryPronunciationMode =
  | 'shadow_sentence'
  | 'intonation'
  | 'rhythm_chunking'
  | 'sentence_stress'
  | 'connected_speech'
  | 'minimal_pair'
  | 'other';

export interface FactEvidence {
  quote: string;
  speakerRole?: 'student' | 'teacher' | null;
  evidenceNote?: string | null;
  transcriptSpan?: string | null;
}

export interface MistakeEvidence {
  observedForm: string;
  suggestedTarget?: string | null;
  evidenceQuote?: string | null;
  evidenceNote?: string | null;
  confidenceNote?: string | null;
}

export interface PronunciationEvidence {
  observedIssue: string;
  focusWords: string[];
  evidenceQuote?: string | null;
  evidenceNote?: string | null;
  confidenceNote?: string | null;
}

export interface StudentFact {
  fact: string;
  category: string;
  authority: StudentFactAuthority;
  confidence: MemoryConfidence;
  evidence: FactEvidence[];
  reviewNeeded: boolean;
}

export interface NamedNote {
  name: string;
  note: string;
}

export interface LabeledNote {
  label: string;
  note: string;
}

export interface TextNote {
  text: string;
  note: string;
}

export interface TopicNote {
  topic: string;
  note: string;
}

export interface MistakePattern {
  label: string;
  explanation: string;
  reviewRecommended: boolean;
  confidence: MemoryConfidence;
  evidence: MistakeEvidence[];
}

export interface PronunciationFocusEntry {
  label: string;
  note: string;
  confidence: MemoryConfidence;
  evidence: PronunciationEvidence[];
}

export interface LessonMemoryRecord {
  id: string;
  studentId: string;
  transcriptId: string;
  recordingId: string;
  schemaVersion: string;
  generatedAt: string;
  provider: string;
  model: string;
  status: LessonMemoryEntryStatus;
  sourceKind: 'lesson_transcript';
  generationNotes?: Record<string, unknown> | null;
  lessonTitle?: string | null;
  lessonSummary?: string | null;
  topicsDiscussed: TopicNote[];
  mistakePatterns: MistakePattern[];
  grammarReviewed: NamedNote[];
  grammarWatchlist: NamedNote[];
  vocabularyFocus: TextNote[];
  pronunciationFocus: PronunciationFocusEntry[];
  studentFacts: StudentFact[];
  progressSignals: LabeledNote[];
  followUpRecommendations: LabeledNote[];
  supersededById?: string | null;
  supersededAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HomeworkMemoryNamedTarget {
  name: string;
  note: string;
  targetKind: HomeworkMemoryTargetKind;
}

export interface HomeworkMemoryVocabularyTarget {
  text: string;
  note: string;
  targetKind: HomeworkMemoryTargetKind;
}

export interface HomeworkMemoryTaskEntry {
  section: string;
  task: string;
  taskType: HomeworkMemoryTaskType;
  review: boolean;
}

export interface HomeworkMemoryPronunciationFocusEntry {
  mode: HomeworkMemoryPronunciationMode;
  target: string;
  action: string;
}

export interface HomeworkMemoryTeacherFollowUpCue {
  cueType: HomeworkMemoryFollowUpCueType;
  note: string;
}

export interface HomeworkMemoryPublishTarget {
  target: PublishTarget;
  url?: string | null;
  jobId?: string | null;
  publishedAt?: string | null;
}

export interface HomeworkMemoryRecord {
  id: string;
  studentId: string;
  jobId: string;
  assignmentLineageKey: string;
  promptPackageId?: string | null;
  draftId?: string | null;
  recordingId?: string | null;
  transcriptId?: string | null;
  schemaVersion: string;
  generatedAt: string;
  provider: string;
  model: string;
  status: HomeworkMemoryEntryStatus;
  sourceKind: 'published_assignment';
  contentHash?: string | null;
  generationNotes?: Record<string, unknown> | null;
  homeworkSummary?: string | null;
  topic?: string | null;
  grammarTargets: HomeworkMemoryNamedTarget[];
  vocabularyTargets: HomeworkMemoryVocabularyTarget[];
  reviewTargets: LabeledNote[];
  taskList: HomeworkMemoryTaskEntry[];
  pronunciationFocus: HomeworkMemoryPronunciationFocusEntry[];
  studyTextType?: HomeworkMemoryStudyTextType | null;
  inputType?: HomeworkMemoryInputType | null;
  communicativeOutcome?: string | null;
  teacherFollowUpCues: HomeworkMemoryTeacherFollowUpCue[];
  publishedAt: string;
  publishTargets: HomeworkMemoryPublishTarget[];
  supersededById?: string | null;
  supersededAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudentMemoryRecurringIssue {
  label: string;
  issueType: StudentMemoryIssueType;
  note: string;
  confidence: MemoryConfidence;
}

export interface StudentMemoryRecommendedAssignmentDirection {
  direction: string;
  rationale: string;
}

export interface StudentMemoryUnresolvedIssue {
  label: string;
  issueType: StudentMemoryIssueType;
  note: string;
  priority: StudentMemoryPriority;
}

export interface StudentMemorySnapshotRecord {
  id: string;
  studentId: string;
  schemaVersion: string;
  generatedAt: string;
  provider: string;
  model: string;
  status: StudentMemorySnapshotStatus;
  sourceKind: 'student_memory_rollup';
  lessonMemoryEntryIds: string[];
  homeworkMemoryEntryIds: string[];
  contentHash?: string | null;
  generationNotes?: Record<string, unknown> | null;
  stableStrengths: LabeledNote[];
  recurringIssues: StudentMemoryRecurringIssue[];
  activeReviewBacklog: LabeledNote[];
  recentProgress: LabeledNote[];
  personalFacts: StudentFact[];
  recommendedAssignmentDirections: StudentMemoryRecommendedAssignmentDirection[];
  unresolvedIssues: StudentMemoryUnresolvedIssue[];
  snapshotSummary?: string | null;
  supersededById?: string | null;
  supersededAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudentMemoryOverviewResponse {
  studentId: string;
  latestReadyStudentMemorySnapshot: StudentMemorySnapshotRecord | null;
  recentReadyLessonMemory: LessonMemoryRecord[];
  recentReadyHomeworkMemory: HomeworkMemoryRecord[];
  unresolvedIssues: StudentMemoryUnresolvedIssue[];
}

export interface StudentMemoryLatestSnapshotHealth {
  id: string;
  status: StudentMemorySnapshotStatus;
  generatedAt: string;
  strategy: string | null;
  trigger: string | null;
  triggerSourceKind: string | null;
  triggerSourceEntryId: string | null;
  parentSnapshotId: string | null;
  inputTokenEstimate: number | null;
  outputTokenEstimate: number | null;
  promptByteLength: number | null;
  includedLessonMemoryCount: number | null;
  includedHomeworkMemoryCount: number | null;
  coveredLessonMemoryCount: number | null;
  coveredHomeworkMemoryCount: number | null;
  contentHash: string | null;
  materialChange: boolean | null;
  budgetDecision: Record<string, unknown> | null;
  candidateRefresh: Record<string, unknown> | null;
}

export interface StudentMemoryStatusCount {
  count: number;
  capped: boolean;
  limit: number;
}

export interface StudentMemoryHealthResponse {
  studentId: string;
  latestSnapshot: StudentMemoryLatestSnapshotHealth | null;
  memoryCounts: {
    lesson: {
      ready: StudentMemoryStatusCount;
      pending: StudentMemoryStatusCount;
      failed: StudentMemoryStatusCount;
    };
    homework: {
      ready: StudentMemoryStatusCount;
      pending: StudentMemoryStatusCount;
      failed: StudentMemoryStatusCount;
    };
  };
  latestFailedReason: {
    source: 'lesson' | 'homework' | 'snapshot';
    artifactId: string;
    message: string;
  } | null;
  profileCandidateCounts: {
    pending: number;
    approved: number;
    rejected: number;
    deferred: number;
  };
}

export interface StudentLessonMemoryListResponse {
  studentId: string;
  items: LessonMemoryRecord[];
  limit: number;
  offset: number;
  order: 'asc' | 'desc';
  statuses: LessonMemoryEntryStatus[] | null;
}

export interface StudentHomeworkMemoryListResponse {
  studentId: string;
  items: HomeworkMemoryRecord[];
  limit: number;
  offset: number;
  order: 'asc' | 'desc';
  statuses: HomeworkMemoryEntryStatus[] | null;
}

export interface StudentMemorySnapshotListResponse {
  studentId: string;
  items: StudentMemorySnapshotRecord[];
  limit: number;
  offset: number;
  order: 'asc' | 'desc';
  statuses: StudentMemorySnapshotStatus[] | null;
}

export type StudentProfileCandidateStatus =
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'promoted'
  | 'superseded';

export type StudentProfileCandidateReviewState =
  | 'unreviewed'
  | 'deferred'
  | 'approved'
  | 'rejected';

export interface StudentProfileCandidateEvidence extends FactEvidence {
  sourceKind?: string | null;
  sourceArtifactId?: string | null;
}

export interface StudentProfileCandidate {
  id: string;
  studentId: string;
  proposedFact: string;
  approvedFactText?: string | null;
  category: string;
  targetSection: string;
  sourceSummary?: string | null;
  authority?: StudentFactAuthority | null;
  confidence?: MemoryConfidence | null;
  evidence: StudentProfileCandidateEvidence[];
  sourceSnapshotId?: string | null;
  sourceLessonMemoryIds: string[];
  sourceLessonId?: string | null;
  sourceLessonStartedAt?: string | null;
  sourceLessonTitle?: string | null;
  sourceMemoryIds?: string[];
  provenance?: Record<string, unknown>;
  dedupDecision?: Record<string, unknown>;
  status: StudentProfileCandidateStatus;
  reviewState: StudentProfileCandidateReviewState;
  reviewerId?: string | null;
  reviewerNote?: string | null;
  reviewedAt?: string | null;
  promotedRevisionId?: string | null;
  promotedAt?: string | null;
  supersededById?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface StudentProfileCandidateApiRecord {
  id: string;
  studentId: string;
  fact?: string | null;
  proposedFact?: string | null;
  approvedFact?: string | null;
  approvedFactText?: string | null;
  category: string;
  targetSection: string;
  sourceSummary?: string | null;
  authority?: StudentFactAuthority | null;
  confidence?: MemoryConfidence | null;
  evidence: StudentProfileCandidateEvidence[];
  sourceSnapshotId?: string | null;
  sourceLessonMemoryIds: string[];
  sourceLessonId?: string | null;
  sourceLessonStartedAt?: string | null;
  sourceLessonTitle?: string | null;
  sourceMemoryIds?: string[];
  provenance?: Record<string, unknown>;
  dedupDecision?: Record<string, unknown>;
  status: StudentProfileCandidateStatus;
  reviewState: StudentProfileCandidateReviewState;
  reviewerId?: string | null;
  reviewerNote?: string | null;
  reviewedAt?: string | null;
  promotedRevisionId?: string | null;
  promotedAt?: string | null;
  supersededById?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudentProfileCandidateListResponse {
  studentId: string;
  items: StudentProfileCandidate[];
  total: number;
  limit: number;
  offset: number;
  order: 'asc' | 'desc';
}

export interface ApproveStudentProfileCandidateRequest {
  approvedFactText?: string;
  reviewerNote?: string;
}

export interface RejectStudentProfileCandidateRequest {
  reviewerNote?: string;
}

export interface DeferStudentProfileCandidateRequest {
  reviewerNote?: string;
}

export interface StudentProfileCandidatePromotionRequest {
  candidateIds: string[];
  baseRevisionId?: string;
  reviewerNote?: string;
}

export interface StudentProfileCandidatePromotionResponse {
  draftRevisionId: string;
  includedCandidateIds: string[];
  excludedCandidateIds: string[];
  contentHash?: string | null;
  draftRevision?: ProfileRevisionDetailResponse;
}

export interface InitializeStudentProfileDraftResponse {
  draftRevisionId: string;
  draftRevision: ProfileRevisionDetailResponse;
}

function buildCandidateSourceSummary(record: StudentProfileCandidateApiRecord): string | null {
  if (typeof record.sourceSummary === 'string' && record.sourceSummary.trim().length > 0) {
    return record.sourceSummary;
  }

  const parts: string[] = [];
  if (record.sourceSnapshotId) {
    parts.push('Latest student-memory snapshot');
  }
  if (record.sourceLessonMemoryIds.length > 0) {
    const lessonCount = record.sourceLessonMemoryIds.length;
    parts.push(`${lessonCount} lesson memory entr${lessonCount === 1 ? 'y' : 'ies'}`);
  }
  if (record.sourceLessonTitle) {
    parts.push(record.sourceLessonTitle);
  }

  return parts.length > 0 ? parts.join(' + ') : null;
}

function mapStudentProfileCandidate(
  record: StudentProfileCandidateApiRecord,
): StudentProfileCandidate {
  return {
    id: record.id,
    studentId: record.studentId,
    proposedFact: record.proposedFact ?? record.fact ?? '',
    approvedFactText: record.approvedFactText ?? record.approvedFact ?? null,
    category: record.category,
    targetSection: record.targetSection,
    sourceSummary: buildCandidateSourceSummary(record),
    authority: record.authority ?? null,
    confidence: record.confidence ?? null,
    evidence: record.evidence ?? [],
    sourceSnapshotId: record.sourceSnapshotId ?? null,
    sourceLessonMemoryIds: record.sourceLessonMemoryIds ?? [],
    sourceLessonId: record.sourceLessonId ?? null,
    sourceLessonStartedAt: record.sourceLessonStartedAt ?? null,
    sourceLessonTitle: record.sourceLessonTitle ?? null,
    sourceMemoryIds: record.sourceMemoryIds ?? [],
    provenance: record.provenance ?? {},
    dedupDecision: record.dedupDecision ?? {},
    status: record.status,
    reviewState: record.reviewState,
    reviewerId: record.reviewerId ?? null,
    reviewerNote: record.reviewerNote ?? null,
    reviewedAt: record.reviewedAt ?? null,
    promotedRevisionId: record.promotedRevisionId ?? null,
    promotedAt: record.promotedAt ?? null,
    supersededById: record.supersededById ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export interface StudentOverviewSurfaceResponse {
  profile: ProfileContentResponse | null;
  revisions: ProfileRevisionListResponse;
  memory: StudentMemoryOverviewResponse;
  pendingCandidates: StudentProfileCandidateListResponse;
  recentTimeline: StudentTimelineResponse;
  scheduleBilling?: StudentScheduleBillingSurfaceResponse;
}

export interface StudentLearningSurfaceResponse {
  profile: ProfileContentResponse | null;
  revisions: ProfileRevisionListResponse;
  memory: StudentMemoryOverviewResponse;
  memoryHealth?: StudentMemoryHealthResponse | null;
  candidates: StudentProfileCandidateListResponse;
}

export interface StudentHistorySurfaceResponse {
  timeline: StudentTimelineResponse;
  lessonMemory: StudentLessonMemoryListResponse;
  homeworkMemory: StudentHomeworkMemoryListResponse;
}

export type StudentScheduleBillingSurface = StudentScheduleBillingSurfaceResponse;
export type StudentLessonPlanUpdate = UpdateStudentLessonPlanRequest;
export type StudentLessonRecurrenceUpsert = UpsertStudentLessonRecurrenceRequest;
export type StudentLessonCreate = CreateStudentLessonRequest;
export type StudentLessonUpdate = UpdateStudentLessonRequest;
export type StudentPackageCreate = AddStudentPackageRequest;
export type StudentCreditAdjustmentCreate = AdjustStudentCreditsRequest;
export type StudentPaymentCreate = RecordStudentPaymentRequest;

export interface PromptOption {
  id: string;
  label: string;
}

export interface PromptOptionsResponse {
  templates: PromptOption[];
  defaults: {
    templateId: string | null;
  };
}

export interface PromptPackageResponse {
  requestEnvelope?: {
    promptVersion?: string;
    assignmentContext?: import('@esl-pipeline/contracts').AssignmentValidationContext;
  } | null;
  id: string;
  recordingId: string;
  transcriptId: string;
  studentId: string | null;
  lessonId?: string | null;
  profilePath: string | null;
  templateVersion: string;
  notes: string | null;
  storageUri: string;
  text: string;
  profileSnapshot?: {
    /** Obsolete standalone identity retained only for historical prompt provenance. */
    resolvedProfileId: string | null;
    resolvedProfileHash: string;
    resolvedProfileRevisionId: string | null;
    resolvedProfileUpdatedAt: string | null;
    resolvedProfileVersionLabel?: string | null;
    resolvedProfileStatus?: 'draft' | 'active' | 'deprecated' | null;
  };
  templateSnapshot?: {
    resolvedTemplateId: string;
    resolvedTemplateHash: string;
    resolvedTemplateRevisionId: string | null;
    resolvedTemplateUpdatedAt: string | null;
    resolvedTemplateVersionLabel?: string | null;
    resolvedTemplateStatus?: 'draft' | 'active' | 'deprecated' | null;
  };
  profileDrift?: {
    detected: true;
    reason: 'profile_missing' | 'profile_content_changed';
    currentProfileHash: string | null;
    currentProfileRevisionId: string | null;
    currentProfileUpdatedAt: string | null;
  };
  templateDrift?: {
    detected: true;
    reason: 'template_missing' | 'template_content_changed';
    currentTemplateHash: string | null;
    currentTemplateRevisionId: string | null;
    currentTemplateUpdatedAt: string | null;
  };
  memory?: {
    studentMemorySnapshotId: string | null;
    studentMemorySnapshotHash: string | null;
    selectedLessonMemoryIds: string[];
    selectedHomeworkMemoryIds: string[];
    retrievalPolicyVersion: string | null;
    layerAvailability: PromptPackageMemoryLayerAvailability;
  };
  createdAt: string;
  updatedAt: string;
}

export type PromptPackageMemoryLayerAvailabilityState = 'available' | 'missing' | 'not_applicable';

export interface PromptPackageMemoryLayerAvailability {
  studentMemorySnapshot: PromptPackageMemoryLayerAvailabilityState;
  recentLessonMemory: PromptPackageMemoryLayerAvailabilityState;
  recentHomeworkMemory: PromptPackageMemoryLayerAvailabilityState;
  retrievalPolicy: PromptPackageMemoryLayerAvailabilityState;
}

export interface PromptPackageLineageResponse {
  promptPackageId: string;
  recordingId: string;
  transcriptId: string;
  studentId: string | null;
  createdAt: string;
  updatedAt: string;
  profile: {
    snapshot: {
      /** Obsolete historical metadata; never a runtime profile root. */
      profileId?: string | null;
      revisionId: string | null;
      hash: string | null;
      versionLabel: string | null;
      status: 'draft' | 'active' | 'deprecated' | null;
      updatedAt: string | null;
    };
    current: {
      studentId?: string | null;
      revisionId: string | null;
      hash: string | null;
      versionLabel: string | null;
      status: 'draft' | 'active' | 'deprecated' | null;
      updatedAt: string | null;
    };
    drift: PromptPackageResponse['profileDrift'] | null;
  };
  template: {
    snapshot: {
      templateId: string | null;
      revisionId: string | null;
      hash: string | null;
      versionLabel: string | null;
      status: 'draft' | 'active' | 'deprecated' | null;
      updatedAt: string | null;
    };
    current: {
      templateId: string | null;
      revisionId: string | null;
      hash: string | null;
      versionLabel: string | null;
      status: 'draft' | 'active' | 'deprecated' | null;
      updatedAt: string | null;
    };
    drift: PromptPackageResponse['templateDrift'] | null;
  };
  memory: {
    studentMemorySnapshotId: string | null;
    studentMemorySnapshotHash: string | null;
    selectedLessonMemoryIds: string[];
    selectedHomeworkMemoryIds: string[];
    retrievalPolicyVersion: string | null;
    layerAvailability: PromptPackageMemoryLayerAvailability;
  };
}

export interface JobProvenanceResponse {
  job: {
    id: string;
    state: string;
    createdAt: string;
    updatedAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    sourceJobId: string | null;
    manifestPath: string | null;
    htmlUrl: string | null;
    error: string | null;
  };
  sourceJob: {
    id: string;
    state: string;
    createdAt: string;
    finishedAt: string | null;
  } | null;
  recording: {
    id: string;
    studentId: string | null;
    sourcePath: string | null;
    storageUri: string | null;
    status: string | null;
    createdAt: string | null;
  } | null;
  transcript: {
    id: string;
    mode: string | null;
    model: string | null;
    language: string | null;
    createdAt: string | null;
  } | null;
  promptPackage: {
    id: string;
    studentId: string | null;
    createdAt: string | null;
    updatedAt: string | null;
  } | null;
  draft: {
    id: string;
    studentId: string | null;
    storageUri: string | null;
    createdAt: string | null;
    updatedAt: string | null;
  } | null;
  tts: {
    provider: string | null;
    generatedCharacters: number | null;
    cachedCharacters: number | null;
    totalCharacters: number | null;
    cacheHitRatio: number | null;
    costPer1kCharsUsd: number | null;
    estimatedSpendUsd: number | null;
  } | null;
  pronunciationWarnings: {
    code: string;
    message: string;
  }[];
  lineage: PromptPackageLineageResponse | null;
  actions: {
    id: string;
    actionType: string;
    outcome: 'succeeded' | 'failed';
    requestedAt: string;
    requestedBy: string | null;
    message: string;
    errorCode: string | null;
    createdJobId: string | null;
  }[];
}

export type DraftResponse = Omit<
  import('@esl-pipeline/contracts').AssignmentDraftDto,
  'workingVersion' | 'contentHash'
> & { workingVersion: number; contentHash: string };

export interface MaterializeDraftResponse {
  draftId: string;
  jobId: string;
  mdPath: string | null;
  mdStorageUri: string;
}

export interface SubmitJobResponse {
  jobId: string;
}

export type UploadProgressCallback = (progress: number, loaded: number, total?: number) => void;

export interface JobActionResponse {
  success: boolean;
  message?: string;
  jobId?: string;
  actionType?: string;
  timestamp?: string;
}

export interface CancelJobPayload {
  reason?: string;
}

export async function listRecordings(
  params: {
    status?: RecordingStatus | RecordingStatus[];
    source?: RecordingListItem['source'] | RecordingListItem['source'][];
    studentId?: string;
    student?: string;
    q?: string;
    limit?: number;
    offset?: number;
    order?: 'asc' | 'desc';
  } = {},
): Promise<RecordingsListResponse> {
  try {
    const search = new URLSearchParams();
    if (params.status) {
      const values = Array.isArray(params.status) ? params.status : [params.status];
      search.set('status', values.join(','));
    }
    if (params.source) {
      const values = Array.isArray(params.source) ? params.source : [params.source];
      search.set('source', values.join(','));
    }
    if (params.studentId) {
      search.set('studentId', params.studentId);
    }
    if (params.student) {
      search.set('student', params.student);
    }
    if (params.q) {
      search.set('q', params.q);
    }
    if (typeof params.limit === 'number') {
      search.set('limit', String(params.limit));
    }
    if (typeof params.offset === 'number') {
      search.set('offset', String(params.offset));
    }
    if (params.order) {
      search.set('order', params.order);
    }

    const query = search.toString();
    const url = query ? `/recordings?${query}` : '/recordings';
    const response = await apiClient.get(buildApiProxyPath(url));
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to view recordings.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function getRecording(recordingId: string): Promise<RecordingListItem> {
  try {
    const response = await apiClient.get(
      buildApiProxyPath(`/recordings/${encodeURIComponent(recordingId)}`),
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to view recordings.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function approveJob(
  jobId: string,
  source: { md?: string | null; mdStorageUri?: string | null } = {},
): Promise<JobStatus> {
  try {
    const response = await apiClient.post(
      buildApiProxyPath(`/jobs/${encodeURIComponent(jobId)}/approve`),
      {
        ...(source.md ? { md: source.md } : {}),
        ...(source.mdStorageUri ? { mdStorageUri: source.mdStorageUri } : {}),
      },
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to approve jobs.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

// Authentication interfaces
export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  inviteToken?: string;
  role?: RegisterRole;
}

export interface AuthResponse {
  user: {
    id: string;
    email: string;
    role: UserRole;
    isActive: boolean;
  };
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

function sanitizeJobOverrides(overrides?: JobConfigOverrides): JobConfigOverrides | undefined {
  if (!overrides) return undefined;
  return { ...overrides };
}

export interface UserProfile {
  id: string;
  email: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
}

export interface UserFile {
  id: string;
  filename: string;
  originalFilename: string;
  fileSize: number;
  mimeType: string;
  uploadedAt: string;
  md: string; // Backend path identifier
}

export interface ErrorEnvelope {
  error:
    | 'validation_failed'
    | 'not_found'
    | 'internal_error'
    | 'unauthorized'
    | 'forbidden'
    | string;
  message?: string;
  code?: string;
}

interface GenerationDraftErrorEnvelope extends ErrorEnvelope {
  code?: GenerationErrorCategory | string;
  provider?: GenerationProvider;
  model?: string;
  limitType?: 'rpm' | 'daily_requests' | 'daily_tokens' | 'max_output_tokens' | 'model_not_allowed';
  limit?: number;
  used?: number;
  window?: 'minute' | 'day' | 'request';
  requestId?: string;
  timestamp?: string;
}

export class GenerationDraftApiError extends Error {
  readonly status: number | undefined;
  readonly code: GenerationErrorCategory | string | undefined;
  readonly provider: GenerationProvider | undefined;
  readonly model: string | undefined;
  readonly limitType:
    | 'rpm'
    | 'daily_requests'
    | 'daily_tokens'
    | 'max_output_tokens'
    | 'model_not_allowed'
    | undefined;
  readonly limit: number | undefined;
  readonly used: number | undefined;
  readonly window: 'minute' | 'day' | 'request' | undefined;
  readonly requestId: string | undefined;
  readonly timestamp: string | undefined;

  constructor(
    message: string,
    details: {
      status?: number;
      code?: GenerationErrorCategory | string;
      provider?: GenerationProvider;
      model?: string;
      limitType?:
        | 'rpm'
        | 'daily_requests'
        | 'daily_tokens'
        | 'max_output_tokens'
        | 'model_not_allowed';
      limit?: number;
      used?: number;
      window?: 'minute' | 'day' | 'request';
      requestId?: string;
      timestamp?: string;
    } = {},
  ) {
    super(message);
    this.name = 'GenerationDraftApiError';
    this.status = details.status;
    this.code = details.code;
    this.provider = details.provider;
    this.model = details.model;
    this.limitType = details.limitType;
    this.limit = details.limit;
    this.used = details.used;
    this.window = details.window;
    this.requestId = details.requestId;
    this.timestamp = details.timestamp;
  }
}

export interface JobOptionsResponse {
  presets: ContractJobOptionsPayload['presets'];
  learningPresets?: LearningPresetOption[];
  cefrLevels?: ContractJobOptionsPayload['cefrLevels'];
  cefrDefault?: ContractJobOptionsPayload['cefrDefault'];
  generation?: ContractJobOptionsPayload['generation'];
  sttProviders?: ContractJobOptionsPayload['sttProviders'];
  defaultSttProvider?: ContractJobOptionsPayload['defaultSttProvider'];
  sttModelOptionsByProvider?: ContractJobOptionsPayload['sttModelOptionsByProvider'];
  defaultSttModelByProvider?: ContractJobOptionsPayload['defaultSttModelByProvider'];
  ttsProviders?: ContractJobOptionsPayload['ttsProviders'];
  ttsModelOptionsByProvider?: ContractJobOptionsPayload['ttsModelOptionsByProvider'];
  defaultTtsProvider?: ContractJobOptionsPayload['defaultTtsProvider'];
  defaultTtsModelByProvider?: ContractJobOptionsPayload['defaultTtsModelByProvider'];
  voiceAccents: ContractJobOptionsPayload['voiceAccents'];
  voices: ContractJobOptionsPayload['voices'];
  ttsStrategies: ContractJobOptionsPayload['ttsStrategies'];
  supportedActions?: ActionCapability[];
}

export interface LearningPresetOption {
  id: string;
  version: string;
  alias: string;
  title: string;
  track: string;
  status: string;
  promptSnapshotVersion: string;
}

export type VoiceOption = ContractVoiceOption;

export async function listUserJobs(
  params: {
    state?: JobState | JobState[];
    studentId?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
    order?: 'asc' | 'desc';
  } = {},
): Promise<JobListResponse> {
  try {
    const search = new URLSearchParams();
    if (params.state) {
      const values = Array.isArray(params.state) ? params.state : [params.state];
      search.set('state', values.join(','));
    }
    if (params.studentId) {
      search.set('studentId', params.studentId);
    }
    if (params.from) {
      search.set('from', params.from);
    }
    if (params.to) {
      search.set('to', params.to);
    }
    if (typeof params.limit === 'number') {
      search.set('limit', String(params.limit));
    }
    if (typeof params.offset === 'number') {
      search.set('offset', String(params.offset));
    }
    if (params.order) {
      search.set('order', params.order);
    }
    const query = search.toString();
    const url = query ? `/user/jobs?${query}` : '/user/jobs';
    const response = await apiClient.get(buildApiProxyPath(url));
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to view jobs.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function getJobSummary(
  params: { from?: string; to?: string } = {},
): Promise<JobSummaryResponse> {
  try {
    const response = await apiClient.get(buildApiProxyPath('/user/jobs/summary'), { params });
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to view job summaries.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function getStudentSummary(
  params: { limit?: number; offset?: number; order?: 'asc' | 'desc' } = {},
): Promise<StudentSummaryResponse> {
  try {
    const response = await apiClient.get(buildApiProxyPath('/students/summary'), { params });
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to view student summaries.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function renderHtmlPreview(params: {
  assignment: import('@esl-pipeline/contracts').AssignmentV1;
  promptPackageId?: string;
  title?: string;
  learningPresetId?: string | null;
  audioUrl?: string | null;
  pronunciationAudioUrl?: string | null;
}): Promise<{ html: string }> {
  try {
    const response = await apiClient.post(buildApiProxyPath('/preview/html'), {
      assignment: params.assignment,
      promptPackageId: params.promptPackageId,
      title: params.title,
      learningPresetId: params.learningPresetId,
      audioUrl: params.audioUrl,
      pronunciationAudioUrl: params.pronunciationAudioUrl,
    });
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to render preview.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export interface JobEventsOptions {
  signal?: AbortSignal;
  onError?: (event: Event) => void;
  onOpen?: (event: Event) => void;
  jobIds?: string[];
  recordingIds?: string[];
  allJobs?: boolean;
}

const toAxiosError = (error: unknown): AxiosError | null => (isAxiosError(error) ? error : null);

const RECOVERY_RETRY_DELAYS_MS = [250, 1_000] as const;

function getRetryAfterMs(error: AxiosError): number | null {
  const value = error.response?.headers?.['retry-after'];
  if (typeof value !== 'string' && typeof value !== 'number') return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1_000, 5_000);
  }

  const dateMs = Date.parse(String(value));
  if (!Number.isFinite(dateMs)) return null;
  return Math.min(Math.max(dateMs - Date.now(), 0), 5_000);
}

function isTransientRecoveryError(error: unknown): error is AxiosError {
  const axiosError = toAxiosError(error);
  if (!axiosError) return false;
  const status = axiosError.response?.status;
  return status === undefined || status === 429 || (status >= 500 && status < 600);
}

async function runRecoveryRequest<T>(request: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await request();
    } catch (error: unknown) {
      const fallbackDelay = RECOVERY_RETRY_DELAYS_MS[attempt];
      if (fallbackDelay === undefined || !isTransientRecoveryError(error)) throw error;
      const retryAfter = getRetryAfterMs(error);
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, retryAfter ?? fallbackDelay);
      });
    }
  }
}

function getAssignmentSessionConflict(error: AxiosError | null): AssignmentSession | null {
  if (error?.response?.status !== 409) return null;
  const data = error.response.data as
    | { code?: unknown; session?: ContractAssignmentSessionDto }
    | undefined;
  return data?.code === 'assignment_session_revision_conflict' && data.session
    ? data.session
    : null;
}

function getAssignmentSourceOwnershipConflict(error: AxiosError | null): AssignmentSession | null {
  if (error?.response?.status !== 409) return null;
  const data = error.response.data as
    | { code?: unknown; session?: ContractAssignmentSessionDto }
    | undefined;
  return data?.code === 'assignment_source_already_owned' && data.session ? data.session : null;
}

function getArtifactWorkingConflict(
  error: AxiosError | null,
): ContractArtifactWorkingContentDto | null {
  if (error?.response?.status !== 409) return null;
  const data = error.response.data as
    | { code?: unknown; artifact?: ContractArtifactWorkingContentDto }
    | undefined;
  return data?.code === 'artifact_working_conflict' && data.artifact ? data.artifact : null;
}

function isAssignmentSpeakerRoleMappingRequired(error: AxiosError | null): boolean {
  if (error?.response?.status !== 400) return false;
  const data = error.response.data as { code?: unknown } | undefined;
  return data?.code === 'assignment_step_speaker_role_mapping_required';
}

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'An unexpected error occurred';
};

const parseGenerationDraftError = (error: AxiosError): GenerationDraftApiError | null => {
  const status = error.response?.status;
  if (status === undefined) {
    return null;
  }

  const knownStatus = new Set([400, 404, 429, 500, 502, 504]);
  if (!knownStatus.has(status)) {
    return null;
  }

  const data = error.response?.data;
  const envelope =
    data && typeof data === 'object' ? (data as Partial<GenerationDraftErrorEnvelope>) : null;

  const message =
    envelope?.message && envelope.message.trim().length > 0
      ? envelope.message
      : handleApiError(error);
  const code = typeof envelope?.code === 'string' ? envelope.code : undefined;
  const provider = envelope?.provider;
  const model = typeof envelope?.model === 'string' ? envelope.model : undefined;
  const limitType =
    envelope?.limitType === 'rpm' ||
    envelope?.limitType === 'daily_requests' ||
    envelope?.limitType === 'daily_tokens' ||
    envelope?.limitType === 'max_output_tokens' ||
    envelope?.limitType === 'model_not_allowed'
      ? envelope.limitType
      : undefined;
  const limit = typeof envelope?.limit === 'number' ? envelope.limit : undefined;
  const used = typeof envelope?.used === 'number' ? envelope.used : undefined;
  const window =
    envelope?.window === 'minute' || envelope?.window === 'day' || envelope?.window === 'request'
      ? envelope.window
      : undefined;
  const requestId = typeof envelope?.requestId === 'string' ? envelope.requestId : undefined;
  const timestamp = typeof envelope?.timestamp === 'string' ? envelope.timestamp : undefined;

  return new GenerationDraftApiError(message, {
    status,
    code,
    provider,
    model,
    limitType,
    limit,
    used,
    window,
    requestId,
    timestamp,
  });
};

/**
 * Authentication API functions
 */
export async function login(credentials: LoginRequest): Promise<AuthResponse> {
  try {
    const response = await apiClient.post(buildApiProxyPath('/auth/login'), credentials);
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function register(userData: RegisterRequest): Promise<AuthResponse> {
  const attempt = async (path: string) => {
    const response = await apiClient.post(path, userData);
    return response.data as AuthResponse;
  };

  try {
    return await attempt(buildApiProxyPath('/auth/register'));
  } catch (error: unknown) {
    const err = error as {
      response?: { status?: number; data?: { message?: unknown } };
      config?: { url?: string };
    };
    const status = err.response?.status;
    const message = err.response?.data?.message;
    const isRouteMissing =
      status === 404 &&
      typeof message === 'string' &&
      message.toLowerCase().includes('route post:/auth/register not found');

    if (status === 404 && !err.config?.url?.includes('/auth/register')) {
      try {
        return await attempt(buildApiProxyPath('/auth/register'));
      } catch (fallbackError: unknown) {
        const fallback = fallbackError as { response?: { status?: number } };
        if (fallback.response?.status === 404 || isRouteMissing) {
          throw new Error(
            'Registration endpoint is unavailable. Enable extended API support on the backend or contact an administrator.',
          );
        }
        const axiosError = toAxiosError(fallbackError);
        throw new Error(
          axiosError ? handleApiError(axiosError) : formatUnknownError(fallbackError),
        );
      }
    }

    if (status === 404 || isRouteMissing) {
      throw new Error(
        'Registration endpoint is unavailable. Enable extended API support on the backend or contact an administrator.',
      );
    }

    const axiosError = toAxiosError(error);
    throw new Error(axiosError ? formatRegisterError(axiosError) : formatUnknownError(error));
  }
}

function formatRegisterError(error: AxiosError): string {
  const data = error.response?.data;
  if (data && typeof data === 'object') {
    const envelope = data as Partial<ErrorEnvelope> & { details?: unknown };
    if (envelope.code === 'weak_password' && Array.isArray(envelope.details)) {
      const details = envelope.details.filter(
        (detail): detail is string => typeof detail === 'string',
      );
      if (details.length > 0) return details.join(' ');
    }
  }
  return handleApiError(error);
}

export async function refreshToken(): Promise<AuthResponse> {
  try {
    const response = await apiClient.post(buildApiProxyPath('/auth/refresh'));
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function logoutSession(): Promise<void> {
  try {
    await apiClient.post(buildApiProxyPath('/auth/logout'));
  } catch (error: unknown) {
    const err = error as { response?: { status?: number } };
    if (err.response?.status === 404) {
      return;
    }
    const axiosError = toAxiosError(error);
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function getUserProfile(): Promise<UserProfile> {
  try {
    const response = await apiClient.get(buildApiProxyPath('/auth/me'));
    return response.data.user;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function getUserFiles(): Promise<UserFile[]> {
  try {
    const response = await apiClient.get(buildApiProxyPath('/user/files'));
    return response.data.files || [];
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

/**
 * Submit a new job via POST /jobs.
 * Now uses authenticated API client.
 */
export async function createJob(body: SubmitJobRequest): Promise<SubmitJobResponse> {
  try {
    const payload: SubmitJobRequest = { ...body };
    const response = await apiClient.post(buildApiProxyPath('/jobs'), payload);
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to submit jobs.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

/**
 * The request was rejected locally before Axios could begin an HTTP upload.
 * Callers may safely retire a browser-owned upload operation after this error.
 */
export class RecordingUploadPreDispatchError extends Error {
  readonly code: RecordingErrorCode = 'file_too_large';

  constructor(message: string) {
    super(message);
    this.name = 'RecordingUploadPreDispatchError';
  }
}

/**
 * Upload an audio recording via POST /recordings/upload.
 * Returns the created recording metadata.
 */
export async function uploadRecording(
  file: File,
  options?: {
    studentId?: string;
    sttProvider?: SttProvider;
    audioTopology?: Extract<AudioInputTopology, 'trusted_split_channels'>;
    /** Browser-owned logical upload identity. Production callers always supply it. */
    uploadOperationId?: string;
    onProgress?: UploadProgressCallback;
    signal?: AbortSignal;
  },
): Promise<RecordingSourceAcquisitionResult> {
  if (file.size > DEFAULT_RECORDING_UPLOAD_MAX_BYTES) {
    throw new RecordingUploadPreDispatchError(
      'Choose a source file at or below the configured 2 GiB operational upload limit.',
    );
  }
  try {
    const formData = new FormData();
    formData.append('file', file);

    const params: Record<string, string> = {};
    if (options?.studentId) {
      params.studentId = options.studentId;
    }
    if (options?.sttProvider) {
      params.sttProvider = options.sttProvider;
    }
    if (options?.audioTopology) {
      params.audioTopology = options.audioTopology;
    }

    const response = await apiClient.post(buildApiProxyPath('/recordings/upload'), formData, {
      params: Object.keys(params).length > 0 ? params : undefined,
      headers: {
        'Content-Type': 'multipart/form-data',
        ...(options?.uploadOperationId
          ? { 'x-upload-operation-id': options.uploadOperationId }
          : {}),
      },
      onUploadProgress: (event) => reportUploadProgress(event, options?.onProgress),
      signal: options?.signal,
    });

    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to upload recordings.');
    }
    const data = axiosError?.response?.data;
    const code =
      data && typeof data === 'object' && 'code' in data && typeof data.code === 'string'
        ? data.code
        : null;
    if (code) {
      throw new Error(getRecordingErrorAction(code));
    }
    throw new Error(
      axiosError?.request
        ? handleApiError(axiosError)
        : 'Unable to upload recording. Try again or choose another file.',
    );
  }
}

export type RecordingUploadOperationStatus =
  | RecordingSourceAcquisitionResult
  | { operationId: string; recordingId: string; status: 'processing' | 'reclaimable' };

/** Resolve durable ownership before a browser retransmits an uncertain upload. */
export async function getRecordingUploadOperation(
  uploadOperationId: string,
): Promise<RecordingUploadOperationStatus | null> {
  try {
    const response = await apiClient.get<RecordingUploadOperationStatus>(
      buildApiProxyPath(`/recording-upload-operations/${uploadOperationId}`),
      { validateStatus: (status) => status === 200 || status === 202 || status === 404 },
    );
    return response.status === 404 ? null : response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to check upload status.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function createManualTranscriptSource(
  input: CreateManualTranscriptSourceInput,
): Promise<RecordingSourceAcquisitionResult> {
  try {
    const response = await apiClient.post<RecordingSourceAcquisitionResult>(
      buildApiProxyPath('/recordings/transcript-source'),
      input,
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to save a pasted transcript.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function retryRecordingTranscription(
  recordingId: string,
  options?: {
    sttProvider?: SttProvider;
    audioTopology?: Extract<AudioInputTopology, 'trusted_split_channels'>;
  },
): Promise<RecordingListItem> {
  try {
    const response = await apiClient.post(
      buildApiProxyPath(`/recordings/${encodeURIComponent(recordingId)}/transcribe`),
      options?.sttProvider || options?.audioTopology
        ? {
            ...(options.sttProvider ? { sttProvider: options.sttProvider } : {}),
            ...(options.audioTopology ? { audioTopology: options.audioTopology } : {}),
          }
        : undefined,
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to retry transcriptions.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

/**
 * Fetch job status via GET /jobs/:jobId.
 * Now uses authenticated API client.
 */
export async function getJobStatus(jobId: string): Promise<JobStatus> {
  try {
    const response = await apiClient.get(buildApiProxyPath(`/jobs/${encodeURIComponent(jobId)}`));
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to view job status.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export function buildRecordingAudioUrl(recordingId: string): string {
  const url = buildApiProxyPath(`/recordings/${encodeURIComponent(recordingId)}/audio`);
  const accessToken = getApiAuthToken();
  return accessToken ? appendTokenQueryParam(url, accessToken) : url;
}

export async function fetchJobOptions(): Promise<JobOptionsResponse> {
  try {
    const response = await apiClient.get(buildApiProxyPath('/config/job-options'));
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function fetchStudentOptions(): Promise<StudentOptionsResponse> {
  try {
    const response = await apiClient.get(buildApiProxyPath('/config/students'));
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function listStudents(
  params: {
    q?: string;
    limit?: number;
    offset?: number;
    order?: 'asc' | 'desc';
    status?: 'active' | 'archived' | 'all';
  } = {},
): Promise<StudentProfileListResponse> {
  try {
    const response = await apiClient.get(buildApiProxyPath('/students'), {
      params,
    });
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to view students.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function archiveStudentProfile(
  studentId: string,
  payload: { reason?: string | null } = {},
): Promise<StudentProfile> {
  try {
    const response = await apiClient.post(
      buildApiProxyPath(`/students/${encodeURIComponent(studentId)}/archive`),
      payload,
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to archive students.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function restoreStudentProfile(studentId: string): Promise<StudentProfile> {
  try {
    const response = await apiClient.post(
      buildApiProxyPath(`/students/${encodeURIComponent(studentId)}/restore`),
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to restore students.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function getStudentProfile(studentId: string): Promise<StudentProfile> {
  try {
    const response = await apiClient.get(
      buildApiProxyPath(`/students/${encodeURIComponent(studentId)}`),
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to view student profiles.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function createStudentProfile(payload: StudentProfileInput): Promise<StudentProfile> {
  try {
    const response = await apiClient.post(buildApiProxyPath('/students'), payload);
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to create students.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function updateStudentProfile(
  studentId: string,
  payload: StudentProfileUpdate,
): Promise<StudentProfile> {
  try {
    const response = await apiClient.put(
      buildApiProxyPath(`/students/${encodeURIComponent(studentId)}`),
      payload,
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to update students.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function deleteStudentProfile(studentId: string): Promise<void> {
  try {
    await apiClient.delete(buildApiProxyPath(`/students/${encodeURIComponent(studentId)}`));
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to delete students.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function getProfileContent(studentId: string): Promise<ProfileContentResponse> {
  try {
    const response = await apiClient.get(
      buildApiProxyPath(`/students/${encodeURIComponent(studentId)}/profile`),
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to view profiles.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function upsertProfileContent(
  studentId: string,
  content: string | null,
  structuredContent?: FoundationalProfile,
): Promise<ProfileContentResponse> {
  try {
    const response = await apiClient.put(
      buildApiProxyPath(`/students/${encodeURIComponent(studentId)}/profile`),
      {
        ...(content !== null ? { content } : {}),
        ...(structuredContent ? { structuredContent } : {}),
      },
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to edit profiles.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function listProfileRevisions(
  studentId: string,
  params: {
    limit?: number;
    offset?: number;
    order?: 'asc' | 'desc';
  } = {},
): Promise<ProfileRevisionListResponse> {
  try {
    const response = await apiClient.get(
      buildApiProxyPath(`/students/${encodeURIComponent(studentId)}/profile/revisions`),
      {
        params,
      },
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to view profile revisions.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function getProfileRevision(
  studentId: string,
  revisionId: string,
): Promise<ProfileRevisionDetailResponse> {
  try {
    const response = await apiClient.get(
      buildApiProxyPath(
        `/students/${encodeURIComponent(studentId)}/profile/revisions/${encodeURIComponent(revisionId)}`,
      ),
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to view profile revisions.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function restoreProfileRevision(
  studentId: string,
  revisionId: string,
): Promise<ProfileContentResponse> {
  try {
    const response = await apiClient.post(
      buildApiProxyPath(
        `/students/${encodeURIComponent(studentId)}/profile/revisions/${encodeURIComponent(revisionId)}/restore`,
      ),
      {},
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to restore profile revisions.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function saveProfileDraftRevision(
  studentId: string,
  payload: SaveProfileDraftRevisionRequest,
): Promise<ProfileRevisionDetailResponse> {
  try {
    const response = await apiClient.post(
      buildApiProxyPath(`/students/${encodeURIComponent(studentId)}/profile/revisions`),
      {
        ...payload,
      },
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to save profile drafts.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function activateProfileRevision(
  studentId: string,
  revisionId: string,
): Promise<ProfileRevisionDetailResponse> {
  try {
    const response = await apiClient.post(
      buildApiProxyPath(
        `/students/${encodeURIComponent(studentId)}/profile/revisions/${encodeURIComponent(revisionId)}/activate`,
      ),
      {},
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to activate profile revisions.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function listTemplateControlPlane(): Promise<TemplateControlPlaneListDto> {
  try {
    const response = await apiClient.get(buildApiProxyPath('/templates/control-plane'));
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function listTemplateContents(): Promise<TemplateContentListResponse> {
  try {
    const response = await apiClient.get(buildApiProxyPath('/templates'));
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function getTemplateContent(templateId: string): Promise<TemplateContentResponse> {
  try {
    const response = await apiClient.get(
      buildApiProxyPath(`/templates/${encodeURIComponent(templateId)}`),
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to view templates.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function upsertTemplateContent(
  templateId: string,
  content: string,
): Promise<TemplateContentResponse> {
  try {
    const response = await apiClient.put(
      buildApiProxyPath(`/templates/${encodeURIComponent(templateId)}`),
      { content },
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to edit templates.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function deleteTemplateContent(templateId: string): Promise<void> {
  try {
    await apiClient.delete(buildApiProxyPath(`/templates/${encodeURIComponent(templateId)}`));
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to archive templates.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function setDefaultTemplateContent(
  templateId: string,
): Promise<TemplateContentResponse> {
  try {
    const response = await apiClient.post(
      buildApiProxyPath(`/templates/${encodeURIComponent(templateId)}/default`),
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to update template defaults.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function listTemplateRevisions(
  templateId: string,
  params: {
    limit?: number;
    offset?: number;
    order?: 'asc' | 'desc';
  } = {},
): Promise<TemplateRevisionListResponse> {
  try {
    const response = await apiClient.get(
      buildApiProxyPath(`/templates/${encodeURIComponent(templateId)}/revisions`),
      { params },
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to view template revisions.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function getTemplateRevision(
  templateId: string,
  revisionId: string,
): Promise<TemplateRevisionDetailResponse> {
  try {
    const response = await apiClient.get(
      buildApiProxyPath(
        `/templates/${encodeURIComponent(templateId)}/revisions/${encodeURIComponent(revisionId)}`,
      ),
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to view template revisions.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function restoreTemplateRevision(
  templateId: string,
  revisionId: string,
): Promise<TemplateContentResponse> {
  try {
    const response = await apiClient.post(
      buildApiProxyPath(
        `/templates/${encodeURIComponent(templateId)}/revisions/${encodeURIComponent(revisionId)}/restore`,
      ),
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to restore template revisions.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function activateTemplateRevision(
  templateId: string,
  revisionId: string,
): Promise<TemplateRevisionDetailResponse> {
  try {
    const response = await apiClient.post(
      buildApiProxyPath(
        `/templates/${encodeURIComponent(templateId)}/revisions/${encodeURIComponent(revisionId)}/activate`,
      ),
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to activate template revisions.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function importAndActivateShippedTemplate(templateId: string): Promise<void> {
  try {
    await apiClient.post(
      buildApiProxyPath(`/templates/${encodeURIComponent(templateId)}/import-and-activate`),
    );
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function getStudentTimeline(
  studentId: string,
  params: {
    type?: StudentTimelineType | StudentTimelineType[];
    status?: string | string[];
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
    order?: 'asc' | 'desc';
  } = {},
): Promise<StudentTimelineResponse> {
  try {
    const search = new URLSearchParams();
    if (params.type) {
      const values = Array.isArray(params.type) ? params.type : [params.type];
      search.set('type', values.join(','));
    }
    if (params.status) {
      const values = Array.isArray(params.status) ? params.status : [params.status];
      search.set('status', values.join(','));
    }
    if (params.from) {
      search.set('from', params.from);
    }
    if (params.to) {
      search.set('to', params.to);
    }
    if (typeof params.limit === 'number') {
      search.set('limit', String(params.limit));
    }
    if (typeof params.offset === 'number') {
      search.set('offset', String(params.offset));
    }
    if (params.order) {
      search.set('order', params.order);
    }

    const query = search.toString();
    const url = query
      ? `/students/${encodeURIComponent(studentId)}/timeline?${query}`
      : `/students/${encodeURIComponent(studentId)}/timeline`;
    const response = await apiClient.get(buildApiProxyPath(url));
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to view timelines.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function getStudentMemoryOverview(
  studentId: string,
  params: {
    lessonLimit?: number;
    homeworkLimit?: number;
  } = {},
): Promise<StudentMemoryOverviewResponse> {
  try {
    const response = await apiClient.get(
      buildApiProxyPath(`/students/${encodeURIComponent(studentId)}/memory`),
      { params },
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to view student memory.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function getStudentMemoryHealth(
  studentId: string,
): Promise<StudentMemoryHealthResponse> {
  try {
    const response = await apiClient.get(
      buildApiProxyPath(`/students/${encodeURIComponent(studentId)}/memory/health`),
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to view student memory health.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

function mapCandidateListResponse(
  data: StudentProfileCandidateListResponse & {
    items?: StudentProfileCandidateApiRecord[];
  },
): StudentProfileCandidateListResponse {
  return {
    ...data,
    items: (data.items ?? []).map((item) => mapStudentProfileCandidate(item)),
  };
}

export async function getStudentOverviewSurface(
  studentId: string,
): Promise<StudentOverviewSurfaceResponse> {
  try {
    const response = await apiClient.get(
      buildApiProxyPath(`/students/${encodeURIComponent(studentId)}/surfaces/overview`),
    );
    const data = response.data as StudentOverviewSurfaceResponse & {
      pendingCandidates: StudentProfileCandidateListResponse & {
        items?: StudentProfileCandidateApiRecord[];
      };
    };
    return {
      ...data,
      pendingCandidates: mapCandidateListResponse(data.pendingCandidates),
    };
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to view the student overview.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function getStudentLearningSurface(
  studentId: string,
): Promise<StudentLearningSurfaceResponse> {
  try {
    const response = await apiClient.get(
      buildApiProxyPath(`/students/${encodeURIComponent(studentId)}/surfaces/learning`),
    );
    const data = response.data as StudentLearningSurfaceResponse & {
      candidates: StudentProfileCandidateListResponse & {
        items?: StudentProfileCandidateApiRecord[];
      };
    };
    return {
      ...data,
      candidates: mapCandidateListResponse(data.candidates),
    };
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to view student learning data.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function getStudentHistorySurface(
  studentId: string,
): Promise<StudentHistorySurfaceResponse> {
  try {
    const response = await apiClient.get(
      buildApiProxyPath(`/students/${encodeURIComponent(studentId)}/surfaces/history`),
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to view student history.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function getStudentScheduleBillingSurface(
  studentId: string,
): Promise<StudentScheduleBillingSurface> {
  try {
    const response = await apiClient.get(
      buildApiProxyPath(`/students/${encodeURIComponent(studentId)}/surfaces/schedule-billing`),
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to view schedule and billing.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function updateStudentLessonPlan(
  studentId: string,
  body: StudentLessonPlanUpdate,
): Promise<StudentScheduleBillingSurface> {
  try {
    const response = await apiClient.put(
      buildApiProxyPath(`/students/${encodeURIComponent(studentId)}/operations/lesson-plan`),
      body,
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function upsertPrimaryStudentLessonRecurrence(
  studentId: string,
  body: StudentLessonRecurrenceUpsert,
): Promise<StudentScheduleBillingSurface> {
  try {
    const response = await apiClient.put(
      buildApiProxyPath(
        `/students/${encodeURIComponent(studentId)}/operations/primary-lesson-recurrence`,
      ),
      body,
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function createStudentLesson(
  studentId: string,
  body: StudentLessonCreate,
): Promise<StudentScheduleBillingSurface> {
  try {
    const response = await apiClient.post(
      buildApiProxyPath(`/students/${encodeURIComponent(studentId)}/lessons`),
      body,
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function updateStudentLesson(
  studentId: string,
  lessonId: string,
  body: StudentLessonUpdate,
): Promise<StudentScheduleBillingSurface> {
  try {
    const response = await apiClient.patch(
      buildApiProxyPath(
        `/students/${encodeURIComponent(studentId)}/lessons/${encodeURIComponent(lessonId)}`,
      ),
      body,
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function hideStudentLessonFollowupReminder(
  studentId: string,
  lessonId: string,
): Promise<StudentScheduleBillingSurface> {
  try {
    const response = await apiClient.put(
      buildApiProxyPath(
        `/students/${encodeURIComponent(
          studentId,
        )}/operations/reminders/lesson-followup/${encodeURIComponent(lessonId)}/hide`,
      ),
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function undoLatestHiddenStudentReminder(
  studentId: string,
): Promise<StudentScheduleBillingSurface> {
  try {
    const response = await apiClient.put(
      buildApiProxyPath(
        `/students/${encodeURIComponent(studentId)}/operations/reminders/latest-hidden/undo`,
      ),
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function addStudentPackage(
  studentId: string,
  body: StudentPackageCreate,
): Promise<StudentScheduleBillingSurface> {
  try {
    const response = await apiClient.post(
      buildApiProxyPath(`/students/${encodeURIComponent(studentId)}/packages`),
      body,
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function adjustStudentCredits(
  studentId: string,
  body: StudentCreditAdjustmentCreate,
): Promise<StudentScheduleBillingSurface> {
  try {
    const response = await apiClient.post(
      buildApiProxyPath(`/students/${encodeURIComponent(studentId)}/credits/adjustments`),
      body,
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function recordStudentPayment(
  studentId: string,
  body: StudentPaymentCreate,
): Promise<StudentScheduleBillingSurface> {
  try {
    const response = await apiClient.post(
      buildApiProxyPath(`/students/${encodeURIComponent(studentId)}/payments`),
      body,
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function getBusinessSettings(): Promise<BusinessSettings> {
  try {
    const response = await apiClient.get(buildApiProxyPath('/business/settings'));
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function updateBusinessSettings(
  body: BusinessSettingsUpdate,
): Promise<BusinessSettings> {
  try {
    const response = await apiClient.put(buildApiProxyPath('/business/settings'), body);
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function getBusinessScheduleSurface(
  params: { from?: string; to?: string } = {},
): Promise<BusinessScheduleSurface> {
  try {
    const search = new URLSearchParams();
    if (params.from) search.set('from', params.from);
    if (params.to) search.set('to', params.to);
    const query = search.toString();
    const response = await apiClient.get(
      buildApiProxyPath(`/business/schedule${query ? `?${query}` : ''}`),
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function getBusinessStatsSurface(
  params: { month?: string } = {},
): Promise<BusinessStatsSurface> {
  try {
    const search = new URLSearchParams();
    if (params.month) search.set('month', params.month);
    const query = search.toString();
    const response = await apiClient.get(
      buildApiProxyPath(`/business/stats${query ? `?${query}` : ''}`),
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function listStudentProfileCandidates(
  studentId: string,
  params: {
    status?: StudentProfileCandidateStatus | StudentProfileCandidateStatus[];
    reviewState?: StudentProfileCandidateReviewState | StudentProfileCandidateReviewState[];
    limit?: number;
    offset?: number;
    order?: 'asc' | 'desc';
  } = {},
): Promise<StudentProfileCandidateListResponse> {
  try {
    const search = new URLSearchParams();
    if (params.status) {
      const values = Array.isArray(params.status) ? params.status : [params.status];
      search.set('status', values.join(','));
    }
    if (params.reviewState) {
      const values = Array.isArray(params.reviewState) ? params.reviewState : [params.reviewState];
      search.set('reviewState', values.join(','));
    }
    if (typeof params.limit === 'number') {
      search.set('limit', String(params.limit));
    }
    if (typeof params.offset === 'number') {
      search.set('offset', String(params.offset));
    }
    if (params.order) {
      search.set('order', params.order);
    }

    const query = search.toString();
    const url = query
      ? `/students/${encodeURIComponent(studentId)}/profile-candidates?${query}`
      : `/students/${encodeURIComponent(studentId)}/profile-candidates`;
    const response = await apiClient.get(buildApiProxyPath(url));
    const data = response.data as StudentProfileCandidateListResponse & {
      items?: StudentProfileCandidateApiRecord[];
    };
    return mapCandidateListResponse(data);
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to view profile candidates.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function approveStudentProfileCandidate(
  studentId: string,
  candidateId: string,
  payload: ApproveStudentProfileCandidateRequest = {},
): Promise<StudentProfileCandidate> {
  try {
    const response = await apiClient.post(
      buildApiProxyPath(
        `/students/${encodeURIComponent(studentId)}/profile-candidates/${encodeURIComponent(
          candidateId,
        )}/approve`,
      ),
      payload,
    );
    return mapStudentProfileCandidate(response.data as StudentProfileCandidateApiRecord);
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to approve profile candidates.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function rejectStudentProfileCandidate(
  studentId: string,
  candidateId: string,
  payload: RejectStudentProfileCandidateRequest = {},
): Promise<StudentProfileCandidate> {
  try {
    const response = await apiClient.post(
      buildApiProxyPath(
        `/students/${encodeURIComponent(studentId)}/profile-candidates/${encodeURIComponent(
          candidateId,
        )}/reject`,
      ),
      payload,
    );
    return mapStudentProfileCandidate(response.data as StudentProfileCandidateApiRecord);
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to reject profile candidates.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function deferStudentProfileCandidate(
  studentId: string,
  candidateId: string,
  payload: DeferStudentProfileCandidateRequest = {},
): Promise<StudentProfileCandidate> {
  try {
    const response = await apiClient.post(
      buildApiProxyPath(
        `/students/${encodeURIComponent(studentId)}/profile-candidates/${encodeURIComponent(
          candidateId,
        )}/defer`,
      ),
      payload,
    );
    return mapStudentProfileCandidate(response.data as StudentProfileCandidateApiRecord);
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to defer profile candidates.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function promoteStudentProfileCandidates(
  studentId: string,
  payload: StudentProfileCandidatePromotionRequest,
): Promise<StudentProfileCandidatePromotionResponse> {
  try {
    const response = await apiClient.post(
      buildApiProxyPath(`/students/${encodeURIComponent(studentId)}/profile-candidates/promote`),
      payload,
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to promote profile candidates.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function refreshProfileDraftFromApprovedCandidates(
  studentId: string,
  payload: StudentProfileCandidatePromotionRequest,
): Promise<StudentProfileCandidatePromotionResponse> {
  try {
    const response = await apiClient.post(
      buildApiProxyPath(
        `/students/${encodeURIComponent(studentId)}/profile-drafts/refresh-from-approved-candidates`,
      ),
      payload,
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to refresh profile drafts.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function initializeStudentProfileDraft(
  studentId: string,
): Promise<InitializeStudentProfileDraftResponse> {
  try {
    const response = await apiClient.post(
      buildApiProxyPath(`/students/${encodeURIComponent(studentId)}/profile-drafts/initialize`),
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to initialize the learner profile.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function listStudentLessonMemoryEntries(
  studentId: string,
  params: {
    status?: LessonMemoryEntryStatus | LessonMemoryEntryStatus[];
    limit?: number;
    offset?: number;
    order?: 'asc' | 'desc';
  } = {},
): Promise<StudentLessonMemoryListResponse> {
  try {
    const search = new URLSearchParams();
    if (params.status) {
      const values = Array.isArray(params.status) ? params.status : [params.status];
      search.set('status', values.join(','));
    }
    if (typeof params.limit === 'number') {
      search.set('limit', String(params.limit));
    }
    if (typeof params.offset === 'number') {
      search.set('offset', String(params.offset));
    }
    if (params.order) {
      search.set('order', params.order);
    }

    const query = search.toString();
    const url = query
      ? `/students/${encodeURIComponent(studentId)}/lesson-memory?${query}`
      : `/students/${encodeURIComponent(studentId)}/lesson-memory`;
    const response = await apiClient.get(buildApiProxyPath(url));
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to view lesson memory.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function listStudentHomeworkMemoryEntries(
  studentId: string,
  params: {
    status?: HomeworkMemoryEntryStatus | HomeworkMemoryEntryStatus[];
    limit?: number;
    offset?: number;
    order?: 'asc' | 'desc';
  } = {},
): Promise<StudentHomeworkMemoryListResponse> {
  try {
    const search = new URLSearchParams();
    if (params.status) {
      const values = Array.isArray(params.status) ? params.status : [params.status];
      search.set('status', values.join(','));
    }
    if (typeof params.limit === 'number') {
      search.set('limit', String(params.limit));
    }
    if (typeof params.offset === 'number') {
      search.set('offset', String(params.offset));
    }
    if (params.order) {
      search.set('order', params.order);
    }

    const query = search.toString();
    const url = query
      ? `/students/${encodeURIComponent(studentId)}/homework-memory?${query}`
      : `/students/${encodeURIComponent(studentId)}/homework-memory`;
    const response = await apiClient.get(buildApiProxyPath(url));
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to view homework memory.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function listStudentMemorySnapshots(
  studentId: string,
  params: {
    status?: StudentMemorySnapshotStatus | StudentMemorySnapshotStatus[];
    limit?: number;
    offset?: number;
    order?: 'asc' | 'desc';
  } = {},
): Promise<StudentMemorySnapshotListResponse> {
  try {
    const search = new URLSearchParams();
    if (params.status) {
      const values = Array.isArray(params.status) ? params.status : [params.status];
      search.set('status', values.join(','));
    }
    if (typeof params.limit === 'number') {
      search.set('limit', String(params.limit));
    }
    if (typeof params.offset === 'number') {
      search.set('offset', String(params.offset));
    }
    if (params.order) {
      search.set('order', params.order);
    }

    const query = search.toString();
    const url = query
      ? `/students/${encodeURIComponent(studentId)}/memory-snapshots?${query}`
      : `/students/${encodeURIComponent(studentId)}/memory-snapshots`;
    const response = await apiClient.get(buildApiProxyPath(url));
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to view student memory snapshots.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function fetchPromptOptions(): Promise<PromptOptionsResponse> {
  try {
    const response = await apiClient.get(buildApiProxyPath('/config/prompts'));
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to load prompt options.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function fetchDraft(draftId: string): Promise<DraftResponse> {
  try {
    const response = await apiClient.get(
      buildApiProxyPath(`/drafts/${encodeURIComponent(draftId)}`),
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to view drafts.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function fetchRecordingTranscript(
  recordingId: string,
): Promise<RecordingTranscriptResponse> {
  try {
    const response = await apiClient.get(
      buildApiProxyPath(`/recordings/${encodeURIComponent(recordingId)}/transcript`),
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to view transcripts.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function updateRecordingTranscript(
  recordingId: string,
  text: string,
  expectedWorkingVersion: number,
  speakerRoleMapping?: { roles: { speaker: number; role: 'teacher' | 'student' }[] },
): Promise<RecordingTranscriptResponse> {
  try {
    const response = await runRecoveryRequest(() =>
      apiClient.put(
        buildApiProxyPath(`/recordings/${encodeURIComponent(recordingId)}/transcript`),
        { text, expectedWorkingVersion, ...(speakerRoleMapping ? { speakerRoleMapping } : {}) },
      ),
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    const conflict = getArtifactWorkingConflict(axiosError);
    if (conflict) throw new ArtifactWorkingConflictApiError(conflict);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to update transcripts.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function createPromptPackage(
  recordingId: string,
  params: {
    assignmentSessionId: string;
    templateId?: string;
  },
): Promise<PromptPackageResponse> {
  try {
    const response = await apiClient.post(
      buildApiProxyPath(`/recordings/${encodeURIComponent(recordingId)}/prompt-package`),
      params,
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to create prompt packages.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function fetchPromptPackage(promptPackageId: string): Promise<PromptPackageResponse> {
  try {
    const response = await apiClient.get(
      buildApiProxyPath(`/prompt-packages/${encodeURIComponent(promptPackageId)}`),
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to view prompt packages.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function fetchJobProvenance(jobId: string): Promise<JobProvenanceResponse> {
  try {
    const response = await apiClient.get(
      buildApiProxyPath(`/jobs/${encodeURIComponent(jobId)}/provenance`),
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to view job provenance.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function listAssignmentSessions(limit = 20): Promise<AssignmentSessionListResponse> {
  try {
    const response = await apiClient.get(buildApiProxyPath('/user/assignment-sessions'), {
      params: { limit },
    });
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to load assignment sessions.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function confirmStudentAssignmentSession(
  request: ConfirmStudentAssignmentSessionRequest,
): Promise<AssignmentSession> {
  try {
    const response = await runRecoveryRequest(() =>
      apiClient.post(buildApiProxyPath('/assignment-sessions/confirm-student'), request),
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to save assignment progress.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function fetchAssignmentSession(sessionId: string): Promise<AssignmentSession> {
  try {
    const response = await apiClient.get(
      buildApiProxyPath(`/assignment-sessions/${encodeURIComponent(sessionId)}`),
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to resume assignment progress.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export type AssignmentLearnerContext = ContractAssignmentLearnerContextDto;

export async function fetchAssignmentLearnerContext(
  sessionId: string,
): Promise<AssignmentLearnerContext> {
  try {
    const response = await apiClient.get<AssignmentLearnerContext>(
      buildApiProxyPath(`/assignment-sessions/${encodeURIComponent(sessionId)}/learner-context`),
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function updateAssignmentSessionRecovery(
  sessionId: string,
  request: UpdateAssignmentSessionRecoveryRequest,
): Promise<AssignmentSession> {
  try {
    const response = await runRecoveryRequest(() =>
      apiClient.patch(
        buildApiProxyPath(`/assignment-sessions/${encodeURIComponent(sessionId)}/recovery`),
        request,
      ),
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    const sourceOwnershipConflict = getAssignmentSourceOwnershipConflict(axiosError);
    if (sourceOwnershipConflict) {
      throw new AssignmentSourceOwnershipApiError(sourceOwnershipConflict);
    }
    const conflict = getAssignmentSessionConflict(axiosError);
    if (conflict) throw new AssignmentSessionConflictApiError(conflict);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to update assignment progress.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function attachAssignmentSource(
  sessionId: string,
  request: AttachAssignmentSourceRequest,
): Promise<AttachAssignmentSourceResponse> {
  try {
    const response = await runRecoveryRequest(() =>
      apiClient.post(
        buildApiProxyPath(
          `/assignment-sessions/${encodeURIComponent(sessionId)}/source-attachment`,
        ),
        request,
      ),
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    const conflict = getAssignmentSessionConflict(axiosError);
    if (conflict) throw new AssignmentSessionConflictApiError(conflict);
    const code = (axiosError?.response?.data as { code?: unknown } | undefined)?.code;
    if (code === 'source_identity_required') {
      throw new Error('Reacquire this historical lesson source before continuing.');
    }
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to attach the lesson source.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function confirmAssignmentSessionStep(
  sessionId: string,
  request: ConfirmAssignmentSessionStepRequest,
): Promise<ConfirmAssignmentSessionStepResponse> {
  try {
    const response = await runRecoveryRequest(() =>
      apiClient.post(
        buildApiProxyPath(`/assignment-sessions/${encodeURIComponent(sessionId)}/confirm`),
        request,
      ),
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    const conflict = getAssignmentSessionConflict(axiosError);
    if (conflict) throw new AssignmentSessionConflictApiError(conflict);
    const artifactConflict = getArtifactWorkingConflict(axiosError);
    if (artifactConflict) throw new ArtifactWorkingConflictApiError(artifactConflict);
    if (isAssignmentSpeakerRoleMappingRequired(axiosError)) {
      throw new AssignmentSpeakerRoleMappingRequiredApiError();
    }
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to confirm assignment progress.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function shareAssignmentSession(
  sessionId: string,
  request: ConfirmAssignmentSessionShareRequest,
): Promise<ConfirmAssignmentSessionShareResponse> {
  try {
    const response = await runRecoveryRequest(() =>
      apiClient.post(
        buildApiProxyPath(`/assignment-sessions/${encodeURIComponent(sessionId)}/share`),
        request,
      ),
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    const conflict = getAssignmentSessionConflict(axiosError);
    if (conflict) throw new AssignmentSessionConflictApiError(conflict);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to share this assignment.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function publishAssignmentCorrection(
  publishedJobId: string,
  request: PublishAssignmentCorrectionRequest,
): Promise<PublishAssignmentCorrectionResponse> {
  try {
    const response = await runRecoveryRequest(() =>
      apiClient.post(
        buildApiProxyPath(`/jobs/${encodeURIComponent(publishedJobId)}/publish-correction`),
        request,
      ),
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please publish the corrected assignment again.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function generateDraft(request: GenerateDraftRequest): Promise<GenerateDraftResponse> {
  try {
    const response = await apiClient.post(buildApiProxyPath('/generation/drafts'), request, {
      timeout: GENERATE_DRAFT_REQUEST_TIMEOUT_MS,
    });
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to generate drafts.');
    }
    if (axiosError) {
      const parsed = parseGenerationDraftError(axiosError);
      if (parsed) {
        throw parsed;
      }
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function createDraft(promptPackageId: string, text: string): Promise<DraftResponse> {
  try {
    const response = await apiClient.post(
      buildApiProxyPath(`/prompt-packages/${encodeURIComponent(promptPackageId)}/draft`),
      { text },
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to create drafts.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function materializeDraft(
  draftId: string,
  options: { jobId?: string; jobOverrides?: JobConfigOverrides } = {},
): Promise<MaterializeDraftResponse> {
  try {
    const payload = {
      ...(options.jobId ? { jobId: options.jobId } : {}),
      ...(options.jobOverrides ? { jobOverrides: sanitizeJobOverrides(options.jobOverrides) } : {}),
    };
    const response = await apiClient.post(
      buildApiProxyPath(`/drafts/${encodeURIComponent(draftId)}/materialize`),
      payload,
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to materialize drafts.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function editJobMetadata(
  jobId: string,
  overrides: JobConfigOverrides,
): Promise<JobActionResponse> {
  try {
    const response = await apiClient.post(
      buildApiProxyPath(`/jobs/${encodeURIComponent(jobId)}/actions`),
      {
        type: JobActionType.EDIT_METADATA,
        payload: sanitizeJobOverrides(overrides),
      },
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to update job metadata.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function submitJobAction(
  jobId: string,
  request: JobActionRequest,
): Promise<JobActionResponse> {
  try {
    const response = await apiClient.post(
      buildApiProxyPath(`/jobs/${encodeURIComponent(jobId)}/actions`),
      request,
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to run job actions.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function rerunJob(
  jobId: string,
  payload?: RerunJobPayload,
): Promise<JobActionResponse> {
  return submitJobAction(jobId, {
    type: JobActionType.RERUN,
    payload,
  });
}

export async function cancelJob(
  jobId: string,
  payload?: CancelJobPayload,
): Promise<JobActionResponse> {
  return submitJobAction(jobId, {
    type: JobActionType.CANCEL,
    payload,
  });
}

export function subscribeToJobEvents(
  onEvent: (event: JobEvent) => void,
  options: JobEventsOptions = {},
): EventSource {
  const baseUrl = buildApiProxyPath('/jobs/events');
  const accessToken = getApiAuthToken();

  const search = new URLSearchParams();
  if (options.allJobs) {
    search.set('jobId', '*');
  } else {
    const jobIds = [...new Set((options.jobIds ?? []).map((id) => id.trim()).filter(Boolean))];
    const recordingIds = [
      ...new Set((options.recordingIds ?? []).map((id) => id.trim()).filter(Boolean)),
    ];
    if (jobIds.length > 0) {
      search.set('jobId', jobIds.join(','));
    }
    if (recordingIds.length > 0) {
      search.set('recordingId', recordingIds.join(','));
    }
  }

  const query = search.toString();
  const url = query ? `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${query}` : baseUrl;

  const tokenizedUrl =
    accessToken && accessToken.length > 0 ? appendTokenQueryParam(url, accessToken) : url;

  const eventSource = new EventSource(tokenizedUrl, { withCredentials: true });

  if (options.onOpen) {
    eventSource.addEventListener('open', options.onOpen);
  }

  const handleMessage = (event: MessageEvent) => {
    try {
      const parsed = JSON.parse(event.data) as JobEvent;
      onEvent(parsed);
    } catch (parseError) {
      console.warn('Failed to parse SSE payload', parseError);
    }
  };

  // Backend emits named SSE events (e.g., job_state_changed), so subscribe to both
  // the default "message" channel and the typed event names.
  for (const type of ['message', 'job_state_changed', 'job_created', 'recording_state_changed']) {
    eventSource.addEventListener(type, handleMessage);
  }

  if (options.onError) {
    eventSource.addEventListener('error', options.onError);
  }

  if (options.signal) {
    options.signal.addEventListener(
      'abort',
      () => {
        eventSource.close();
      },
      { once: true },
    );
  }

  return eventSource;
}

function appendTokenQueryParam(url: string, token: string): string {
  if (!token) {
    return url;
  }

  const [basePart, hashPart] = url.split('#', 2);
  const base = basePart ?? '';
  const hash = hashPart ?? '';
  const separator = base.includes('?') ? '&' : '?';
  const queryAppended = `${base}${separator}access_token=${encodeURIComponent(token)}`;
  return hash ? `${queryAppended}#${hash}` : queryAppended;
}

function reportUploadProgress(
  event: AxiosProgressEvent,
  onProgress?: UploadProgressCallback,
): void {
  if (!onProgress) return;
  const total = event.total ?? 0;
  const progress = total ? Math.min(100, Math.round((event.loaded / total) * 100)) : 0;
  onProgress(progress, event.loaded, event.total ?? undefined);
}

export async function updateDraft(
  id: string,
  text: string,
  expectedWorkingVersion: number,
): Promise<DraftResponse> {
  try {
    const response = await runRecoveryRequest(() =>
      apiClient.put(buildApiProxyPath(`/drafts/${encodeURIComponent(id)}`), {
        text,
        expectedWorkingVersion,
      }),
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    const conflict = getArtifactWorkingConflict(axiosError);
    if (conflict) throw new ArtifactWorkingConflictApiError(conflict);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to update drafts.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}
