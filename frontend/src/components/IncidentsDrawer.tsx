import React from 'react';
import {
  AlertTriangle,
  CheckCircle,
  FileCheck,
  History,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { IncidentItem } from '../types/saas';

interface AuditLogEntry {
  id: string;
  timestamp: string; // UTC ISO
  operator: string;
  incidentId: string;
  service: string;
  action: string;
  status: 'approved' | 'rejected' | 'rolled_back' | 'policy_verified';
  note: string;
}

interface IncidentsDrawerProps {
  incidents: IncidentItem[];
  isLoading: boolean;
}

export const IncidentsDrawer: React.FC<IncidentsDrawerProps> = ({ incidents, isLoading }) => {
  const [selectedIncident, setSelectedIncident] = React.useState<IncidentItem | null>(null);
  const [auditLog, setAuditLog] = React.useState<AuditLogEntry[]>([
    {
      id: 'audit-001',
      timestamp: new Date(Date.now() - 360000).toISOString(),
      operator: 'sre-lead@aegisops.internal',
      incidentId: 'inc-init-check',
      service: 'fleet-controller',
      action: 'Automated pre-flight security rule verification',
      status: 'policy_verified',
      note: 'Verified Zero-Data-Egress policy and contract conformance',
    },
  ]);
  const [remediationState, setRemediationState] = React.useState<
    Record<string, 'pending' | 'approved' | 'rejected' | 'rolled_back'>
  >({});

  const activeIncidents = incidents.filter((i) => i.status === 'active');
  const displayIncident = selectedIncident || activeIncidents[0] || incidents[0] || null;

  const currentStatus = displayIncident ? remediationState[displayIncident.incident_id] || 'pending' : 'pending';

  const handleApproveRemediation = (incident: IncidentItem) => {
    const nowIso = new Date().toISOString();
    setRemediationState((prev) => ({ ...prev, [incident.incident_id]: 'approved' }));
    setAuditLog((prev) => [
      {
        id: `audit-${Date.now()}`,
        timestamp: nowIso,
        operator: 'sre-oncall@aegisops.internal',
        incidentId: incident.incident_id,
        service: incident.service,
        action: `Approved: ${incident.recommended_action}`,
        status: 'approved',
        note: 'Human approval recorded in immutable session audit log',
      },
      ...prev,
    ]);
  };

  const handleRejectRemediation = (incident: IncidentItem) => {
    const nowIso = new Date().toISOString();
    setRemediationState((prev) => ({ ...prev, [incident.incident_id]: 'rejected' }));
    setAuditLog((prev) => [
      {
        id: `audit-${Date.now()}`,
        timestamp: nowIso,
        operator: 'sre-oncall@aegisops.internal',
        incidentId: incident.incident_id,
        service: incident.service,
        action: 'Operator rejected recommended action',
        status: 'rejected',
        note: 'Remediation aborted by human supervisor',
      },
      ...prev,
    ]);
  };

  const handleRollback = (incident: IncidentItem) => {
    const nowIso = new Date().toISOString();
    setRemediationState((prev) => ({ ...prev, [incident.incident_id]: 'rolled_back' }));
    setAuditLog((prev) => [
      {
        id: `audit-${Date.now()}`,
        timestamp: nowIso,
        operator: 'sre-oncall@aegisops.internal',
        incidentId: incident.incident_id,
        service: incident.service,
        action: `Executed Rollback: ${incident.rollback_plan}`,
        status: 'rolled_back',
        note: 'Reverted deployment image tag to previous stable commit',
      },
      ...prev,
    ]);
  };

  const getSeverityBadge = (severity: string) => {
    const map: Record<string, { bg: string; text: string; border: string }> = {
      critical: { bg: 'bg-health-poor/15', text: 'text-health-poor', border: 'border-health-poor/40' },
      high: { bg: 'bg-health-fair/15', text: 'text-health-fair', border: 'border-health-fair/40' },
      medium: { bg: 'bg-health-good/15', text: 'text-health-good', border: 'border-health-good/40' },
      low: { bg: 'bg-canvas', text: 'text-text-muted', border: 'border-border' },
    };
    const s = map[severity.toLowerCase()] || map.medium;
    return (
      <span className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${s.border} ${s.bg} ${s.text}`}>
        {severity}
      </span>
    );
  };

  return (
    <div className="space-y-4">
      {/* Top Banner explaining Explainable AIOps */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-border bg-surface px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-health-poor/10 text-health-poor">
            <ShieldAlert className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-primary">
              Correlated AIOps Incidents & Explainable Remediation
            </h3>
            <p className="text-[11px] text-text-muted">
              Zero speculative black-box AI. Anomalies are detected via rolling Z-scores/EWMA and clustered into explainable remediation workflows with pre-approved rollback plans.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded border border-border bg-canvas px-2.5 py-1 text-[11px] font-mono text-text-muted">
            {incidents.length} total incidents ({activeIncidents.length} active)
          </span>
        </div>
      </div>

      {incidents.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded border border-border bg-surface py-12 text-center">
          <CheckCircle className="h-8 w-8 text-health-excellent mb-2" />
          <h4 className="text-sm font-semibold text-text-primary">All Fleet Systems Nominal</h4>
          <p className="mt-1 text-xs text-text-muted max-w-sm">
            {isLoading
              ? 'Querying tenant incidents from SaaS API...'
              : 'Zero active or recent correlated anomalies detected for this tenant context.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left Column: Incidents List */}
          <div className="lg:col-span-5 rounded border border-border bg-surface overflow-hidden">
            <div className="border-b border-border bg-surface-elevated/40 px-3 py-2 text-xs font-bold uppercase text-text-primary">
              Incident Registry
            </div>
            <div className="divide-y divide-border/60 max-h-[520px] overflow-y-auto">
              {incidents.map((inc) => {
                const isSelected = displayIncident?.incident_id === inc.incident_id;
                return (
                  <div
                    key={inc.incident_id}
                    onClick={() => setSelectedIncident(inc)}
                    className={`cursor-pointer p-3 transition-colors ${
                      isSelected
                        ? 'bg-surface-elevated border-l-2 border-l-series-cpu'
                        : 'hover:bg-surface-hover/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {getSeverityBadge(inc.severity)}
                        <span className="text-xs font-semibold text-text-primary">{inc.service}</span>
                      </div>
                      <span className="text-[11px] font-mono text-series-latency">
                        {(inc.confidence * 100).toFixed(0)}% conf
                      </span>
                    </div>

                    <div className="mt-1.5 flex items-center justify-between text-[11px] text-text-muted font-mono tabular-nums">
                      <span className="truncate max-w-[200px] text-text-dim">{inc.incident_id}</span>
                      <span>{inc.started_at.slice(11, 19)} UTC</span>
                    </div>

                    <p className="mt-1 text-[11px] text-text-muted line-clamp-1">
                      {inc.contributing_signals[0] || 'Anomalous metric deviation detected'}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Column: Incident Detail & Safe Remediation Simulation */}
          {displayIncident && (
            <div className="lg:col-span-7 space-y-4">
              {/* Detailed Incident View */}
              <div className="rounded border border-border bg-surface p-4">
                <div className="flex items-start justify-between border-b border-border pb-3 mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      {getSeverityBadge(displayIncident.severity)}
                      <h4 className="text-sm font-bold text-text-primary">{displayIncident.service}</h4>
                      <span className="rounded bg-canvas px-1.5 py-0.5 text-[10px] font-mono uppercase text-text-muted border border-border">
                        {displayIncident.status}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-text-muted tabular-nums">
                      ID: {displayIncident.incident_id} | Window: {displayIncident.started_at.slice(11, 19)} – {displayIncident.last_seen_at.slice(11, 19)} UTC
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-xs text-text-muted">Correlation Confidence</div>
                    <div className="text-lg font-bold font-mono text-series-latency">
                      {(displayIncident.confidence * 100).toFixed(0)}%
                    </div>
                  </div>
                </div>

                {/* Contributing Signals */}
                <div className="mb-3">
                  <div className="text-xs font-bold uppercase tracking-wider text-text-muted mb-1.5 flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-health-fair" />
                    Contributing Signals (Root Cause Triggers)
                  </div>
                  <ul className="space-y-1 rounded border border-border bg-canvas p-2.5 text-xs font-mono">
                    {displayIncident.contributing_signals.map((sig, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-text-primary">
                        <span className="text-health-poor">▶</span>
                        <span>{sig}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Recommended Remediation Action */}
                <div className="mb-3">
                  <div className="text-xs font-bold uppercase tracking-wider text-text-muted mb-1.5 flex items-center gap-1.5">
                    <Zap className="h-3.5 w-3.5 text-series-cpu" />
                    Recommended Remediation
                  </div>
                  <div className="rounded border border-series-cpu/30 bg-series-cpu/5 p-2.5 text-xs text-text-primary font-sans leading-relaxed">
                    {displayIncident.recommended_action}
                  </div>
                </div>

                {/* Rollback Plan */}
                <div className="mb-4">
                  <div className="text-xs font-bold uppercase tracking-wider text-text-muted mb-1.5 flex items-center gap-1.5">
                    <RotateCcw className="h-3.5 w-3.5 text-health-fair" />
                    Guaranteed Safe Rollback Plan
                  </div>
                  <div className="rounded border border-border bg-canvas p-2.5 text-xs text-text-muted font-mono leading-relaxed">
                    {displayIncident.rollback_plan}
                  </div>
                </div>

                {/* Safe Remediation Simulation Workflow Box */}
                <div className="rounded border border-border-subtle bg-surface-elevated/40 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-text-primary">
                      <ShieldCheck className="h-4 w-4 text-health-excellent" />
                      <span>Safe Remediation Simulation Workflow</span>
                    </div>
                    <span className="rounded bg-canvas px-2 py-0.5 text-[10px] font-mono text-series-cpu border border-border">
                      SIMULATION SANDBOX
                    </span>
                  </div>

                  <p className="text-[11px] text-text-muted mb-3">
                    Enforces strict operator verification before executing remediation, followed by an immediate audit trail entry and one-click rollback.
                  </p>

                  {/* Remediation Action Controls */}
                  <div className="flex flex-wrap items-center gap-2">
                    {currentStatus === 'pending' && (
                      <>
                        <button
                          onClick={() => handleApproveRemediation(displayIncident)}
                          className="flex items-center gap-1.5 rounded bg-health-excellent/20 border border-health-excellent/40 px-3 py-1.5 text-xs font-semibold text-health-excellent hover:bg-health-excellent/30 transition-colors"
                        >
                          <FileCheck className="h-3.5 w-3.5" />
                          Approve Remediation
                        </button>
                        <button
                          onClick={() => handleRejectRemediation(displayIncident)}
                          className="flex items-center gap-1.5 rounded bg-health-poor/20 border border-health-poor/40 px-3 py-1.5 text-xs font-semibold text-health-poor hover:bg-health-poor/30 transition-colors"
                        >
                          Reject
                        </button>
                      </>
                    )}

                    {currentStatus === 'approved' && (
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-health-excellent/10 border border-health-excellent/30 px-2.5 py-1 text-xs font-semibold text-health-excellent flex items-center gap-1.5">
                          <CheckCircle className="h-3.5 w-3.5" />
                          Remediation Executed & Audited
                        </span>
                        <button
                          onClick={() => handleRollback(displayIncident)}
                          className="flex items-center gap-1.5 rounded bg-health-fair/20 border border-health-fair/40 px-3 py-1.5 text-xs font-semibold text-health-fair hover:bg-health-fair/30 transition-colors"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Trigger Rollback
                        </button>
                      </div>
                    )}

                    {currentStatus === 'rolled_back' && (
                      <span className="rounded bg-health-fair/10 border border-health-fair/30 px-2.5 py-1 text-xs font-semibold text-health-fair flex items-center gap-1.5">
                        <RotateCcw className="h-3.5 w-3.5" />
                        Rollback Completed & Confirmed
                      </span>
                    )}

                    {currentStatus === 'rejected' && (
                      <span className="rounded bg-health-poor/10 border border-health-poor/30 px-2.5 py-1 text-xs font-semibold text-health-poor flex items-center gap-1.5">
                        Remediation Aborted by Supervisor
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Immutable Session Audit Trail */}
              <div className="rounded border border-border bg-surface p-4">
                <div className="flex items-center justify-between border-b border-border pb-2 mb-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold uppercase text-text-primary">
                    <History className="h-3.5 w-3.5 text-text-muted" />
                    <span>Immutable Session Audit Trail</span>
                  </div>
                  <span className="text-[10px] font-mono text-text-dim">APPEND-ONLY</span>
                </div>

                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {auditLog.map((log) => (
                    <div
                      key={log.id}
                      className="rounded border border-border/70 bg-canvas p-2 text-xs font-mono"
                    >
                      <div className="flex items-center justify-between text-[11px] text-text-muted mb-0.5">
                        <span className="text-series-cpu">{log.operator}</span>
                        <span>{log.timestamp.slice(11, 19)} UTC</span>
                      </div>
                      <div className="text-text-primary text-[11px]">{log.action}</div>
                      <div className="text-[10px] text-text-dim mt-0.5 italic">{log.note}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
