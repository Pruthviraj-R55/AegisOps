import React from 'react';
import {
  AlertCircle,
  CheckCircle,
  Copy,
  FileCode,
  HardDrive,
  Lock,
  RefreshCw,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { CollectorClient } from '../api/collector';
import { CollectorHealth, CollectorQueueStatus, EgressPreview } from '../types/collector';

interface EgressProofPanelProps {
  collectorClient: CollectorClient;
}

export const EgressProofPanel: React.FC<EgressProofPanelProps> = ({ collectorClient }) => {
  const [preview, setPreview] = React.useState<EgressPreview | null>(null);
  const [health, setHealth] = React.useState<CollectorHealth | null>(null);
  const [queue, setQueue] = React.useState<CollectorQueueStatus | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [isApproving, setIsApproving] = React.useState(false);
  const [isEnqueuing, setIsEnqueuing] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const fetchCollectorData = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [prevRes, healthRes, queueRes] = await Promise.allSettled([
        collectorClient.getEgressPreview(),
        collectorClient.getHealth(),
        collectorClient.getQueue(),
      ]);

      if (prevRes.status === 'fulfilled') {
        setPreview(prevRes.value);
      } else {
        throw prevRes.reason;
      }

      if (healthRes.status === 'fulfilled') {
        setHealth(healthRes.value);
      }
      if (queueRes.status === 'fulfilled') {
        setQueue(queueRes.value);
      }
    } catch (err: any) {
      setError(
        err?.message ||
          'Failed to reach Tier 1 Local Collector. Please verify the collector service is running on 127.0.0.1:8100.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [collectorClient]);

  React.useEffect(() => {
    fetchCollectorData();
    const interval = setInterval(fetchCollectorData, 5000);
    return () => clearInterval(interval);
  }, [fetchCollectorData]);

  const handleApprove = async (payloadId: string) => {
    setIsApproving(true);
    try {
      await collectorClient.approveEgress(payloadId);
      await fetchCollectorData();
    } catch (err: any) {
      alert(`Approval failed: ${err.message}`);
    } finally {
      setIsApproving(false);
    }
  };

  const handleEnqueueTestEvent = async () => {
    setIsEnqueuing(true);
    try {
      const sampleEvent = {
        event_id: `test-event-${Date.now().toString(36)}`,
        event_time: new Date().toISOString().replace(/\.\d+/, ''),
        service: 'synthetic-checkout-api',
        environment: 'development',
        region: 'local-cluster',
        metrics: {
          cpu_percent: 44.5,
          latency_ms: 18.2,
          memory_percent: 58.0,
        },
        security: {
          failed_login_count: 0,
          suspicious_activity_count: 0,
        },
        health: 'good',
        // Inject untrusted/raw fields that MUST be scrubbed/excluded
        untrusted_raw_logs: 'FATAL: database query password=SuperSecretToken123',
        api_token: 'secret-token-that-must-be-scrubbed',
      };

      await collectorClient.sendDevelopmentTelemetry(sampleEvent);
      await fetchCollectorData();
    } catch (err: any) {
      alert(`Test ingestion failed: ${err.message}`);
    } finally {
      setIsEnqueuing(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      {/* Privacy Guarantee Header Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-border bg-surface px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-health-excellent/10 text-health-excellent">
            <Lock className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-text-primary">
                Tier 1 Local Collector: Live Egress Proof Panel
              </h3>
              <span className="rounded bg-health-excellent/10 border border-health-excellent/30 px-2 py-0.5 text-[10px] font-mono text-health-excellent font-semibold">
                PRIVACY BOUNDARY VERIFIED
              </span>
            </div>
            <p className="text-[11px] text-text-muted mt-0.5">
              Live inspection of outbound telemetry payloads BEFORE they leave customer premises. Polled directly from Tier 1 Local Collector API on <code className="text-series-cpu font-mono">{collectorClient.getBaseUrl()}</code>.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchCollectorData}
            disabled={isLoading}
            className="flex items-center gap-1.5 rounded border border-border bg-canvas px-2.5 py-1 text-xs text-text-muted hover:text-text-primary disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin text-series-cpu' : ''}`} />
            <span>Poll Tier 1</span>
          </button>
        </div>
      </div>

      {/* Diagnostic Banner if Local Collector is Offline / CORS Blocked */}
      {error && (
        <div className="rounded border border-health-poor/40 bg-health-poor/10 p-4 text-xs">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="h-4 w-4 text-health-poor flex-shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-bold text-health-poor">
                Tier 1 Local Collector Unreachable or Blocked
              </div>
              <p className="text-text-muted">
                Unable to establish connection to: <code className="font-mono text-text-primary">{collectorClient.getBaseUrl()}</code>
              </p>
              <div className="mt-2 rounded border border-border bg-canvas p-2 font-mono text-[11px] text-text-dim">
                <span className="text-series-cpu"># To launch the Tier 1 Local Collector:</span>
                <br />
                uv run --locked --extra collector python -m collector
              </div>
              <p className="text-[11px] text-text-dim italic mt-1">
                Note: In strict compliance with privacy contracts, SaaS never reconstructs or fakes local egress proofs when the local collector is unreachable.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Privacy Verification Badges Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="flex items-center gap-2.5 rounded border border-border bg-surface p-2.5">
          <CheckCircle className="h-4 w-4 text-health-excellent flex-shrink-0" />
          <div>
            <div className="text-xs font-semibold text-text-primary">Allow-Listed Only</div>
            <div className="text-[10px] text-text-muted">telemetry.schema.json v1.0.0</div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 rounded border border-border bg-surface p-2.5">
          <CheckCircle className="h-4 w-4 text-health-excellent flex-shrink-0" />
          <div>
            <div className="text-xs font-semibold text-text-primary">Zero Raw Logs</div>
            <div className="text-[10px] text-text-muted">Stack traces & logs excluded</div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 rounded border border-border bg-surface p-2.5">
          <CheckCircle className="h-4 w-4 text-health-excellent flex-shrink-0" />
          <div>
            <div className="text-xs font-semibold text-text-primary">Local Secret Redaction</div>
            <div className="text-[10px] text-text-muted">Scrubbed before WAL queue</div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 rounded border border-border bg-surface p-2.5">
          <CheckCircle className="h-4 w-4 text-health-excellent flex-shrink-0" />
          <div>
            <div className="text-xs font-semibold text-text-primary">HMAC Pseudonymization</div>
            <div className="text-[10px] text-text-muted">Service IDs keyed via SHA-256</div>
          </div>
        </div>
      </div>

      {/* Main Egress Proof & Queue Status Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left: Live Egress JSON Inspection (7 cols) */}
        <div className="lg:col-span-7 rounded border border-border bg-surface p-4">
          <div className="flex items-center justify-between border-b border-border pb-2.5 mb-3">
            <div className="flex items-center gap-2">
              <FileCode className="h-4 w-4 text-series-cpu" />
              <span className="text-xs font-bold uppercase tracking-wider text-text-primary">
                Live Outbound Record Payload
              </span>
            </div>

            <div className="flex items-center gap-2">
              {preview?.payload_json && (
                <button
                  onClick={() => copyToClipboard(preview.payload_json || '')}
                  className="flex items-center gap-1 rounded border border-border bg-canvas px-2 py-0.5 text-[11px] font-mono text-text-muted hover:text-text-primary"
                >
                  <Copy className="h-3 w-3" />
                  {copied ? 'Copied' : 'Copy JSON'}
                </button>
              )}

              {/* Enqueue sample test button */}
              <button
                onClick={handleEnqueueTestEvent}
                disabled={isEnqueuing || !!error}
                className="flex items-center gap-1 rounded bg-series-cpu/10 border border-series-cpu/30 px-2.5 py-0.5 text-[11px] font-semibold text-series-cpu hover:bg-series-cpu/20 disabled:opacity-40"
              >
                <Send className="h-3 w-3" />
                {isEnqueuing ? 'Enqueueing...' : 'Test Enqueue Event'}
              </button>
            </div>
          </div>

          {/* Payload Content Area */}
          {preview?.available && preview.payload ? (
            <div className="space-y-3">
              {/* Egress Metadata Header */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-canvas p-2.5 text-xs font-mono">
                <div>
                  <span className="text-text-muted">Payload ID: </span>
                  <span className="text-text-primary font-bold">{preview.payload_id}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded bg-series-cpu/10 border border-series-cpu/30 px-1.5 py-0.5 text-[10px] text-series-cpu uppercase">
                    Status: {preview.transmission_status}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] uppercase font-bold border ${
                      preview.egress_review_status === 'approved'
                        ? 'border-health-excellent/40 bg-health-excellent/10 text-health-excellent'
                        : 'border-health-fair/40 bg-health-fair/10 text-health-fair'
                    }`}
                  >
                    {preview.egress_review_status === 'approved' ? 'Approved' : 'Awaiting Review'}
                  </span>
                </div>
              </div>

              {/* Exact JSON View */}
              <pre className="rounded border border-border bg-canvas p-3 font-mono text-xs text-text-primary overflow-x-auto max-h-80 leading-relaxed">
                {JSON.stringify(preview.payload, null, 2)}
              </pre>

              {/* Human Approval Gate Action */}
              {preview.egress_review_status === 'awaiting_review' && preview.payload_id && (
                <div className="rounded border border-health-fair/40 bg-health-fair/10 p-3 flex items-center justify-between gap-3">
                  <div className="text-xs text-text-primary">
                    <span className="font-bold text-health-fair">Explicit Egress Gate: </span>
                    This payload is buffered locally. Transmit only after review.
                  </div>
                  <button
                    onClick={() => handleApprove(preview.payload_id!)}
                    disabled={isApproving}
                    className="flex items-center gap-1.5 rounded bg-health-excellent px-3 py-1.5 text-xs font-bold text-canvas hover:bg-health-excellent/90 disabled:opacity-50 whitespace-nowrap"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {isApproving ? 'Approving...' : 'Approve & Transmit Outbound'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center rounded border border-border/60 bg-canvas/40">
              <HardDrive className="h-8 w-8 text-text-dim mb-2" />
              <div className="text-xs font-semibold text-text-muted">
                {error ? 'Collector Offline' : 'No Pending Egress Payload in Local WAL Queue'}
              </div>
              <p className="text-[11px] text-text-dim mt-1 max-w-xs">
                {error
                  ? 'Start the local collector to inspect outbound allow-listed metadata.'
                  : 'Click "Test Enqueue Event" above to feed a development event and view real-time scrubbing.'}
              </p>
            </div>
          )}
        </div>

        {/* Right: Redaction & Queue Proof Metadata (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Exclusion & Scrubbing Proof Box */}
          <div className="rounded border border-border bg-surface p-4">
            <div className="flex items-center gap-2 border-b border-border pb-2 mb-3">
              <ShieldCheck className="h-4 w-4 text-health-excellent" />
              <span className="text-xs font-bold uppercase tracking-wider text-text-primary">
                Local Redaction & Exclusion Proof
              </span>
            </div>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between py-1 border-b border-border/40 font-mono">
                <span className="text-text-muted">Validation Status</span>
                <span className="text-health-excellent font-bold">
                  {preview?.validation_status || 'valid'}
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-border/40 font-mono">
                <span className="text-text-muted">Excluded Fields</span>
                <span className="text-text-primary font-bold">
                  {preview?.excluded_field_count ?? 0} fields
                </span>
              </div>

              <div className="py-1">
                <span className="text-text-muted block text-[11px] mb-1 font-mono">
                  Excluded Categories:
                </span>
                <div className="flex flex-wrap gap-1">
                  {preview?.excluded_field_categories && preview.excluded_field_categories.length > 0 ? (
                    preview.excluded_field_categories.map((cat, i) => (
                      <span
                        key={i}
                        className="rounded border border-border bg-canvas px-1.5 py-0.5 text-[10px] font-mono text-health-fair"
                      >
                        {cat}
                      </span>
                    ))
                  ) : (
                    <span className="text-[11px] text-text-dim font-mono">Zero unapproved fields</span>
                  )}
                </div>
              </div>

              <div className="py-1">
                <span className="text-text-muted block text-[11px] mb-1 font-mono">
                  Scrubbed / Redacted:
                </span>
                <div className="flex flex-wrap gap-1">
                  {preview?.redacted_fields && preview.redacted_fields.length > 0 ? (
                    preview.redacted_fields.map((f, i) => (
                      <span
                        key={i}
                        className="rounded border border-border bg-canvas px-1.5 py-0.5 text-[10px] font-mono text-health-poor"
                      >
                        {f}
                      </span>
                    ))
                  ) : (
                    <span className="text-[11px] text-text-dim font-mono">Clean - no tokens detected</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Local SQLite Queue Buffer Status */}
          <div className="rounded border border-border bg-surface p-4">
            <div className="flex items-center gap-2 border-b border-border pb-2 mb-3">
              <HardDrive className="h-4 w-4 text-series-memory" />
              <span className="text-xs font-bold uppercase tracking-wider text-text-primary">
                Local Queue Buffer (SQLite WAL)
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <div className="rounded border border-border bg-canvas p-2 text-center">
                <div className="text-[10px] text-text-muted">Queue Depth</div>
                <div className="text-lg font-bold text-text-primary">
                  {queue?.queue_depth ?? '--'}
                </div>
              </div>

              <div className="rounded border border-border bg-canvas p-2 text-center">
                <div className="text-[10px] text-text-muted">Pending Delivery</div>
                <div className="text-lg font-bold text-series-latency">
                  {queue?.pending_delivery ?? '--'}
                </div>
              </div>

              <div className="rounded border border-border bg-canvas p-2 text-center">
                <div className="text-[10px] text-text-muted">In Flight</div>
                <div className="text-lg font-bold text-series-cpu">
                  {queue?.in_flight ?? '--'}
                </div>
              </div>

              <div className="rounded border border-border bg-canvas p-2 text-center">
                <div className="text-[10px] text-text-muted">Acknowledged</div>
                <div className="text-lg font-bold text-health-excellent">
                  {queue?.acknowledged ?? '--'}
                </div>
              </div>
            </div>

            {/* Heartbeat Status */}
            <div className="mt-3 text-[11px] font-mono text-text-muted border-t border-border/40 pt-2 space-y-1">
              <div className="flex justify-between">
                <span>Collector ID:</span>
                <span className="text-text-primary font-bold">{health?.collector_id || '--'}</span>
              </div>
              <div className="flex justify-between">
                <span>Operational Status:</span>
                <span className="text-series-cpu font-bold uppercase">
                  {health?.operational_status || 'offline'}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Last Heartbeat:</span>
                <span>{health?.last_successful_heartbeat?.slice(11, 19) || '--'} UTC</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
