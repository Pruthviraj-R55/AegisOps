/** Typed access to tenant-scoped SaaS endpoints. Tenant scope comes only from auth. */

import { ApiRequestError, historyQuery, incidentEvidenceEndpoint, requestJson } from './http.mjs';
import type {
  CollectorsResponse,
  DashboardOverview,
  HistoryResponse,
  IncidentEvidenceResponse,
  IncidentAnalysisResponse,
  IncidentsResponse,
  ServicesResponse,
} from '../types/saas';

export { ApiRequestError as SaasApiError };

export interface DashboardSessionResponse {
  authenticated: boolean;
  user_id: string;
  csrf_token: string;
}

export class SaasClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly csrfToken: string;

  constructor(baseUrl: string, token = '', csrfToken = '') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token.trim();
    this.csrfToken = csrfToken;
  }

  private request<T>(endpoint: string, signal?: AbortSignal, options: RequestInit = {}): Promise<T> {
    return requestJson<T>(this.baseUrl, endpoint, this.token, { ...options, signal, csrfToken: this.csrfToken });
  }

  async getOverview(signal?: AbortSignal): Promise<DashboardOverview> {
    return this.request('/api/v1/dashboard/overview', signal);
  }

  async getServices(limit = 50, signal?: AbortSignal): Promise<ServicesResponse> {
    return this.request(`/api/v1/services?${new URLSearchParams({ limit: String(limit) })}`, signal);
  }

  async getIncidents(limit = 50, signal?: AbortSignal): Promise<IncidentsResponse> {
    return this.request(`/api/v1/incidents?${new URLSearchParams({ limit: String(limit) })}`, signal);
  }

  async getCollectors(limit = 50, signal?: AbortSignal): Promise<CollectorsResponse> {
    return this.request(`/api/v1/collectors?${new URLSearchParams({ limit: String(limit) })}`, signal);
  }

  async getTelemetry(options: { limit?: number; cursor?: string; startTime?: string; endTime?: string } = {}, signal?: AbortSignal): Promise<HistoryResponse> {
    return this.request(`/api/v1/telemetry?${historyQuery(options)}`, signal);
  }

  async getSecurityEvents(options: { limit?: number; cursor?: string; startTime?: string; endTime?: string } = {}, signal?: AbortSignal): Promise<HistoryResponse> {
    return this.request(`/api/v1/security-events?${historyQuery(options)}`, signal);
  }

  async getIncidentEvidence(incidentId: string, signal?: AbortSignal): Promise<IncidentEvidenceResponse> {
    return this.request(incidentEvidenceEndpoint(incidentId), signal);
  }

  async getIncidentAnalysis(incidentId: string, signal?: AbortSignal): Promise<IncidentAnalysisResponse> {
    return this.request(`/api/v1/incidents/${encodeURIComponent(incidentId)}/analysis`, signal);
  }

  async retryIncidentAnalysis(incidentId: string): Promise<IncidentAnalysisResponse> {
    return this.request(`/api/v1/incidents/${encodeURIComponent(incidentId)}/analysis/retry`, undefined, { method: 'POST' });
  }

  login(email: string, password: string): Promise<DashboardSessionResponse> {
    return requestJson<DashboardSessionResponse>(this.baseUrl, '/api/v1/auth/login', '', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  }

  getSession(): Promise<DashboardSessionResponse> {
    return requestJson<DashboardSessionResponse>(this.baseUrl, '/api/v1/auth/session', '');
  }

  logout(csrfToken: string): Promise<{ logged_out: boolean }> {
    return requestJson<{ logged_out: boolean }>(this.baseUrl, '/api/v1/auth/logout', '', {
      method: 'POST',
      csrfToken,
    });
  }
}
