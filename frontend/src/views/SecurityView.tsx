import React from 'react';
import {
  AlertOctagon,
  FileText,
  KeyRound,
  Lock,
  Shield,
  ShieldCheck,
} from 'lucide-react';
import { SanitizedEventLog } from '../types/telemetry';
import { StatusBadge } from '../components/StatusBadge';

interface SecurityViewProps {
  logs: SanitizedEventLog[];
  isLoading: boolean;
}

export const SecurityView: React.FC<SecurityViewProps> = ({ logs }) => {
  return (
    <div className="space-y-6">
      {/* Privacy Guarantee Banner */}
      <div className="rounded-lg border border-[#147D70]/30 bg-[#E8F3F1] p-4 flex items-start gap-3">
        <ShieldCheck className="h-5 w-5 text-accent shrink-0 mt-0.5" />
        <div className="text-xs">
          <h2 className="font-semibold text-text-primary mb-1">
            Privacy-First Architecture: Local Zero-Raw-Log Scrubbing
          </h2>
          <p className="text-text-secondary leading-relaxed">
            All database queries, customer PII, session tokens, and passwords are permanently stripped
            at the Tier 1 Local Collector boundary prior to metadata serialization. The Tier 2 SaaS
            engine only receives aggregate telemetry conforming strictly to the versioned schema allowlist.
          </p>
        </div>
      </div>

      {/* Security KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between text-xs font-medium text-text-muted mb-2">
            <span>Auth Failure Signals</span>
            <Lock className="h-4 w-4 text-text-muted" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tracking-tight text-text-primary tabular-nums">
              0
            </span>
            <span className="text-xs font-mono text-text-muted">failed attempts</span>
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px] text-text-secondary pt-2 border-t border-border-subtle">
            <span>Brute-force baseline</span>
            <span className="text-[#23865B] font-mono font-medium">Nominal</span>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between text-xs font-medium text-text-muted mb-2">
            <span>Suspicious Anomalies</span>
            <AlertOctagon className="h-4 w-4 text-text-muted" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tracking-tight text-text-primary tabular-nums">
              0
            </span>
            <span className="text-xs font-mono text-text-muted">flagged events</span>
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px] text-text-secondary pt-2 border-t border-border-subtle">
            <span>AIOps correlation</span>
            <span className="text-[#23865B] font-mono font-medium">Clear</span>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between text-xs font-medium text-text-muted mb-2">
            <span>Tenant Isolation</span>
            <KeyRound className="h-4 w-4 text-text-muted" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tracking-tight text-text-primary">
              100%
            </span>
            <span className="text-xs font-mono text-text-muted">enforced</span>
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px] text-text-secondary pt-2 border-t border-border-subtle">
            <span>Cross-tenant reads</span>
            <span className="text-[#23865B] font-mono font-medium">Blocked (403)</span>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between text-xs font-medium text-text-muted mb-2">
            <span>Sanitized Events Streamed</span>
            <FileText className="h-4 w-4 text-text-muted" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tracking-tight text-text-primary tabular-nums">
              {logs.length}
            </span>
            <span className="text-xs font-mono text-text-muted">audit logs</span>
          </div>
          <div className="mt-3 flex items-center justify-between text-[11px] text-text-secondary pt-2 border-t border-border-subtle">
            <span>Zero raw log retention</span>
            <span className="text-[#23865B] font-mono font-medium">Active</span>
          </div>
        </div>
      </div>

      {/* Sanitized Security Event Stream */}
      <div className="rounded-lg border border-border bg-surface shadow-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-surface-secondary flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-accent" />
            <h3 className="text-xs font-semibold text-text-primary">
              Sanitized Telemetry Stream (Live Tier 1 Ingestion Audit)
            </h3>
          </div>
          <span className="text-[11px] font-mono text-text-muted">
            {logs.length} events logged
          </span>
        </div>

        {logs.length === 0 ? (
          <div className="p-8 text-center text-text-muted text-xs font-mono">
            Awaiting sanitized telemetry audit logs from local collector...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-surface-secondary/50 text-[11px] font-medium text-text-muted font-mono">
                <tr>
                  <th className="py-2.5 px-4">Event Time (UTC)</th>
                  <th className="py-2.5 px-4">Service</th>
                  <th className="py-2.5 px-4">Environment</th>
                  <th className="py-2.5 px-4">Health</th>
                  <th className="py-2.5 px-4">Score</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Sanitized Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle font-mono text-[11px]">
                {logs.map((log) => (
                  <tr key={log.id} className="hover:bg-surface-hover/60 transition-colors">
                    <td className="py-2.5 px-4 text-text-muted tabular-nums">
                      {log.event_time}
                    </td>
                    <td className="py-2.5 px-4 font-semibold text-text-primary">
                      {log.service}
                    </td>
                    <td className="py-2.5 px-4 text-text-secondary">{log.environment}</td>
                    <td className="py-2.5 px-4">
                      <StatusBadge status={log.health} />
                    </td>
                    <td className="py-2.5 px-4 tabular-nums font-bold text-text-primary">
                      {log.score}
                    </td>
                    <td className="py-2.5 px-4">
                      <StatusBadge status={log.status} />
                    </td>
                    <td className="py-2.5 px-4 text-text-secondary font-mono text-[11px]">
                      {log.summary}
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
