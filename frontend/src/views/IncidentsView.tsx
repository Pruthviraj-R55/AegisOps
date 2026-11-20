import React from 'react';
import {
  AlertTriangle,
  CheckCircle,
  History,
  RotateCcw,
  Zap,
} from 'lucide-react';
import { IncidentItem } from '../types/saas';
import { StatusBadge } from '../components/StatusBadge';

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

interface IncidentsViewProps {
  incidents: IncidentItem[];
  isLoading: boolean;
}

export const IncidentsView: React.FC<IncidentsViewProps> = ({ incidents }) => {
  const [selectedIncidentId, setSelectedIncidentId] = React.useState<string | null>(null);
  const [filterStatus, setFilterStatus] = React.useState<string>('all');
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

  const filteredIncidents = incidents.filter((i) => {
    if (filterStatus === 'all') return true;
    return i.status.toLowerCase() === filterStatus.toLowerCase();
  });

  const selectedIncident =
    filteredIncidents.find((i) => i.incident_id === selectedIncidentId) ||
    filteredIncidents[0] ||
    null;

  const currentRemediationStatus = selectedIncident
    ? remediationState[selectedIncident.incident_id] || 'pending'
    : 'pending';

  const handleApprove = (incident: IncidentItem) => {
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
        note: 'Human-in-the-loop approval recorded in session audit log',
      },
      ...prev,
    ]);
  };

  const handleReject = (incident: IncidentItem) => {
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
        note: 'Remediation rejected by human supervisor',
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
        action: `Triggered Rollback: ${incident.rollback_plan}`,
        status: 'rolled_back',
        note: 'Rollback initiated to previous stable state',
      },
      ...prev,
    ]);
  };

  return (
    <div className="space-y-6">
      {/* Top Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-lg border border-border bg-surface shadow-card">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-[#B7791F]" />
          <h2 className="text-sm font-semibold text-text-primary">
            AIOps Correlated Incidents & Safe Remediation
          </h2>
          <span className="text-xs text-text-muted font-mono">
            ({filteredIncidents.length} shown)
          </span>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 bg-surface-secondary p-1 rounded-md border border-border text-xs font-mono">
          {['all', 'active', 'investigating', 'resolved'].map((st) => (
            <button
              key={st}
              onClick={() => setFilterStatus(st)}
              className={`px-2.5 py-1 rounded capitalize transition-colors ${
                filterStatus === st
                  ? 'bg-surface text-accent font-semibold shadow-xs'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {filteredIncidents.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-12 text-center text-text-muted text-xs">
          No incidents matching the selected filter.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Incidents List */}
          <div className="lg:col-span-1 rounded-lg border border-border bg-surface shadow-card overflow-hidden divide-y divide-border-subtle max-h-[700px] overflow-y-auto">
            {filteredIncidents.map((inc) => {
              const isSelected = selectedIncident?.incident_id === inc.incident_id;
              return (
                <div
                  key={inc.incident_id}
                  onClick={() => setSelectedIncidentId(inc.incident_id)}
                  className={`p-3.5 cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-accent-light/50 border-l-3 border-accent'
                      : 'hover:bg-surface-hover/60'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-xs font-bold text-text-primary">
                      {inc.service}
                    </span>
                    <StatusBadge status={inc.severity} />
                  </div>

                  <div className="flex items-center justify-between text-[11px] font-mono text-text-muted">
                    <span>{inc.incident_id}</span>
                    <span>{inc.started_at.slice(11, 19)} UTC</span>
                  </div>

                  <div className="mt-2 flex items-center justify-between text-[11px]">
                    <span className="text-text-secondary">Confidence:</span>
                    <span className="font-mono font-bold text-text-primary">
                      {Math.round(inc.confidence * 100)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right Column: Incident Detail & Safe Remediation */}
          {selectedIncident && (
            <div className="lg:col-span-2 space-y-4">
              {/* Incident Overview Card */}
              <div className="rounded-lg border border-border bg-surface p-5 shadow-card">
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-4 border-b border-border-subtle">
                  <div>
                    <span className="text-[11px] font-mono text-text-muted block">
                      Incident ID: {selectedIncident.incident_id}
                    </span>
                    <h3 className="text-base font-bold text-text-primary flex items-center gap-2 mt-0.5">
                      <span>{selectedIncident.service} Service Incident</span>
                      <StatusBadge status={selectedIncident.severity} />
                      <StatusBadge status={selectedIncident.status} />
                    </h3>
                  </div>

                  <div className="text-right text-[11px] font-mono text-text-muted">
                    <div>Started: {selectedIncident.started_at.slice(11, 19)} UTC</div>
                    <div>Last seen: {selectedIncident.last_seen_at.slice(11, 19)} UTC</div>
                  </div>
                </div>

                {/* Contributing Signals */}
                <div className="mb-4">
                  <span className="text-xs font-semibold text-text-secondary block mb-1.5">
                    Contributing Telemetry Signals:
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {selectedIncident.contributing_signals.map((sig, idx) => (
                      <span
                        key={idx}
                        className="px-2.5 py-1 rounded bg-surface-secondary border border-border text-xs font-mono text-text-primary"
                      >
                        {sig}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Confidence Bar */}
                <div className="mb-4">
                  <div className="flex items-center justify-between text-xs font-medium mb-1">
                    <span className="text-text-secondary">AIOps Detection Confidence</span>
                    <span className="font-mono font-bold text-text-primary">
                      {Math.round(selectedIncident.confidence * 100)}%
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-surface-secondary border border-border-subtle overflow-hidden">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${selectedIncident.confidence * 100}%` }}
                    />
                  </div>
                </div>

                {/* Plain-Language Explanation */}
                <div className="p-3.5 rounded bg-surface-secondary border border-border-subtle text-xs mb-4">
                  <div className="font-semibold text-text-primary mb-1 flex items-center gap-1.5">
                    <Zap className="h-3.5 w-3.5 text-accent" />
                    <span>Explainable Root Cause Diagnosis:</span>
                  </div>
                  <p className="text-text-secondary leading-relaxed">
                    Correlated telemetry detected sustained metric deviations beyond normal baseline thresholds.
                    Elevated latency coincides with resource saturation without violating tenant privacy boundaries.
                  </p>
                </div>

                {/* Safe Remediation Section */}
                <div className="pt-3 border-t border-border-subtle">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold uppercase tracking-wider text-text-primary">
                      Safe Remediation & Human-in-the-Loop Controls
                    </span>
                    <span
                      className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
                        currentRemediationStatus === 'approved'
                          ? 'bg-[#EAF5F0] text-[#23865B]'
                          : currentRemediationStatus === 'rolled_back'
                          ? 'bg-[#FEF7EC] text-[#B7791F]'
                          : currentRemediationStatus === 'rejected'
                          ? 'bg-[#FDF2F2] text-[#C2414B]'
                          : 'bg-surface-secondary text-text-muted border border-border'
                      }`}
                    >
                      Status: {currentRemediationStatus.toUpperCase()}
                    </span>
                  </div>

                  <div className="space-y-3 mb-4">
                    <div className="p-3 rounded border border-border bg-surface text-xs font-mono">
                      <span className="text-text-muted block text-[10px] uppercase font-sans">
                        Recommended Action:
                      </span>
                      <span className="text-text-primary font-semibold">
                        {selectedIncident.recommended_action}
                      </span>
                    </div>

                    <div className="p-3 rounded border border-border bg-surface text-xs font-mono">
                      <span className="text-text-muted block text-[10px] uppercase font-sans">
                        Automated Rollback Plan:
                      </span>
                      <span className="text-text-secondary">
                        {selectedIncident.rollback_plan}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => handleApprove(selectedIncident)}
                      disabled={currentRemediationStatus === 'approved'}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded bg-accent hover:bg-accent-hover text-white text-xs font-medium transition-colors disabled:opacity-50"
                    >
                      <CheckCircle className="h-3.5 w-3.5" />
                      <span>Simulate & Approve</span>
                    </button>

                    <button
                      onClick={() => handleReject(selectedIncident)}
                      disabled={currentRemediationStatus === 'rejected'}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border hover:bg-surface-hover text-text-primary text-xs font-medium transition-colors disabled:opacity-50"
                    >
                      <span>Reject Action</span>
                    </button>

                    <button
                      onClick={() => handleRollback(selectedIncident)}
                      disabled={currentRemediationStatus === 'rolled_back'}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#C2414B]/30 bg-[#FDF2F2] hover:bg-[#FBEAEA] text-[#C2414B] text-xs font-medium transition-colors disabled:opacity-50"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>Trigger Rollback</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Immutable Session Audit Log */}
              <div className="rounded-lg border border-border bg-surface shadow-card overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border bg-surface-secondary flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <History className="h-3.5 w-3.5 text-text-muted" />
                    <span className="text-xs font-semibold text-text-primary">
                      Session Remediation Audit Trail
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-text-muted">
                    {auditLog.length} entries
                  </span>
                </div>

                <div className="divide-y divide-border-subtle font-mono text-xs max-h-48 overflow-y-auto">
                  {auditLog.map((log) => (
                    <div key={log.id} className="p-3 text-[11px] hover:bg-surface-hover/50">
                      <div className="flex items-center justify-between text-text-muted mb-1">
                        <span>{log.timestamp.slice(11, 19)} UTC • {log.operator}</span>
                        <StatusBadge status={log.status} />
                      </div>
                      <div className="font-semibold text-text-primary">{log.action}</div>
                      <div className="text-text-secondary text-[10px] mt-0.5">{log.note}</div>
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
