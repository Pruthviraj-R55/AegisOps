import React from 'react';
import { Activity, AlertTriangle, Layers, Server } from 'lucide-react';
import { DashboardOverview } from '../types/saas';

interface KpiFleetStripProps {
  overview: DashboardOverview | null;
  isLoading: boolean;
}

export const KpiFleetStrip: React.FC<KpiFleetStripProps> = ({ overview, isLoading }) => {
  const overallHealth = overview?.overall_health || 'good';
  const serviceCounts = overview?.service_counts || { excellent: 0, good: 0, fair: 0, poor: 0 };
  const totalServices =
    serviceCounts.excellent + serviceCounts.good + serviceCounts.fair + serviceCounts.poor;
  const activeIncidents = overview?.active_incident_count ?? 0;
  const staleServices = overview?.stale_service_count ?? 0;

  const healthColorMap: Record<string, { border: string; bg: string; text: string; label: string }> = {
    excellent: {
      border: 'border-health-excellent/40',
      bg: 'bg-health-excellent/10',
      text: 'text-health-excellent',
      label: 'EXCELLENT',
    },
    good: {
      border: 'border-health-good/40',
      bg: 'bg-health-good/10',
      text: 'text-health-good',
      label: 'GOOD',
    },
    fair: {
      border: 'border-health-fair/40',
      bg: 'bg-health-fair/10',
      text: 'text-health-fair',
      label: 'FAIR',
    },
    poor: {
      border: 'border-health-poor/40',
      bg: 'bg-health-poor/10',
      text: 'text-health-poor',
      label: 'POOR',
    },
  };

  const healthStyle = healthColorMap[overallHealth] || healthColorMap.good;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {/* 1. Overall Fleet Health */}
      <div className="rounded border border-border bg-surface p-3 transition-colors hover:border-border-subtle">
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span className="font-medium tracking-wide">FLEET HEALTH</span>
          <Activity className="h-3.5 w-3.5 text-text-muted" />
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span
            className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-0.5 text-xs font-bold tracking-wider ${healthStyle.border} ${healthStyle.bg} ${healthStyle.text}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${healthStyle.bg.replace('/10', '')}`} />
            {healthStyle.label}
          </span>
          {staleServices > 0 && (
            <span className="rounded border border-health-poor/40 bg-health-poor/10 px-1.5 py-0.5 text-[10px] font-mono text-health-poor">
              {staleServices} STALE
            </span>
          )}
        </div>
        <div className="mt-1.5 text-[11px] text-text-muted mono-metric">
          {staleServices > 0
            ? 'Stale collectors cause automatic downgrade'
            : 'All fleet components within SLAs'}
        </div>
      </div>

      {/* 2. Monitored Services */}
      <div className="rounded border border-border bg-surface p-3 transition-colors hover:border-border-subtle">
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span className="font-medium tracking-wide">SERVICES MONITORED</span>
          <Layers className="h-3.5 w-3.5 text-text-muted" />
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-2xl font-bold mono-metric text-text-primary">
            {isLoading && !overview ? '--' : totalServices}
          </span>
          <span className="text-xs text-text-muted">active endpoints</span>
        </div>
        {/* Breakdown Row */}
        <div className="mt-1 flex items-center gap-2 text-[10px] mono-metric">
          <span className="text-health-excellent">{serviceCounts.excellent} Exc</span>
          <span className="text-text-dim">|</span>
          <span className="text-health-good">{serviceCounts.good} Good</span>
          <span className="text-text-dim">|</span>
          <span className="text-health-fair">{serviceCounts.fair} Fair</span>
          <span className="text-text-dim">|</span>
          <span className="text-health-poor">{serviceCounts.poor} Poor</span>
        </div>
      </div>

      {/* 3. Active Incidents */}
      <div className="rounded border border-border bg-surface p-3 transition-colors hover:border-border-subtle">
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span className="font-medium tracking-wide">ACTIVE INCIDENTS</span>
          <AlertTriangle
            className={`h-3.5 w-3.5 ${
              activeIncidents > 0 ? 'text-health-poor' : 'text-text-muted'
            }`}
          />
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span
            className={`text-2xl font-bold mono-metric ${
              activeIncidents > 0 ? 'text-health-poor' : 'text-text-primary'
            }`}
          >
            {isLoading && !overview ? '--' : activeIncidents}
          </span>
          <span className="text-xs text-text-muted">correlated alerts</span>
        </div>
        <div className="mt-1 text-[11px] mono-metric">
          {activeIncidents > 0 ? (
            <span className="text-health-poor font-medium">Requires SRE remediation</span>
          ) : (
            <span className="text-health-excellent">Zero anomalous clusters</span>
          )}
        </div>
      </div>

      {/* 4. Stale / Offline Services & SLA */}
      <div className="rounded border border-border bg-surface p-3 transition-colors hover:border-border-subtle">
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span className="font-medium tracking-wide">OFFLINE DETECTION</span>
          <Server className="h-3.5 w-3.5 text-text-muted" />
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span
            className={`text-2xl font-bold mono-metric ${
              staleServices > 0 ? 'text-health-poor' : 'text-health-excellent'
            }`}
          >
            {staleServices > 0 ? `${staleServices} Stale` : 'Online'}
          </span>
          <span className="text-xs text-text-muted font-mono">&lt;60s SLA</span>
        </div>
        <div className="mt-1 text-[11px] text-text-muted mono-metric">
          {staleServices > 0
            ? 'Heartbeat missed offline threshold'
            : 'All collectors fresh and streaming'}
        </div>
      </div>
    </div>
  );
};
