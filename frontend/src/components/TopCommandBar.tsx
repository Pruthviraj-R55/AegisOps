import React from 'react';
import { Clock, RefreshCw, Shield, Key } from 'lucide-react';

interface TopCommandBarProps {
  currentTenant: string;
  currentToken: string;
  onSelectToken: (tenant: string, token: string) => void;
  isPolling: boolean;
  onTogglePolling: () => void;
  onManualRefresh: () => void;
  isRefreshing: boolean;
  lastSyncTime: string | null;
  activeTab: string;
  onSelectTab: (tab: string) => void;
}

const PRESET_TOKENS = [
  { tenant: 'development-tenant', token: 'dev-secret-token-12345', label: 'Dev Tenant (Default)' },
  { tenant: 'tenant-alpha', token: 'token-alpha', label: 'Tenant Alpha (Isolated)' },
  { tenant: 'tenant-beta', token: 'token-beta', label: 'Tenant Beta (Isolated)' },
];

export const TopCommandBar: React.FC<TopCommandBarProps> = ({
  currentTenant,
  currentToken,
  onSelectToken,
  isPolling,
  onTogglePolling,
  onManualRefresh,
  isRefreshing,
  lastSyncTime,
  activeTab,
  onSelectTab,
}) => {
  const [customTokenOpen, setCustomTokenOpen] = React.useState(false);
  const [customInput, setCustomInput] = React.useState(currentToken);

  const tabs = [
    { id: 'telemetry', label: 'Fleet & Telemetry' },
    { id: 'incidents', label: 'AIOps Incidents' },
    { id: 'collectors', label: 'Collector Fleet' },
    { id: 'egress', label: 'Egress Proof Panel' },
  ];

  return (
    <header className="border-b border-border bg-surface px-4 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left: Brand + Status Pill + Navigation Tabs */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded bg-series-cpu/10 text-series-cpu">
              <Shield className="h-4 w-4" />
            </div>
            <div>
              <span className="text-base font-bold tracking-tight text-text-primary">AegisOps</span>
            </div>
            <span className="rounded border border-border bg-canvas px-2 py-0.5 text-[10px] font-semibold tracking-wider text-text-muted">
              METADATA-ONLY SAAS
            </span>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex items-center gap-1">
            {tabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => onSelectTab(tab.id)}
                  className={`px-3 py-1 text-xs font-medium transition-colors rounded ${
                    active
                      ? 'bg-surface-elevated text-text-primary border border-border'
                      : 'text-text-muted hover:bg-surface-hover hover:text-text-primary'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Right: Tenant/Token Selector + Live Polling + Refresh Clock */}
        <div className="flex items-center gap-3">
          {/* Tenant / Token Selector */}
          <div className="flex items-center gap-1.5 rounded border border-border bg-canvas px-2 py-1">
            <Key className="h-3.5 w-3.5 text-text-muted" />
            <span className="text-[11px] text-text-muted">Tenant:</span>
            <select
              value={
                PRESET_TOKENS.some((t) => t.token === currentToken)
                  ? currentToken
                  : 'custom'
              }
              onChange={(e) => {
                const val = e.target.value;
                if (val === 'custom') {
                  setCustomTokenOpen(true);
                } else {
                  const preset = PRESET_TOKENS.find((p) => p.token === val);
                  if (preset) {
                    onSelectToken(preset.tenant, preset.token);
                    setCustomInput(preset.token);
                  }
                }
              }}
              className="bg-transparent text-xs font-medium text-text-primary outline-none cursor-pointer"
            >
              {PRESET_TOKENS.map((p) => (
                <option key={p.token} value={p.token} className="bg-surface text-text-primary">
                  {p.label}
                </option>
              ))}
              <option value="custom" className="bg-surface text-text-primary">
                Custom Bearer Token...
              </option>
            </select>
          </div>

          {/* Custom Token Modal / Input Popover */}
          {customTokenOpen && (
            <div className="flex items-center gap-1.5 rounded border border-border bg-surface-elevated p-1">
              <input
                type="text"
                placeholder="Bearer token"
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                className="w-48 bg-canvas px-2 py-0.5 text-xs font-mono text-text-primary border border-border rounded outline-none"
              />
              <button
                onClick={() => {
                  onSelectToken(currentTenant, customInput);
                  setCustomTokenOpen(false);
                }}
                className="rounded bg-series-cpu/20 px-2 py-0.5 text-xs font-medium text-series-cpu hover:bg-series-cpu/30"
              >
                Apply
              </button>
              <button
                onClick={() => setCustomTokenOpen(false)}
                className="px-1 text-xs text-text-muted hover:text-text-primary"
              >
                ✕
              </button>
            </div>
          )}

          {/* Live Polling Toggle */}
          <button
            onClick={onTogglePolling}
            title={isPolling ? 'Live auto-refresh enabled (3s)' : 'Live polling paused'}
            className={`flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-mono transition-colors ${
              isPolling
                ? 'border-series-cpu/40 bg-series-cpu/10 text-series-cpu'
                : 'border-border bg-canvas text-text-muted hover:text-text-primary'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                isPolling ? 'animate-pulse bg-series-cpu' : 'bg-text-dim'
              }`}
            />
            <span>{isPolling ? 'LIVE 3s' : 'PAUSED'}</span>
          </button>

          {/* Manual Refresh Button */}
          <button
            onClick={onManualRefresh}
            disabled={isRefreshing}
            title="Manual sync"
            className="flex items-center justify-center rounded border border-border bg-canvas p-1.5 text-text-muted hover:border-border-subtle hover:text-text-primary disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin text-series-cpu' : ''}`} />
          </button>

          {/* Last Sync UTC Clock */}
          <div className="flex items-center gap-1 text-[11px] text-text-muted font-mono tabular-nums">
            <Clock className="h-3 w-3" />
            <span>{lastSyncTime ? lastSyncTime.slice(11, 19) + ' UTC' : '--:--:-- UTC'}</span>
          </div>
        </div>
      </div>
    </header>
  );
};
