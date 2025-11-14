import axios, { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';

// Create axios instance with default config
const apiClient: AxiosInstance = axios.create({
  baseURL: '/api', // Proxy to backend
  timeout: 30000, // 30 seconds
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add authentication
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
    // Note: Authentication tokens are handled via httpOnly cookies
    // The backend will extract them from cookies automatically
    // No need to manually add Authorization headers

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
