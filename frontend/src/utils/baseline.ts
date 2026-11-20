import { ServiceItem } from '../types/saas';
import { TelemetryDataPoint } from '../types/telemetry';

/**
 * Ensures a service has at least 8 smooth baseline points before the latest live sample
 * so charts render rich, readable curves immediately during demos while updating live on new telemetry.
 */
export function padBaselineHistory(
  service: ServiceItem,
  existingSamples: TelemetryDataPoint[]
): TelemetryDataPoint[] {
  if (existingSamples.length >= 8) {
    return existingSamples;
  }

  const latestTime = existingSamples.length > 0
    ? new Date(existingSamples[0].timestamp)
    : new Date(service.last_event_time || new Date().toISOString());

  const currentCpu = service.metrics.cpu_percent ?? 32;
  const currentMem = service.metrics.memory_percent ?? 48;
  const currentDisk = service.metrics.disk_percent ?? 40;
  const currentLat = service.metrics.latency_ms ?? 24;
  const currentLoss = service.metrics.packet_loss_percent ?? 0;

  const padded: TelemetryDataPoint[] = [];
  const needed = 8 - existingSamples.length;

  for (let i = needed; i >= 1; i--) {
    const pointTime = new Date(latestTime.getTime() - i * 15000);
    const iso = pointTime.toISOString();
    const timeStr = iso.slice(11, 19);

    // Smooth sinusoidal pseudo-variance around baseline
    const variance = Math.sin(i * 0.8) * 3;
    padded.push({
      timestamp: iso,
      displayTime: timeStr,
      cpu: Math.max(5, Math.min(98, Math.round((currentCpu * 0.85 + variance) * 10) / 10)),
      memory: Math.max(10, Math.min(95, Math.round((currentMem * 0.95 + variance * 0.5) * 10) / 10)),
      disk: Math.round(currentDisk * 10) / 10,
      latency: Math.max(2, Math.round((currentLat * 0.8 + Math.abs(variance) * 2) * 10) / 10),
      packetLoss: Math.max(0, Math.min(10, Math.round(currentLoss * 10) / 10)),
      failedLogins: 0,
      isBaseline: true,
    });
  }

  // Combine with existing real samples and sort strictly by UTC timestamp
  const combined = [...padded, ...existingSamples];
  combined.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return combined;
}
