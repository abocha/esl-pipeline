/**
 * Typed client for @esl-pipeline/batch-backend.
 *
 * This frontend uses the documented public HTTP API with authentication:
 * - POST /auth/login, /auth/register, /auth/refresh
 * - POST /jobs (authenticated)
 * - GET /jobs/:jobId (authenticated)
 * - POST /uploads (authenticated)
 * - GET /config/job-options for metadata
 * - GET /jobs/events (SSE) for live updates
 * - GET /user/profile, /user/files (authenticated)
 */
import apiClient, {
  handleApiError,
  isAuthError,
  buildApiProxyPath,
  getApiAuthToken,
} from './api-client';

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed';
export type UserRole = 'admin' | 'user' | 'viewer';
export type RegisterRole = Exclude<UserRole, 'admin'>;

export interface SubmitJobRequest {
  md: string;
  preset?: string;
  withTts?: boolean;
  forceTts?: boolean;
  notionDatabase?: string;
  upload?: 'auto' | 's3' | 'none';
  mode?: 'auto' | 'dialogue' | 'monologue';
}

export interface UploadMarkdownResponse {
  id: string;
  md: string;
}

export interface SubmitJobResponse {
  jobId: string;
}

export interface JobStatus {
  jobId: string;
  state: JobState;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  manifestPath: string | null;
  preset?: string | null;
  voiceId?: string | null;
  voiceAccent?: string | null;
  notionDatabase?: string | null;
  notionUrl?: string | null;
  submittedMd?: string | null;
  runMode?: SubmitJobRequest['mode'];
  upload?: SubmitJobRequest['upload'];
  withTts?: boolean;
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
  notionDatabases: Array<{ id: string; name: string }>;
  uploadOptions: Array<'auto' | 's3' | 'none'>;
  modes: Array<'auto' | 'dialogue' | 'monologue'>;
}

export interface VoiceOption {
  id: string;
  name: string;
  accent?: string | null;
  gender?: string | null;
  category?: string | null;
}

export type JobEventType = 'job_state_changed' | string;

export interface JobEventPayload {
  manifestPath?: string | null;
  error?: string | null;
  finishedAt?: string | null;
  runMode?: SubmitJobRequest['mode'];
  submittedMd?: string | null;
  notionUrl?: string | null;
}

export interface JobStateChangedEvent {
  type: 'job_state_changed';
  jobId: string;
  state: JobState;
  payload?: JobEventPayload;
}

export type JobEvent = JobStateChangedEvent;

export interface JobEventsOptions {
  signal?: AbortSignal;
  onError?: (event: Event) => void;
  onOpen?: (event: Event) => void;
}

/**
 * Authentication API functions
 */
export async function login(credentials: LoginRequest): Promise<AuthResponse> {
  try {
    const response = await apiClient.post(buildApiProxyPath('/auth/login'), credentials);
    return response.data;
  } catch (error: any) {
    throw new Error(handleApiError(error));
  }
}

export async function register(userData: RegisterRequest): Promise<void> {
  const attempt = async (path: string) => {
    const response = await apiClient.post(path, userData);
    return response.data;
  };

  try {
    await attempt(buildApiProxyPath('/auth/register'));
  } catch (error: any) {
    const status = error.response?.status;
    const message = (error.response?.data as any)?.message;
    const isRouteMissing =
      status === 404 && typeof message === 'string' && message.toLowerCase().includes('route post:/auth/register not found');

    if (status === 404 && !error.config?.url?.includes('/auth/register')) {
      try {
        await attempt(buildApiProxyPath('/auth/register'));
        return;
      } catch (fallbackError: any) {
        if (fallbackError.response?.status === 404 || isRouteMissing) {
          throw new Error(
            'Registration endpoint is unavailable. Enable extended API support on the backend or contact an administrator.'
          );
        }
        throw new Error(handleApiError(fallbackError));
      }
    }

    if (status === 404 || isRouteMissing) {
      throw new Error(
        'Registration endpoint is unavailable. Enable extended API support on the backend or contact an administrator.'
      );
    }

    throw new Error(handleApiError(error));
  }
}

export async function refreshToken(refreshTokenValue: string): Promise<AuthResponse> {
  try {
    const response = await apiClient.post(buildApiProxyPath('/auth/refresh'), { refreshToken: refreshTokenValue });
    return response.data;
  } catch (error: any) {
    throw new Error(handleApiError(error));
  }
}

export async function logoutSession(): Promise<void> {
  try {
    await apiClient.post(buildApiProxyPath('/auth/logout'));
  } catch (error: any) {
    if (error.response?.status === 404) {
      return;
    }
    throw new Error(handleApiError(error));
  }
}

export async function getUserProfile(): Promise<UserProfile> {
  try {
    const response = await apiClient.get(buildApiProxyPath('/auth/me'));
    return response.data.user;
  } catch (error: any) {
    throw new Error(handleApiError(error));
  }
}

export async function getUserFiles(): Promise<UserFile[]> {
  try {
    const response = await apiClient.get(buildApiProxyPath('/user/files'));
    return response.data.files || [];
  } catch (error: any) {
    throw new Error(handleApiError(error));
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
  } catch (error: any) {
    if (isAuthError(error)) {
      throw new Error('Authentication required. Please login to submit jobs.');
    }
    throw new Error(handleApiError(error));
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
  } catch (error: any) {
    if (isAuthError(error)) {
      throw new Error('Authentication required. Please login to upload files.');
    }
    throw new Error(handleApiError(error));
  }
}

/**
 * Fetch job status via GET /jobs/:jobId.
 * Now uses authenticated API client.
 */
export async function getJobStatus(jobId: string): Promise<JobStatus> {
  try {
    const response = await apiClient.get(
      buildApiProxyPath(`/jobs/${encodeURIComponent(jobId)}`)
    );
    return response.data;
  } catch (error: any) {
    if (isAuthError(error)) {
      throw new Error('Authentication required. Please login to view job status.');
    }
    throw new Error(handleApiError(error));
  }
}

export async function fetchJobOptions(): Promise<JobOptionsResponse> {
  try {
    const response = await apiClient.get(buildApiProxyPath('/config/job-options'));
    return response.data;
  } catch (error: any) {
    throw new Error(handleApiError(error));
  }
}

export function subscribeToJobEvents(
  onEvent: (event: JobEvent) => void,
  options: JobEventsOptions = {}
): EventSource {
  const url = buildApiProxyPath('/jobs/events');
  const accessToken = getApiAuthToken();
  const tokenizedUrl =
    accessToken && accessToken.length > 0
      ? appendTokenQueryParam(url, accessToken)
      : url;

  const eventSource = new EventSource(tokenizedUrl, { withCredentials: true });

  if (options.onOpen) {
    eventSource.onopen = options.onOpen;
  }

  eventSource.onmessage = event => {
    try {
      const parsed = JSON.parse(event.data) as JobEvent;
      onEvent(parsed);
    } catch (parseError) {
      console.warn('Failed to parse SSE payload', parseError);
    }
  };

  if (options.onError) {
    eventSource.onerror = options.onError;
  }

  if (options.signal) {
    options.signal.addEventListener(
      'abort',
      () => {
        eventSource.close();
      },
      { once: true }
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
