import React from 'react';
import {
  CheckCircle,
  KeyRound,
  RotateCcw,
  Server,
  Shield,
} from 'lucide-react';

interface SettingsViewProps {
  currentToken: string;
  onSaveToken: (token: string) => void;
  saasUrl: string;
  collectorUrl: string;
  authEnabled: boolean;
  isAuthenticated?: boolean;
  environmentLabel?: string;
}

function safeEndpointLabel(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return 'Configured endpoint';
  }
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  currentToken,
  onSaveToken,
  saasUrl,
  collectorUrl,
  authEnabled,
  isAuthenticated = false,
  environmentLabel = 'Unavailable',
}) => {
  const [tokenInput, setTokenInput] = React.useState(currentToken);
  const [savedNotice, setSavedNotice] = React.useState(false);

  React.useEffect(() => {
    setTokenInput(currentToken);
  }, [currentToken]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveToken(tokenInput.trim());
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 3000);
  };

  const clearToken = () => {
    setTokenInput('');
    onSaveToken('');
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 3000);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Development-only authentication boundary */}
      <div className="rounded-lg border border-border bg-surface p-5 shadow-card">
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-border-subtle">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-semibold text-text-primary">
              Dashboard authentication
            </h2>
          </div>
          {savedNotice && (
            <span className="flex items-center gap-1 text-xs text-[#55564F] font-mono font-medium">
              <CheckCircle className="h-3.5 w-3.5" />
              Settings Applied
            </span>
          )}
          <span className={`border px-2 py-1 text-[10px] font-mono ${isAuthenticated ? 'border-[#77786F] bg-[#E8E6DE] text-ink' : 'border-border text-text-muted'}`}>{isAuthenticated ? 'Authenticated' : 'Not connected'}</span>
        </div>

        {authEnabled ? <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Local development credential
            </label>
            <p className="text-[11px] text-text-muted mt-1">
              Enter the explicitly configured <code>SAAS_DASHBOARD_DEV_TOKEN</code> for a local development API. The backend binds authorization scope to its server configuration; this page has no tenant selector.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1">
              Development token
            </label>
            <input
              type="password"
              autoComplete="off"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              className="w-full max-w-md px-3 py-1.5 rounded border border-border bg-surface text-xs font-mono text-text-primary focus:border-accent focus:outline-none"
            />
            <p className="text-[11px] text-text-muted mt-1">
              Token stays in memory only and is sent to the local API as a bearer credential. Do not paste a collector delivery token here.
            </p>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button
              type="submit"
              className="px-4 py-1.5 rounded bg-accent hover:bg-accent-hover text-white text-xs font-medium transition-colors"
            >
              Save Configuration
            </button>
            <button
              type="button"
              onClick={clearToken}
              className="flex items-center gap-1 px-3 py-1.5 rounded border border-border hover:bg-surface-hover text-xs font-medium text-text-secondary transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Clear Token</span>
            </button>
          </div>
        </form> : <p className="text-xs text-text-secondary">This dashboard uses a server-validated session cookie. Session credentials are not stored in browser storage or exposed as bearer tokens.</p>}
      </div>

      {/* Endpoint Configuration & Routing */}
      <div className="rounded-lg border border-border bg-surface p-5 shadow-card">
        <div className="flex items-center gap-2 pb-3 mb-4 border-b border-border-subtle">
          <Server className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-semibold text-text-primary">
            AegisOps Microservice Endpoints
          </h2>
        </div>

        <div className="space-y-3 text-xs font-mono">
          <div className="p-3 border border-border-subtle bg-surface-secondary flex items-center justify-between"><span className="text-text-secondary">Dashboard environment</span><span className="font-semibold text-ink">{environmentLabel}</span></div>
          <div className="p-3 rounded bg-surface-secondary border border-border-subtle flex items-center justify-between">
            <div>
              <span className="text-text-muted block text-[10px] font-sans">
                Tier 2 SaaS API Base URL:
              </span>
              <span className="text-text-primary font-bold">{safeEndpointLabel(saasUrl)}</span>
            </div>
            <span className="text-[10px] text-accent font-sans bg-accent-light px-2 py-0.5 rounded">
              URL configured
            </span>
          </div>

          <div className="p-3 rounded bg-surface-secondary border border-border-subtle flex items-center justify-between">
            <div>
              <span className="text-text-muted block text-[10px] font-sans">
                Tier 1 Local Collector URL:
              </span>
              <span className="text-text-primary font-bold">{safeEndpointLabel(collectorUrl)}</span>
            </div>
            <span className="text-[10px] text-text-muted font-sans bg-surface px-2 py-0.5 rounded border border-border">
              Configured
            </span>
          </div>
        </div>
      </div>

      {/* Architecture & Telemetry Contract Info */}
      <div className="rounded-lg border border-border bg-surface p-5 shadow-card">
        <div className="flex items-center gap-2 pb-3 mb-3 border-b border-border-subtle">
          <Shield className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-semibold text-text-primary">
            Architecture & Contract Conformance
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div className="p-3 rounded bg-surface-secondary border border-border-subtle">
            <span className="font-semibold text-text-primary block mb-1">
              Canonical JSON Schema:
            </span>
            <p className="text-text-secondary text-[11px] leading-relaxed">
              Conforms to <code className="font-mono text-accent">contracts/telemetry.schema.json</code> v1.0.0 and v1.1.0.
              Enforces <code className="font-mono">extra="forbid"</code> on all ingestion endpoints.
            </p>
          </div>

          <div className="p-3 rounded bg-surface-secondary border border-border-subtle">
            <span className="font-semibold text-text-primary block mb-1">
              Zero Raw Logs Egress:
            </span>
            <p className="text-text-secondary text-[11px] leading-relaxed">
              Raw log payloads, SQL statements, and authorization headers are scrubbed locally on Tier 1
              prior to outbound dispatch.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
