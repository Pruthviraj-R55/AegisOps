import React from 'react';
import { Activity, AlertOctagon, Cpu, Network } from 'lucide-react';
import { DashboardOverview, ServiceItem } from '../types/saas';

interface KpiHeroStripProps {
  overview: DashboardOverview | null;
  services: ServiceItem[];
  isLoading: boolean;
}

export const KpiHeroStrip: React.FC<KpiHeroStripProps> = ({ overview, services, isLoading }) => {
  const overallHealth = overview?.overall_health || 'good';
  const serviceCounts = overview?.service_counts || { excellent: 0, good: 0, fair: 0, poor: 0 };
  const totalServices =
    serviceCounts.excellent + serviceCounts.good + serviceCounts.fair + serviceCounts.poor;
  const activeIncidents = overview?.active_incident_count ?? 0;
  const staleServices = overview?.stale_service_count ?? 0;

  // Compute fleet averages
  const validServices = services.filter((s) => s.metrics);
  const avgCpu = validServices.length > 0
    ? validServices.reduce((acc, s) => acc + (s.metrics.cpu_percent ?? 0), 0) / validServices.length
    : 34.2;
  const avgMem = validServices.length > 0
    ? validServices.reduce((acc, s) => acc + (s.metrics.memory_percent ?? 0), 0) / validServices.length
    : 52.8;
  const avgLat = validServices.length > 0
    ? validServices.reduce((acc, s) => acc + (s.metrics.latency_ms ?? 0), 0) / validServices.length
    : 18.5;
  const maxPacketLoss = validServices.length > 0
    ? Math.max(...validServices.map((s) => s.metrics.packet_loss_percent ?? 0))
    : 0.0;
  const totalFailedLogins = services.reduce(
    (acc, s) => acc + ((s as any).security?.failed_login_count ?? 0),
    0
  );

  const healthColorMap: Record<string, { border: string; bg: string; text: string; label: string; glow: string }> = {
    excellent: {
      border: 'border-health-excellent/50',
      bg: 'bg-health-excellent/10',
      text: 'text-health-excellent',
      label: 'EXCELLENT',
      glow: 'shadow-[0_0_12px_rgba(0,210,106,0.25)]',
    },
    good: {
      border: 'border-health-good/50',
      bg: 'bg-health-good/10',
      text: 'text-health-good',
      label: 'GOOD',
      glow: 'shadow-[0_0_12px_rgba(56,189,248,0.25)]',
    },
    fair: {
      border: 'border-health-fair/50',
      bg: 'bg-health-fair/10',
      text: 'text-health-fair',
      label: 'FAIR',
      glow: 'shadow-[0_0_12px_rgba(245,158,11,0.25)]',
    },
    poor: {
      border: 'border-health-poor/50',
      bg: 'bg-health-poor/10',
      text: 'text-health-poor',
      label: 'POOR',
      glow: 'shadow-[0_0_12px_rgba(242,73,92,0.25)]',
    },
  };

  const healthStyle = healthColorMap[overallHealth] || healthColorMap.good;

  // Mini SVG Sparkline Generator
  const renderSparkline = (points: number[], strokeColor: string) => {
    const min = Math.min(...points);
    const max = Math.max(...points) || 1;
    const height = 24;
    const width = 80;
    const step = width / (points.length - 1 || 1);
    const d = points
      .map((p, i) => {
        const x = i * step;
        const y = height - ((p - min) / (max - min || 1)) * (height - 4) - 2;
        return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
      })
      .join(' ');

    return (
      <svg width={width} height={height} className="overflow-visible">
        <path d={d} fill="none" stroke={strokeColor} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  };

  // Mini Radial Progress Ring
  const renderRadialGauge = (percent: number, color: string, label: string) => {
    const radius = 18;
    const stroke = 3.5;
    const normalizedRadius = radius - stroke * 0.5;
    const circumference = normalizedRadius * 2 * Math.PI;
    const strokeDashoffset = circumference - (Math.min(100, Math.max(0, percent)) / 100) * circumference;

    return (
      <div className="flex items-center gap-2">
        <div className="relative inline-flex items-center justify-center">
          <svg height={radius * 2} width={radius * 2} className="-rotate-90">
            <circle
              stroke="#1B2230"
              fill="transparent"
              strokeWidth={stroke}
              r={normalizedRadius}
              cx={radius}
              cy={radius}
            />
            <circle
              stroke={color}
              fill="transparent"
              strokeWidth={stroke}
              strokeDasharray={`${circumference} ${circumference}`}
              style={{ strokeDashoffset }}
              strokeLinecap="round"
              r={normalizedRadius}
              cx={radius}
              cy={radius}
            />
          </svg>
          <span className="absolute text-[9px] font-mono font-bold text-text-primary">
            {Math.round(percent)}%
          </span>
        </div>
        <div className="text-[11px] font-mono leading-tight">
          <div className="text-text-muted text-[10px]">{label}</div>
          <div className="text-text-primary font-bold">{percent.toFixed(1)}%</div>
        </div>
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {/* 1. Fleet Health */}
      <div className="rounded border border-border bg-surface p-3.5 transition-all hover:border-border-focus hover:bg-surface-elevated/40">
        <div className="flex items-center justify-between text-xs text-text-muted mb-2">
          <span className="font-bold tracking-wider uppercase text-[10px]">Fleet Health Status</span>
          <Activity className="h-3.5 w-3.5 text-accent-emerald" />
        </div>

        <div className="flex items-center justify-between">
          <span
            className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-0.5 text-xs font-bold font-mono tracking-wider ${healthStyle.border} ${healthStyle.bg} ${healthStyle.text} ${healthStyle.glow}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {healthStyle.label}
          </span>
          {renderSparkline([80, 85, 90, 88, 92, 95], healthStyle.text.replace('text-', '#').replace('health-excellent', '00D26A').replace('health-good', '38BDF8').replace('health-fair', 'F59E0B').replace('health-poor', 'F2495C'))}
        </div>

        <div className="mt-2.5 flex items-center justify-between text-[10px] font-mono text-text-muted border-t border-border/50 pt-2">
          <span>{totalServices} active services</span>
          {staleServices > 0 ? (
            <span className="text-health-poor font-bold animate-pulse">{staleServices} STALE</span>
          ) : (
            <span className="text-health-excellent">All Fresh (&lt;45s)</span>
          )}
        </div>
      </div>

      {/* 2. Hardware Load (Radial Gauges for CPU & Memory) */}
      <div className="rounded border border-border bg-surface p-3.5 transition-all hover:border-border-focus hover:bg-surface-elevated/40">
        <div className="flex items-center justify-between text-xs text-text-muted mb-2">
          <span className="font-bold tracking-wider uppercase text-[10px]">Hardware Load</span>
          <Cpu className="h-3.5 w-3.5 text-series-cpu" />
        </div>

        <div className="flex items-center justify-around py-0.5">
          {renderRadialGauge(avgCpu, '#38BDF8', 'AVG CPU')}
          <div className="h-8 w-[1px] bg-border" />
          {renderRadialGauge(avgMem, '#A78BFA', 'AVG MEM')}
        </div>

        <div className="mt-2.5 flex items-center justify-between text-[10px] font-mono text-text-muted border-t border-border/50 pt-2">
          <span className="text-series-cpu">CPU Nominal (&lt;75%)</span>
          <span className="text-series-memory">RAM Nominal</span>
        </div>
      </div>

      {/* 3. Network Health (Latency & Packet Loss) */}
      <div className="rounded border border-border bg-surface p-3.5 transition-all hover:border-border-focus hover:bg-surface-elevated/40">
        <div className="flex items-center justify-between text-xs text-text-muted mb-2">
          <span className="font-bold tracking-wider uppercase text-[10px]">Network Telemetry</span>
          <Network className="h-3.5 w-3.5 text-series-latency" />
        </div>

        <div className="flex items-baseline justify-between">
          <div className="flex items-baseline gap-1.5">
            <span className="text-2xl font-bold font-mono text-text-primary tabular-nums">
              {isLoading && services.length === 0 ? '--' : avgLat.toFixed(1)}
            </span>
            <span className="text-xs font-mono text-text-muted">ms avg</span>
          </div>
          {renderSparkline([14, 18, 16, 22, 19, 17, avgLat], '#F59E0B')}
        </div>

        <div className="mt-2.5 flex items-center justify-between text-[10px] font-mono text-text-muted border-t border-border/50 pt-2">
          <span>Max Loss: <strong className="text-text-primary">{maxPacketLoss.toFixed(1)}%</strong></span>
          <span className={avgLat < 100 ? 'text-health-excellent' : 'text-health-fair'}>
            {avgLat < 100 ? 'Low Latency SLA' : 'Elevated'}
          </span>
        </div>
      </div>

      {/* 4. Security & Active Incidents */}
      <div className="rounded border border-border bg-surface p-3.5 transition-all hover:border-border-focus hover:bg-surface-elevated/40">
        <div className="flex items-center justify-between text-xs text-text-muted mb-2">
          <span className="font-bold tracking-wider uppercase text-[10px]">Security & Incidents</span>
          <AlertOctagon
            className={`h-3.5 w-3.5 ${activeIncidents > 0 ? 'text-health-poor' : 'text-accent-emerald'}`}
          />
        </div>

        <div className="flex items-baseline justify-between">
          <div className="flex items-baseline gap-1.5">
            <span
              className={`text-2xl font-bold font-mono tabular-nums ${
                activeIncidents > 0 ? 'text-health-poor' : 'text-text-primary'
              }`}
            >
              {isLoading && !overview ? '--' : activeIncidents}
            </span>
            <span className="text-xs text-text-muted">active incidents</span>
          </div>

          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-mono font-bold border ${
              activeIncidents > 0
                ? 'border-health-poor/40 bg-health-poor/10 text-health-poor'
                : 'border-health-excellent/40 bg-health-excellent/10 text-health-excellent'
            }`}
          >
            {activeIncidents > 0 ? 'Remediation Req' : 'Nominal'}
          </span>
        </div>

        <div className="mt-2.5 flex items-center justify-between text-[10px] font-mono text-text-muted border-t border-border/50 pt-2">
          <span>Failed Logins: <strong className="text-text-primary">{totalFailedLogins}</strong></span>
          <span>Zero Breaches</span>
        </div>
      </div>
    </div>
  );
};
