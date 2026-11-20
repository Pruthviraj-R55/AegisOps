/**
 * Typed client for SaaS API (saas/api/main.py & saas/api/routes/dashboard.py)
 */

import {
  CollectorsResponse,
  DashboardOverview,
  IncidentsResponse,
  ProblemDetail,
  ServicesResponse,
} from '../types/saas';

export class SaasApiError extends Error {
  status: number;
  code: string;
  detail: string;
  requestId?: string;

  constructor(status: number, problem: Partial<ProblemDetail>) {
    super(problem.detail || `SaaS API Error ${status}`);
    this.name = 'SaasApiError';
    this.status = status;
    this.code = problem.code || 'unknown_error';
    this.detail = problem.detail || 'An unexpected error occurred.';
    this.requestId = problem.request_id;
  }
}

export class SaasClient {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token.trim();
  }

  setToken(token: string) {
    this.token = token.trim();
  }

  setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/+$/, '');
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      let problem: Partial<ProblemDetail> = {};
      try {
        problem = await response.json();
      } catch {
        problem = { detail: await response.text() };
      }
      throw new SaasApiError(response.status, problem);
    }

    return response.json();
  }

  async getHealth(): Promise<{ status: string; version: string }> {
    return this.request<{ status: string; version: string }>('/api/v1/health');
  }

  async getOverview(): Promise<DashboardOverview> {
    return this.request<DashboardOverview>('/api/v1/dashboard/overview');
  }

  async getServices(limit: number = 50, cursor?: string): Promise<ServicesResponse> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.append('cursor', cursor);
    return this.request<ServicesResponse>(`/api/v1/services?${params.toString()}`);
  }

  async getIncidents(limit: number = 50, cursor?: string): Promise<IncidentsResponse> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.append('cursor', cursor);
    return this.request<IncidentsResponse>(`/api/v1/incidents?${params.toString()}`);
  }

  async getCollectors(limit: number = 50, cursor?: string): Promise<CollectorsResponse> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.append('cursor', cursor);
    return this.request<CollectorsResponse>(`/api/v1/collectors?${params.toString()}`);
  }
}
