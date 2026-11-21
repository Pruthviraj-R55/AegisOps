/**
 * Exact TypeScript schemas matching collector/api.py
 */

export interface CollectorHealth {
  collector_id: string;
  operational_status: 'running' | 'starting' | 'offline' | 'degraded' | 'delivery_unconfigured';
  last_successful_heartbeat: string | null;
  queue_depth: number;
  pending_payload_count: number;
  delivery_status: string;
  last_delivery_success: string | null;
  heartbeat_interval_seconds: number;
  offline_after_seconds: number;
  last_ingestion_to_queue_ms: number | null;
  last_queue_to_delivery_attempt_ms: number | null;
}

export interface CollectorQueueItem {
  payload_id: string;
  state: 'pending' | 'in_flight' | 'acknowledged' | 'failed';
  egress_approved: boolean;
  egress_review_status: 'approved' | 'awaiting_review' | 'rejected' | 'integrity_error';
  attempts: number;
  created_at: string;
  updated_at: string;
  next_attempt_at: number;
  last_error_code: string | null;
  schema_version: string | null;
  event_time: string | null;
  source_category: string;
  metrics: Record<string, number>;
  security_status: 'available' | 'partial' | 'unavailable' | 'unknown';
  payload_integrity_valid: boolean;
}

export interface CollectorQueueStatus {
  queue_depth: number;
  pending_payload_count: number;
  pending_delivery: number;
  in_flight: number;
  failed: number;
  acknowledged: number;
  items: CollectorQueueItem[];
}

export interface EgressPreview {
  available: boolean;
  payload_id?: string;
  validation_status?: string;
  transmission_status: string;
  egress_review_status?: 'approved' | 'awaiting_review' | 'rejected' | 'integrity_error';
  payload_integrity_valid?: boolean;
  schema_version?: string | null;
  capture_timestamp?: string | null;
  source_category?: string;
  metrics?: Record<string, number>;
  security_status?: 'available' | 'partial' | 'unavailable' | 'unknown';
  payload_json?: string | null;
  payload?: {
    schema_version: string;
    payload_id: string;
    tenant_id: string;
    collector_id: string;
    event_time: string;
    service: string;
    environment: string;
    region?: string | null;
    metrics: Record<string, number>;
    security?: Record<string, number> | null;
    health: string;
  } | null;
  excluded_field_count?: number;
  excluded_field_categories?: string[];
  excluded_fields?: string[];
  redacted_fields?: string[];
}
