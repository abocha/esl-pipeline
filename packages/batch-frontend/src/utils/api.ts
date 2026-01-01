/**
 * Typed client for @esl-pipeline/batch-backend.
 *
 * This frontend uses the documented public HTTP API with authentication:
 * - POST /auth/login, /auth/register, /auth/refresh
 * - POST /jobs (authenticated)
 * - GET /jobs/:jobId (authenticated)
 * - POST /uploads (authenticated)
 * - POST /recordings/upload (authenticated)
 * - POST /recordings/:id/transcribe (authenticated)
 * - GET /config/job-options for metadata
 * - GET /config/students for student profiles
 * - GET /config/prompts for prompt templates and profiles
 * - GET /jobs/events (SSE) for live updates
 * - GET /user/profile, /user/files (authenticated)
 */
import { type AxiosError, isAxiosError } from 'axios';

import type {
  JobEventPayload as ContractJobEventPayload,
  JobEventType as ContractJobEventType,
  JobState as ContractJobState,
  RecordingStatus as ContractRecordingStatus,
  TtsStrategy as ContractTtsStrategy,
  StreamEventMessage,
  JobStatusDto,
  JobUploadOption,
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
  source: 'scan' | 'upload';
  studentId: string | null;
  durationSec: number | null;
  channels: number | null;
  bytes: number;
  createdAt: string;
  updatedAt: string;
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
}

export interface StudentOptionsResponse {
  students: StudentOption[];
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
  createdAt: string;
  updatedAt: string;
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
  mdPath: string;
}

export interface SubmitJobRequest {
  md?: string | null;
  transcribeWorkdir?: string;
  promptNotes?: string;
  profilePath?: string;
  preset?: string;
  withTts?: boolean;
  forceTts?: boolean;
  notionDatabase?: string;
  upload?: JobUploadOption;
  ttsStrategy?: TtsStrategy;
}

export interface UploadMarkdownResponse {
  id: string;
  md: string;
}

export interface SubmitJobResponse {
  jobId: string;
}

export async function listRecordings(params: {
  status?: RecordingStatus | RecordingStatus[];
  limit?: number;
  offset?: number;
  order?: 'asc' | 'desc';
} = {}): Promise<RecordingsListResponse> {
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

export async function retryRecordingTranscription(
  recordingId: string,
): Promise<RecordingListItem> {
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

export async function approveJob(jobId: string, md: string): Promise<JobStatus> {
  try {
    const response = await apiClient.post(
      buildApiProxyPath(`/jobs/${encodeURIComponent(jobId)}/approve`),
      { md },
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
  refreshToken: string;
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
  presets: string[];
  voiceAccents: string[];
  voices: VoiceOption[];
  notionDatabases: { id: string; name: string }[];
  ttsStrategies: TtsStrategy[];
}

export interface VoiceOption {
  id: string;
  name: string;
  accent?: string | null;
  gender?: string | null;
  category?: string | null;
}

export interface RecordingFolderEntry {
  path: string;
  relativePath: string;
  student: string;
  name: string;
  updatedAt: string;
}

export interface RecordingsIndexResponse {
  root: string;
  exists: boolean;
  items: RecordingFolderEntry[];
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

export async function refreshToken(refreshTokenValue: string): Promise<AuthResponse> {
  try {
    const response = await apiClient.post(buildApiProxyPath('/auth/refresh'), {
      refreshToken: refreshTokenValue,
    });
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
    const response = await apiClient.post(buildApiProxyPath('/jobs'), body);
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
export async function uploadMarkdown(file: File): Promise<UploadMarkdownResponse> {
  try {
    const formData = new FormData();
    formData.append('file', file);

    const response = await apiClient.post(buildApiProxyPath('/uploads'), formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
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
  options?: { studentId?: string },
): Promise<RecordingListItem> {
  try {
    const formData = new FormData();
    formData.append('file', file);

    const response = await apiClient.post(buildApiProxyPath('/recordings/upload'), formData, {
      params: options?.studentId ? { studentId: options.studentId } : undefined,
      headers: {
        'Content-Type': 'multipart/form-data',
      },
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

export async function fetchRecordingsIndex(limit = 200): Promise<RecordingsIndexResponse> {
  try {
    const response = await apiClient.get(buildApiProxyPath('/config/recordings'), {
      params: { limit },
    });
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(error));
  }
}

export async function syncRecordings(): Promise<{ discovered: number }> {
  try {
    const response = await apiClient.post(buildApiProxyPath('/recordings/sync'));
    return response.data;
  } catch (error: unknown) {
    const axiosError = toAxiosError(error);
    if (axiosError && isAuthError(axiosError)) {
      throw new Error('Authentication required. Please login to sync recordings.');
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
  params: { notes?: string; profileId?: string; templateId?: string; profilePath?: string },
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

export async function fetchPromptPackage(
  promptPackageId: string,
): Promise<PromptPackageResponse> {
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

export async function createDraft(
  promptPackageId: string,
  text: string,
): Promise<DraftResponse> {
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
  jobId?: string,
): Promise<MaterializeDraftResponse> {
  try {
    const payload = jobId ? { jobId } : {};
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
