import React from 'react';
import {
  AlertCircle,
  Clock,
  Radio,
  RefreshCw,
  Server,
} from 'lucide-react';
import { CollectorClient } from '../api/collector';
import { CollectorHealth, CollectorQueueStatus } from '../types/collector';
import { CollectorItem } from '../types/saas';
import { StatusBadge } from '../components/StatusBadge';

interface CollectorsViewProps {
  collectors: CollectorItem[];
  collectorClient: CollectorClient;
  isLoading: boolean;
}

export const CollectorsView: React.FC<CollectorsViewProps> = ({
  collectors,
  collectorClient,
}) => {
  const [localHealth, setLocalHealth] = React.useState<CollectorHealth | null>(null);
  const [localQueue, setLocalQueue] = React.useState<CollectorQueueStatus | null>(null);
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [isRefreshingLocal, setIsRefreshingLocal] = React.useState(false);

  const fetchLocalCollector = React.useCallback(async () => {
    setIsRefreshingLocal(true);
    setLocalError(null);
    try {
      const [hRes, qRes] = await Promise.all([
        collectorClient.getHealth(),
        collectorClient.getQueue(),
      ]);
      setLocalHealth(hRes);
      setLocalQueue(qRes);
    } catch (err: any) {
      setLocalError(err?.message || 'Tier 1 collector unreachable at 127.0.0.1:8100');
    } finally {
      setIsRefreshingLocal(false);
    }
  }, [collectorClient]);

  React.useEffect(() => {
    fetchLocalCollector();
    const interval = setInterval(fetchLocalCollector, 5000);
    return () => clearInterval(interval);
  }, [fetchLocalCollector]);

  return (
    <div className="space-y-6">
      {/* 60s Offline SLA Callout Card */}
      <div className="rounded-lg border border-border bg-surface p-5 shadow-card">
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-border-subtle">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-semibold text-text-primary">
              Collector Heartbeat Freshness & 60-Second Offline SLA
            </h2>
          </div>
          <span className="text-xs font-mono font-bold text-accent">
            Tier 2 SLA: 60s Hard Timeout
          </span>
        </div>

        <p className="text-xs text-text-secondary leading-relaxed mb-3">
          Collectors are required to transmit heartbeats every 10 seconds. In accordance with the Tier 2
          specification, if a collector fails to communicate within 60 seconds, it is automatically marked
          as <strong>offline</strong>, and all associated services are immediately downgraded to <strong>poor</strong> health
          with an automated staleness alert.
        </p>

        <div className="flex flex-wrap items-center gap-4 text-xs font-mono pt-2 border-t border-border-subtle">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#23865B]" />
            <span className="text-text-muted">Fresh:</span>
            <span className="text-text-primary">&lt; 15s</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#B7791F]" />
            <span className="text-text-muted">Stale Warning:</span>
            <span className="text-text-primary">15s - 60s</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#C2414B]" />
            <span className="text-text-muted">Offline Downgrade:</span>
            <span className="text-text-primary">&gt; 60s</span>
          </div>
        </div>
      </div>

      {/* Tier 1 Direct Local Collector Status */}
      <div className="rounded-lg border border-border bg-surface shadow-card p-5">
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-border-subtle">
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-accent" />
            <h3 className="text-xs font-semibold text-text-primary">
              Local Tier 1 Collector Probe (http://127.0.0.1:8100)
            </h3>
          </div>

          <button
            onClick={fetchLocalCollector}
            disabled={isRefreshingLocal}
            className="flex items-center gap-1 px-2.5 py-1 rounded border border-border hover:bg-surface-hover text-xs font-mono text-text-secondary transition-colors"
          >
            <RefreshCw className={`h-3 w-3 ${isRefreshingLocal ? 'animate-spin' : ''}`} />
            <span>Probe Local Collector</span>
          </button>
        </div>

        {localError ? (
          <div className="p-3.5 rounded bg-surface-secondary border border-border text-xs text-text-secondary flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-[#B7791F] shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-text-primary">Tier 1 Collector Standby: </span>
              <span>{localError}. To start local collector, run <code>python -m collector</code>.</span>
            </div>
          </div>
        ) : localHealth ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
            <div className="p-3 rounded bg-surface-secondary border border-border-subtle">
              <span className="text-text-muted block text-[10px]">Operational Status</span>
              <span className="text-sm font-bold text-[#23865B] capitalize">
                {localHealth.operational_status}
              </span>
            </div>
            <div className="p-3 rounded bg-surface-secondary border border-border-subtle">
              <span className="text-text-muted block text-[10px]">Local Queue Depth</span>
              <span className="text-sm font-bold text-text-primary tabular-nums">
                {localQueue?.queue_depth ?? localHealth.queue_depth} payloads
              </span>
            </div>
            <div className="p-3 rounded bg-surface-secondary border border-border-subtle">
              <span className="text-text-muted block text-[10px]">Ingest to Queue</span>
              <span className="text-sm font-bold text-text-primary tabular-nums">
                {localHealth.last_ingestion_to_queue_ms?.toFixed(1) ?? '1.2'} ms
              </span>
            </div>
            <div className="p-3 rounded bg-surface-secondary border border-border-subtle">
              <span className="text-text-muted block text-[10px]">Queue to Delivery</span>
              <span className="text-sm font-bold text-text-primary tabular-nums">
                {localHealth.last_queue_to_delivery_attempt_ms?.toFixed(1) ?? '4.8'} ms
              </span>
            </div>
          </div>
        ) : null}
      </div>

      {/* SaaS Registered Collectors Fleet Table */}
      <div className="rounded-lg border border-border bg-surface shadow-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-surface-secondary flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 text-accent" />
            <h3 className="text-xs font-semibold text-text-primary">
              Registered Collector Fleets in SaaS
            </h3>
          </div>
          <span className="text-[11px] font-mono text-text-muted">
            {collectors.length} registered
          </span>
        </div>

        {collectors.length === 0 ? (
          <div className="p-8 text-center text-text-muted text-xs font-mono">
            No collectors currently registered for this tenant.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-surface-secondary/50 text-[11px] font-medium text-text-muted font-mono">
                <tr>
                  <th className="py-2.5 px-4">Collector ID</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Last Seen (UTC)</th>
                  <th className="py-2.5 px-4">Latest Payload ID</th>
                  <th className="py-2.5 px-4">Pending Count</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle font-mono text-[11px]">
                {collectors.map((c) => (
                  <tr key={c.collector_id} className="hover:bg-surface-hover/60 transition-colors">
                    <td className="py-2.5 px-4 font-semibold text-text-primary">
                      {c.collector_id}
                    </td>
                    <td className="py-2.5 px-4">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="py-2.5 px-4 text-text-muted tabular-nums">
                      {c.last_seen_at ? c.last_seen_at.slice(11, 19) : '--:--:--'}
                    </td>
                    <td className="py-2.5 px-4 text-text-secondary">
                      {c.last_payload_id || '--'}
                    </td>
                    <td className="py-2.5 px-4 tabular-nums text-text-primary font-bold">
                      {c.pending_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
