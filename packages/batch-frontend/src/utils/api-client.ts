import axios, { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';

type MaybeString = string | undefined | null;

function normalizeBaseUrl(url: MaybeString): string {
  if (!url) return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  return trimmed.replace(/\/+$/, '');
}

function resolveBackendBaseUrl(): string {
  const globalAny: any = typeof window !== 'undefined' ? window : undefined;
  const globalOverride = normalizeBaseUrl(globalAny?.__BATCH_BACKEND_URL__);
  if (globalOverride) return globalOverride;

  const viteEnv = normalizeBaseUrl((import.meta as any)?.env?.VITE_BATCH_BACKEND_URL);
  if (viteEnv) return viteEnv;

  const nodeEnvSource =
    typeof globalThis !== 'undefined' ? (globalThis as any)?.process?.env : undefined;
  const nodeEnv = normalizeBaseUrl(nodeEnvSource?.BATCH_BACKEND_URL as MaybeString);
  if (nodeEnv) return nodeEnv;

  return '';
}

export const backendBaseUrl = resolveBackendBaseUrl();

let currentAccessToken: string | null = null;

export function setApiAuthToken(token: MaybeString): void {
  currentAccessToken = token ? token : null;
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

// Create axios instance with default config
const apiClient: AxiosInstance = axios.create({
  baseURL: backendBaseUrl || undefined,
  timeout: 30000, // 30 seconds
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
  }
);

// Response interceptor for error handling and token refresh
apiClient.interceptors.response.use(
  (response: AxiosResponse) => {
    return response;
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // If 401 error and we haven't retried yet, try to refresh tokens
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        // Try to refresh tokens
        // Note: This would need access to auth context, but interceptors run outside React
        // Instead, we'll let the component handle token refresh on 401 errors
        // The AuthContext will handle automatic redirects

        // For now, just reject and let the component handle it
        return Promise.reject(error);
      } catch (refreshError) {
        console.warn('Token refresh attempt failed inside API client', refreshError);
        // Token refresh failed, reject with original error
        return Promise.reject(error);
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

    return Promise.reject(error);
  }
);

// Helper function to handle API errors consistently
export function handleApiError(error: AxiosError): string {
  if (error.response) {
    // Server responded with error status
    const data = error.response.data as any;
    return (
      data?.message || data?.error || `HTTP ${error.response.status}: ${error.response.statusText}`
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
