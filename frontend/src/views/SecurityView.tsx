import React from 'react';
import { AlertTriangle, Shield } from 'lucide-react';
import type { HistoryResponse } from '../types/saas';

interface SecurityViewProps {
  history: HistoryResponse | null;
  isLoading: boolean;
  onLoadMore: () => void;
}

function utc(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Invalid timestamp' : `${date.toLocaleString(undefined, { timeZone: 'UTC', hour12: false })} UTC`;
}

export const SecurityView: React.FC<SecurityViewProps> = ({ history, isLoading, onLoadMore }) => {
  const records = history?.items || [];
  const sumReported = (key: 'failed_login_count' | 'suspicious_activity_count') => {
    const reported = records.map((event) => event.security?.[key]).filter((value): value is number => typeof value === 'number');
    return reported.length ? reported.reduce((sum, value) => sum + value, 0) : null;
  };
  const failedLogins = sumReported('failed_login_count');
  const suspiciousActivity = sumReported('suspicious_activity_count');

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-surface p-4 text-xs text-text-secondary">
        <div className="mb-1 flex items-center gap-2 font-semibold text-text-primary"><Shield className="h-4 w-4 text-accent" />Persisted security telemetry</div>
        <p>These records contain only the security counters returned by the SaaS schema. The page does not show raw events or infer authentication attempts that were not recorded.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-lg border border-border bg-surface p-4"><span className="text-xs text-text-muted">Failed logins summed from reported counters</span><div className="mt-2 text-2xl font-mono font-bold">{failedLogins ?? 'Unavailable'}</div></div>
        <div className="rounded-lg border border-border bg-surface p-4"><span className="text-xs text-text-muted">Suspicious activity summed from reported counters</span><div className="mt-2 text-2xl font-mono font-bold">{suspiciousActivity ?? 'Unavailable'}</div></div>
        <div className="rounded-lg border border-border bg-surface p-4"><span className="text-xs text-text-muted">Security records loaded</span><div className="mt-2 text-2xl font-mono font-bold">{history ? records.length : 'Unavailable'}</div></div>
      </div>
      <section className="rounded-lg border border-border bg-surface shadow-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-3"><h2 className="flex items-center gap-2 text-xs font-semibold"><AlertTriangle className="h-4 w-4 text-accent" />Security event records</h2><span className="text-[11px] text-text-muted">Ordered by event time</span></div>
        {isLoading && <p className="px-4 py-2 text-xs text-text-muted">Loading security records…</p>}
        {!records.length ? <p className="p-8 text-center text-xs text-text-muted">{history ? 'No security records were returned.' : 'Security data is unavailable until the SaaS API responds.'}</p> : <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="border-b border-border text-[11px] text-text-muted"><tr><th className="px-4 py-2">Event time (UTC)</th><th>Service / environment</th><th>Collector</th><th>Failed logins</th><th>Suspicious activity</th><th>Health</th></tr></thead><tbody className="divide-y divide-border-subtle">{records.map((event) => <tr key={event.payload_id}><td className="whitespace-nowrap px-4 py-2 font-mono">{utc(event.event_time)}</td><td>{event.service} / {event.environment}</td><td className="font-mono">{event.collector_id}</td><td>{event.security?.failed_login_count ?? 'Not reported'}</td><td>{event.security?.suspicious_activity_count ?? 'Not reported'}</td><td className="capitalize">{event.health}</td></tr>)}</tbody></table></div>}
        {history?.has_more && <div className="flex justify-end border-t border-border p-3"><button disabled={isLoading} onClick={onLoadMore} className="rounded border border-border px-3 py-1.5 text-xs disabled:opacity-50">Load more records</button></div>}
      </section>
    </div>
  );
};
