import axios, { AxiosError, AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

type MaybeString = string | undefined | null;
type AuthRefreshHandler = () => Promise<{ accessToken?: MaybeString }>;

function normalizeBaseUrl(url: MaybeString): string {
  if (!url) return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  return trimmed.replace(/\/+$/, '');
}

function resolveBackendBaseUrl(): string {
  type GlobalWithOverrides = typeof globalThis & {
    __BATCH_BACKEND_URL__?: string;
    process?: { env?: Record<string, unknown> };
  };
  const globalObj: GlobalWithOverrides =
    globalThis.window === undefined
      ? (globalThis as GlobalWithOverrides)
      : (globalThis as GlobalWithOverrides);

  const globalOverride = normalizeBaseUrl(globalObj?.__BATCH_BACKEND_URL__);
  if (globalOverride) return globalOverride;

  const viteEnv = normalizeBaseUrl(
    (import.meta as { env?: Record<string, unknown> }).env?.VITE_BATCH_BACKEND_URL as
      | string
      | undefined,
  );
  if (viteEnv) return viteEnv;

  const nodeEnvSource = typeof globalThis === 'undefined' ? undefined : globalObj.process?.env;
  const nodeEnv = normalizeBaseUrl(nodeEnvSource?.BATCH_BACKEND_URL as MaybeString);
  if (nodeEnv) return nodeEnv;

  return '';
}

export const backendBaseUrl = resolveBackendBaseUrl();

let currentAccessToken: string | null = null;
let authRefreshHandler: AuthRefreshHandler | null = null;

export function setApiAuthToken(token: MaybeString): void {
  currentAccessToken = token ?? null;
}

export function setApiAuthRefreshHandler(handler: AuthRefreshHandler | null): void {
  authRefreshHandler = handler;
}

export function getApiAuthToken(): string | null {
  return currentAccessToken;
}

export function buildBackendUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (!backendBaseUrl) {
    return normalizedPath;
  }

  return `${backendBaseUrl}${normalizedPath}`;
}

export function buildApiProxyPath(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (!backendBaseUrl) {
    return `/api${normalizedPath}`;
  }

  return buildBackendUrl(path);
}

function isRefreshableAuthRequest(
  config: InternalAxiosRequestConfig & { _retry?: boolean },
): boolean {
  const url = config.url ?? '';
  return (
    !config._retry &&
    !url.includes('/auth/login') &&
    !url.includes('/auth/register') &&
    !url.includes('/auth/refresh') &&
    !url.includes('/auth/logout')
  );
}

// Create axios instance with default config
const apiClient: AxiosInstance = axios.create({
  baseURL: backendBaseUrl || undefined,
  timeout: 240_000, // 240 seconds — matches backend GEN_*_REQUEST_TIMEOUT_MS
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add authentication
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
    if (currentAccessToken) {
      config.headers = config.headers ?? {};
      config.headers.Authorization = `Bearer ${currentAccessToken}`;
    }

    return config;
  },
  (error: AxiosError) => {
    return Promise.reject(error);
  },
);

// Response interceptor for error handling and token refresh
apiClient.interceptors.response.use(
  (response: AxiosResponse) => {
    return response;
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // If a protected request hit an expired access token, refresh the session once and replay it.
    if (
      error.response?.status === 401 &&
      originalRequest &&
      isRefreshableAuthRequest(originalRequest)
    ) {
      originalRequest._retry = true;

      try {
        const refreshed = await authRefreshHandler?.();
        if (!refreshed?.accessToken) {
          throw error;
        }
        setApiAuthToken(refreshed.accessToken);
        originalRequest.headers = originalRequest.headers ?? {};
        originalRequest.headers.Authorization = `Bearer ${refreshed.accessToken}`;
        return apiClient(originalRequest);
      } catch (refreshError) {
        console.warn('Token refresh attempt failed inside API client', refreshError);
        // Token refresh failed, reject with original error
        throw error;
      }
    }

    // Log security events for certain error types
    if (error.response?.status === 403) {
      console.warn('Access forbidden - possible security event', {
        url: originalRequest.url,
        method: originalRequest.method,
        status: error.response.status,
      });
    }

    throw error;
  },
);

// Helper function to handle API errors consistently
export function handleApiError(error: AxiosError): string {
  if (error.response) {
    // Server responded with error status
    const data = error.response.data as Record<string, unknown> | string | undefined;
    return (
      (typeof data === 'object' && data
        ? ((data.message as string | undefined) ?? (data.error as string | undefined))
        : undefined) ??
      (typeof data === 'string' ? data : undefined) ??
      `HTTP ${error.response.status}: ${error.response.statusText}`
    );
  } else if (error.request) {
    // Request was made but no response received
    return 'Network error - please check your connection';
  } else {
    // Something else happened
    return error.message || 'An unexpected error occurred';
  }
}

// Helper function to check if error is authentication related
export function isAuthError(error: AxiosError): boolean {
  return error.response?.status === 401 || error.response?.status === 403;
}

// Helper function to check if error is network related
export function isNetworkError(error: AxiosError): boolean {
  return !error.response && !!error.request;
}

export default apiClient;
