/**
 * Typed client for Tier 1 Local Collector API (collector/api.py)
 * Default URL: http://127.0.0.1:8100
 */

import { CollectorHealth, CollectorQueueStatus, EgressPreview } from '../types/collector';

export class CollectorClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/+$/, '');
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Collector API Error (${response.status}): ${errorText}`);
    }

    if (response.status === 204) {
      return {} as T;
    }

    return response.json();
  }

  async getHealth(): Promise<CollectorHealth> {
    return this.request<CollectorHealth>('/api/v1/collector/health');
  }

  async getQueue(): Promise<CollectorQueueStatus> {
    return this.request<CollectorQueueStatus>('/api/v1/collector/queue');
  }

  async getEgressPreview(payloadId?: string): Promise<EgressPreview> {
    const path = payloadId
      ? `/api/v1/collector/egress-preview?payload_id=${encodeURIComponent(payloadId)}`
      : '/api/v1/collector/egress-preview';
    return this.request<EgressPreview>(path);
  }

  async approveEgress(payloadId: string): Promise<void> {
    await this.request<void>(`/api/v1/collector/egress-preview/${encodeURIComponent(payloadId)}/approve`, {
      method: 'POST',
    });
  }

  async retryFailedPayload(payloadId: string): Promise<{ payload_id: string; status: string }> {
    return this.request<{ payload_id: string; status: string }>(
      `/api/v1/collector/queue/${encodeURIComponent(payloadId)}/retry`,
      { method: 'POST' }
    );
  }

  async sendDevelopmentTelemetry(event: Record<string, any>): Promise<any> {
    return this.request<any>('/api/v1/collector/telemetry', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    });
  }
}
