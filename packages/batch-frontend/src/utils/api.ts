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
import type {
  JobEventPayload as ContractJobEventPayload,
  JobEventType as ContractJobEventType,
  JobMode as ContractJobMode,
  JobState as ContractJobState,
  JobEventMessage,
  JobStatusDto,
  JobUploadOption,
} from '@esl-pipeline/contracts';
import { isAxiosError, type AxiosError } from 'axios';

import apiClient, {
  buildApiProxyPath,
  getApiAuthToken,
  handleApiError,
  isAuthError,
} from './api-client';

export type JobState = ContractJobState;
export type JobMode = ContractJobMode;
export type UserRole = 'admin' | 'user' | 'viewer';
export type RegisterRole = Exclude<UserRole, 'admin'>;

export type JobStatus = JobStatusDto;
export type JobEventType = ContractJobEventType;
export type JobEventPayload = ContractJobEventPayload;
export type JobEvent = JobEventMessage;

export interface SubmitJobRequest {
  md: string;
  preset?: string;
  withTts?: boolean;
  forceTts?: boolean;
  notionDatabase?: string;
  upload?: JobUploadOption;
  mode?: JobMode;
}

export interface UploadMarkdownResponse {
  id: string;
  md: string;
}

export interface SubmitJobResponse {
  jobId: string;
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
  uploadOptions: JobUploadOption[];
  modes: JobMode[];
}

export interface VoiceOption {
  id: string;
  name: string;
  accent?: string | null;
  gender?: string | null;
  category?: string | null;
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
        throw new Error(axiosError ? handleApiError(axiosError) : formatUnknownError(fallbackError));
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

  eventSource.addEventListener('message', handleMessage);

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
