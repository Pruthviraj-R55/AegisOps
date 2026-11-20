export interface TelemetryDataPoint {
  timestamp: string; // ISO event_time
  displayTime: string; // HH:mm:ss UTC
  cpu: number;
  memory: number;
  disk: number;
  latency: number;
  packetLoss: number;
  failedLogins?: number;
  isBaseline?: boolean;
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
