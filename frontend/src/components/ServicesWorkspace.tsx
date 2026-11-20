import React from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertCircle, ChevronRight, Cpu, Network, Search } from 'lucide-react';
import { ServiceItem } from '../types/saas';

export interface TelemetryDataPoint {
  timestamp: string; // ISO event_time
  displayTime: string; // HH:mm:ss UTC
  cpu: number;
  memory: number;
  disk: number;
  latency: number;
  packetLoss: number;
}

interface ServicesWorkspaceProps {
  services: ServiceItem[];
  selectedService: string | null;
  onSelectService: (serviceName: string) => void;
  telemetryHistory: Record<string, TelemetryDataPoint[]>;
  isLoading: boolean;
}

export const ServicesWorkspace: React.FC<ServicesWorkspaceProps> = ({
  services,
  selectedService,
  onSelectService,
  telemetryHistory,
  isLoading,
}) => {
  const [searchTerm, setSearchTerm] = React.useState('');

  const filteredServices = services.filter((s) =>
    s.service.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.environment.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (s.region && s.region.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const activeService =
    services.find((s) => s.service === selectedService) ||
    services[0] ||
    null;

  const currentHistory = activeService
    ? telemetryHistory[activeService.service] || []
    : [];

  const getHealthBadge = (health: string, stale: boolean) => {
    if (stale) {
      return (
        <span className="inline-flex items-center gap-1 rounded border border-health-poor/40 bg-health-poor/10 px-1.5 py-0.5 text-[10px] font-bold text-health-poor mono-metric">
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
    const s = map[health] || map.good;
    return (
      <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-wider mono-metric ${s.border} ${s.bg} ${s.text}`}>
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
        {s.label}
      </span>
    );
  };

  return (
    <div className="space-y-4">
      {/* Services Table Section */}
      <div className="rounded border border-border bg-surface overflow-hidden">
        {/* Table Header Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-elevated/40 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-text-primary">
              Fleet Services
            </span>
            <span className="rounded bg-canvas px-1.5 py-0.5 text-[10px] font-mono text-text-muted border border-border">
              {filteredServices.length} active
            </span>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted" />
              <input
                type="text"
                placeholder="Filter services or env..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-56 rounded border border-border bg-canvas pl-8 pr-3 py-1 text-xs text-text-primary placeholder:text-text-dim focus:border-border-subtle focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Datadog / Grafana High-Density Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-canvas/60 text-[11px] font-medium text-text-muted">
              <tr>
                <th className="py-2 px-3">Service</th>
                <th className="py-2 px-3">Environment</th>
                <th className="py-2 px-3">Region</th>
                <th className="py-2 px-3">Health Status</th>
                <th className="py-2 px-3 text-right">Score</th>
                <th className="py-2 px-3 text-right">CPU %</th>
                <th className="py-2 px-3 text-right">Memory %</th>
                <th className="py-2 px-3 text-right">Latency</th>
                <th className="py-2 px-3 text-right">Loss %</th>
                <th className="py-2 px-3 text-right">Last Event (UTC)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filteredServices.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-xs text-text-muted">
                    {isLoading ? 'Loading services...' : 'No telemetry services detected for current tenant context.'}
                  </td>
                </tr>
              ) : (
                filteredServices.map((svc) => {
                  const isSelected = activeService?.service === svc.service;
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
                      <td className="py-2.5 px-3 font-medium">
                        <div className="flex items-center gap-1.5">
                          <span className={isSelected ? 'text-series-cpu font-semibold' : ''}>
                            {svc.service}
                          </span>
                          {isSelected && <ChevronRight className="h-3.5 w-3.5 text-series-cpu" />}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-text-muted font-mono">{svc.environment}</td>
                      <td className="py-2.5 px-3 text-text-muted font-mono">{svc.region || 'global'}</td>
                      <td className="py-2.5 px-3">{getHealthBadge(svc.health, svc.stale)}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-medium">
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
                        {svc.metrics.cpu_percent !== undefined ? (
                          <span
                            className={
                              svc.metrics.cpu_percent >= 90
                                ? 'text-health-poor font-bold'
                                : svc.metrics.cpu_percent >= 75
                                ? 'text-health-fair'
                                : 'text-text-primary'
                            }
                          >
                            {svc.metrics.cpu_percent.toFixed(1)}%
                          </span>
                        ) : (
                          '--'
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {svc.metrics.memory_percent !== undefined ? (
                          <span
                            className={
                              svc.metrics.memory_percent >= 90
                                ? 'text-health-poor font-bold'
                                : svc.metrics.memory_percent >= 80
                                ? 'text-health-fair'
                                : 'text-text-primary'
                            }
                          >
                            {svc.metrics.memory_percent.toFixed(1)}%
                          </span>
                        ) : (
                          '--'
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {svc.metrics.latency_ms !== undefined ? (
                          <span
                            className={
                              svc.metrics.latency_ms >= 500
                                ? 'text-health-poor font-bold'
                                : svc.metrics.latency_ms >= 250
                                ? 'text-health-fair'
                                : 'text-text-primary'
                            }
                          >
                            {svc.metrics.latency_ms.toFixed(1)}ms
                          </span>
                        ) : (
                          '--'
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                        {svc.metrics.packet_loss_percent !== undefined ? (
                          <span
                            className={
                              svc.metrics.packet_loss_percent > 1.0
                                ? 'text-health-poor font-bold'
                                : 'text-text-muted'
                            }
                          >
                            {svc.metrics.packet_loss_percent.toFixed(1)}%
                          </span>
                        ) : (
                          '0.0%'
                        )}
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

      {/* Synchronized Recharts Telemetry Workspace */}
      {activeService && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Chart 1: Infrastructure Telemetry (CPU / Memory / Disk) */}
          <div className="rounded border border-border bg-surface p-4">
            <div className="flex items-center justify-between border-b border-border/80 pb-2 mb-3">
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-series-cpu" />
                <span className="text-xs font-bold uppercase tracking-wider text-text-primary">
                  Infrastructure Telemetry: {activeService.service}
                </span>
              </div>
              <div className="flex items-center gap-3 text-[11px] font-mono">
                <span className="flex items-center gap-1 text-series-cpu">
                  <span className="h-2 w-2 rounded-full bg-series-cpu" /> CPU %
                </span>
                <span className="flex items-center gap-1 text-series-memory">
                  <span className="h-2 w-2 rounded-full bg-series-memory" /> Mem %
                </span>
                <span className="flex items-center gap-1 text-series-disk">
                  <span className="h-2 w-2 rounded-full bg-series-disk" /> Disk %
                </span>
              </div>
            </div>

            <div className="h-56 w-full">
              {currentHistory.length === 0 ? (
                <div className="flex h-full items-center justify-center text-xs text-text-muted font-mono">
                  Accumulating live telemetry samples strictly by UTC event_time...
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={currentHistory} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E2532" vertical={false} />
                    <XAxis
                      dataKey="displayTime"
                      stroke="#8B949E"
                      fontSize={10}
                      tickLine={false}
                      fontFamily="JetBrains Mono, monospace"
                    />
                    <YAxis
                      domain={[0, 100]}
                      stroke="#8B949E"
                      fontSize={10}
                      tickLine={false}
                      fontFamily="JetBrains Mono, monospace"
                      unit="%"
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#131720',
                        borderColor: '#222836',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontFamily: 'JetBrains Mono, monospace',
                      }}
                      itemStyle={{ padding: '1px 0' }}
                    />
                    <ReferenceLine y={90} stroke="#F2495C" strokeDasharray="4 4" label={{ value: 'Critical 90%', fill: '#F2495C', fontSize: 9 }} />
                    <ReferenceLine y={75} stroke="#F59E0B" strokeDasharray="4 4" label={{ value: 'Warn 75%', fill: '#F59E0B', fontSize: 9 }} />
                    <Line
                      type="monotone"
                      dataKey="cpu"
                      stroke="#38BDF8"
                      strokeWidth={1.5}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="memory"
                      stroke="#A78BFA"
                      strokeWidth={1.5}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="disk"
                      stroke="#10B981"
                      strokeWidth={1.5}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Chart 2: Network & Security Telemetry (Latency / Packet Loss) */}
          <div className="rounded border border-border bg-surface p-4">
            <div className="flex items-center justify-between border-b border-border/80 pb-2 mb-3">
              <div className="flex items-center gap-2">
                <Network className="h-4 w-4 text-series-latency" />
                <span className="text-xs font-bold uppercase tracking-wider text-text-primary">
                  Network & Security: {activeService.service}
                </span>
              </div>
              <div className="flex items-center gap-3 text-[11px] font-mono">
                <span className="flex items-center gap-1 text-series-latency">
                  <span className="h-2 w-2 rounded-full bg-series-latency" /> Latency ms
                </span>
                <span className="flex items-center gap-1 text-series-packetLoss">
                  <span className="h-2 w-2 rounded-full bg-series-packetLoss" /> Loss %
                </span>
              </div>
            </div>

            <div className="h-56 w-full">
              {currentHistory.length === 0 ? (
                <div className="flex h-full items-center justify-center text-xs text-text-muted font-mono">
                  Accumulating live telemetry samples strictly by UTC event_time...
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={currentHistory} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E2532" vertical={false} />
                    <XAxis
                      dataKey="displayTime"
                      stroke="#8B949E"
                      fontSize={10}
                      tickLine={false}
                      fontFamily="JetBrains Mono, monospace"
                    />
                    <YAxis
                      stroke="#8B949E"
                      fontSize={10}
                      tickLine={false}
                      fontFamily="JetBrains Mono, monospace"
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#131720',
                        borderColor: '#222836',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontFamily: 'JetBrains Mono, monospace',
                      }}
                      itemStyle={{ padding: '1px 0' }}
                    />
                    <ReferenceLine y={500} stroke="#F2495C" strokeDasharray="4 4" label={{ value: 'Critical 500ms', fill: '#F2495C', fontSize: 9 }} />
                    <ReferenceLine y={250} stroke="#F59E0B" strokeDasharray="4 4" label={{ value: 'Warn 250ms', fill: '#F59E0B', fontSize: 9 }} />
                    <Area
                      type="monotone"
                      dataKey="latency"
                      stroke="#F59E0B"
                      fill="#F59E0B"
                      fillOpacity={0.15}
                      strokeWidth={1.5}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="packetLoss"
                      stroke="#F2495C"
                      strokeWidth={1.5}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
