import React from 'react';
import { AlertTriangle, Network, Server, ShieldCheck } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { StatusBadge } from '../components/StatusBadge';
import type { CollectorItem, DashboardOverview, HistoryResponse, IncidentItem, ServiceItem } from '../types/saas';
import type { TelemetryDataPoint } from '../types/telemetry';

interface OverviewViewProps {
  overview: DashboardOverview | null;
  services: ServiceItem[];
  servicesAvailable: boolean;
  incidents: IncidentItem[];
  incidentsAvailable: boolean;
  collectors: CollectorItem[];
  collectorsAvailable: boolean;
  telemetry: HistoryResponse | null;
  securityEvents: HistoryResponse | null;
  telemetryHistory: Record<string, TelemetryDataPoint[]>;
  selectedService: string | null;
  onSelectService: (service: string) => void;
  onNavigateToIncidents: () => void;
  onLoadTelemetry: (cursor?: string, startTime?: string, endTime?: string) => Promise<void>;
  telemetryLoading: boolean;
  timeFilter: { startTime: string; endTime: string };
  isStale: boolean;
  dataAvailable: boolean;
}

function localInput(value: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function toUtcQuery(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  overview, services, servicesAvailable, incidents, incidentsAvailable, collectors, collectorsAvailable, telemetry, securityEvents, telemetryHistory, selectedService,
  onSelectService, onNavigateToIncidents, onLoadTelemetry, telemetryLoading,
  timeFilter, isStale, dataAvailable,
}) => {
  const [startInput, setStartInput] = React.useState(localInput(timeFilter.startTime));
  const [endInput, setEndInput] = React.useState(localInput(timeFilter.endTime));
  React.useEffect(() => {
    setStartInput(localInput(timeFilter.startTime));
    setEndInput(localInput(timeFilter.endTime));
  }, [timeFilter.startTime, timeFilter.endTime]);

  const currentService = selectedService || services[0]?.service || '';
  const history = telemetryHistory[currentService] || [];
  const shownIncidents = incidents.filter((incident) => incident.status !== 'resolved').slice(0, 5);
  const totalServices = overview ? Object.values(overview.service_counts).reduce((sum, count) => sum + count, 0) : 0;
  const activeCollectors = collectorsAvailable ? collectors.filter((collector) => collector.status === 'online').length : null;
  const severityCounts = incidents.filter((incident) => incident.status !== 'resolved').reduce<Record<string, number>>((counts, incident) => {
    counts[incident.severity] = (counts[incident.severity] || 0) + 1;
    return counts;
  }, { critical: 0, high: 0, medium: 0, low: 0 });
  const time = (value?: string) => value ? `${new Date(value).toLocaleString(undefined, { timeZone: 'UTC', hour12: false })} UTC` : 'Unavailable';

  return (
    <div className="space-y-6">
      {isStale && <div className="rounded border border-[#62635D]/30 bg-[#E8E6DE] px-3 py-2 text-xs text-ink">Displayed SaaS data may be stale. Check the refresh status and event timestamps.</div>}
      {!dataAvailable && <div className="rounded border border-border bg-surface px-3 py-2 text-xs text-text-muted">Live overview data is unavailable until an authorized SaaS response is received.</div>}

      <section className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-5 gap-3">
        <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
          <div className="mb-2 flex items-center justify-between text-xs text-text-muted"><span>Fleet health</span><ShieldCheck className="h-4 w-4" /></div>
          <div className="text-2xl font-bold capitalize">{overview ? overview.overall_health : 'Unavailable'}</div>
          <p className="mt-2 border-t border-border-subtle pt-2 text-[11px] text-text-secondary">{overview ? `${totalServices} services · ${overview.stale_service_count} stale` : 'Service totals unavailable'}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
          <div className="mb-2 flex items-center justify-between text-xs text-text-muted"><span>Active collectors</span><Server className="h-4 w-4" /></div>
          <div className="text-2xl font-bold tabular-nums">{activeCollectors ?? 'Unavailable'}</div>
          <p className="mt-2 border-t border-border-subtle pt-2 text-[11px] text-text-secondary">Online status from the tenant-scoped SaaS API</p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
          <div className="mb-2 flex items-center justify-between text-xs text-text-muted"><span>Critical incidents</span><AlertTriangle className="h-4 w-4 text-signal" /></div>
          <div className="text-2xl font-bold tabular-nums">{incidentsAvailable ? severityCounts.critical : 'Unavailable'}</div>
          <p className="mt-2 border-t border-border-subtle pt-2 text-[11px] text-text-secondary">Active and investigating, returned incident records</p>
        </div>
        <button onClick={onNavigateToIncidents} className="rounded-lg border border-border bg-surface p-4 text-left shadow-card hover:bg-surface-hover">
          <div className="mb-2 flex items-center justify-between text-xs text-text-muted"><span>Active incidents</span><AlertTriangle className="h-4 w-4" /></div>
          <div className="text-2xl font-bold tabular-nums">{overview?.active_incident_count ?? 'Unavailable'}</div>
          <p className="mt-2 border-t border-border-subtle pt-2 text-[11px] text-text-secondary">Persisted incidents from SaaS</p>
        </button>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle pb-3">
          <div className="flex items-center gap-2"><Network className="h-4 w-4 text-accent" /><h2 className="text-xs font-semibold">Persisted telemetry history</h2></div>
          <div className="flex flex-wrap items-end gap-2 text-[11px]">
            <label className="grid gap-1 text-text-muted">Start (browser local)<input type="datetime-local" value={startInput} onChange={(event) => setStartInput(event.target.value)} className="rounded border border-border bg-surface px-2 py-1 text-text-primary" /></label>
            <label className="grid gap-1 text-text-muted">End (browser local)<input type="datetime-local" value={endInput} onChange={(event) => setEndInput(event.target.value)} className="rounded border border-border bg-surface px-2 py-1 text-text-primary" /></label>
            <button disabled={telemetryLoading} onClick={() => void onLoadTelemetry(undefined, toUtcQuery(startInput) || '', toUtcQuery(endInput) || '')} className="rounded bg-accent px-3 py-1.5 text-white disabled:opacity-50">Apply range</button>
            <button disabled={telemetryLoading} onClick={() => { setStartInput(''); setEndInput(''); void onLoadTelemetry(undefined, '', ''); }} className="rounded border border-border px-3 py-1.5 text-text-secondary disabled:opacity-50">Clear</button>
          </div>
        </div>
        <p className="py-2 text-[11px] text-text-muted">The browser-local time selected above is converted to UTC before querying. Showing records ordered by event time; missing metric values remain unavailable.</p>
        <div className="flex flex-wrap items-center gap-2 py-2 text-[11px] text-text-secondary">
          <label>Chart service <select value={currentService} onChange={(event) => onSelectService(event.target.value)} className="ml-2 rounded border border-border bg-surface px-2 py-1">
            {services.map((service) => <option key={`${service.service}:${service.environment}:${service.region || ''}`} value={service.service}>{service.service} · {service.environment}</option>)}
          </select></label>
          <span>{telemetry?.items.length ?? 0} records on this page</span>
          {telemetry?.items.length ? <span>Latest event: {time(telemetry.items[0].event_time)}</span> : null}
        </div>
        <div className="h-60 w-full">
          {!history.length ? <div className="flex h-full items-center justify-center text-xs text-text-muted">No telemetry history returned for this service and time range.</div> : (
            <ResponsiveContainer width="100%" height="100%"><LineChart data={history} margin={{ top: 8, right: 16, left: 0, bottom: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#D8D5CB" vertical={false} />
              <XAxis dataKey="displayTime" tick={{ fontSize: 9 }} angle={-18} textAnchor="end" />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip labelFormatter={(label) => label} />
              <Legend />
              <Line type="monotone" dataKey="cpu" name="CPU %" stroke="#B83A32" dot={false} connectNulls={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="memory" name="Memory %" stroke="#20211E" dot={false} connectNulls={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="latency" name="Latency ms" stroke="#77786F" dot={false} connectNulls={false} isAnimationActive={false} />
            </LineChart></ResponsiveContainer>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px]"><thead><tr className="border-y border-border text-text-muted"><th className="py-2 pr-4">Event time (UTC)</th><th className="pr-4">Service / environment</th><th className="pr-4">Health</th><th className="pr-4">CPU %</th><th className="pr-4">Latency ms</th><th>Ingested (UTC)</th></tr></thead>
            <tbody className="divide-y divide-border-subtle">{telemetry?.items.map((record) => <tr key={record.payload_id}><td className="py-2 pr-4 font-mono">{time(record.event_time)}</td><td className="pr-4">{record.service} / {record.environment}</td><td className="pr-4"><StatusBadge status={record.health} /></td><td className="pr-4">{record.metrics.cpu_percent ?? 'Unavailable'}</td><td className="pr-4">{record.metrics.latency_ms ?? 'Unavailable'}</td><td>{time(record.ingested_at)}</td></tr>)}</tbody>
          </table>
        {!telemetry?.items.length && <p className="py-6 text-center text-xs text-text-muted">{telemetry ? 'No persisted telemetry records match this query.' : 'Telemetry history is unavailable.'}</p>}
        </div>
        <div className="mt-3 flex items-center justify-between text-xs"><span className="text-text-muted">{telemetry?.has_more ? 'More records are available.' : 'End of returned history.'}</span><button disabled={!telemetry?.next_cursor || telemetryLoading} onClick={() => void onLoadTelemetry(telemetry?.next_cursor || undefined)} className="rounded border border-border px-3 py-1.5 text-text-secondary disabled:opacity-40">{telemetryLoading ? 'Loading…' : 'Next page'}</button></div>
      </section>

      <section className="rounded-lg border border-border bg-surface shadow-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3"><h2 className="flex items-center gap-2 text-xs font-semibold"><Server className="h-4 w-4 text-accent" />Current service health</h2><span className="text-[11px] text-text-muted">{services.length} returned</span></div>
        {!services.length ? <p className="p-6 text-center text-xs text-text-muted">{servicesAvailable ? 'No service records were returned by the SaaS API.' : 'Service health data is unavailable.'}</p> : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="border-b border-border text-[11px] text-text-muted"><tr><th className="px-4 py-2">Service</th><th>Environment</th><th>Region</th><th>Health</th><th>CPU %</th><th>Last event (UTC)</th></tr></thead><tbody className="divide-y divide-border-subtle">{services.map((service) => <tr key={`${service.service}:${service.environment}:${service.region || ''}`}><td className="px-4 py-2 font-medium">{service.service}</td><td>{service.environment}</td><td>{service.region || 'Unavailable'}</td><td><StatusBadge status={service.health} isStale={service.stale} /></td><td>{service.metrics.cpu_percent ?? 'Unavailable'}</td><td>{time(service.last_event_time)}</td></tr>)}</tbody></table></div>}
      </section>

      <section className="rounded-lg border border-border bg-surface shadow-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-3"><h2 className="text-xs font-semibold">Recent persisted security events</h2><span className="font-mono text-[10px] text-text-muted">{securityEvents ? `${securityEvents.items.length} loaded` : 'Unavailable'}</span></div>
        {!securityEvents?.items.length ? <p className="p-5 text-xs text-text-muted">{securityEvents ? 'No security events were returned for this tenant.' : 'Security event data is unavailable.'}</p> : <div className="divide-y divide-border-subtle">{securityEvents.items.slice(0, 5).map((event) => <div key={event.payload_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs"><div><strong>{event.service}</strong><span className="ml-2 text-text-secondary">{event.environment}</span><p className="mt-1 font-mono text-[10px] text-text-muted">{event.payload_id}</p></div><div className="flex flex-wrap gap-3 font-mono text-[10px]"><span>Failed logins {event.security.failed_login_count ?? 'Not reported'}</span><span>Suspicious activity {event.security.suspicious_activity_count ?? 'Not reported'}</span><span>{time(event.event_time)}</span></div></div>)}</div>}
      </section>

      <section className="rounded-lg border border-border bg-surface shadow-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3"><h2 className="flex items-center gap-2 text-xs font-semibold"><Server className="h-4 w-4 text-accent" />SaaS collector connectivity</h2><span className="text-[11px] text-text-muted">{collectors.length} returned</span></div>
        {!collectors.length ? <p className="p-6 text-center text-xs text-text-muted">{collectorsAvailable ? 'No collector records are available for this tenant.' : 'Collector status is unavailable.'}</p> : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="border-b border-border text-[11px] text-text-muted"><tr><th className="px-4 py-2">Collector</th><th>Status</th><th>Last seen (UTC)</th><th>Last payload</th></tr></thead><tbody className="divide-y divide-border-subtle">{collectors.map((collector) => <tr key={collector.collector_id}><td className="px-4 py-2 font-mono">{collector.collector_id}</td><td className="capitalize">{collector.status}</td><td>{time(collector.last_seen_at)}</td><td className="font-mono">{collector.last_payload_id}</td></tr>)}</tbody></table><p className="px-4 py-2 text-[10px] text-text-muted">Pending queue count is not shown because the current SaaS API does not expose local queue state.</p></div>}
      </section>

      <section className="rounded-lg border border-border bg-surface shadow-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3"><h2 className="flex items-center gap-2 text-xs font-semibold"><AlertTriangle className="h-4 w-4 text-accent" />Persisted incidents</h2><button onClick={onNavigateToIncidents} className="text-xs text-accent">View all</button></div>
        <div className="flex flex-wrap gap-4 border-b border-border px-4 py-2 text-[11px] text-text-secondary"><span>Open severity distribution among returned incidents:</span>{Object.entries(severityCounts).map(([severity, count]) => <span key={severity} className="capitalize">{severity} {incidentsAvailable ? count : 'Unavailable'}</span>)}</div>
        {!shownIncidents.length ? <p className="p-6 text-center text-xs text-text-muted">{incidentsAvailable ? 'No persisted active or investigating incidents were returned.' : 'Incident data is unavailable.'}</p> : <div className="divide-y divide-border-subtle">{shownIncidents.map((incident) => <div key={incident.incident_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs"><div><strong>{incident.service}</strong><span className="ml-2 font-mono text-text-muted">{incident.incident_id}</span><p className="mt-1 text-[11px] text-text-secondary">Correlated evidence; this is not a confirmed root cause.</p></div><div className="flex items-center gap-3"><span className="capitalize">{incident.severity} · {incident.status}</span><span className="text-text-muted">Last seen {time(incident.last_seen_at)}</span></div></div>)}</div>}
      </section>
      <p className="text-[10px] text-text-muted">SaaS response generated at {overview ? time(overview.generated_at) : 'Unavailable'}</p>
    </div>
  );
};
