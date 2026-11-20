import React from 'react';
import { Activity, ArrowDownUp, Info, Network, Radio, Wifi } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { StatusBadge } from '../components/StatusBadge';
import type { ServiceItem } from '../types/saas';
import type { TelemetryDataPoint } from '../types/telemetry';
import { meanAvailable } from '../api/telemetry-view.mjs';

interface NetworkViewProps {
  services: ServiceItem[];
  selectedService: string | null;
  onSelectService: (serviceName: string) => void;
  telemetryHistory: Record<string, TelemetryDataPoint[]>;
  isLoading: boolean;
}

const values = (services: ServiceItem[], key: 'latency_ms' | 'packet_loss_percent' | 'bandwidth_mbps') =>
  services.map((service) => service.metrics[key]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

export const NetworkView: React.FC<NetworkViewProps> = ({ services, selectedService, onSelectService, telemetryHistory, isLoading }) => {
  const latencies = values(services, 'latency_ms');
  const losses = values(services, 'packet_loss_percent');
  const bandwidth = values(services, 'bandwidth_mbps');
  const serviceNames = Array.from(new Set(services.map((service) => service.service)));
  const currentService = selectedService || serviceNames[0] || '';
  const history = telemetryHistory[currentService] || [];
  const staleCount = services.length ? services.filter((service) => service.stale).length : null;
  const format = (value: number | undefined | null, suffix = '') => value == null ? 'Unavailable' : `${value.toFixed(1)}${suffix}`;
  const timestamp = (value: string) => `${new Date(value).toLocaleString(undefined, { timeZone: 'UTC', hour12: false })} UTC`;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={<Wifi className="h-4 w-4" />} label="Mean reported latency" value={format(meanAvailable(latencies), ' ms')} detail={`${latencies.length} service records reported this metric`} />
        <MetricCard icon={<Activity className="h-4 w-4" />} label="Maximum reported packet loss" value={losses.length ? format(Math.max(...losses), '%') : 'Unavailable'} detail={`${losses.length} service records reported this metric`} />
        <MetricCard icon={<ArrowDownUp className="h-4 w-4" />} label="Mean reported bandwidth" value={format(meanAvailable(bandwidth), ' Mbps')} detail={`${bandwidth.length} service records reported this metric`} />
        <MetricCard icon={<Radio className="h-4 w-4" />} label="Stale services" value={staleCount === null ? 'Unavailable' : String(staleCount)} detail="Calculated from SaaS service stale flags" />
      </div>

      <section className="rounded-lg border border-border bg-surface p-4 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-3"><div className="flex items-center gap-2"><Network className="h-4 w-4 text-accent" /><h2 className="text-xs font-semibold">Persisted network telemetry</h2></div><label className="text-xs text-text-secondary">Service<select value={currentService} onChange={(event) => onSelectService(event.target.value)} className="ml-2 rounded border border-border bg-surface px-2 py-1">{serviceNames.map((service) => <option key={service}>{service}</option>)}</select></label></div>
        <div className="h-64 w-full">{!history.length ? <div className="flex h-full items-center justify-center gap-2 text-xs text-text-muted"><Info className="h-4 w-4" />{isLoading ? 'Loading telemetry…' : 'No persisted telemetry is available for this service.'}</div> : <ResponsiveContainer width="100%" height="100%"><LineChart data={history} margin={{ top: 8, right: 16, left: 0, bottom: 22 }}><CartesianGrid strokeDasharray="3 3" stroke="#D8D5CB" vertical={false} /><XAxis dataKey="displayTime" tick={{ fontSize: 9 }} angle={-18} textAnchor="end" /><YAxis yAxisId="left" tick={{ fontSize: 10 }} /><YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10 }} /><Tooltip /><Legend /><Line yAxisId="left" type="monotone" dataKey="latency" name="Latency (ms)" stroke="#B83A32" dot={false} connectNulls={false} isAnimationActive={false} /><Line yAxisId="right" type="monotone" dataKey="packetLoss" name="Packet loss (%)" stroke="#B83A32" dot={false} connectNulls={false} isAnimationActive={false} /></LineChart></ResponsiveContainer>}</div>
        <p className="text-[11px] text-text-muted">Chart points come from persisted event-time records. Missing measurements are left blank; no SLA thresholds are applied.</p>
      </section>

      <section className="rounded-lg border border-border bg-surface shadow-card overflow-hidden"><div className="border-b border-border px-4 py-3 text-xs font-semibold">Service network metrics returned by SaaS</div>{!services.length ? <p className="p-6 text-center text-xs text-text-muted">No service metrics are available.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="border-b border-border text-[11px] text-text-muted"><tr><th className="px-4 py-2">Service</th><th>Environment</th><th>Region</th><th>Health</th><th>Latency</th><th>Packet loss</th><th>Bandwidth</th><th>Last event (UTC)</th></tr></thead><tbody className="divide-y divide-border-subtle">{services.map((service) => <tr key={`${service.service}:${service.environment}:${service.region || ''}`}><td className="px-4 py-2">{service.service}</td><td>{service.environment}</td><td>{service.region || 'Unavailable'}</td><td><StatusBadge status={service.health} isStale={service.stale} /></td><td>{format(service.metrics.latency_ms, ' ms')}</td><td>{format(service.metrics.packet_loss_percent, '%')}</td><td>{format(service.metrics.bandwidth_mbps, ' Mbps')}</td><td>{timestamp(service.last_event_time)}</td></tr>)}</tbody></table></div>}</section>
    </div>
  );
};

const MetricCard: React.FC<{ icon: React.ReactNode; label: string; value: string; detail: string }> = ({ icon, label, value, detail }) => (
  <div className="rounded-lg border border-border bg-surface p-4 shadow-card"><div className="mb-2 flex items-center justify-between text-xs text-text-muted"><span>{label}</span>{icon}</div><div className="text-xl font-mono font-bold">{value}</div><p className="mt-2 border-t border-border-subtle pt-2 text-[10px] text-text-secondary">{detail}</p></div>
);
