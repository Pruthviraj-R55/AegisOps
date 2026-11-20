import React from 'react';
import {
  Activity,
  Cpu,
  Info,
  Search,
  Server,
} from 'lucide-react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ServiceItem } from '../types/saas';
import { TelemetryDataPoint } from '../types/telemetry';
import { StatusBadge } from '../components/StatusBadge';

interface InfrastructureViewProps {
  services: ServiceItem[];
  selectedService: string | null;
  onSelectService: (serviceName: string) => void;
  telemetryHistory: Record<string, TelemetryDataPoint[]>;
  isLoading: boolean;
}

export const InfrastructureView: React.FC<InfrastructureViewProps> = ({
  services,
  selectedService,
  onSelectService,
  telemetryHistory,
}) => {
  const [searchTerm, setSearchTerm] = React.useState('');

  // Deduplicate services by service name (taking latest record per service)
  const deduplicatedServices = React.useMemo(() => {
    const map = new Map<string, ServiceItem>();
    services.forEach((s) => {
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

  const filteredServices = deduplicatedServices.filter(
    (s) =>
      s.service.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.environment.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.region && s.region.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const activeServiceObj =
    deduplicatedServices.find((s) => s.service === selectedService) ||
    deduplicatedServices[0] ||
    null;

  const currentHistory = activeServiceObj
    ? telemetryHistory[activeServiceObj.service] || []
    : [];

  const hasHistory = currentHistory.length >= 2;

  return (
    <div className="space-y-6">
      {/* Active Service Stats Strip */}
      {activeServiceObj && (
        <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-4 pb-3 mb-3 border-b border-border-subtle">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-accent" />
              <h2 className="text-sm font-bold text-text-primary">
                {activeServiceObj.service}
              </h2>
              <span className="text-xs font-mono text-text-muted">
                [{activeServiceObj.environment}]
              </span>
              {activeServiceObj.region && (
                <span className="text-xs font-mono text-text-muted">
                  • {activeServiceObj.region}
                </span>
              )}
            </div>

            <div className="flex items-center gap-3">
              <StatusBadge
                status={activeServiceObj.health}
                isStale={activeServiceObj.stale}
              />
              <span className="text-xs font-mono text-text-muted">
                Health Score: <strong className="text-text-primary">{activeServiceObj.health_score}</strong>/100
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
            <div className="p-2.5 rounded bg-surface-secondary border border-border-subtle">
              <span className="text-text-muted block text-[10px]">CPU Utilization</span>
              <span className="text-lg font-bold text-text-primary tabular-nums">
                {activeServiceObj.metrics.cpu_percent?.toFixed(1) ?? '--'}%
              </span>
            </div>
            <div className="p-2.5 rounded bg-surface-secondary border border-border-subtle">
              <span className="text-text-muted block text-[10px]">Memory Allocated</span>
              <span className="text-lg font-bold text-text-primary tabular-nums">
                {activeServiceObj.metrics.memory_percent?.toFixed(1) ?? '--'}%
              </span>
            </div>
            <div className="p-2.5 rounded bg-surface-secondary border border-border-subtle">
              <span className="text-text-muted block text-[10px]">Disk Space Used</span>
              <span className="text-lg font-bold text-text-primary tabular-nums">
                {activeServiceObj.metrics.disk_percent?.toFixed(1) ?? '--'}%
              </span>
            </div>
            <div className="p-2.5 rounded bg-surface-secondary border border-border-subtle">
              <span className="text-text-muted block text-[10px]">Bandwidth</span>
              <span className="text-lg font-bold text-text-primary tabular-nums">
                {activeServiceObj.metrics.bandwidth_mbps?.toFixed(1) ?? '--'} Mbps
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Hardware Utilization Time Series Charts */}
      <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-border-subtle">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-accent" />
            <h3 className="text-xs font-semibold text-text-primary">
              Hardware Resource Utilization History ({activeServiceObj?.service || 'None'})
            </h3>
          </div>
          <span className="text-[11px] font-mono text-text-muted">
            {currentHistory.length} real samples recorded
          </span>
        </div>

        <div className="h-64 w-full">
          {!hasHistory ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-4">
              <Info className="h-6 w-6 text-text-muted mb-2 opacity-60" />
              <p className="text-xs font-medium text-text-secondary">
                Waiting for telemetry history...
              </p>
              <p className="text-[11px] text-text-muted font-mono mt-1">
                Accumulating real-time samples for {activeServiceObj?.service || 'service'} from SaaS API.
              </p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={currentHistory} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EDF2F7" vertical={false} />
                <XAxis
                  dataKey="displayTime"
                  stroke="#8C9BA5"
                  fontSize={10}
                  tickLine={false}
                  fontFamily="JetBrains Mono, monospace"
                />
                <YAxis
                  domain={[0, 100]}
                  stroke="#8C9BA5"
                  fontSize={10}
                  tickLine={false}
                  fontFamily="JetBrains Mono, monospace"
                  unit="%"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#FFFFFF',
                    borderColor: '#E3E8ED',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontFamily: 'JetBrains Mono, monospace',
                  }}
                />
                <Legend wrapperStyle={{ fontSize: '11px', fontFamily: 'JetBrains Mono, monospace' }} />
                <Line
                  type="monotone"
                  dataKey="cpu"
                  name="CPU %"
                  stroke="#147D70"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="memory"
                  name="Memory %"
                  stroke="#3267C8"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="disk"
                  name="Disk %"
                  stroke="#8B6BA8"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Deduplicated Service Health Matrix Table */}
      <div className="rounded-lg border border-border bg-surface shadow-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-border bg-surface-secondary">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-accent" />
            <h3 className="text-xs font-semibold text-text-primary">
              Deduplicated Service Health Matrix
            </h3>
            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-surface border border-border text-text-muted">
              {filteredServices.length} unique services
            </span>
          </div>

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted" />
            <input
              type="text"
              placeholder="Filter services..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-48 rounded border border-border bg-surface pl-8 pr-3 py-1 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-surface-secondary/50 text-[11px] font-medium text-text-muted font-mono">
              <tr>
                <th className="py-2.5 px-4">Service</th>
                <th className="py-2.5 px-4">Environment</th>
                <th className="py-2.5 px-4">Region</th>
                <th className="py-2.5 px-4">Health</th>
                <th className="py-2.5 px-4">Score</th>
                <th className="py-2.5 px-4">CPU %</th>
                <th className="py-2.5 px-4">Memory %</th>
                <th className="py-2.5 px-4">Disk %</th>
                <th className="py-2.5 px-4">Last Seen (UTC)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle font-mono text-[11px]">
              {filteredServices.map((svc) => {
                const isSelected = activeServiceObj?.service === svc.service;
                return (
                  <tr
                    key={svc.service}
                    onClick={() => onSelectService(svc.service)}
                    className={`cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-accent-light/40 font-semibold'
                        : 'hover:bg-surface-hover/60'
                    }`}
                  >
                    <td className="py-2.5 px-4 text-text-primary flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent" />
                      {svc.service}
                    </td>
                    <td className="py-2.5 px-4 text-text-secondary">{svc.environment}</td>
                    <td className="py-2.5 px-4 text-text-muted">{svc.region || 'global'}</td>
                    <td className="py-2.5 px-4">
                      <StatusBadge status={svc.health} isStale={svc.stale} />
                    </td>
                    <td className="py-2.5 px-4 tabular-nums font-bold text-text-primary">
                      {svc.health_score}
                    </td>
                    <td className="py-2.5 px-4 tabular-nums text-text-secondary">
                      {svc.metrics.cpu_percent?.toFixed(1) ?? '--'}%
                    </td>
                    <td className="py-2.5 px-4 tabular-nums text-text-secondary">
                      {svc.metrics.memory_percent?.toFixed(1) ?? '--'}%
                    </td>
                    <td className="py-2.5 px-4 tabular-nums text-text-secondary">
                      {svc.metrics.disk_percent?.toFixed(1) ?? '--'}%
                    </td>
                    <td className="py-2.5 px-4 tabular-nums text-text-muted">
                      {svc.last_event_time ? svc.last_event_time.slice(11, 19) : '--:--:--'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
