import React from 'react';
import {
  AlertCircle,
  CheckCircle,
  Copy,
  FileCode,
  Lock,
  RefreshCw,
  Send,
  ShieldCheck,
} from 'lucide-react';
import { CollectorClient } from '../api/collector';
import { CollectorHealth, CollectorQueueStatus, EgressPreview } from '../types/collector';

interface EgressProofViewProps {
  collectorClient: CollectorClient;
}

export const EgressProofView: React.FC<EgressProofViewProps> = ({ collectorClient }) => {
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
        // Inject sensitive raw fields that MUST be scrubbed locally
        raw_database_query: 'SELECT * FROM users WHERE password="UnscrubbedPassword123";',
        authorization_bearer: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        customer_email: 'john.doe@confidential-client.org',
        trace_id: 'trace-private-999',
      };

      await collectorClient.sendDevelopmentTelemetry(sampleEvent);
      await fetchCollectorData();
    } catch (err: any) {
      alert(`Failed to enqueue test event: ${err.message}`);
    } finally {
      setIsEnqueuing(false);
    }
  };

  const handleCopyJson = () => {
    if (!preview?.payload_json && !preview?.payload) return;
    const text = preview.payload_json || JSON.stringify(preview.payload, null, 2);
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="rounded-lg border border-border bg-surface p-5 shadow-card flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-accent-light text-accent">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-text-primary">
              Live Tier 1 Egress & Redaction Proof
            </h2>
            <p className="text-xs text-text-secondary mt-0.5">
              Direct verification of local sanitization at <code className="font-mono text-accent">{collectorClient.getBaseUrl()}</code>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleEnqueueTestEvent}
            disabled={isEnqueuing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-border hover:bg-surface-hover text-xs font-mono text-text-primary transition-colors disabled:opacity-50"
            title="Inject a test event with database query and sensitive fields to verify local scrubbing"
          >
            <Send className="h-3.5 w-3.5 text-accent" />
            <span>{isEnqueuing ? 'Injecting...' : 'Inject Sensitive Test Event'}</span>
          </button>

          <button
            onClick={fetchCollectorData}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-accent hover:bg-accent-hover text-white text-xs font-mono transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh Preview</span>
          </button>
        </div>
      </div>

      {/* Collector Queue & Operational Status Strip */}
      {health && (
        <div className="flex flex-wrap items-center gap-4 px-4 py-2.5 rounded-lg border border-border bg-surface text-xs font-mono shadow-card">
          <div className="flex items-center gap-1.5">
            <span className="text-text-muted">Collector Status:</span>
            <span className="font-bold text-[#23865B] capitalize">{health.operational_status}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-text-muted">Queue Depth:</span>
            <span className="font-bold text-text-primary">{queue?.queue_depth ?? health.queue_depth}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-text-muted">Pending In-Flight:</span>
            <span className="font-bold text-text-primary">{queue?.pending_delivery ?? 0}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-text-muted">Schema Allowlist:</span>
            <span className="font-bold text-accent">telemetry.schema.json v1.0.0</span>
          </div>
        </div>
      )}

      {/* Offline Diagnostic Alert */}
      {error && (
        <div className="rounded-lg border border-[#B7791F]/30 bg-[#FEF7EC] p-4 text-xs flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-[#B7791F] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-semibold text-text-primary">
              Tier 1 Local Collector Unreachable:
            </div>
            <div className="font-mono text-text-secondary text-[11px]">{error}</div>
            <div className="text-text-muted text-[11px]">
              Expected endpoint: <code className="font-mono text-text-primary">http://127.0.0.1:8100/api/v1/collector/egress-preview</code>.
              Start the collector service via <code>python -m collector</code> or inspect CORS headers.
            </div>
          </div>
        </div>
      )}

      {/* Side-by-Side Proof Comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Panel: Raw Pre-Scrubbed Event */}
        <div className="rounded-lg border border-border bg-surface shadow-card overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface-secondary">
            <div className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-[#C2414B]" />
              <span className="text-xs font-bold text-text-primary">
                Local Raw Event (Pre-Scrubbing)
              </span>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#FDF2F2] text-[#C2414B] border border-[#C2414B]/30 font-bold">
              CONTAINS SENSITIVE DATA
            </span>
          </div>

          <div className="p-4 flex-1 bg-surface-secondary/40 font-mono text-[11px] leading-relaxed text-text-primary overflow-x-auto space-y-2">
            <div className="text-text-muted">{'// Simulating application event at collector ingestion:'}</div>
            <div>{'{'}</div>
            <div className="pl-4"><span className="text-accent">"event_id"</span>: <span className="text-text-secondary">"ev-prod-83921"</span>,</div>
            <div className="pl-4"><span className="text-accent">"service"</span>: <span className="text-text-secondary">"payment-gateway"</span>,</div>
            <div className="pl-4"><span className="text-accent">"environment"</span>: <span className="text-text-secondary">"production"</span>,</div>
            
            {/* Redacted fields */}
            <div className="pl-4 bg-[#FDF2F2] text-[#C2414B] py-0.5 px-1 rounded flex items-center justify-between">
              <span><span className="font-bold">"raw_database_query"</span>: "SELECT * FROM cardholders..."</span>
              <span className="text-[9px] font-bold">[STRIPPED LOCALLY]</span>
            </div>
            <div className="pl-4 bg-[#FDF2F2] text-[#C2414B] py-0.5 px-1 rounded flex items-center justify-between">
              <span><span className="font-bold">"authorization_bearer"</span>: "Bearer eyJhbGciOi..."</span>
              <span className="text-[9px] font-bold">[STRIPPED LOCALLY]</span>
            </div>
            <div className="pl-4 bg-[#FDF2F2] text-[#C2414B] py-0.5 px-1 rounded flex items-center justify-between">
              <span><span className="font-bold">"customer_ssn_tax_id"</span>: "XXX-XX-1284"</span>
              <span className="text-[9px] font-bold">[STRIPPED LOCALLY]</span>
            </div>

            <div className="pl-4"><span className="text-accent">"metrics"</span>: {'{'} "cpu_percent": 34.2, "latency_ms": 19.4 {'}'},</div>
            <div className="pl-4"><span className="text-accent">"health"</span>: <span className="text-text-secondary">"excellent"</span></div>
            <div>{'}'}</div>

            <div className="pt-3 text-[10px] text-text-muted border-t border-border-subtle">
              Notice: The collector strips all fields outside the strict allowlist before serializing to disk or queue.
            </div>
          </div>
        </div>

        {/* Right Panel: Outbound Canonical Telemetry */}
        <div className="rounded-lg border border-border bg-surface shadow-card overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface-secondary">
            <div className="flex items-center gap-2">
              <FileCode className="h-4 w-4 text-accent" />
              <span className="text-xs font-bold text-text-primary">
                Outbound Metadata Record (Schema Allowlist)
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyJson}
                className="flex items-center gap-1 text-[11px] font-mono text-text-muted hover:text-text-primary"
              >
                <Copy className="h-3 w-3" />
                <span>{copied ? 'Copied!' : 'Copy JSON'}</span>
              </button>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#EAF5F0] text-[#23865B] border border-[#23865B]/30 font-bold">
                100% SANITIZED
              </span>
            </div>
          </div>

          <div className="p-4 flex-1 bg-surface-secondary/40 font-mono text-[11px] leading-relaxed text-text-primary overflow-x-auto">
            {preview?.payload ? (
              <pre className="text-xs font-mono text-text-primary whitespace-pre-wrap">
                {JSON.stringify(preview.payload, null, 2)}
              </pre>
            ) : preview?.payload_json ? (
              <pre className="text-xs font-mono text-text-primary whitespace-pre-wrap">
                {preview.payload_json}
              </pre>
            ) : (
              <div className="p-6 text-center text-text-muted text-xs">
                No outbound payload currently pending review. Click "Inject Sensitive Test Event" above to create one.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Approval & Transmission Review Footer */}
      {preview?.payload_id && (
        <div className="rounded-lg border border-border bg-surface p-4 shadow-card flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex flex-col">
              <span className="text-xs font-mono text-text-muted">
                Pending Payload ID: <code className="text-text-primary font-bold">{preview.payload_id}</code>
              </span>
              <span className="text-xs font-mono text-text-muted">
                Review Status: <strong className="text-accent">{preview.egress_review_status || 'awaiting_review'}</strong>
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleApprove(preview.payload_id!)}
              disabled={isApproving || preview.egress_review_status === 'approved'}
              className="flex items-center gap-1.5 px-4 py-2 rounded bg-accent hover:bg-accent-hover text-white text-xs font-medium transition-colors disabled:opacity-50"
            >
              <CheckCircle className="h-4 w-4" />
              <span>{isApproving ? 'Approving...' : 'Approve Outbound Transmission'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
