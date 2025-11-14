/**
 * Typed client for @esl-pipeline/batch-backend.
 *
 * This frontend uses the documented public HTTP API with authentication:
 * - POST /auth/login, /auth/register, /auth/refresh
 * - POST /jobs (authenticated)
 * - GET /jobs/:jobId (authenticated)
 * - POST /uploads (authenticated)
 * - GET /user/profile, /user/files (authenticated)
 *
 * Base URL resolution (in priority order):
 * - window.__BATCH_BACKEND_URL__ (for ad-hoc overrides when bundling)
 * - import.meta.env.VITE_BATCH_BACKEND_URL (Vite dev/prod configuration)
 * - Relative "" (when running behind the same origin / reverse proxy)
 *
 * In dev, vite.config.ts also proxies /api to the backend by default.
 */
import apiClient, { handleApiError, isAuthError } from './api-client';

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed';

export interface SubmitJobRequest {
  md: string;
  preset?: string;
  withTts?: boolean;
  upload?: string;
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
}

// Authentication interfaces
export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  role?: 'user' | 'viewer';
}

export interface AuthResponse {
  user: {
    id: string;
    email: string;
    role: 'admin' | 'user' | 'viewer';
    isActive: boolean;
  };
  accessToken: string;
  refreshToken: string;
}

export interface UserProfile {
  id: string;
  email: string;
  role: 'admin' | 'user' | 'viewer';
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

/**
 * Resolve the base URL to talk to batch-backend.
 */
export function getBatchBackendBaseUrl(): string {
  // Guard against non-browser environments (SSR, tests).
  // We check typeof before touching window first.
  const globalAny: any = typeof window !== 'undefined' ? (window as any) : undefined;
  const globalOverride = globalAny?.__BATCH_BACKEND_URL__ as string | undefined;

  if (globalOverride) {
    return globalOverride;
  }

  // Vite-style env for dev/prod builds.
  const viteEnv = (import.meta as any).env?.VITE_BATCH_BACKEND_URL as string | undefined;
  if (viteEnv) return viteEnv;

  // Default: same-origin (useful when frontend is served via reverse proxy).
  return '';
}

/**
 * Authentication API functions
 */
export async function login(credentials: LoginRequest): Promise<AuthResponse> {
  try {
    const response = await apiClient.post('/auth/login', credentials);
    return response.data;
  } catch (error: any) {
    throw new Error(handleApiError(error));
  }
}

export async function register(userData: RegisterRequest): Promise<{ user: UserProfile }> {
  try {
    const response = await apiClient.post('/auth/register', userData);
    return response.data;
  } catch (error: any) {
    throw new Error(handleApiError(error));
  }
}

export async function refreshToken(refreshToken: string): Promise<AuthResponse> {
  try {
    const response = await apiClient.post('/auth/refresh', { refreshToken });
    return response.data;
  } catch (error: any) {
    throw new Error(handleApiError(error));
  }
}

export async function getUserProfile(): Promise<UserProfile> {
  try {
    const response = await apiClient.get('/auth/me');
    return response.data.user;
  } catch (error: any) {
    throw new Error(handleApiError(error));
  }
}

export async function getUserFiles(): Promise<UserFile[]> {
  try {
    const response = await apiClient.get('/user/files');
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
    const response = await apiClient.post('/jobs', body);
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

    const response = await apiClient.post('/uploads', formData, {
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
    const response = await apiClient.get(`/jobs/${encodeURIComponent(jobId)}/status`);
    return response.data;
  } catch (error: any) {
    if (isAuthError(error)) {
      throw new Error('Authentication required. Please login to view job status.');
    }
    throw new Error(handleApiError(error));
  }
}
