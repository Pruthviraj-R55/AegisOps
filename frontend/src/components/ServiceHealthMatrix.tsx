import React from 'react';
import { AlertCircle, ChevronRight, Search, Shield } from 'lucide-react';
import { ServiceItem } from '../types/saas';

interface ServiceHealthMatrixProps {
  services: ServiceItem[];
  selectedService: string | null;
  onSelectService: (serviceName: string) => void;
  isLoading: boolean;
}

export const ServiceHealthMatrix: React.FC<ServiceHealthMatrixProps> = ({
  services,
  selectedService,
  onSelectService,
  isLoading,
}) => {
  const [searchTerm, setSearchTerm] = React.useState('');

  // Deduplicate services by service name (taking latest record per service)
  const deduplicatedServices = React.useMemo(() => {
    const map = new Map<string, ServiceItem>();
    services.forEach((s) => {
      // If service already seen, keep latest
      if (!map.has(s.service)) {
        map.set(s.service, s);
      } else {
        const existing = map.get(s.service)!;
        if ((s.last_event_time || '') > (existing.last_event_time || '')) {
          map.set(s.service, s);
        }
      }
    });
    return Array.from(map.values());
  }, [services]);

  const filtered = deduplicatedServices.filter(
    (s) =>
      s.service.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.environment.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.region && s.region.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const getHealthBadge = (health: string, stale: boolean) => {
    if (stale) {
      return (
        <span className="inline-flex items-center gap-1 rounded border border-health-poor/40 bg-health-poor/10 px-1.5 py-0.5 text-[10px] font-bold text-health-poor font-mono">
          <AlertCircle className="h-3 w-3" />
          POOR (STALE)
        </span>
      );
    }
    const map: Record<string, { border: string; bg: string; text: string; label: string }> = {
      excellent: { border: 'border-health-excellent/40', bg: 'bg-health-excellent/10', text: 'text-health-excellent', label: 'EXCELLENT' },
      good: { border: 'border-health-good/40', bg: 'bg-health-good/10', text: 'text-health-good', label: 'GOOD' },
      fair: { border: 'border-health-fair/40', bg: 'bg-health-fair/10', text: 'text-health-fair', label: 'FAIR' },
      poor: { border: 'border-health-poor/40', bg: 'bg-health-poor/10', text: 'text-health-poor', label: 'POOR' },
    };
    const s = map[health.toLowerCase()] || map.good;
    return (
      <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-wider font-mono ${s.border} ${s.bg} ${s.text}`}>
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        {s.label}
      </span>
    );
  };

  return (
    <div className="rounded border border-border bg-surface overflow-hidden transition-all hover:border-border-focus">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-elevated/40 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Shield className="h-3.5 w-3.5 text-accent-emerald" />
          <span className="text-xs font-bold uppercase tracking-wider text-text-primary">
            Deduplicated Service Health Matrix
          </span>
          <span className="rounded bg-canvas px-1.5 py-0.5 text-[10px] font-mono text-text-muted border border-border">
            {filtered.length} unique services
          </span>
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted" />
          <input
            type="text"
            placeholder="Search service..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-48 rounded border border-border bg-canvas pl-8 pr-3 py-1 text-xs text-text-primary placeholder:text-text-dim focus:border-border-focus focus:outline-none"
          />
        </div>
      </div>

      {/* Clean Matrix Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-border bg-canvas/60 text-[11px] font-medium text-text-muted">
            <tr>
              <th className="py-2.5 px-3">Service Name</th>
              <th className="py-2.5 px-3">Environment</th>
              <th className="py-2.5 px-3">Region</th>
              <th className="py-2.5 px-3">Operational Status</th>
              <th className="py-2.5 px-3 text-right">Health Score</th>
              <th className="py-2.5 px-3 text-right">CPU</th>
              <th className="py-2.5 px-3 text-right">Memory</th>
              <th className="py-2.5 px-3 text-right">Latency</th>
              <th className="py-2.5 px-3 text-right">Freshness</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-6 text-center text-xs text-text-muted font-mono">
                  {isLoading ? 'Querying service telemetry...' : 'No services match filter criteria.'}
                </td>
              </tr>
            ) : (
              filtered.map((svc) => {
                const isSelected = selectedService === svc.service;
                return (
                  <tr
                    key={svc.service}
                    onClick={() => onSelectService(svc.service)}
                    className={`cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-surface-elevated text-text-primary'
                        : 'hover:bg-surface-hover/50 text-text-primary'
                    }`}
                  >
                    <td className="py-2.5 px-3 font-semibold">
                      <div className="flex items-center gap-1.5">
                        <span className={isSelected ? 'text-accent-emerald font-bold' : ''}>
                          {svc.service}
                        </span>
                        {isSelected && <ChevronRight className="h-3 w-3 text-accent-emerald" />}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-text-muted font-mono">{svc.environment}</td>
                    <td className="py-2.5 px-3 text-text-muted font-mono">{svc.region || 'global'}</td>
                    <td className="py-2.5 px-3">{getHealthBadge(svc.health, svc.stale)}</td>
                    <td className="py-2.5 px-3 text-right font-mono font-bold">
                      <span
                        className={
                          svc.health_score >= 90
                            ? 'text-health-excellent'
                            : svc.health_score >= 70
                            ? 'text-health-good'
                            : svc.health_score >= 40
                            ? 'text-health-fair'
                            : 'text-health-poor'
                        }
                      >
                        {svc.health_score}
                      </span>
                      <span className="text-[10px] text-text-dim">/100</span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {svc.metrics.cpu_percent !== undefined ? `${svc.metrics.cpu_percent.toFixed(1)}%` : '--'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {svc.metrics.memory_percent !== undefined ? `${svc.metrics.memory_percent.toFixed(1)}%` : '--'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-series-latency">
                      {svc.metrics.latency_ms !== undefined ? `${svc.metrics.latency_ms.toFixed(1)}ms` : '--'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-[11px] text-text-muted tabular-nums">
                      {svc.last_event_time ? svc.last_event_time.slice(11, 19) + ' UTC' : '--'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
