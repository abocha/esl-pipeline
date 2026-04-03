import type {
  JobListResponse,
  JobStatusDto,
  JobSummaryResponse,
  OpsActionListResponse,
  OpsActionRequest,
  OpsActionStatus,
  OpsStatusResponse,
  StudentProfileListResponse,
  StudentSummaryResponse,
} from '@esl-pipeline/contracts';

import type { BotJobListParams, BotJobSummaryParams, BotStudentSummaryParams } from './types.js';

export interface BackendClientOptions {
  baseUrl: string;
  email: string;
  password: string;
  timeoutMs: number;
  sharedSecret?: string;
  fetchImpl?: typeof fetch;
}

interface AuthResponse {
  accessToken: string;
  expiresIn: number;
}

export class BackendClientError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'BackendClientError';
    this.statusCode = statusCode;
  }
}

export class HttpBackendClient {
  private readonly baseUrl: string;
  private readonly email: string;
  private readonly password: string;
  private readonly timeoutMs: number;
  private readonly sharedSecret?: string;
  private readonly fetchImpl: typeof fetch;

  private accessToken: string | null = null;
  private refreshCookie: string | null = null;
  private accessTokenExpiresAt = 0;

  constructor(options: BackendClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.email = options.email;
    this.password = options.password;
    this.timeoutMs = options.timeoutMs;
    this.sharedSecret = options.sharedSecret;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getOpsStatus(): Promise<OpsStatusResponse> {
    return this.requestJson<OpsStatusResponse>('GET', '/ops/status');
  }

  async enqueueOpsAction(payload: OpsActionRequest): Promise<OpsActionStatus> {
    return this.requestJson<OpsActionStatus>('POST', '/ops/actions', payload);
  }

  async getOpsActionStatus(operationId: string): Promise<OpsActionStatus> {
    return this.requestJson<OpsActionStatus>(
      'GET',
      `/ops/actions/${encodeURIComponent(operationId)}`,
    );
  }

  async listOpsActions(limit: number, offset = 0): Promise<OpsActionListResponse> {
    const safeLimit = Number.isInteger(limit) ? Math.max(1, Math.min(20, limit)) : 10;
    const safeOffset = Number.isInteger(offset) ? Math.max(0, offset) : 0;
    const query = new URLSearchParams({
      limit: String(safeLimit),
      offset: String(safeOffset),
    });
    return this.requestJson<OpsActionListResponse>('GET', `/ops/actions?${query.toString()}`);
  }

  async listJobs(params: BotJobListParams = {}): Promise<JobListResponse> {
    const query = new URLSearchParams();
    if (params.states && params.states.length > 0) {
      query.set('state', params.states.join(','));
    }
    if (params.studentId) {
      query.set('studentId', params.studentId);
    }
    if (params.from) {
      query.set('from', params.from);
    }
    if (params.to) {
      query.set('to', params.to);
    }
    if (Number.isInteger(params.limit)) {
      query.set('limit', String(Math.max(1, Math.min(200, params.limit ?? 10))));
    }
    if (Number.isInteger(params.offset)) {
      query.set('offset', String(Math.max(0, params.offset ?? 0)));
    }
    if (params.order === 'asc' || params.order === 'desc') {
      query.set('order', params.order);
    }
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    return this.requestJson<JobListResponse>('GET', `/admin/jobs${suffix}`);
  }

  async getAdminJobSummary(params: BotJobSummaryParams = {}): Promise<JobSummaryResponse> {
    const query = new URLSearchParams();
    if (params.from) {
      query.set('from', params.from);
    }
    if (params.to) {
      query.set('to', params.to);
    }
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    return this.requestJson<JobSummaryResponse>('GET', `/admin/jobs/summary${suffix}`);
  }

  async listStudentSummaries(
    params: BotStudentSummaryParams = {},
  ): Promise<StudentSummaryResponse> {
    const query = new URLSearchParams();
    if (Number.isInteger(params.limit)) {
      query.set('limit', String(Math.max(1, Math.min(100, params.limit ?? 10))));
    }
    if (Number.isInteger(params.offset)) {
      query.set('offset', String(Math.max(0, params.offset ?? 0)));
    }
    if (params.order === 'asc' || params.order === 'desc') {
      query.set('order', params.order);
    }
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    return this.requestJson<StudentSummaryResponse>('GET', `/students/summary${suffix}`);
  }

  async searchStudents(queryRaw: string, limit = 10): Promise<StudentProfileListResponse> {
    const query = new URLSearchParams({
      q: queryRaw,
      limit: String(Math.max(1, Math.min(500, limit))),
      offset: '0',
      order: 'asc',
    });
    return this.requestJson<StudentProfileListResponse>('GET', `/students?${query.toString()}`);
  }

  async getFinishedJobs(limit: number): Promise<JobListResponse> {
    const safeLimit = Number.isInteger(limit) ? Math.max(1, Math.min(50, limit)) : 10;
    return this.listJobs({
      states: ['succeeded'],
      order: 'desc',
      limit: safeLimit,
    });
  }

  async getJob(jobId: string): Promise<JobStatusDto> {
    return this.requestJson<JobStatusDto>('GET', `/jobs/${encodeURIComponent(jobId)}`);
  }

  private async requestJson<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const response = await this.request(method, path, body, true);
    if (!response.ok) {
      const message = await extractErrorMessage(response);
      throw new BackendClientError(message, response.status);
    }
    return (await response.json()) as T;
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    authenticated: boolean,
    retryCount = 0,
  ): Promise<Response> {
    if (authenticated) {
      await this.ensureAuthenticated();
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (authenticated && this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }

    if (this.sharedSecret && path.startsWith('/ops/')) {
      headers['x-ops-bot-secret'] = this.sharedSecret;
    }

    if (path === '/auth/refresh' && this.refreshCookie) {
      headers.Cookie = this.refreshCookie;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      this.captureRefreshCookie(response);

      if (authenticated && response.status === 401 && retryCount < 1) {
        this.accessToken = null;
        this.accessTokenExpiresAt = 0;
        await this.ensureAuthenticated();
        return this.request(method, path, body, authenticated, retryCount + 1);
      }

      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  private captureRefreshCookie(response: Response): void {
    const headerValue = response.headers.get('set-cookie');
    if (!headerValue) return;
    const cookiePair = headerValue.split(';', 1)[0];
    if (!cookiePair || !cookiePair.includes('=')) return;
    this.refreshCookie = cookiePair;
  }

  private async ensureAuthenticated(): Promise<void> {
    const now = Date.now();
    if (this.accessToken && now < this.accessTokenExpiresAt - 5000) {
      return;
    }

    if (this.refreshCookie) {
      const refreshed = await this.refreshAccessToken();
      if (refreshed) return;
    }

    await this.login();
  }

  private async login(): Promise<void> {
    const response = await this.request(
      'POST',
      '/auth/login',
      {
        email: this.email,
        password: this.password,
      },
      false,
    );

    if (!response.ok) {
      const message = await extractErrorMessage(response);
      throw new BackendClientError(`Service-account login failed: ${message}`, response.status);
    }

    const payload = (await response.json()) as AuthResponse;
    this.accessToken = payload.accessToken;
    this.accessTokenExpiresAt = Date.now() + payload.expiresIn * 1000;
  }

  private async refreshAccessToken(): Promise<boolean> {
    if (!this.refreshCookie) return false;

    const response = await this.request('POST', '/auth/refresh', {}, false);
    if (!response.ok) {
      return false;
    }

    const payload = (await response.json()) as AuthResponse;
    this.accessToken = payload.accessToken;
    this.accessTokenExpiresAt = Date.now() + payload.expiresIn * 1000;
    return true;
  }
}

async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const parsed = (await response.json()) as { message?: unknown; error?: unknown };
    if (typeof parsed.message === 'string') return parsed.message;
    if (typeof parsed.error === 'string') return parsed.error;
  } catch {
    // ignore JSON parse errors
  }
  return `${response.status} ${response.statusText}`.trim();
}
