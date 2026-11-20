import React from 'react';
import { AlertTriangle, Info, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { SaasApiError, SaasClient } from '../api/client';
import type { IncidentAnalysisResponse, IncidentEvidence, IncidentItem } from '../types/saas';

interface IncidentsViewProps {
  incidents: IncidentItem[];
  dataAvailable: boolean;
  client: SaasClient;
  isLoading: boolean;
  isStale: boolean;
}

function timestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Invalid timestamp' : `${date.toLocaleString(undefined, { timeZone: 'UTC', hour12: false })} UTC`;
}

export const IncidentsView: React.FC<IncidentsViewProps> = ({ incidents, dataAvailable, client, isLoading, isStale }) => {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [evidence, setEvidence] = React.useState<IncidentEvidence[]>([]);
  const [loadingEvidence, setLoadingEvidence] = React.useState(false);
  const [evidenceError, setEvidenceError] = React.useState<string | null>(null);
  const [analysis, setAnalysis] = React.useState<IncidentAnalysisResponse | null>(null);
  const [analysisLoading, setAnalysisLoading] = React.useState(false);
  const [analysisError, setAnalysisError] = React.useState<string | null>(null);
  const [retryingAnalysis, setRetryingAnalysis] = React.useState(false);
  const [severityFilter, setSeverityFilter] = React.useState('all');
  const [statusFilter, setStatusFilter] = React.useState('all');
  const filteredIncidents = incidents.filter((incident) =>
    (severityFilter === 'all' || incident.severity === severityFilter)
    && (statusFilter === 'all' || incident.status === statusFilter));
  const selected = filteredIncidents.find((incident) => incident.incident_id === selectedId) || filteredIncidents[0] || null;
  const visibleSelected = selected;

  React.useEffect(() => {
    let active = true;
    if (!selected || !dataAvailable) {
      setEvidence([]);
      setAnalysis(null);
      return () => { active = false; };
    }
    setSelectedId(selected.incident_id);
    setLoadingEvidence(true);
    setAnalysisLoading(true);
    setEvidenceError(null);
    setAnalysisError(null);
    void Promise.allSettled([
      client.getIncidentEvidence(selected.incident_id),
      client.getIncidentAnalysis(selected.incident_id),
    ]).then(([evidenceResult, analysisResult]) => {
      if (!active) return;
      if (evidenceResult.status === 'fulfilled') setEvidence(evidenceResult.value.items);
      else {
        setEvidence([]);
        setEvidenceError(evidenceResult.reason instanceof SaasApiError && evidenceResult.reason.status === 404
          ? 'The incident or its evidence is no longer available for this tenant.'
          : 'Incident evidence could not be loaded.');
      }
      if (analysisResult.status === 'fulfilled') setAnalysis(analysisResult.value);
      else setAnalysisError('Advisory analysis could not be loaded from the SaaS API.');
    }).finally(() => {
      if (active) { setLoadingEvidence(false); setAnalysisLoading(false); }
    });
    return () => { active = false; };
  }, [client, selected?.incident_id, dataAvailable]);

  const retryAnalysis = async () => {
    if (!selected) return;
    setRetryingAnalysis(true);
    setAnalysisError(null);
    try {
      const pending = await client.retryIncidentAnalysis(selected.incident_id);
      setAnalysis(pending);
      const refreshed = await client.getIncidentAnalysis(selected.incident_id);
      setAnalysis(refreshed);
    } catch (error) {
      setAnalysisError(error instanceof SaasApiError ? error.detail : 'Analysis retry could not be requested.');
    } finally { setRetryingAnalysis(false); }
  };

  const refreshAnalysis = async () => {
    if (!selected) return;
    setAnalysisLoading(true);
    setAnalysisError(null);
    try { setAnalysis(await client.getIncidentAnalysis(selected.incident_id)); }
    catch { setAnalysisError('Advisory analysis could not be refreshed from the SaaS API.'); }
    finally { setAnalysisLoading(false); }
  };

  return (
    <div className="space-y-6">
      {isStale && <div className="rounded border border-[#62635D]/30 bg-[#E8E6DE] p-3 text-xs">Incident list may be stale because the latest SaaS refresh failed.</div>}
      <div className="rounded-lg border border-border bg-surface p-4 text-xs text-text-secondary"><div className="flex items-center gap-2 font-semibold text-text-primary"><Info className="h-4 w-4 text-accent" />Interpretation</div><p className="mt-1">Incidents group correlated telemetry evidence. Correlation does not confirm root cause. Recommended actions are persisted suggestions and are not executed by this dashboard.</p></div>
      <section className="rounded-lg border border-border bg-surface shadow-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3"><h2 className="flex items-center gap-2 text-xs font-semibold"><AlertTriangle className="h-4 w-4 text-accent" />Persisted incidents</h2><div className="flex items-center gap-2 text-[10px] text-text-muted"><label>Severity<select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)} className="ml-1 border border-border bg-surface px-2 py-1"><option value="all">All</option>{['critical', 'high', 'medium', 'low'].map((value) => <option key={value}>{value}</option>)}</select></label><label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="ml-1 border border-border bg-surface px-2 py-1"><option value="all">All</option>{['active', 'investigating', 'resolved'].map((value) => <option key={value}>{value}</option>)}</select></label><span>{isLoading ? 'Refreshing…' : `${filteredIncidents.length} shown`}</span></div></div>
        {!filteredIncidents.length ? <p className="p-8 text-center text-xs text-text-muted">{!incidents.length ? (dataAvailable ? 'No incidents were returned by the SaaS API.' : 'Incident data is unavailable.') : 'No incidents match the selected filters.'}</p> : <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="divide-y divide-border-subtle border-b border-border lg:border-b-0 lg:border-r">{filteredIncidents.map((incident) => <button key={incident.incident_id} onClick={() => setSelectedId(incident.incident_id)} className={`block w-full px-4 py-3 text-left ${visibleSelected?.incident_id === incident.incident_id ? 'bg-accent-light/40' : 'hover:bg-surface-hover'}`}><div className="flex items-center justify-between gap-2"><strong className="text-xs">{incident.service}</strong><span className="text-[10px] uppercase">{incident.severity} · {incident.status}</span></div><span className="mt-1 block font-mono text-[10px] text-text-muted">{incident.incident_id}</span><span className="mt-1 block text-[10px] text-text-secondary">First seen {timestamp(incident.started_at)}</span></button>)}</div>
          {visibleSelected && <div className="space-y-4 p-4">
            <div><h3 className="text-sm font-semibold">{visibleSelected.service}</h3><p className="mt-1 text-[11px] text-text-secondary">{visibleSelected.severity} · {visibleSelected.status} · confidence {(visibleSelected.confidence * 100).toFixed(0)}% (backend value)</p><div className="mt-2 grid grid-cols-1 gap-1 text-[11px] text-text-muted sm:grid-cols-2"><span>First seen: {timestamp(visibleSelected.started_at)}</span><span>Last seen: {timestamp(visibleSelected.last_seen_at)}</span></div></div>
            <div className="rounded border border-border bg-surface-secondary p-3 text-xs"><strong>Persisted recommendation</strong><p className="mt-1">{visibleSelected.recommended_action || 'Not provided'}</p><p className="mt-2 text-text-muted">Rollback: {visibleSelected.rollback_plan || 'Not provided'}</p></div>
            <div><h4 className="mb-2 text-xs font-semibold">Evidence and detector signals</h4>{loadingEvidence && <p className="text-xs text-text-muted">Loading persisted evidence…</p>}{evidenceError && <p className="text-xs text-[#B83A32]">{evidenceError}</p>}{!loadingEvidence && !evidenceError && evidence.length === 0 && <p className="text-xs text-text-muted">No persisted evidence rows were returned.</p>}
              <div className="space-y-3">{evidence.map((row) => <IncidentEvidenceRow key={row.payload_id} row={row} />)}</div>
            </div>
            <section className="border border-border bg-surface p-4" aria-labelledby="analysis-title">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border-subtle pb-3">
                <div><h4 id="analysis-title" className="flex items-center gap-2 text-xs font-semibold"><Sparkles className="h-4 w-4 text-signal" />Advisory reasoning rail</h4><p className="mt-1 text-[10px] text-text-secondary">AI findings are hypotheses; deterministic detection remains authoritative.</p></div>
                <div className="flex gap-2"><button onClick={() => void refreshAnalysis()} disabled={analysisLoading} className="inline-flex items-center gap-2 border border-border px-3 py-1.5 text-[10px] font-semibold disabled:opacity-50"><RefreshCw className={`h-3 w-3 ${analysisLoading ? 'animate-spin' : ''}`} />Refresh</button>{analysis?.status === 'failed' && <button onClick={() => void retryAnalysis()} disabled={retryingAnalysis} className="inline-flex items-center gap-2 border border-ink bg-ink px-3 py-1.5 text-[10px] font-semibold text-paper disabled:opacity-50"><RefreshCw className={`h-3 w-3 ${retryingAnalysis ? 'animate-spin' : ''}`} />Retry</button>}</div>
              </div>
              {analysisLoading && <p className="py-4 text-xs text-text-muted">Loading persisted analysis and provenance…</p>}
              {analysisError && <p role="alert" className="py-3 text-xs text-signal">{analysisError}</p>}
              {!analysisLoading && analysis && <div className="space-y-3 pt-3 text-xs">
                <div className="flex flex-wrap items-center gap-2"><span className="font-mono uppercase">{analysis.status.replace('_', ' ')}</span>{analysis.provider && <span className="text-text-muted">{analysis.provider} · {analysis.model}</span>}{analysis.result?.fusion && <span className="inline-flex items-center gap-1 border border-border px-2 py-1 text-[10px]"><ShieldCheck className="h-3 w-3" />Effective severity: {analysis.result.fusion.effective_severity} · deterministic authority</span>}</div>
                {analysis.safe_error_code && <p className="text-text-secondary">Safe failure code: <code>{analysis.safe_error_code}</code>{analysis.safe_error_code === 'provider_not_configured' ? ' — advisory provider is not configured.' : ''}</p>}
                {analysis.result?.analysis && <>
                  <p className="leading-relaxed">{analysis.result.analysis.summary}</p>
                  {analysis.result.fusion.disagreement_recorded && <p className="border-l-2 border-signal bg-[#F3E4DF] px-3 py-2 text-[#8F2D27]">AI assessment disagrees with deterministic evidence. Incident severity remains {analysis.result.fusion.effective_severity}.</p>}
                  <div className="grid gap-3 lg:grid-cols-2"><div><strong className="text-[10px] uppercase tracking-wide text-text-secondary">Hypotheses</strong>{analysis.result.analysis.likely_causes.map((cause) => <article key={cause.hypothesis} className="mt-2 border border-border-subtle p-3"><p>{cause.hypothesis}</p><p className="mt-1 font-mono text-[10px] text-text-muted">Confidence {(cause.confidence * 100).toFixed(0)}% · evidence {cause.evidence_ids.join(', ')}</p></article>)}</div><div><strong className="text-[10px] uppercase tracking-wide text-text-secondary">Recommended investigation steps</strong><ul className="mt-2 list-decimal space-y-1 pl-5">{analysis.result.analysis.recommended_steps.map((step, index) => <li key={`${index}:${step}`}>{step}</li>)}</ul></div></div>
                  <p className="text-[10px] text-text-muted">Analysis confidence {(analysis.result.analysis.confidence * 100).toFixed(0)}% · assessment {analysis.result.analysis.assessment} · cites {analysis.result.analysis.evidence_ids.length} persisted evidence IDs.</p>
                  {analysis.result.analysis.limitations.length > 0 && <p className="text-[10px] text-text-secondary">Limitations: {analysis.result.analysis.limitations.join(' ')}</p>}
                </>}
                {analysis.status === 'not_requested' && <p className="text-text-muted">No advisory analysis has been recorded for this incident.</p>}
                {analysis.status === 'pending' && <p className="text-text-muted">Analysis is pending. Refresh the incident view to check for a result.</p>}
                {analysis.prompt_version && <p className="break-all font-mono text-[9px] text-text-muted">Provenance: {analysis.prompt_version} · SHA-256 {analysis.prompt_hash}</p>}
              </div>}
            </section>
          </div>}
        </div>}
      </section>
    </div>
  );
};

export const IncidentEvidenceRow: React.FC<{ row: IncidentEvidence }> = ({ row }) => (
  <article className="rounded border border-border p-3 text-[11px]">
    <div className="flex flex-wrap justify-between gap-2"><strong>{row.service} · {row.environment}</strong><span className="font-mono text-text-muted">{timestamp(row.event_time)}</span></div>
    <p className="mt-1 font-mono text-text-muted">Payload {row.payload_id} · collector {row.collector_id}</p>
    {!row.signals.length ? <p className="mt-2 text-text-muted">No detector signals stored for this observation.</p> : <div className="mt-2 space-y-2">{row.signals.map((signal, index) => <div key={`${signal.metric}:${index}`} className="rounded bg-surface-secondary p-2"><div className="flex flex-wrap justify-between gap-2"><strong>{signal.metric}</strong><span className="capitalize">{signal.severity} · {signal.method}</span></div><p className="mt-1">Observed {signal.observed_value}; baseline {signal.baseline ?? 'unavailable'}; samples {signal.sample_count}; threshold {signal.threshold ?? 'unavailable'}</p><p className="mt-1 text-text-secondary">{signal.description}</p><p className="mt-1 font-mono text-text-muted">Signal time: {timestamp(signal.event_time)}</p></div>)}</div>}
  </article>
);
