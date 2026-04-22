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
 * - POST /validation/markdown (authenticated)
 * - POST /uploads (authenticated)
 * - POST /recordings/upload (authenticated)
 * - POST /recordings/:id/transcribe (authenticated)
 * - GET /config/job-options for metadata
 * - GET /config/students for student profiles
 * - GET /config/prompts for prompt templates and profiles
 * - GET /students, /students/:id, /students/:id/timeline
 * - GET /students/:id/bindings, /students/:id/bindings/active
 * - POST /students, PUT /students/:id, DELETE /students/:id
 * - GET /profiles, /profiles/:id, PUT /profiles/:id, DELETE /profiles/:id
 * - GET /profiles/:id/revisions, GET /profiles/:id/revisions/:revisionId
 * - POST /profiles/:id/revisions/:revisionId/restore
 * - GET /prompt-packages/:id/lineage
 * - POST /generation/drafts
 * - GET /drafts/:id
 * - GET /jobs/events (SSE) for live updates
 * - GET /user/profile, /user/files (authenticated)
 */
import { type AxiosError, type AxiosProgressEvent, isAxiosError } from 'axios';

import type {
  ActionCapability,
  ElevenLabsTtsModelId as ContractElevenLabsTtsModelId,
  GenerateDraftRequest as ContractGenerateDraftRequest,
  GenerateDraftResponse as ContractGenerateDraftResponse,
  GoogleTtsModel as ContractGoogleTtsModel,
  JobConfigOverrides as ContractJobConfigOverrides,
  JobEventPayload as ContractJobEventPayload,
  JobEventType as ContractJobEventType,
  JobListResponse as ContractJobListResponse,
  JobOptionsPayload as ContractJobOptionsPayload,
  JobState as ContractJobState,
  JobSummaryResponse as ContractJobSummaryResponse,
  MarkdownValidationResponse as ContractMarkdownValidationResponse,
  PronunciationChunkTtsProviderId as ContractPronunciationChunkTtsProviderId,
  RecordingStatus as ContractRecordingStatus,
  RerunJobPayload as ContractRerunJobPayload,
  SttProviderId as ContractSttProviderId,
  StudentSummaryResponse as ContractStudentSummaryResponse,
  SubmitJobRequest as ContractSubmitJobRequest,
  TtsProviderId as ContractTtsProviderId,
  TtsStrategy as ContractTtsStrategy,
  VoiceOption as ContractVoiceOption,
  GenerationErrorCategory,
  GenerationProvider,
  JobActionRequest,
  JobStatusDto,
  PublishTarget,
  StreamEventMessage,
} from '@esl-pipeline/contracts';
import { JobActionType } from '@esl-pipeline/contracts';

import apiClient, {
  buildApiProxyPath,
  getApiAuthToken,
  handleApiError,
  isAuthError,
} from './api-client';

export type JobState = ContractJobState;
export type TtsStrategy = ContractTtsStrategy;
export type RecordingStatus = ContractRecordingStatus;
export type SttProvider = ContractSttProviderId;
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
export type TtsProviderId = ContractTtsProviderId;
export type GoogleTtsModel = ContractGoogleTtsModel;
export type ElevenLabsTtsModelId = ContractElevenLabsTtsModelId;
export type PronunciationChunkTtsProviderId = ContractPronunciationChunkTtsProviderId;
export type MarkdownValidationResponse = ContractMarkdownValidationResponse;
export type GenerateDraftRequest = ContractGenerateDraftRequest;
export type GenerateDraftResponse = ContractGenerateDraftResponse;
export type GenerationDraftErrorCode = GenerationErrorCategory;
export type RerunJobPayload = ContractRerunJobPayload;

const GENERATE_DRAFT_REQUEST_TIMEOUT_MS = 240_000;

export interface RecordingTranscriptResponse {
  recordingId: string;
  transcriptId: string;
  text: string;
  summaryJson: Record<string, unknown> | null;
  sttProvider: SttProvider;
  model: string;
  language: string;
  mode: 'timeline' | 'stack';
  createdAt: string;
  updatedAt: string;
}

export interface RecordingListItem {
  recordingId: string;
  status: RecordingStatus;
  transcriptId: string | null;
  error: string | null;
  source: 'upload';
  studentId: string | null;
  displayName: string;
  durationSec: number | null;
  channels: number | null;
  bytes: number;
  createdAt: string;
  updatedAt: string;
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

export interface StudentOption {
  id: string;
  name: string;
  profileId?: string | null;
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
  profileId?: string | null;
}

export interface StarterProfileInput {
  level?: string | null;
  goals?: string | null;
  professionOrContext?: string | null;
  interests?: string | null;
  longRunningChallenges?: string | null;
  studyPreferencesOrConstraints?: string | null;
  teacherNotes?: string | null;
}

export type StudentProfileInput = Omit<StudentProfile, 'id'> & {
  starterProfile?: StarterProfileInput | null;
};
export type StudentProfileUpdate = Partial<StudentProfileInput>;

export interface StudentProfileListResponse {
  items: StudentProfile[];
  total: number;
  limit: number;
  offset: number;
  order: 'asc' | 'desc';
}

export interface ProfileContentOption {
  id: string;
  label: string;
}

export interface ProfileContentListResponse {
  profiles: ProfileContentOption[];
}

export interface ProfileContentResponse {
  id: string;
  label: string;
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
  profileId: string;
  contentHash: string;
  source:
    | 'create'
    | 'update'
    | 'restore'
    | 'starter_profile_form'
    | 'candidate_promotion'
    | 'legacy_normalization'
    | 'lesson_population';
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
  | 'student_profile_binding_changed'
  | 'profile_revision_saved'
  | 'profile_revision_restored'
  | 'profile_revision_activated'
  | 'template_revision_saved'
  | 'template_revision_restored'
  | 'template_revision_activated'
  | 'job_action_rerun'
  | 'job_action_cancel'
  | 'job_action_edit_metadata';

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
  profileId: string;
  includedCandidateIds: string[];
  excludedCandidateIds: string[];
  contentHash?: string | null;
  draftRevision?: ProfileRevisionDetailResponse;
}

export interface PopulateFirstProfileFromLessonResponse {
  draftRevisionId: string;
  profileId: string;
  snapshotId: string | null;
  lessonMemoryIds: string[];
  homeworkMemoryIds: string[];
  draftRevision: ProfileRevisionDetailResponse;
}

export interface InitializeStudentProfileDraftResponse {
  draftRevisionId: string;
  profileId: string;
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

export interface StudentProfileBindingResponse {
  id: string;
  studentId: string;
  profileId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: string | null;
  changedBy: string | null;
  createdAt: string;
}

export interface StudentProfileBindingListResponse {
  items: StudentProfileBindingResponse[];
  total: number;
  limit: number;
  offset: number;
  order: 'asc' | 'desc';
}

export interface PromptOption {
  id: string;
  label: string;
}

export interface PromptOptionsResponse {
  templates: PromptOption[];
  profiles: PromptOption[];
  defaults: {
    templateId: string | null;
    profileId: string | null;
  };
}

export interface PromptPackageResponse {
  id: string;
  recordingId: string;
  transcriptId: string;
  studentId: string | null;
  profilePath: string | null;
  templateVersion: string;
  notes: string | null;
  storageUri: string;
  text: string;
  profileSnapshot?: {
    resolvedProfileId: string;
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
      profileId: string | null;
      revisionId: string | null;
      hash: string | null;
      versionLabel: string | null;
      status: 'draft' | 'active' | 'deprecated' | null;
      updatedAt: string | null;
    };
    current: {
      profileId: string | null;
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
  voiceCapabilitiesSnapshot?: {
    generatedAt: string | null;
    hash: string | null;
  } | null;
  memory: {
    studentMemorySnapshotId: string | null;
    studentMemorySnapshotHash: string | null;
    selectedLessonMemoryIds: string[];
    selectedHomeworkMemoryIds: string[];
    retrievalPolicyVersion: string | null;
    layerAvailability: PromptPackageMemoryLayerAvailability;
  };
  bindingAtCreation?: {
    bindingId: string;
    studentId: string;
    profileId: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    reason: string | null;
    changedBy: string | null;
    createdAt: string;
  } | null;
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

export interface DraftResponse {
  id: string;
  promptPackageId: string;
  studentId: string | null;
  storageUri: string;
  createdBy: string | null;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export interface MaterializeDraftResponse {
  draftId: string;
  jobId: string;
  mdPath: string | null;
  mdStorageUri: string;
}

export interface UploadMarkdownResponse {
  id: string;
  md: string;
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

export async function validateMarkdown(
  text: string,
  strict?: boolean,
  context?: {
    learningPresetId?: string | null;
    learningPresetVersion?: string | null;
  },
): Promise<MarkdownValidationResponse> {
  try {
    const response = await apiClient.post(buildApiProxyPath('/validation/markdown'), {
      text,
      strict,
      learningPresetId: context?.learningPresetId ?? undefined,
      learningPresetVersion: context?.learningPresetVersion ?? undefined,
    });
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to validate markdown.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function renderHtmlPreview(params: {
  text: string;
  title?: string;
  learningPresetId?: string | null;
  audioUrl?: string | null;
  pronunciationAudioUrl?: string | null;
}): Promise<{ html: string }> {
  try {
    const response = await apiClient.post(buildApiProxyPath('/preview/html'), {
      text: params.text,
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
}

const toAxiosError = (error: unknown): AxiosError | null => (isAxiosError(error) ? error : null);

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

export async function register(userData: RegisterRequest): Promise<void> {
  const attempt = async (path: string) => {
    const response = await apiClient.post(path, userData);
    return response.data;
  };

  try {
    await attempt(buildApiProxyPath('/auth/register'));
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
        await attempt(buildApiProxyPath('/auth/register'));
        return;
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
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
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
 * Upload a markdown file via POST /uploads and receive an md identifier
 * that can be passed through to POST /jobs. Now uses authenticated API client.
 */
export async function uploadMarkdown(
  file: File,
  options: { onProgress?: UploadProgressCallback; signal?: AbortSignal } = {},
): Promise<UploadMarkdownResponse> {
  try {
    const formData = new FormData();
    formData.append('file', file);

    const response = await apiClient.post(buildApiProxyPath('/uploads'), formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (event) => reportUploadProgress(event, options.onProgress),
      signal: options.signal,
    });

    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to upload files.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
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
    onProgress?: UploadProgressCallback;
    signal?: AbortSignal;
  },
): Promise<RecordingListItem> {
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

    const response = await apiClient.post(buildApiProxyPath('/recordings/upload'), formData, {
      params: Object.keys(params).length > 0 ? params : undefined,
      headers: {
        'Content-Type': 'multipart/form-data',
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
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function retryRecordingTranscription(
  recordingId: string,
  options?: { sttProvider?: SttProvider },
): Promise<RecordingListItem> {
  try {
    const response = await apiClient.post(
      buildApiProxyPath(`/recordings/${encodeURIComponent(recordingId)}/transcribe`),
      options?.sttProvider ? { sttProvider: options.sttProvider } : undefined,
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
  params: { q?: string; limit?: number; offset?: number; order?: 'asc' | 'desc' } = {},
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

export async function listProfileContents(): Promise<ProfileContentListResponse> {
  try {
    const response = await apiClient.get(buildApiProxyPath('/profiles'));
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function getProfileContent(profileId: string): Promise<ProfileContentResponse> {
  try {
    const response = await apiClient.get(
      buildApiProxyPath(`/profiles/${encodeURIComponent(profileId)}`),
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
  profileId: string,
  content: string,
): Promise<ProfileContentResponse> {
  try {
    const response = await apiClient.put(
      buildApiProxyPath(`/profiles/${encodeURIComponent(profileId)}`),
      { content },
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

export async function deleteProfileContent(profileId: string): Promise<void> {
  try {
    await apiClient.delete(buildApiProxyPath(`/profiles/${encodeURIComponent(profileId)}`));
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to delete profiles.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function listProfileRevisions(
  profileId: string,
  params: {
    limit?: number;
    offset?: number;
    order?: 'asc' | 'desc';
  } = {},
): Promise<ProfileRevisionListResponse> {
  try {
    const response = await apiClient.get(
      buildApiProxyPath(`/profiles/${encodeURIComponent(profileId)}/revisions`),
      { params },
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
  profileId: string,
  revisionId: string,
): Promise<ProfileRevisionDetailResponse> {
  try {
    const response = await apiClient.get(
      buildApiProxyPath(
        `/profiles/${encodeURIComponent(profileId)}/revisions/${encodeURIComponent(revisionId)}`,
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
  profileId: string,
  revisionId: string,
): Promise<ProfileContentResponse> {
  try {
    const response = await apiClient.post(
      buildApiProxyPath(
        `/profiles/${encodeURIComponent(profileId)}/revisions/${encodeURIComponent(revisionId)}/restore`,
      ),
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
  profileId: string,
  payload: SaveProfileDraftRevisionRequest,
): Promise<ProfileRevisionDetailResponse> {
  try {
    const response = await apiClient.post(
      buildApiProxyPath(`/profiles/${encodeURIComponent(profileId)}/revisions`),
      payload,
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
  profileId: string,
  revisionId: string,
): Promise<ProfileContentResponse> {
  try {
    const response = await apiClient.post(
      buildApiProxyPath(
        `/profiles/${encodeURIComponent(profileId)}/revisions/${encodeURIComponent(revisionId)}/activate`,
      ),
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

export async function listStudentProfileBindings(
  studentId: string,
  params: {
    limit?: number;
    offset?: number;
    order?: 'asc' | 'desc';
  } = {},
): Promise<StudentProfileBindingListResponse> {
  try {
    const response = await apiClient.get(
      buildApiProxyPath(`/students/${encodeURIComponent(studentId)}/bindings`),
      { params },
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to view profile bindings.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function getActiveStudentProfileBinding(
  studentId: string,
  at?: string,
): Promise<StudentProfileBindingResponse> {
  try {
    const response = await apiClient.get(
      buildApiProxyPath(`/students/${encodeURIComponent(studentId)}/bindings/active`),
      {
        params: at ? { at } : undefined,
      },
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to view active profile bindings.');
    }
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
    return {
      ...data,
      items: (data.items ?? []).map((item) => mapStudentProfileCandidate(item)),
    };
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

export async function populateFirstProfileFromLesson(
  studentId: string,
  payload: { reviewerNote?: string } = {},
): Promise<PopulateFirstProfileFromLessonResponse> {
  try {
    const response = await apiClient.post(
      buildApiProxyPath(
        `/students/${encodeURIComponent(studentId)}/profile-drafts/populate-first-from-lesson`,
      ),
      payload,
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to populate the learner profile.');
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
      throw new Error(
        'Authentication required. Please login to initialize the learner profile.',
      );
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
): Promise<RecordingTranscriptResponse> {
  try {
    const response = await apiClient.put(
      buildApiProxyPath(`/recordings/${encodeURIComponent(recordingId)}/transcript`),
      { text },
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to update transcripts.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function createPromptPackage(
  recordingId: string,
  params: {
    notes?: string;
    profileId?: string;
    templateId?: string;
    profilePath?: string;
    bindingEffectiveAt?: string;
  },
): Promise<PromptPackageResponse> {
  // Backend precedence:
  // profileId > profilePath > student-linked profileId > configured default profile.
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

export async function fetchPromptPackageLineage(
  promptPackageId: string,
): Promise<PromptPackageLineageResponse> {
  try {
    const response = await apiClient.get(
      buildApiProxyPath(`/prompt-packages/${encodeURIComponent(promptPackageId)}/lineage`),
    );
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to view prompt lineage.');
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
  const url = buildApiProxyPath('/jobs/events');
  const accessToken = getApiAuthToken();

  // Add jobId=* to subscribe to all jobs
  const separator = url.includes('?') ? '&' : '?';
  const urlWithJobId = `${url}${separator}jobId=*`;

  const tokenizedUrl =
    accessToken && accessToken.length > 0
      ? appendTokenQueryParam(urlWithJobId, accessToken)
      : urlWithJobId;

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

export async function updateDraft(id: string, text: string): Promise<DraftResponse> {
  try {
    const response = await apiClient.put(buildApiProxyPath(`/drafts/${encodeURIComponent(id)}`), {
      text,
    });
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to update drafts.');
    }
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}
