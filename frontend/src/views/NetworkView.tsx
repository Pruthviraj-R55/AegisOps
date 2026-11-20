import React from 'react';
import {
  Activity,
  ArrowDownUp,
  Info,
  Network,
  Radio,
  Wifi,
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

interface NetworkViewProps {
  services: ServiceItem[];
  selectedService: string | null;
  onSelectService: (serviceName: string) => void;
  telemetryHistory: Record<string, TelemetryDataPoint[]>;
  isLoading: boolean;
}

export const NetworkView: React.FC<NetworkViewProps> = ({
  services,
  selectedService,
  onSelectService,
  telemetryHistory,
}) => {
  const validServices = services.filter((s) => s.metrics);
  const avgLat =
    validServices.length > 0
      ? validServices.reduce((acc, s) => acc + (s.metrics.latency_ms ?? 0), 0) / validServices.length
      : 0;
  const maxLoss =
    validServices.length > 0
      ? Math.max(...validServices.map((s) => s.metrics.packet_loss_percent ?? 0))
      : 0;
  const totalBw =
    validServices.length > 0
      ? validServices.reduce((acc, s) => acc + (s.metrics.bandwidth_mbps ?? 0), 0)
      : 0;
  const staleCount = services.filter((s) => s.stale).length;

  const uniqueServices = Array.from(new Set(services.map((s) => s.service)));
  const currentService = selectedService || uniqueServices[0] || '';
  const currentHistory = currentService ? telemetryHistory[currentService] || [] : [];
  const hasHistory = currentHistory.length >= 2;

  return (
    <div className="space-y-6">
      {/* Network KPIs Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between text-xs font-medium text-text-muted mb-2">
            <span>Avg Network Latency</span>
            <Wifi className="h-4 w-4 text-text-muted" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tracking-tight text-text-primary tabular-nums">
              {avgLat.toFixed(1)}
            </span>
            <span className="text-xs font-mono text-text-muted">ms</span>
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px] text-text-secondary pt-2 border-t border-border-subtle">
            <span>Target SLA: &lt; 50ms</span>
            <span className="text-[#23865B] font-mono font-medium">Within SLA</span>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between text-xs font-medium text-text-muted mb-2">
            <span>Max Packet Loss</span>
            <Activity className="h-4 w-4 text-text-muted" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tracking-tight text-text-primary tabular-nums">
              {maxLoss.toFixed(1)}%
            </span>
            <span className="text-xs font-mono text-text-muted">peak</span>
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px] text-text-secondary pt-2 border-t border-border-subtle">
            <span>Critical threshold: 2.0%</span>
            <span
              className={`font-mono font-medium ${
                maxLoss > 1 ? 'text-[#C2414B]' : 'text-[#23865B]'
              }`}
            >
              {maxLoss > 1 ? 'Degraded' : 'Nominal'}
            </span>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between text-xs font-medium text-text-muted mb-2">
            <span>Total Bandwidth</span>
            <ArrowDownUp className="h-4 w-4 text-text-muted" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tracking-tight text-text-primary tabular-nums">
              {totalBw.toFixed(1)}
            </span>
            <span className="text-xs font-mono text-text-muted">Mbps egress</span>
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px] text-text-secondary pt-2 border-t border-border-subtle">
            <span>Active Interfaces</span>
            <span className="text-text-primary font-mono font-medium">
              {validServices.length} online
            </span>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between text-xs font-medium text-text-muted mb-2">
            <span>Stale Connections</span>
            <Radio className="h-4 w-4 text-text-muted" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tracking-tight text-text-primary tabular-nums">
              {staleCount}
            </span>
            <span className="text-xs font-mono text-text-muted">endpoints</span>
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px] text-text-secondary pt-2 border-t border-border-subtle">
            <span>Offline requirement</span>
            <span className="text-text-muted font-mono">60s threshold</span>
          </div>
        </div>
      </div>

      {/* Latency & Packet Loss Dual Chart */}
      <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-3 border-b border-border-subtle">
          <div className="flex items-center gap-2">
            <Network className="h-4 w-4 text-accent" />
            <h3 className="text-xs font-semibold text-text-primary">
              Network Latency & Packet Loss Telemetry
            </h3>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-text-secondary">Target Service:</label>
            <select
              value={currentService}
              onChange={(e) => onSelectService(e.target.value)}
              className="text-xs font-mono rounded border border-border bg-surface px-2.5 py-1 text-text-primary focus:border-accent focus:outline-none"
            >
              {uniqueServices.map((svc) => (
                <option key={svc} value={svc}>
                  {svc}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="h-64 w-full">
          {!hasHistory ? (
            <div className="flex flex-col items-center justify-center h-full text-center p-4">
              <Info className="h-6 w-6 text-text-muted mb-2 opacity-60" />
              <p className="text-xs font-medium text-text-secondary">
                Waiting for telemetry history...
              </p>
              <p className="text-[11px] text-text-muted font-mono mt-1">
                Accumulating network samples for {currentService || 'service'} from SaaS API.
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
                  yAxisId="left"
                  stroke="#8C9BA5"
                  fontSize={10}
                  tickLine={false}
                  fontFamily="JetBrains Mono, monospace"
                  unit="ms"
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  domain={[0, 10]}
                  stroke="#C2414B"
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
                  yAxisId="left"
                  type="monotone"
                  dataKey="latency"
                  name="Latency (ms)"
                  stroke="#147D70"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="packetLoss"
                  name="Packet Loss %"
                  stroke="#C2414B"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Network Services Table */}
      <div className="rounded-lg border border-border bg-surface shadow-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-surface-secondary flex items-center justify-between">
          <span className="text-xs font-semibold text-text-primary">
            Service Network Endpoints
          </span>
          <span className="text-[11px] font-mono text-text-muted">
            {services.length} endpoints
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-border bg-surface-secondary/50 text-[11px] font-medium text-text-muted font-mono">
              <tr>
                <th className="py-2.5 px-4">Service</th>
                <th className="py-2.5 px-4">Environment</th>
                <th className="py-2.5 px-4">Health</th>
                <th className="py-2.5 px-4">Latency (ms)</th>
                <th className="py-2.5 px-4">Packet Loss %</th>
                <th className="py-2.5 px-4">Bandwidth (Mbps)</th>
                <th className="py-2.5 px-4">Last Ping (UTC)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle font-mono text-[11px]">
              {services.map((svc) => (
                <tr
                  key={svc.service}
                  onClick={() => onSelectService(svc.service)}
                  className="hover:bg-surface-hover/60 cursor-pointer transition-colors"
                >
                  <td className="py-2.5 px-4 font-semibold text-text-primary">
                    {svc.service}
                  </td>
                  <td className="py-2.5 px-4 text-text-secondary">{svc.environment}</td>
                  <td className="py-2.5 px-4">
                    <StatusBadge status={svc.health} isStale={svc.stale} />
                  </td>
                  <td className="py-2.5 px-4 tabular-nums text-text-primary">
                    {svc.metrics.latency_ms?.toFixed(1) ?? '--'}
                  </td>
                  <td className="py-2.5 px-4 tabular-nums text-text-primary">
                    {svc.metrics.packet_loss_percent?.toFixed(1) ?? '--'}%
                  </td>
                  <td className="py-2.5 px-4 tabular-nums text-text-secondary">
                    {svc.metrics.bandwidth_mbps?.toFixed(1) ?? '--'}
                  </td>
                  <td className="py-2.5 px-4 text-text-muted tabular-nums">
                    {svc.last_event_time ? svc.last_event_time.slice(11, 19) : '--:--:--'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
