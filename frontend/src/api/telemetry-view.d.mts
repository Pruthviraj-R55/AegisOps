import type { TelemetryRecord } from '../types/saas';
import type { TelemetryDataPoint } from '../types/telemetry';
export function formatUtcTimestamp(value: string): string;
export function toTelemetryHistory(records: TelemetryRecord[]): Record<string, TelemetryDataPoint[]>;
export function meanAvailable(values: Array<number | undefined>): number | null;
export function getDataState(options: { hasData: boolean; loading: boolean; error: boolean; empty?: boolean }): 'stale' | 'unavailable' | 'loading' | 'empty' | 'ready';
