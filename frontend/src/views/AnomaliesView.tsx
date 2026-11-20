import React from 'react';
import { Info, TrendingUp } from 'lucide-react';
import type { IncidentItem } from '../types/saas';

export const AnomaliesView: React.FC<{ incidents: IncidentItem[]; dataAvailable: boolean; isLoading: boolean }> = ({ incidents, dataAvailable, isLoading }) => {
  const incidentSignals = incidents.flatMap((incident) => incident.contributing_signals.map((signal, index) => ({
    incidentId: incident.incident_id,
    service: incident.service,
    severity: incident.severity,
    signal,
    key: `${incident.incident_id}:${index}`,
  })));
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-surface p-4 text-xs text-text-secondary"><div className="flex items-center gap-2 font-semibold text-text-primary"><Info className="h-4 w-4 text-accent" />Backend detection output</div><p className="mt-1">This view lists persisted contributing signals returned with SaaS incidents. It does not run a second browser-side detector. Signal correlation is not a confirmed root cause.</p></div>
      <section className="rounded-lg border border-border bg-surface shadow-card overflow-hidden"><div className="flex items-center justify-between border-b border-border px-4 py-3"><h2 className="flex items-center gap-2 text-xs font-semibold"><TrendingUp className="h-4 w-4 text-accent" />Persisted anomaly signals</h2><span className="text-[11px] text-text-muted">{isLoading ? 'Refreshing…' : `${incidentSignals.length} signals returned`}</span></div>
        {!incidentSignals.length ? <p className="p-8 text-center text-xs text-text-muted">{dataAvailable ? 'No persisted contributing signals were returned by the SaaS API.' : 'Detection data is unavailable.'}</p> : <div className="divide-y divide-border-subtle">{incidentSignals.map((item) => <article key={item.key} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-xs"><div><p className="font-medium">{item.signal}</p><p className="mt-1 font-mono text-[10px] text-text-muted">{item.service} · {item.incidentId}</p></div><span className="rounded border border-border px-2 py-1 text-[10px] uppercase">{item.severity}</span></article>)}</div>}
      </section>
    </div>
  );
};
