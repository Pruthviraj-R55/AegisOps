import React from 'react';
import { Activity, Cpu, Gauge, MemoryStick } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { meanAvailable } from '../api/telemetry-view.mjs';
import type { ServiceItem } from '../types/saas';
import type { TelemetryDataPoint } from '../types/telemetry';

interface Props { services: ServiceItem[]; selectedService: string | null; onSelectService: (service: string) => void; telemetryHistory: Record<string, TelemetryDataPoint[]>; isLoading: boolean }
const fmt = (value: number | null, unit: string) => value === null ? 'Unavailable' : `${value.toFixed(1)}${unit}`;
const utc = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Invalid timestamp' : `${date.toISOString()} UTC`; };

export const PerformanceView: React.FC<Props> = ({ services, selectedService, onSelectService, telemetryHistory, isLoading }) => {
  const names = Array.from(new Set(services.map((service) => service.service)));
  const service = services.find((item) => item.service === selectedService) || services[0];
  const history = service ? telemetryHistory[service.service] || [] : [];
  const cpu = meanAvailable(services.map((item) => item.metrics.cpu_percent));
  const memory = meanAvailable(services.map((item) => item.metrics.memory_percent));
  const latency = meanAvailable(services.map((item) => item.metrics.latency_ms));
  const cards = [
    { label: 'Reported CPU mean', value: fmt(cpu, '%'), icon: Cpu },
    { label: 'Reported memory mean', value: fmt(memory, '%'), icon: MemoryStick },
    { label: 'Reported latency mean', value: fmt(latency, ' ms'), icon: Gauge },
  ];
  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4"><div><p className="font-mono text-[10px] uppercase tracking-[.2em] text-text-muted">Telemetry / persisted history</p><h2 className="mt-1 text-2xl font-semibold tracking-tight">Performance</h2><p className="mt-1 text-xs text-text-secondary">Measurements are shown only when present in the SaaS event history.</p></div><label className="text-xs text-text-secondary">Service<select aria-label="Service" value={service?.service || ''} onChange={(event) => onSelectService(event.target.value)} className="ml-2 border border-border bg-surface px-3 py-2 font-mono text-xs">{names.map((name) => <option key={name} value={name}>{name}</option>)}</select></label></div>
    <section className="grid gap-3 sm:grid-cols-3">{cards.map(({ label, value, icon: Icon }) => <article key={label} className="border border-border bg-surface p-4"><p className="flex items-center justify-between text-[10px] uppercase tracking-wide text-text-secondary"><span>{label}</span><Icon className="h-4 w-4" /></p><p className="mt-3 font-mono text-2xl font-semibold tabular-nums">{value}</p><p className="mt-2 text-[10px] text-text-muted">Current service summaries returned by the SaaS API</p></article>)}</section>
    <section className="border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-3"><div><h3 className="flex items-center gap-2 text-xs font-semibold"><Activity className="h-4 w-4 text-signal" />Event-time performance history</h3><p className="mt-1 text-[10px] text-text-muted">{service?.service || 'No selected service'} · {history.length} persisted samples</p></div><span className="font-mono text-[10px] text-text-muted">UTC</span></div>
      <div className="h-[300px] pt-4">{!history.length ? <div className="grid h-full place-items-center text-center text-xs text-text-muted">{isLoading ? 'Loading persisted telemetry…' : 'No persisted CPU, memory, or latency history is available for this service.'}</div> : <ResponsiveContainer width="100%" height="100%"><LineChart data={history} margin={{ top: 8, right: 14, bottom: 24, left: 0 }}><CartesianGrid strokeDasharray="2 4" stroke="#D8D5CB" vertical={false} /><XAxis dataKey="displayTime" tick={{ fontSize: 9, fill: '#65665E' }} angle={-18} textAnchor="end" /><YAxis yAxisId="percent" tick={{ fontSize: 10, fill: '#65665E' }} /><YAxis yAxisId="latency" orientation="right" tick={{ fontSize: 10, fill: '#65665E' }} /><Tooltip contentStyle={{ background: '#F8F7F2', borderColor: '#D8D5CB', fontSize: 11 }} /><Legend wrapperStyle={{ fontSize: 10 }} /><Line yAxisId="percent" type="monotone" dataKey="cpu" name="CPU %" stroke="#B83A32" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} /><Line yAxisId="percent" type="monotone" dataKey="memory" name="Memory %" stroke="#20211E" strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} /><Line yAxisId="latency" type="monotone" dataKey="latency" name="Latency ms" stroke="#77786F" strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} /></LineChart></ResponsiveContainer>}</div>
    </section>
    <section className="overflow-x-auto border border-border bg-surface"><table className="w-full text-left text-xs"><thead className="border-b border-border bg-surface-secondary font-mono text-[10px] uppercase tracking-wide text-text-secondary"><tr><th className="px-4 py-3">Service</th><th>Environment</th><th>CPU</th><th>Memory</th><th>Latency</th><th>Health</th><th>Last event</th></tr></thead><tbody className="divide-y divide-border-subtle">{services.map((item) => <tr key={`${item.service}:${item.environment}:${item.region || ''}`}><td className="px-4 py-3 font-semibold">{item.service}</td><td>{item.environment}</td><td className="font-mono">{item.metrics.cpu_percent == null ? 'Unavailable' : `${item.metrics.cpu_percent}%`}</td><td className="font-mono">{item.metrics.memory_percent == null ? 'Unavailable' : `${item.metrics.memory_percent}%`}</td><td className="font-mono">{item.metrics.latency_ms == null ? 'Unavailable' : `${item.metrics.latency_ms} ms`}</td><td>{item.health}{item.stale ? ' · stale' : ''}</td><td className="font-mono text-[10px]">{utc(item.last_event_time)}</td></tr>)}</tbody></table>{services.length === 0 && <p className="p-6 text-center text-xs text-text-muted">{isLoading ? 'Loading services…' : 'No service summaries were returned.'}</p>}</section>
  </div>;
};
