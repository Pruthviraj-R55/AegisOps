import React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Cpu,
  HardDrive,
  Info,
  Layers,
  Network,
  ShieldCheck,
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
import { DashboardOverview, IncidentItem, ServiceItem } from '../types/saas';
import { TelemetryDataPoint } from '../types/telemetry';
import { StatusBadge } from '../components/StatusBadge';

interface OverviewViewProps {
  overview: DashboardOverview | null;
  services: ServiceItem[];
  incidents: IncidentItem[];
  telemetryHistory: Record<string, TelemetryDataPoint[]>;
  selectedService: string | null;
  onSelectService: (service: string) => void;
  onNavigateToIncidents: () => void;
  isLoading: boolean;
}

export const OverviewView: React.FC<OverviewViewProps> = ({
  overview,
  services,
  incidents,
  telemetryHistory,
  selectedService,
  onSelectService,
  onNavigateToIncidents,
}) => {
  const overallHealth = overview?.overall_health || 'good';
  const serviceCounts = overview?.service_counts || { excellent: 0, good: 0, fair: 0, poor: 0 };
  const totalServices =
    serviceCounts.excellent + serviceCounts.good + serviceCounts.fair + serviceCounts.poor;
  const activeIncidents = overview?.active_incident_count ?? 0;
  const staleServices = overview?.stale_service_count ?? 0;

  // Fleet averages
  const validServices = services.filter((s) => s.metrics);
  const avgCpu =
    validServices.length > 0
      ? validServices.reduce((acc, s) => acc + (s.metrics.cpu_percent ?? 0), 0) / validServices.length
      : 0;
  const avgMem =
    validServices.length > 0
      ? validServices.reduce((acc, s) => acc + (s.metrics.memory_percent ?? 0), 0) / validServices.length
      : 0;
  const avgLat =
    validServices.length > 0
      ? validServices.reduce((acc, s) => acc + (s.metrics.latency_ms ?? 0), 0) / validServices.length
      : 0;
  const maxLoss =
    validServices.length > 0
      ? Math.max(...validServices.map((s) => s.metrics.packet_loss_percent ?? 0))
      : 0;

  // Distinct service list
  const uniqueServices = Array.from(new Set(services.map((s) => s.service)));
  const currentService = selectedService || uniqueServices[0] || '';
  const currentHistory = currentService ? telemetryHistory[currentService] || [] : [];
  const hasHistory = currentHistory.length >= 2;

  return (
    <div className="space-y-6">
      {/* 4 Numerical KPI Cards (Linear / Vercel style, zero radial gauges) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Fleet Health */}
        <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between text-xs font-medium text-text-muted mb-2">
            <span>Overall Fleet Health</span>
            <Layers className="h-4 w-4 text-text-muted" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tracking-tight text-text-primary capitalize">
              {overallHealth}
            </span>
            <StatusBadge status={overallHealth} />
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px] text-text-secondary pt-2 border-t border-border-subtle">
            <span>{totalServices} monitored services</span>
            {staleServices > 0 && (
              <span className="text-[#C2414B] font-mono font-medium">
                {staleServices} stale
              </span>
            )}
          </div>
        </div>

        {/* KPI 2: Fleet Avg CPU */}
        <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between text-xs font-medium text-text-muted mb-2">
            <span>Fleet Avg CPU</span>
            <Cpu className="h-4 w-4 text-text-muted" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tracking-tight text-text-primary tabular-nums">
              {avgCpu.toFixed(1)}%
            </span>
            <span className="text-xs font-mono text-text-muted">utilization</span>
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px] text-text-secondary pt-2 border-t border-border-subtle">
            <span>Critical threshold: 85%</span>
            <span
              className={`font-mono font-medium ${
                avgCpu > 80 ? 'text-[#C2414B]' : 'text-[#23865B]'
              }`}
            >
              {avgCpu > 80 ? 'Elevated' : 'Normal'}
            </span>
          </div>
        </div>

        {/* KPI 3: Fleet Avg Memory */}
        <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between text-xs font-medium text-text-muted mb-2">
            <span>Fleet Avg Memory</span>
            <HardDrive className="h-4 w-4 text-text-muted" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tracking-tight text-text-primary tabular-nums">
              {avgMem.toFixed(1)}%
            </span>
            <span className="text-xs font-mono text-text-muted">allocated</span>
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px] text-text-secondary pt-2 border-t border-border-subtle">
            <span>Warning threshold: 80%</span>
            <span
              className={`font-mono font-medium ${
                avgMem > 80 ? 'text-[#B7791F]' : 'text-[#23865B]'
              }`}
            >
              {avgMem > 80 ? 'High' : 'Normal'}
            </span>
          </div>
        </div>

        {/* KPI 4: Network Latency & Loss */}
        <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between text-xs font-medium text-text-muted mb-2">
            <span>Network Latency / Loss</span>
            <Network className="h-4 w-4 text-text-muted" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tracking-tight text-text-primary tabular-nums">
              {avgLat.toFixed(1)}
            </span>
            <span className="text-xs font-mono text-text-muted">ms avg</span>
            <span className="text-xs font-mono text-text-muted ml-1">
              ({maxLoss.toFixed(1)}% loss)
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px] text-text-secondary pt-2 border-t border-border-subtle">
            <span>Active Incidents:</span>
            <span
              className={`font-mono font-bold ${
                activeIncidents > 0 ? 'text-[#C2414B]' : 'text-[#23865B]'
              }`}
            >
              {activeIncidents} active
            </span>
          </div>
        </div>
      </div>

      {/* Fleet Distribution Strip */}
      <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-accent" />
            <span className="text-xs font-semibold text-text-primary">
              Fleet Service Distribution
            </span>
            <span className="text-xs text-text-muted font-mono">
              ({totalServices} total)
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#23865B]" />
              <span className="text-text-secondary">Excellent:</span>
              <span className="font-bold text-text-primary">{serviceCounts.excellent}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#3267C8]" />
              <span className="text-text-secondary">Good:</span>
              <span className="font-bold text-text-primary">{serviceCounts.good}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#B7791F]" />
              <span className="text-text-secondary">Fair:</span>
              <span className="font-bold text-text-primary">{serviceCounts.fair}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#C2414B]" />
              <span className="text-text-secondary">Poor:</span>
              <span className="font-bold text-text-primary">{serviceCounts.poor}</span>
            </div>
          </div>
        </div>
      </div>

      {/* 2-Column Performance Charts Grid */}
      <div className="space-y-3">
        {/* Chart Header with Service Selector */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-text-primary">
              Real-Time Performance Telemetry
            </h2>
            <span className="text-[11px] text-text-muted">
              (Live SaaS ingestion stream)
            </span>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-text-secondary">Selected Service:</label>
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

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Chart 1: CPU & Memory */}
          <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-border-subtle">
              <span className="text-xs font-semibold text-text-primary">
                CPU & Memory Utilization
              </span>
              <span className="text-[11px] font-mono text-text-muted">
                {currentService || 'No service selected'}
              </span>
            </div>

            <div className="h-56 w-full">
              {!hasHistory ? (
                <div className="flex flex-col items-center justify-center h-full text-center p-4">
                  <Info className="h-6 w-6 text-text-muted mb-2 opacity-60" />
                  <p className="text-xs font-medium text-text-secondary">
                    Waiting for telemetry history...
                  </p>
                  <p className="text-[11px] text-text-muted font-mono mt-1">
                    Accumulating genuine real-time samples from SaaS API.
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
                        boxShadow: '0 4px 6px -2px rgba(16, 24, 40, 0.05)',
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
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Chart 2: Latency & Packet Loss */}
          <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-border-subtle">
              <span className="text-xs font-semibold text-text-primary">
                Network Latency & Packet Loss
              </span>
              <span className="text-[11px] font-mono text-text-muted">
                {currentService || 'No service selected'}
              </span>
            </div>

            <div className="h-56 w-full">
              {!hasHistory ? (
                <div className="flex flex-col items-center justify-center h-full text-center p-4">
                  <Info className="h-6 w-6 text-text-muted mb-2 opacity-60" />
                  <p className="text-xs font-medium text-text-secondary">
                    Waiting for telemetry history...
                  </p>
                  <p className="text-[11px] text-text-muted font-mono mt-1">
                    Accumulating genuine real-time samples from SaaS API.
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
                        boxShadow: '0 4px 6px -2px rgba(16, 24, 40, 0.05)',
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
        </div>
      </div>

      {/* Recent Incidents Table */}
      <div className="rounded-lg border border-border bg-surface shadow-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface-secondary">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-[#B7791F]" />
            <span className="text-xs font-semibold text-text-primary">
              Recent Correlated Incidents
            </span>
            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-surface border border-border text-text-muted">
              {incidents.length} total
            </span>
          </div>

          <button
            onClick={onNavigateToIncidents}
            className="flex items-center gap-1 text-xs font-medium text-accent hover:underline"
          >
            <span>View All Incidents</span>
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>

        {incidents.length === 0 ? (
          <div className="p-8 text-center text-text-muted text-xs">
            No active incidents detected. All services operating within normal baselines.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-surface-secondary/50 text-[11px] font-medium text-text-muted font-mono">
                <tr>
                  <th className="py-2.5 px-4">Incident ID</th>
                  <th className="py-2.5 px-4">Service</th>
                  <th className="py-2.5 px-4">Severity</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Confidence</th>
                  <th className="py-2.5 px-4">Started (UTC)</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle font-mono text-[11px]">
                {incidents.slice(0, 5).map((inc) => (
                  <tr key={inc.incident_id} className="hover:bg-surface-hover/60 transition-colors">
                    <td className="py-2.5 px-4 font-semibold text-text-primary">
                      {inc.incident_id}
                    </td>
                    <td className="py-2.5 px-4 text-text-primary">
                      {inc.service}
                    </td>
                    <td className="py-2.5 px-4">
                      <StatusBadge status={inc.severity} />
                    </td>
                    <td className="py-2.5 px-4">
                      <StatusBadge status={inc.status} />
                    </td>
                    <td className="py-2.5 px-4 tabular-nums text-text-secondary">
                      {Math.round(inc.confidence * 100)}%
                    </td>
                    <td className="py-2.5 px-4 text-text-muted tabular-nums">
                      {inc.started_at.slice(11, 19)}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <button
                        onClick={onNavigateToIncidents}
                        className="text-accent hover:underline text-xs font-sans font-medium"
                      >
                        Review
                      </button>
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
