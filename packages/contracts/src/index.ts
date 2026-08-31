import type { ContractVersionRegistry } from './contract-versions.js';

export type JobState = 'queued' | 'running' | 'awaiting_approval' | 'succeeded' | 'failed';

export type TtsStrategy = 'auto' | 'dialogue' | 'tts';
export type TtsStrategyOption = TtsStrategy;
export type TtsProviderId = 'elevenlabs' | 'google' | 'inworld';
export type ElevenLabsTtsModelId =
  | 'eleven_v3'
  | 'eleven_multilingual_v2'
  | 'eleven_flash_v2_5'
  | 'eleven_flash_v2';
export type PronunciationChunkTtsProviderId = TtsProviderId;
export type SttProviderId = 'deepgram' | 'elevenlabs' | 'google';
export type TranscriptProviderId = SttProviderId | 'manual';
export type RecordingSourceId = 'upload' | 'manual_transcript';
export type AudioInputTopology = 'mixed_recording' | 'trusted_split_channels';
export type GoogleTtsModel = 'chirp3_hd' | 'studio' | 'neural2' | 'wavenet';
export type InworldTtsModel = 'inworld-tts-2' | 'inworld-tts-1.5-max' | 'inworld-tts-1.5-mini';
export type TtsModelId = ElevenLabsTtsModelId | GoogleTtsModel | InworldTtsModel;
export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export type JobUploadOption = 'auto' | 's3' | 'none';
export type UploadOption = JobUploadOption;
export type PublishTarget = 'html';

export type RecordingStatus = 'ingested' | 'queued' | 'transcribing' | 'transcribed' | 'failed';

export interface VoiceOption {
  id: string;
  name: string;
  accent?: string | null;
  gender?: string | null;
  category?: string | null;
}

export type GenerationProvider = 'openai' | 'google_ai_studio' | 'openrouter';

export type GenerationErrorCategory =
  | 'provider_rate_limit'
  | 'provider_timeout'
  | 'provider_contract_error'
  | 'budget_exceeded';

export type GenerationQuotaSource = 'configured' | 'provider' | 'hybrid';

export interface GenerationModelOption {
  provider: GenerationProvider;
  id: string;
  label?: string;
  tier?: 'primary' | 'fallback' | 'tertiary' | 'custom';
  fallbackRank?: number;
  defaultSelected?: boolean;
  enabled?: boolean;
}

export interface GenerationQuotaView {
  source: GenerationQuotaSource;
  lastUpdatedAt: string;
  dashboardUrl?: string;
  requestsPerMinute?: number | null;
  tokensPerMinute?: number | null;
  requestsPerDay?: number | null;
  dailyTokenBudget?: number | null;
  usedRequestsToday?: number | null;
  usedTokensToday?: number | null;
  dailyRequestBudget?: number | null;
  dailyRequestUsed?: number | null;
  dailyRequestRemaining?: number | null;
  dailyTokenUsed?: number | null;
  dailyTokenRemaining?: number | null;
  rpmBudget?: number | null;
  rpmUsed?: number | null;
  rpmRemaining?: number | null;
}

export interface GenerationOptionsPayload {
  providers: GenerationProvider[];
  defaultProvider: GenerationProvider;
  modelOptions: GenerationModelOption[];
  defaultModelByProvider?: Partial<Record<GenerationProvider, string>>;
  quota: GenerationQuotaView;
}

export interface GenerateDraftRequest {
  promptPackageId: string;
  provider?: GenerationProvider;
  model?: string;
  maxOutputTokens?: number;
  stream?: boolean;
}

export interface GenerateDraftUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
}

export interface GenerateDraftResponse {
  text: string;
  provider: GenerationProvider;
  model: string;
  quota: GenerationQuotaView;
  usage?: GenerateDraftUsage;
  providerRequestId?: string;
  errorCategory?: GenerationErrorCategory;
}

export interface JobOptionsPayload {
  presets: string[];
  voiceAccents: string[];
  voices: VoiceOption[];
  uploadOptions: UploadOption[];
  ttsStrategies: TtsStrategyOption[];
  sttProviders?: SttProviderId[];
  defaultSttProvider?: SttProviderId;
  sttModelOptionsByProvider?: Partial<Record<SttProviderId, string[]>>;
  defaultSttModelByProvider?: Partial<Record<SttProviderId, string>>;
  ttsProviders?: TtsProviderId[];
  ttsModelOptionsByProvider?: Partial<Record<TtsProviderId, string[]>>;
  defaultTtsProvider?: TtsProviderId;
  defaultTtsModelByProvider?: Partial<Record<TtsProviderId, string>>;
  cefrLevels?: CefrLevel[];
  cefrDefault?: CefrLevel;
  generation?: GenerationOptionsPayload;
}

export interface LearningPresetProvenance {
  learningPresetId?: string | null;
  learningPresetVersion?: string | null;
  promptSnapshotVersion?: string | null;
  promptAlias?: string | null;
}

export interface SubmitJobRequest {
  md: string;
  learningPresetId?: string;
  withTts?: boolean;
  forceTts?: boolean;
  publishTarget?: PublishTarget;
  upload?: JobUploadOption;
  ttsStrategy?: TtsStrategy;
  ttsProvider?: TtsProviderId;
  ttsModel?: TtsModelId;
  voiceId?: string;
  voiceAccent?: string;
  autoPublish?: boolean;
}

export interface JobConfigOverrides {
  learningPresetId?: string;
  publishTarget?: PublishTarget;
  withTts?: boolean;
  forceTts?: boolean;
  ttsStrategy?: TtsStrategy;
  ttsProvider?: TtsProviderId;
  ttsModel?: TtsModelId | null;
  upload?: JobUploadOption;
  voiceId?: string;
  voiceAccent?: string;
  autoPublish?: boolean;
}

export type AssignmentConfirmedStep = 'student' | 'source' | 'context' | 'create' | 'share';

export type AssignmentInvalidatedArtifact = 'transcript' | 'prompt' | 'draft' | 'preview';

export interface ArtifactWorkingContentDto {
  workingVersion: number;
  contentHash: string;
}

export interface AssignmentConfirmedSnapshot {
  student: { studentId: string };
  source: {
    lessonId: string | null;
    recordingId: string;
    transcriptId: string;
    transcriptWorkingVersion: number;
    transcriptStorageUri: string;
    transcriptHash: string;
  } | null;
  context: {
    teacherNotes: string | null;
    profileId: string | null;
    profileRevisionId: string | null;
    profileRevisionHash: string | null;
  } | null;
  create: {
    promptPackageId: string;
    draftId: string;
    draftWorkingVersion: number;
    draftStorageUri: string;
    draftHash: string;
  } | null;
}

export interface AssignmentSessionDto {
  id: string;
  userId: string;
  studentId: string;
  lessonId: string | null;
  recordingId: string | null;
  transcriptId: string | null;
  promptPackageId: string | null;
  draftId: string | null;
  revision: number;
  confirmedStep: AssignmentConfirmedStep;
  confirmed: AssignmentConfirmedSnapshot;
  publishTarget: PublishTarget | null;
  selectedTtsProvider: TtsProviderId | null;
  selectedTtsStrategy: TtsStrategy | null;
  selectedTtsModel: string | null;
  selectedPreset: string | null;
  selectedGenerationProvider: GenerationProvider | null;
  selectedGenerationModel: string | null;
  teacherNotes: string | null;
  selectedProfileId: string | null;
  selectedProfileRevisionId: string | null;
  selectedProfileRevisionHash: string | null;
  shareJobId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssignmentSessionListResponse {
  sessions: AssignmentSessionDto[];
  total: number;
  limit: number;
}

export interface ConfirmStudentAssignmentSessionRequest {
  requestId: string;
  studentId: string;
  lessonId?: string | null;
}

export interface UpdateAssignmentSessionRecoveryRequest {
  expectedRevision: number;
  patch: Partial<{
    lessonId: string | null;
    recordingId: string | null;
    transcriptId: string | null;
    promptPackageId: string | null;
    draftId: string | null;
    publishTarget: PublishTarget | null;
    selectedTtsProvider: TtsProviderId | null;
    selectedTtsStrategy: TtsStrategy | null;
    selectedTtsModel: string | null;
    selectedPreset: string | null;
    selectedGenerationProvider: GenerationProvider | null;
    selectedGenerationModel: string | null;
    teacherNotes: string | null;
    selectedProfileId: string | null;
    selectedProfileRevisionId: string | null;
    selectedProfileRevisionHash: string | null;
  }>;
}

export type ConfirmAssignmentSessionStepRequest =
  | {
      step: 'source';
      expectedRevision: number;
      lessonId: string | null;
      recordingId: string;
      transcriptId: string;
      transcriptWorkingVersion: number;
    }
  | {
      step: 'context';
      expectedRevision: number;
      teacherNotes: string | null;
      profileId: string | null;
      profileRevisionId: string | null;
      profileRevisionHash: string | null;
    }
  | {
      step: 'create';
      expectedRevision: number;
      promptPackageId: string;
      draftId: string;
      draftWorkingVersion: number;
    };

export interface ConfirmAssignmentSessionStepResponse {
  session: AssignmentSessionDto;
  invalidated: AssignmentInvalidatedArtifact[];
}

export interface ConfirmAssignmentSessionShareRequest {
  expectedRevision: number;
  requestId: string;
}

export interface ConfirmAssignmentSessionShareResponse {
  session: AssignmentSessionDto;
  job: JobStatusDto;
}

export interface PublishAssignmentCorrectionRequest {
  requestId: string;
  draftId: string;
  draftWorkingVersion: number;
  draftHash: string;
}

export interface PublishAssignmentCorrectionResponse {
  job: JobStatusDto;
}

export interface AssignmentSessionConflictResponse {
  code: 'assignment_session_revision_conflict';
  session: AssignmentSessionDto;
}

export interface ArtifactWorkingConflictResponse {
  code: 'artifact_working_conflict';
  artifact: ArtifactWorkingContentDto;
}

export type RecentAssignmentItem =
  | { kind: 'session'; session: AssignmentSessionDto }
  | { kind: 'job'; job: JobStatusDto };

export interface JobStatusDto {
  jobId: string;
  assignmentSessionId?: string | null;
  studentId?: string | null;
  studentName?: string | null;
  lessonId?: string | null;
  md: string | null;
  mdStorageUri?: string | null;
  pronunciationMode?:
    | 'shadow_sentence'
    | 'connected_speech'
    | 'intonation'
    | 'rhythm_chunking'
    | 'sentence_stress'
    | 'minimal_pair'
    | null;
  recordingId: string | null;
  transcriptId: string | null;
  promptPackageId: string | null;
  draftId: string | null;
  preset: string | null;
  learningPresetId?: string | null;
  learningPresetVersion?: string | null;
  promptSnapshotVersion?: string | null;
  promptAlias?: string | null;
  withTts: boolean | null;
  voiceId: string | null;
  upload: JobUploadOption | null;
  voiceAccent: string | null;
  forceTts: boolean | null;
  publishTarget: PublishTarget | null;
  ttsStrategy: TtsStrategy | null;
  ttsProvider?: TtsProviderId | null;
  ttsModel?: TtsModelId | null;
  autoPublish: boolean | null;
  htmlUrl: string | null;
  state: JobState;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  sourceJobId?: string | null;
  error: string | null;
  providerError?: VoiceProviderErrorDetails | null;
  manifestPath: string | null;
}

export interface JobListResponse {
  jobs: JobStatusDto[];
  total: number;
  limit: number;
  offset: number;
}

export interface JobSummaryResponse {
  total: number;
  byState: Record<JobState, number>;
  pendingApprovals: number;
  last7Days: {
    total: number;
    succeeded: number;
    failed: number;
  };
  tts: {
    enabled: number;
    succeeded: number;
  };
}

export type OpsHealthState = 'healthy' | 'degraded' | 'critical';

export type OpsActionId = 'backup_upload' | 'restore_drill_download_only';
export type OpsActionState = 'queued' | 'running' | 'succeeded' | 'failed';

export interface OpsStatusResponse {
  checkedAtUtc: string;
  overall: {
    state: OpsHealthState;
    reasons: string[];
  };
  thresholds: {
    backupMaxAgeHours: number | null;
    drillMaxAgeDays: number | null;
    keyRotationMaxAgeDays: number | null;
  };
  backup: {
    state: OpsHealthState;
    reason: string;
    latestDumpKey: string | null;
    lastModifiedUtc: string | null;
    ageHours: number | null;
  };
  restoreDrill: {
    state: OpsHealthState;
    reason: string;
    lastReportUtc: string | null;
    ageDays: number | null;
    reportStatus: string | null;
    reportMode: string | null;
    latestRemoteDumpKey: string | null;
    drillResult: string | null;
  };
  keyRotation: {
    state: OpsHealthState;
    reason: string;
    iamUser: string | null;
    oldestAccessKeyId: string | null;
    oldestCreatedUtc: string | null;
    oldestAgeDays: number | null;
    oldestLastUsedUtc: string | null;
  };
}

export interface OpsActionRequest {
  action: OpsActionId;
  label?: string;
}

export interface OpsActionStatus {
  operationId: string;
  action: OpsActionId;
  state: OpsActionState;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  requestedBy: string | null;
  requestedByUserId: string | null;
  message: string | null;
  command: string;
  exitCode: number | null;
  stdoutTail: string | null;
  stderrTail: string | null;
}

export interface OpsActionListResponse {
  actions: OpsActionStatus[];
  total: number;
  limit: number;
  offset: number;
}

export type ReadinessMetricName =
  | 'publishSuccessRate'
  | 'medianPublishLatencyMs'
  | 'firstSessionSuccessProxy'
  | 'voiceValidationFailureRate'
  | 'voiceStrictMismatchRate'
  | 'voiceFallbackRate'
  | 'voiceProviderErrorRate';

export interface ReadinessMetricSource {
  source: string;
  window: string;
  calculation: string;
}

export type ReadinessMetricSourceMap = Record<ReadinessMetricName, ReadinessMetricSource>;

export interface ReadinessMetricsResponse {
  window: {
    from: string;
    to: string;
  };
  publishSuccess: {
    succeeded: number;
    failed: number;
    total: number;
    rate: number | null;
  };
  publishLatencyMs: {
    median: number | null;
    sampleSize: number;
  };
  firstSessionSuccessProxy: {
    successfulUsers: number;
    totalUsers: number;
    rate: number | null;
  };
  voiceAlignment?: {
    validationFailures: number;
    strictMismatches: number;
    providerErrors: number;
    providerErrorBreakdown: Partial<Record<VoiceProviderErrorCategory, number>>;
    fallbackSelections: number | null;
    reuseSelections: number | null;
  };
  sources: ReadinessMetricSourceMap;
}

export interface StudentSummaryResponse {
  items: {
    id: string;
    name: string;
    lastLessonAt: string | null;
    pendingDrafts: number;
  }[];
  total: number;
  limit: number;
  offset: number;
}

export type StudentLessonStatus = 'scheduled' | 'completed' | 'canceled' | 'no_show';
export type StudentCreditEventType = 'credit_added' | 'credit_consumed' | 'credit_adjusted';
export type StudentReminderType =
  | 'no_next_lesson'
  | 'low_balance'
  | 'payment_followup'
  | 'lesson_followup';
export type StudentReminderChannel = 'manual' | 'telegram' | 'email';
export type StudentReminderActionIntent = 'copy_text' | 'complete_lesson_and_start_assignment';
export type StudentLessonHomeworkStatus =
  | 'not_started'
  | 'session_in_progress'
  | 'draft_in_progress'
  | 'publishing'
  | 'published'
  | 'memory_ready';

export interface StudentLessonHomeworkDto {
  status: StudentLessonHomeworkStatus;
  assignmentSessionId: string | null;
  promptPackageId: string | null;
  draftId: string | null;
  jobId: string | null;
  homeworkMemoryEntryId: string | null;
  htmlUrl: string | null;
  updatedAt: string | null;
}
export type StudentLessonRecurrenceStatus = 'active' | 'paused' | 'archived';
export type StudentLessonRecurrenceFrequency = 'weekly';
export type StudentLessonRecurrenceOrigin = 'manual' | 'generated';
export type StudentLessonRecurrenceOverrideKind =
  | 'manual_edit'
  | 'manual_reschedule'
  | 'manual_cancel';

export interface StudentLessonRecurrenceSlotDto {
  id: string;
  ruleId: string;
  isoWeekday: number;
  localStartTime: string;
  durationMinutes: number;
  sortOrder: number;
}

export interface StudentLessonRecurrenceRuleDto {
  id: string;
  studentId: string;
  workspaceId: string | null;
  timezone: string;
  frequency: StudentLessonRecurrenceFrequency;
  startsOn: string;
  endsOn: string | null;
  status: StudentLessonRecurrenceStatus;
  generationHorizonDays: number;
  materializedThrough: string | null;
  slots: StudentLessonRecurrenceSlotDto[];
  updatedAt: string;
}

export interface UpsertStudentLessonRecurrenceRequest {
  timezone: string;
  frequency?: StudentLessonRecurrenceFrequency;
  startsOn: string;
  endsOn?: string | null;
  status?: Exclude<StudentLessonRecurrenceStatus, 'archived'>;
  generationHorizonDays?: number;
  slots: {
    isoWeekday: number;
    localStartTime: string;
    durationMinutes: number;
  }[];
}

export interface StudentLessonPlanDto {
  studentId: string;
  workspaceId: string | null;
  timezone: string;
  defaultDurationMinutes: number;
  cadence: string | null;
  preferredTimes: string | null;
  schedulingNotes: string | null;
  updatedAt: string | null;
}

export interface UpdateStudentLessonPlanRequest {
  timezone?: string;
  defaultDurationMinutes?: number;
  cadence?: string | null;
  preferredTimes?: string | null;
  schedulingNotes?: string | null;
}

export interface StudentLessonDto {
  id: string;
  studentId: string;
  workspaceId: string | null;
  startsAt: string;
  timezone: string;
  durationMinutes: number;
  status: StudentLessonStatus;
  consumesCredit: boolean;
  title: string | null;
  notes: string | null;
  creditEventId: string | null;
  recurrenceRuleId: string | null;
  recurrenceSlotId: string | null;
  recurrenceOccurrenceKey: string | null;
  recurrenceOrigin: StudentLessonRecurrenceOrigin;
  recurrenceOverrideKind: StudentLessonRecurrenceOverrideKind | null;
  homework: StudentLessonHomeworkDto;
  createdAt: string;
  updatedAt: string;
}

export interface CreateStudentLessonRequest {
  startsAt: string;
  timezone?: string;
  durationMinutes?: number;
  status?: StudentLessonStatus;
  consumesCredit?: boolean;
  title?: string | null;
  notes?: string | null;
}

export interface UpdateStudentLessonRequest {
  startsAt?: string;
  timezone?: string;
  durationMinutes?: number;
  status?: StudentLessonStatus;
  consumesCredit?: boolean;
  title?: string | null;
  notes?: string | null;
}

export interface StudentCreditEventDto {
  id: string;
  studentId: string;
  workspaceId: string | null;
  eventType: StudentCreditEventType;
  quantityDelta: number;
  sourceLessonId: string | null;
  sourcePaymentId: string | null;
  note: string | null;
  voidedAt: string | null;
  createdAt: string;
}

export interface AddStudentPackageRequest {
  lessons: number;
  note?: string | null;
  payment?: {
    amountMinor: number;
    currency: string;
    method?: string | null;
    receivedAt?: string;
    externalUrl?: string | null;
    note?: string | null;
  } | null;
}

export interface AdjustStudentCreditsRequest {
  quantityDelta: number;
  note?: string | null;
}

export interface StudentPaymentRecordDto {
  id: string;
  studentId: string;
  workspaceId: string | null;
  amountMinor: number;
  currency: string;
  method: string | null;
  receivedAt: string;
  externalUrl: string | null;
  note: string | null;
  voidedAt: string | null;
  createdAt: string;
}

export interface RecordStudentPaymentRequest {
  amountMinor: number;
  currency: string;
  method?: string | null;
  receivedAt?: string;
  externalUrl?: string | null;
  note?: string | null;
}

export interface StudentCreditSummaryDto {
  purchased: number;
  consumed: number;
  adjustments: number;
  remaining: number;
  lowBalanceThreshold: number;
  isLow: boolean;
  isNegative: boolean;
}

export interface StudentReminderRecommendationDto {
  type: StudentReminderType;
  channel: StudentReminderChannel;
  severity: 'info' | 'attention' | 'urgent';
  actionIntent: StudentReminderActionIntent;
  lessonId?: string | null;
  lessonStatus?: StudentLessonStatus | null;
  lessonConsumesCredit?: boolean | null;
  lessonSummary?: StudentReminderLessonSummaryDto | null;
  title: string;
  message: string;
  copyText: string;
}

export interface StudentReminderLessonSummaryDto {
  lessonId: string;
  startsAt: string | null;
  durationMinutes: number | null;
  title: string | null;
}

export interface StudentLatestHiddenReminderDto {
  type: Extract<StudentReminderType, 'lesson_followup'>;
  lessonId: string;
  hiddenAt: string | null;
  lessonSummary: StudentReminderLessonSummaryDto | null;
}

export interface StudentScheduleBillingSurfaceResponse {
  studentId: string;
  workspaceId: string | null;
  lessonPlan: StudentLessonPlanDto;
  recurrenceRule: StudentLessonRecurrenceRuleDto | null;
  nextLesson: StudentLessonDto | null;
  lessons: StudentLessonDto[];
  creditSummary: StudentCreditSummaryDto;
  creditEvents: StudentCreditEventDto[];
  payments: StudentPaymentRecordDto[];
  reminders: StudentReminderRecommendationDto[];
  latestHiddenReminder: StudentLatestHiddenReminderDto | null;
}

export interface BusinessSettingsDto {
  workspaceId: string;
  defaultCurrency: string;
  defaultLessonRateMinor: number;
  defaultLessonDurationMinutes: number;
  timezone: string;
  forecastHorizonDays: number;
  noShowRateBasisPoints: number;
  cancellationRateBasisPoints: number;
  topUpThreshold: number;
  updatedAt: string | null;
}

export interface UpdateBusinessSettingsRequest {
  defaultCurrency?: string;
  defaultLessonRateMinor?: number;
  defaultLessonDurationMinutes?: number;
  timezone?: string;
  forecastHorizonDays?: number;
  noShowRateBasisPoints?: number;
  cancellationRateBasisPoints?: number;
  topUpThreshold?: number;
}

export interface BusinessLessonDto extends StudentLessonDto {
  studentName: string;
  studentScheduleBillingPath: string;
}

export interface BusinessReminderDto extends StudentReminderRecommendationDto {
  studentId: string;
  studentName: string;
  studentScheduleBillingPath: string;
  remainingCredits: number;
}

export interface BusinessLatestHiddenReminderDto extends StudentLatestHiddenReminderDto {
  studentId: string;
  studentName: string;
  studentScheduleBillingPath: string;
}

export interface BusinessCreditAlertDto {
  studentId: string;
  studentName: string;
  studentScheduleBillingPath: string;
  remainingCredits: number;
  lowBalanceThreshold: number;
  severity: 'attention' | 'urgent';
  upcomingChargeableLessons: number;
}

export interface BusinessPaymentSummaryDto {
  studentId: string;
  studentName: string;
  studentScheduleBillingPath: string;
  amountMinor: number;
  currency: string;
  receivedAt: string;
  method: string | null;
}

export interface BusinessScheduleSurfaceResponse {
  workspaceId: string;
  from: string;
  to: string;
  generatedAt: string;
  settings: BusinessSettingsDto;
  today: BusinessLessonDto[];
  lessons: BusinessLessonDto[];
  reminders: BusinessReminderDto[];
  latestHiddenReminder: BusinessLatestHiddenReminderDto | null;
  creditAlerts: BusinessCreditAlertDto[];
  recentPayments: BusinessPaymentSummaryDto[];
}

export interface BusinessStatsCurrencyExclusionDto {
  currency: string;
  amountMinor: number;
  paymentCount: number;
}

export interface BusinessStatsPipelineItemDto {
  studentId: string;
  studentName: string;
  studentScheduleBillingPath: string;
  remainingCredits: number;
  upcomingChargeableLessons: number;
  severity: 'attention' | 'urgent';
}

export interface BusinessStatsSurfaceResponse {
  workspaceId: string;
  month: string;
  generatedAt: string;
  settings: BusinessSettingsDto;
  currency: string;
  collectedMinor: number;
  earnedMinor: number;
  scheduledGrossMinor: number;
  forecastMinor: number;
  riskAdjustmentMinor: number;
  completedLessons: number;
  taughtMinutes: number;
  scheduledLessons: number;
  scheduledMinutes: number;
  noShowLessons: number;
  canceledLessons: number;
  forecastFrom: string;
  forecastTo: string;
  excludedCurrencies: BusinessStatsCurrencyExclusionDto[];
  pipeline: BusinessStatsPipelineItemDto[];
  risks: BusinessStatsPipelineItemDto[];
}

export interface StudentProfileDto {
  id: string;
  student: string;
  dbId?: string | null;
  pageParentId?: string | null;
  colorPreset?: string | null;
  voices?: Record<string, string>;
  manifestPreset?: string | null;
  accentPreference?: string | null;
  profileId?: string | null;
  archivedAt?: string | null;
  archivedBy?: string | null;
  archiveReason?: string | null;
}

export interface StudentProfileListResponse {
  items: StudentProfileDto[];
  total: number;
  limit: number;
  offset: number;
  order: 'asc' | 'desc';
}

export type ContentSource = 'generate' | 'authentic';
export type StudyTextType = 'monologue' | 'dialogue';
export type SpeakerGender = 'male' | 'female' | 'neutral' | 'child';
export type SpeakerAge =
  | 'child'
  | 'teen'
  | 'young'
  | 'adult'
  | 'middle_aged'
  | 'senior'
  | 'universal';

export interface SpeakerProfile {
  id: string;
  display_name?: string;
  role?: string;
  persona?: string;
  voice_direction?: string;
  gender?: SpeakerGender;
  age?: SpeakerAge;
  accent?: string;
  /** @deprecated Authored profiles should use stable persona text instead. */
  style?: string;
  /** @deprecated Use operator voice routing configuration instead. */
  voice?: string;
  [k: string]: unknown;
}

export interface VoiceSelectionDiagnostics {
  selectionReason: string;
  capabilityMatches?: string[];
  capabilityMismatches?: string[];
}

export type VoiceProviderErrorCategory =
  | 'invalid_voice_id'
  | 'unsupported_voice_capability'
  | 'provider_rate_limit'
  | 'provider_timeout'
  | 'provider_contract_error';

export interface VoiceProviderErrorDetails {
  category: VoiceProviderErrorCategory;
  message: string;
  providerStatus?: number;
  actionableHint?: string;
}

export interface MarkdownValidationVoiceDiagnostics {
  errors?: string[];
  warnings?: string[];
  compatibilityMode?: {
    enabled: boolean;
    reason?: string;
  };
  shadowMode?: {
    enabled: boolean;
    mismatchClasses?: Record<string, number>;
    mismatchTotal?: number;
  };
}

export type MarkdownValidationIssueSeverity = 'error' | 'warning' | 'advisory';
export type MarkdownValidationIssueCategory = 'runtime' | 'contract' | 'quality' | 'voice';

export interface MarkdownValidationIssue {
  code: string;
  ruleId: string;
  severity: MarkdownValidationIssueSeverity;
  message: string;
  line?: number;
  category: MarkdownValidationIssueCategory;
  blockingInStrict: boolean;
}

export interface MarkdownValidationRuleSetInfo {
  id: string;
  version: string;
  requestedId?: string | null;
  requestedVersion?: string | null;
  fallbackApplied?: boolean;
  fallbackReason?: string;
}

export interface MarkdownValidationResponse {
  ok: boolean;
  errors: string[];
  warnings: string[];
  issues?: MarkdownValidationIssue[];
  ruleset?: MarkdownValidationRuleSetInfo;
  voiceDiagnostics?: MarkdownValidationVoiceDiagnostics;
  meta?: {
    title: string;
    student: string;
    level: string;
    topic: string | string[];
    input_type: ContentSource;
    study_text_type?: StudyTextType;
    speaker_labels?: string[];
    speaker_profiles?: SpeakerProfile[];
  };
}

export type JobEventType = 'job_created' | 'job_state_changed';

export interface JobEventPayload {
  manifestPath?: string | null;
  error?: string | null;
  finishedAt?: string | null;
  ttsStrategy?: TtsStrategy | null;
  learningPresetId?: string | null;
  md?: string | null;
  mdStorageUri?: string | null;
  htmlUrl?: string | null;
  publishTarget?: PublishTarget | null;
  recordingId?: string | null;
  transcriptId?: string | null;
}

export interface JobEventMessage {
  type: JobEventType;
  jobId: string;
  state: JobState;
  payload?: JobEventPayload;
}

export type RecordingEventType = 'recording_state_changed';

export interface RecordingEventMessage {
  type: RecordingEventType;
  recordingId: string;
  status: RecordingStatus;
  transcriptId?: string | null;
  error?: string | null;
  studentId?: string | null;
  source?: RecordingSourceId;
  displayName?: string | null;
  durationSec?: number | null;
  channels?: number | null;
  bytes?: number;
  createdAt?: string;
  updatedAt?: string;
}

export type StreamEventMessage = JobEventMessage | RecordingEventMessage;

export interface VersionMetaResponse {
  repoVersion: string;
  contracts: ContractVersionRegistry & {
    dbMigrationHead: string;
  };
}

export * from './contract-versions.js';
export * from './errors.js';
// Job actions exports
export * from './job-actions.js';
export * from './observability.js';
