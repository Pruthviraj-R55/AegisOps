export function formatUtcTimestamp(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Invalid timestamp'
    : `${date.toLocaleString(undefined, { timeZone: 'UTC', hour12: false })} UTC`;
}

export function toTelemetryHistory(records) {
  const grouped = {};
  for (const record of records) {
    const metrics = record.metrics || {};
    const point = {
      timestamp: record.event_time,
      displayTime: formatUtcTimestamp(record.event_time),
      cpu: metrics.cpu_percent,
      memory: metrics.memory_percent,
      disk: metrics.disk_percent,
      latency: metrics.latency_ms,
      packetLoss: metrics.packet_loss_percent,
      bandwidth: metrics.bandwidth_mbps,
      failedLogins: record.security?.failed_login_count,
    };
    (grouped[record.service] ||= []).push(point);
  }
  return grouped;
}

export function meanAvailable(values) {
  const present = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
}

export function getDataState({ hasData, loading, error, empty = false }) {
  if (error) return hasData ? 'stale' : 'unavailable';
  if (loading && !hasData) return 'loading';
  if (empty && !loading) return 'empty';
  return hasData ? 'ready' : 'unavailable';
}
