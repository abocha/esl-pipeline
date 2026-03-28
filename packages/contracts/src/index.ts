import type { ContractVersionRegistry } from './contract-versions.js';

export type JobState = 'queued' | 'running' | 'awaiting_approval' | 'succeeded' | 'failed';

export type TtsStrategy = 'auto' | 'dialogue' | 'tts';
export type TtsStrategyOption = TtsStrategy;
export type TtsProviderId = 'elevenlabs' | 'google';
export type ElevenLabsTtsModelId =
  | 'eleven_v3'
  | 'eleven_multilingual_v2'
  | 'eleven_flash_v2_5'
  | 'eleven_flash_v2';
export type PronunciationChunkTtsProviderId = TtsProviderId | 'edge-tts';
export type SttProviderId = 'deepgram' | 'elevenlabs' | 'google';
export type GoogleTtsModel = 'chirp3_hd' | 'studio' | 'neural2' | 'wavenet';
export type CefrLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

export type JobUploadOption = 'auto' | 's3' | 'none';
export type UploadOption = JobUploadOption;
export type PublishTarget = 'notion' | 'anytype' | 'html';

export type RecordingStatus = 'ingested' | 'queued' | 'transcribing' | 'transcribed' | 'failed';

export interface NotionDatabaseOption {
  id: string;
  name: string;
}

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
  notionDatabases: NotionDatabaseOption[];
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
  notionDatabase?: string;
  publishTarget?: PublishTarget;
  upload?: JobUploadOption;
  ttsStrategy?: TtsStrategy;
  ttsProvider?: TtsProviderId;
  googleTtsModel?: GoogleTtsModel;
  voiceId?: string;
  voiceAccent?: string;
  autoPublish?: boolean;
}

export interface JobConfigOverrides {
  learningPresetId?: string;
  notionDatabase?: string;
  publishTarget?: PublishTarget;
  withTts?: boolean;
  forceTts?: boolean;
  ttsStrategy?: TtsStrategy;
  ttsProvider?: TtsProviderId;
  googleTtsModel?: GoogleTtsModel;
  upload?: JobUploadOption;
  voiceId?: string;
  voiceAccent?: string;
  autoPublish?: boolean;
}

export interface JobStatusDto {
  jobId: string;
  studentId?: string | null;
  studentName?: string | null;
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
  notionDatabase: string | null;
  publishTarget: PublishTarget | null;
  ttsStrategy: TtsStrategy | null;
  ttsProvider?: TtsProviderId | null;
  googleTtsModel?: GoogleTtsModel | null;
  autoPublish: boolean | null;
  notionUrl: string | null;
  anytypeUrl: string | null;
  htmlUrl?: string | null;
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
export type SpeakerRole = 'narrator' | 'teacher' | 'student' | 'system';
export type SpeakerGender = 'male' | 'female' | 'neutral' | 'child';
export type SpeakerAge =
  | 'child'
  | 'teen'
  | 'young'
  | 'adult'
  | 'middle_aged'
  | 'senior'
  | 'universal';

const SPEAKER_ROLE_ALIAS_SETS: Record<SpeakerRole, readonly string[]> = {
  narrator: [
    'narrator',
    'narration',
    'storyteller',
    'presenter',
    'announcer',
    'voiceover',
    'voice over',
    'guide',
    'host',
  ],
  teacher: [
    'teacher',
    'tutor',
    'instructor',
    'professor',
    'lecturer',
    'coach',
    'trainer',
    'mentor',
    'teacher assistant',
    'teaching assistant',
    'interviewer',
    'recruiter',
    'examiner',
    'manager',
    'boss',
    'supervisor',
    'doctor',
    'physician',
    'dentist',
    'nurse',
    'pharmacist',
    'therapist',
    'counselor',
    'consultant',
    'advisor',
    'adviser',
    'receptionist',
    'front desk',
    'concierge',
    'agent',
    'travel agent',
    'officer',
    'police officer',
    'security officer',
    'customs officer',
    'immigration officer',
    'flight attendant',
    'landlord',
    'bank teller',
    'mechanic',
    'technician',
    'it support',
    'customer support',
    'help desk',
    'dispatcher',
  ],
  student: [
    'student',
    'learner',
    'classmate',
    'peer',
    'colleague',
    'coworker',
    'co worker',
    'teammate',
    'friend',
    'partner',
    'spouse',
    'wife',
    'husband',
    'parent',
    'mother',
    'father',
    'child',
    'kid',
    'teen',
    'teenager',
    'son',
    'daughter',
    'sibling',
    'brother',
    'sister',
    'neighbor',
    'roommate',
    'customer',
    'client',
    'patient',
    'guest',
    'tourist',
    'traveler',
    'commuter',
    'passenger',
    'shopper',
    'buyer',
    'caller',
    'visitor',
    'resident',
    'applicant',
    'candidate',
    'interviewee',
    'tenant',
    'employee',
    'staff',
    'cashier',
    'clerk',
    'barista',
    'waiter',
    'waitress',
    'server',
    'salesperson',
    'sales clerk',
    'shop assistant',
    'shopkeeper',
    'vendor',
    'diner',
    'citizen',
  ],
  system: ['system', 'assistant', 'ai', 'bot', 'chatbot'],
};

const SPEAKER_ROLE_ALIAS_LOOKUP: ReadonlyMap<string, SpeakerRole> = (() => {
  const pairs: [string, SpeakerRole][] = [];
  for (const [role, aliases] of Object.entries(SPEAKER_ROLE_ALIAS_SETS) as [
    SpeakerRole,
    readonly string[],
  ][]) {
    for (const alias of aliases) {
      pairs.push([normalizeSpeakerRoleToken(alias), role]);
    }
  }
  return new Map(pairs);
})();

function normalizeSpeakerRoleToken(value: string): string {
  return value.trim().toLowerCase().replaceAll(/[_-]+/g, ' ').replaceAll(/\s+/g, ' ');
}

export function normalizeSpeakerRole(value: unknown): SpeakerRole | undefined {
  if (typeof value !== 'string') return undefined;
  const token = normalizeSpeakerRoleToken(value);
  if (!token) return undefined;
  return SPEAKER_ROLE_ALIAS_LOOKUP.get(token);
}

export interface SpeakerProfile {
  id: string;
  display_name?: string;
  role?: SpeakerRole;
  gender?: SpeakerGender;
  age?: SpeakerAge;
  accent?: string;
  style?: string;
  voice?: string;
  [k: string]: unknown;
}

export interface VoiceCapabilitiesSnapshot {
  generatedAt: string;
  role: SpeakerRole[];
  gender: SpeakerGender[];
  age: SpeakerAge[];
  accent: string[];
  style: string[];
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
  capabilities?: VoiceCapabilitiesSnapshot;
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
  notionUrl?: string | null;
  anytypeUrl?: string | null;
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
  source?: 'upload';
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

// Job actions exports
export * from './job-actions.js';
export * from './contract-versions.js';
export * from './errors.js';
export * from './observability.js';
