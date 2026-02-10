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
 * - GET /drafts/:id
 * - GET /jobs/events (SSE) for live updates
 * - GET /user/profile, /user/files (authenticated)
 */
import { type AxiosError, type AxiosProgressEvent, isAxiosError } from 'axios';
import { JobActionType } from '@esl-pipeline/contracts';

import type {
  ActionCapability,
  JobConfigOverrides as ContractJobConfigOverrides,
  JobEventPayload as ContractJobEventPayload,
  JobEventType as ContractJobEventType,
  JobListResponse as ContractJobListResponse,
  JobOptionsPayload as ContractJobOptionsPayload,
  JobState as ContractJobState,
  JobSummaryResponse as ContractJobSummaryResponse,
  MarkdownValidationResponse as ContractMarkdownValidationResponse,
  RecordingStatus as ContractRecordingStatus,
  StudentSummaryResponse as ContractStudentSummaryResponse,
  SubmitJobRequest as ContractSubmitJobRequest,
  TtsStrategy as ContractTtsStrategy,
  VoiceOption as ContractVoiceOption,
  JobActionRequest,
  JobStatusDto,
  StreamEventMessage,
} from '@esl-pipeline/contracts';

import apiClient, {
  buildApiProxyPath,
  getApiAuthToken,
  handleApiError,
  isAuthError,
} from './api-client';

export type JobState = ContractJobState;
export type TtsStrategy = ContractTtsStrategy;
export type RecordingStatus = ContractRecordingStatus;
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
export type MarkdownValidationResponse = ContractMarkdownValidationResponse;

export interface RecordingTranscriptResponse {
  recordingId: string;
  transcriptId: string;
  text: string;
  summaryJson: Record<string, unknown> | null;
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

export type StudentProfileInput = Omit<StudentProfile, 'id'>;
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
  currentRevisionId: string | null;
  updatedAt: string | null;
}

export interface ProfileRevisionSummaryResponse {
  id: string;
  profileId: string;
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

export interface ProfileRevisionDetailResponse extends ProfileRevisionSummaryResponse {
  content: string;
}

export interface ProfileRevisionListResponse {
  items: ProfileRevisionSummaryResponse[];
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
  | 'job_action_rerun_audio'
  | 'job_action_rerun_publish'
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
  createdAt: string;
  updatedAt: string;
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
    notionUrl: string | null;
    anytypeUrl: string | null;
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

export interface RerunAudioPayload {
  forceTts?: boolean;
  voiceId?: string;
  voiceAccent?: string;
  ttsStrategy?: 'auto' | 'dialogue' | 'tts';
  dialogueLanguage?: string;
  dialogueStability?: number;
  dialogueSeed?: number;
}

export interface CancelJobPayload {
  reason?: string;
}

export interface RerunPublishPayload {
  upload?: 's3';
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

export async function retryRecordingTranscription(recordingId: string): Promise<RecordingListItem> {
  try {
    const response = await apiClient.post(
      buildApiProxyPath(`/recordings/${encodeURIComponent(recordingId)}/transcribe`),
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

const NOTION_DB_ID_REGEX = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

function normalizeNotionDatabase(value?: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return NOTION_DB_ID_REGEX.test(trimmed) ? trimmed : undefined;
}

function sanitizeJobOverrides(overrides?: JobConfigOverrides): JobConfigOverrides | undefined {
  if (!overrides) return undefined;
  const next: JobConfigOverrides = { ...overrides };
  const normalized = normalizeNotionDatabase(next.notionDatabase);
  if (normalized) {
    next.notionDatabase = normalized;
  } else {
    delete next.notionDatabase;
  }
  return next;
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

export interface JobOptionsResponse {
  presets: ContractJobOptionsPayload['presets'];
  voiceAccents: ContractJobOptionsPayload['voiceAccents'];
  voices: ContractJobOptionsPayload['voices'];
  notionDatabases: ContractJobOptionsPayload['notionDatabases'];
  ttsStrategies: ContractJobOptionsPayload['ttsStrategies'];
  supportedActions?: ActionCapability[];
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
  params: {
    from?: string;
    to?: string;
  } = {},
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
  params: {
    limit?: number;
    offset?: number;
    order?: 'asc' | 'desc';
  } = {},
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
): Promise<MarkdownValidationResponse> {
  try {
    const response = await apiClient.post(buildApiProxyPath('/validation/markdown'), {
      text,
      strict,
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
    const normalizedDb = normalizeNotionDatabase(body.notionDatabase);
    if (normalizedDb) {
      payload.notionDatabase = normalizedDb;
    } else {
      delete payload.notionDatabase;
    }
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
  options?: { studentId?: string; onProgress?: UploadProgressCallback; signal?: AbortSignal },
): Promise<RecordingListItem> {
  try {
    const formData = new FormData();
    formData.append('file', file);

    const response = await apiClient.post(buildApiProxyPath('/recordings/upload'), formData, {
      params: options?.studentId ? { studentId: options.studentId } : undefined,
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

export async function rerunAudioJob(
  jobId: string,
  payload?: RerunAudioPayload,
): Promise<JobActionResponse> {
  return submitJobAction(jobId, {
    type: JobActionType.RERUN_AUDIO,
    payload,
  });
}

export async function rerunPublishJob(
  jobId: string,
  payload?: RerunPublishPayload,
): Promise<JobActionResponse> {
  return submitJobAction(jobId, {
    type: JobActionType.RERUN_PUBLISH,
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
