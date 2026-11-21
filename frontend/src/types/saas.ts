/** Response types for the tenant-scoped SaaS API. */

export type HealthStatus = 'excellent' | 'good' | 'fair' | 'poor';

export interface ServiceMetrics {
  cpu_percent?: number;
  memory_percent?: number;
  disk_percent?: number;
  bandwidth_mbps?: number;
  latency_ms?: number;
  packet_loss_percent?: number;
}

export interface ServiceItem {
  service: string;
  environment: string;
  region: string | null;
  health: HealthStatus;
  health_score: number;
  security_status?: 'available' | 'partial' | 'unavailable';
  last_event_time: string;
  stale: boolean;
  metrics: ServiceMetrics;
}

export interface ServicesResponse { items: ServiceItem[] }

export interface DashboardOverview {
  generated_at: string;
  overall_health: HealthStatus;
  service_counts: Record<HealthStatus, number>;
  active_incident_count: number;
  stale_service_count: number;
}

export type IncidentSeverity = 'critical' | 'high' | 'medium' | 'low';
export type IncidentStatus = 'active' | 'investigating' | 'resolved';

export interface IncidentItem {
  incident_id: string;
  service: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  started_at: string;
  last_seen_at: string;
  contributing_signals: string[];
  confidence: number;
  recommended_action: string;
  rollback_plan: string;
}

export interface IncidentsResponse { items: IncidentItem[] }
export type CollectorStatus = 'online' | 'stale' | 'offline';

export interface CollectorItem {
  collector_id: string;
  status: CollectorStatus;
  last_seen_at: string;
  last_payload_id: string;
  pending_count: number;
}

export interface CollectorsResponse { items: CollectorItem[] }

export interface TelemetryRecord {
  payload_id: string;
  collector_id: string;
  schema_version: string;
  event_time: string;
  ingested_at: string;
  service: string;
  environment: string;
  region: string | null;
  metrics: ServiceMetrics;
  security: SecurityMetrics | null;
  health: HealthStatus;
}

export interface SecurityMetrics {
  failed_login_count?: number;
  suspicious_activity_count?: number;
}

export interface HistoryResponse {
  items: TelemetryRecord[];
  limit: number;
  has_more: boolean;
  next_cursor: string | null;
}

export interface IncidentSignal {
  metric: string;
  observed_value: number;
  baseline: number | null;
  sample_count: number;
  threshold: number | null;
  deviation_score: number;
  method: string;
  severity: string;
  event_time: string;
  description: string;
}

export interface IncidentEvidence {
  payload_id: string;
  event_time: string;
  ingested_at: string;
  service: string;
  collector_id: string;
  environment: string;
  region: string | null;
  metrics: ServiceMetrics;
  security: SecurityMetrics | null;
  signals: IncidentSignal[];
}

export interface IncidentEvidenceResponse { items: IncidentEvidence[] }

export interface AdvisoryHypothesis { hypothesis: string; confidence: number; evidence_ids: string[] }
export interface AdvisoryResult {
  summary: string;
  likely_causes: AdvisoryHypothesis[];
  recommended_steps: string[];
  confidence: number;
  evidence_ids: string[];
  limitations: string[];
  assessment: 'supports' | 'uncertain' | 'disagrees';
}
export interface IncidentAnalysisResponse {
  incident_id: string;
  status: 'not_requested' | 'pending' | 'completed' | 'failed';
  provider?: string;
  model?: string;
  prompt_version?: string;
  prompt_hash?: string;
  evidence_ids?: string[];
  result?: { analysis: AdvisoryResult; fusion: { deterministic_severity: string; ai_assessment: string; disagreement_recorded: boolean; effective_severity: string; authority: 'deterministic'; remediation_authorized: false } } | null;
  safe_error_code?: string | null;
  created_at?: string;
  updated_at?: string;
  completed_at?: string | null;
}

export interface ProblemDetail {
  type?: string;
  title?: string;
  status?: number;
  code?: string;
  detail?: string;
  request_id?: string;
}
