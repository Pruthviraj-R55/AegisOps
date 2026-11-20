import React from 'react';
import { AlertCircle, Radio, Server } from 'lucide-react';
import { CollectorItem } from '../types/saas';

interface CollectorsFleetViewProps {
  collectors: CollectorItem[];
  isLoading: boolean;
}

export const CollectorsFleetView: React.FC<CollectorsFleetViewProps> = ({ collectors, isLoading }) => {
  const getStatusBadge = (status: string) => {
    switch (status.toLowerCase()) {
      case 'online':
        return (
          <span className="inline-flex items-center gap-1.5 rounded border border-health-excellent/40 bg-health-excellent/10 px-2 py-0.5 text-xs font-bold text-health-excellent font-mono">
            <span className="h-1.5 w-1.5 rounded-full bg-health-excellent animate-pulse" />
            ONLINE
          </span>
        );
      case 'stale':
        return (
          <span className="inline-flex items-center gap-1.5 rounded border border-health-fair/40 bg-health-fair/10 px-2 py-0.5 text-xs font-bold text-health-fair font-mono">
            <AlertCircle className="h-3 w-3" />
            STALE (&gt;45s)
          </span>
        );
      case 'offline':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 rounded border border-health-poor/40 bg-health-poor/10 px-2 py-0.5 text-xs font-bold text-health-poor font-mono">
            <AlertCircle className="h-3 w-3" />
            OFFLINE (&gt;60s)
          </span>
        );
    }
  };

  return (
    <div className="space-y-4">
      {/* Informational SLA Card */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-border bg-surface px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-series-cpu/10 text-series-cpu">
            <Server className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-primary">
              Collector Fleet Connection & Freshness Monitor
            </h3>
            <p className="text-[11px] text-text-muted">
              Central SaaS tracks collector heartbeat freshness. Collectors inactive for &gt;45s automatically downgrade service health to <strong className="text-health-poor font-medium">Poor</strong> to enforce the &lt;60s offline detection requirement.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded border border-border bg-canvas px-2 py-1 text-[11px] font-mono text-text-muted">
            {collectors.length} active registered collectors
          </span>
        </div>
      </div>

      {/* Collectors Table */}
      <div className="rounded border border-border bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-canvas/60 text-[11px] font-medium text-text-muted">
              <tr>
                <th className="py-2.5 px-3">Collector ID</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3">Last Seen (UTC)</th>
                <th className="py-2.5 px-3">Last Ingested Payload ID</th>
                <th className="py-2.5 px-3 text-right">Pending Queue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {collectors.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-xs text-text-muted font-mono">
                    {isLoading ? 'Querying collector fleet status...' : 'No collectors active for this tenant context.'}
                  </td>
                </tr>
              ) : (
                collectors.map((c) => (
                  <tr key={c.collector_id} className="hover:bg-surface-hover/50 text-text-primary transition-colors">
                    <td className="py-3 px-3 font-semibold font-mono text-series-cpu">
                      <div className="flex items-center gap-2">
                        <Radio className="h-3.5 w-3.5 text-text-muted" />
                        <span>{c.collector_id}</span>
                      </div>
                    </td>
                    <td className="py-3 px-3">{getStatusBadge(c.status)}</td>
                    <td className="py-3 px-3 font-mono text-[11px] text-text-muted tabular-nums">
                      {c.last_seen_at ? c.last_seen_at.slice(0, 19).replace('T', ' ') + ' UTC' : '--'}
                    </td>
                    <td className="py-3 px-3 font-mono text-[11px] text-text-dim">
                      {c.last_payload_id || 'None'}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums text-text-primary">
                      {c.pending_count}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
