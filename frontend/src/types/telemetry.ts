/**
 * Telemetry types for charts, event logs, and UI presentation
 */

export interface TelemetryDataPoint {
  timestamp: string; // ISO event_time (RFC 3339 UTC)
  displayTime: string; // UTC timestamp formatted for the chart
  cpu?: number;
  memory?: number;
  disk?: number;
  latency?: number;
  packetLoss?: number;
  bandwidth?: number;
  failedLogins?: number;
}

export interface SanitizedEventLog {
  id: string;
  event_time: string; // HH:mm:ss UTC
  service: string;
  environment: string;
  health: string;
  score: number;
  cpu_percent?: number;
  latency_ms?: number;
  status: 'normal' | 'anomalous' | 'stale';
  summary: string;
}

export type ActiveNavView =
  | 'overview'
  | 'infrastructure'
  | 'performance'
  | 'network'
  | 'security'
  | 'incidents'
  | 'anomalies'
  | 'collectors'
  | 'egress'
  | 'settings';
