import React from 'react';
import { CheckCircle, Copy, FileCode, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { CollectorClient } from '../api/collector';
import type { CollectorHealth, CollectorQueueStatus, EgressPreview } from '../types/collector';

export const EgressProofView: React.FC<{ collectorClient: CollectorClient }> = ({ collectorClient }) => {
  const [preview, setPreview] = React.useState<EgressPreview | null>(null);
  const [health, setHealth] = React.useState<CollectorHealth | null>(null);
  const [queue, setQueue] = React.useState<CollectorQueueStatus | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [approving, setApproving] = React.useState(false);
  const [rejecting, setRejecting] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const refresh = React.useCallback(async (payloadId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const [egress, collectorHealth, collectorQueue] = await Promise.all([
        collectorClient.getEgressPreview(payloadId), collectorClient.getHealth(), collectorClient.getQueue(),
      ]);
      setPreview(egress);
      setHealth(collectorHealth);
      setQueue(collectorQueue);
    } catch {
      setError(`Local collector API is unavailable at ${collectorClient.getBaseUrl()}.`);
    } finally {
      setLoading(false);
    }
  }, [collectorClient]);

  React.useEffect(() => { void refresh(); }, [refresh]);

  const approve = async () => {
    if (!preview?.payload_id) return;
    setApproving(true);
    try {
      await collectorClient.approveEgress(preview.payload_id);
      await refresh(preview.payload_id);
    } catch {
      setError('The collector rejected the egress approval request.');
    } finally {
      setApproving(false);
    }
  };

  const reject = async () => {
    if (!preview?.payload_id) return;
    setRejecting(true);
    try {
      await collectorClient.rejectEgress(preview.payload_id);
      await refresh(preview.payload_id);
    } catch {
      setError('The collector rejected the local rejection request.');
    } finally {
      setRejecting(false);
    }
  };

  const copyPayload = async () => {
    const payload = preview?.payload_json || (preview?.payload ? JSON.stringify(preview.payload, null, 2) : '');
    if (!payload) return;
    await navigator.clipboard.writeText(payload);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-accent" /><div><h2 className="text-sm font-semibold">Local collector egress review</h2><p className="mt-1 text-xs text-text-secondary">Review the exact normalized payload. Only an explicitly approved, integrity-checked record can enter delivery.</p></div></div><button onClick={() => void refresh(preview?.payload_id)} disabled={loading} className="flex items-center gap-2 rounded border border-border px-3 py-2 text-xs disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh</button></div>
        {error && <p role="alert" className="mt-4 rounded border border-[#B83A32]/30 bg-[#F3E4DF] p-3 text-xs text-[#B83A32]">{error}</p>}
        {health && <div className="mt-4 flex flex-wrap gap-5 border-t border-border-subtle pt-3 text-xs"><span>Local collector: <strong>{health.operational_status}</strong></span><span>Queue depth: <strong>{queue?.queue_depth ?? health.queue_depth}</strong></span><span>Pending delivery: <strong>{queue?.pending_delivery ?? 'Unavailable'}</strong></span><span>Last delivery success: <strong>{health.last_delivery_success ? `${new Date(health.last_delivery_success).toLocaleString(undefined, { timeZone: 'UTC' })} UTC` : 'Unavailable'}</strong></span></div>}
      </section>
      <section className="rounded-lg border border-border bg-surface shadow-card overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-3"><h3 className="flex items-center gap-2 text-xs font-semibold"><FileCode className="h-4 w-4 text-accent" />Queued outbound payload</h3><button disabled={!preview?.payload && !preview?.payload_json} onClick={() => void copyPayload()} className="flex items-center gap-1 text-xs text-text-secondary disabled:opacity-40"><Copy className="h-3.5 w-3.5" />{copied ? 'Copied' : 'Copy payload'}</button></div>
        {preview?.payload_json ? <pre className="max-h-[32rem] overflow-auto p-4 text-xs">{preview.payload_json}</pre> : <p className="p-8 text-center text-xs text-text-muted">{loading ? 'Loading collector preview…' : preview?.validation_status === 'integrity_error' ? 'Payload integrity check failed; this record cannot be approved or displayed.' : 'No queued payload is available for review.'}</p>}
        {preview?.payload_id && <div className="border-t border-border p-4 text-xs">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <p>Queue record ID: <code>{preview.payload_id}</code></p>
            <p>Schema: <strong>{preview.schema_version || 'Unavailable'}</strong></p>
            <p>Capture time: <strong>{preview.capture_timestamp || 'Unavailable'}</strong></p>
            <p>Source category: <strong>{preview.source_category || 'unknown'}</strong></p>
            <p>Security telemetry: <strong>{preview.security_status || 'unknown'}</strong></p>
            <p>Approval: <strong>{preview.egress_review_status || 'Unavailable'}</strong></p>
          </div>
          <p className="mt-3">Sanitized metrics: <code>{JSON.stringify(preview.metrics || {})}</code></p>
          <p className="mt-2">Validation: {preview.validation_status || 'Unavailable'} · Transmission: {preview.transmission_status}</p>
          <p className="mt-2 text-text-muted">Excluded fields: {preview.excluded_field_count ?? 'Unavailable'} · Categories: {(preview.excluded_field_categories || []).join(', ') || 'none reported'}</p>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button onClick={() => void reject()} disabled={rejecting || preview.egress_review_status !== 'awaiting_review'} className="flex items-center gap-2 rounded border border-border px-4 py-2 disabled:opacity-50"><XCircle className="h-4 w-4" />{rejecting ? 'Rejecting…' : 'Reject and keep local'}</button>
            <button onClick={() => void approve()} disabled={approving || preview.egress_review_status !== 'awaiting_review' || preview.validation_status !== 'valid'} className="flex items-center gap-2 rounded bg-accent px-4 py-2 text-white disabled:opacity-50"><CheckCircle className="h-4 w-4" />{approving ? 'Approving…' : 'Approve transmission'}</button>
          </div>
        </div>}
      </section>
    </div>
  );
};
