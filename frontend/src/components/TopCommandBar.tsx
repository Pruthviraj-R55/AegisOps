import React from 'react';
import {
  Clock,
  Key,
  Layers,
  Lock,
  Network,
  RefreshCw,
  Server,
  Shield,
  ShieldAlert,
} from 'lucide-react';

export type FilterPill = 'all' | 'hardware' | 'network' | 'security' | 'egress';

interface TopCommandBarProps {
  currentTenant: string;
  currentToken: string;
  onSelectToken: (tenant: string, token: string) => void;
  isPolling: boolean;
  onTogglePolling: () => void;
  onManualRefresh: () => void;
  isRefreshing: boolean;
  lastSyncTime: string | null;
  activePill: FilterPill;
  onSelectPill: (pill: FilterPill) => void;
}

const PRESET_TOKENS = [
  { tenant: 'development-tenant', token: 'dev-secret-token-12345', label: 'Dev Tenant (SAAS_DEV_TOKEN)' },
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
  activePill,
  onSelectPill,
}) => {
  const [customTokenOpen, setCustomTokenOpen] = React.useState(false);
  const [customInput, setCustomInput] = React.useState(currentToken);

  const filterPills: { id: FilterPill; label: string; icon: React.ReactNode }[] = [
    { id: 'all', label: 'All Systems', icon: <Layers className="h-3 w-3" /> },
    { id: 'hardware', label: 'Hardware & Infra', icon: <Server className="h-3 w-3" /> },
    { id: 'network', label: 'Network', icon: <Network className="h-3 w-3" /> },
    { id: 'security', label: 'Security & Incidents', icon: <ShieldAlert className="h-3 w-3" /> },
    { id: 'egress', label: 'Egress Proof', icon: <Lock className="h-3 w-3" /> },
  ];

  return (
    <header className="glass-header sticky top-0 z-50 px-4 py-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left: Brand + Privacy Badge + Use-Case Filter Pills */}
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded bg-accent-emerald/15 text-accent-emerald ring-1 ring-accent-emerald/30 shadow-[0_0_8px_rgba(0,210,106,0.3)]">
              <Shield className="h-4 w-4" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-base font-extrabold tracking-tight text-text-primary">AegisOps</span>
              <span className="rounded border border-accent-emerald/30 bg-accent-emerald/10 px-1.5 py-0.2 text-[9px] font-mono font-bold tracking-widest text-accent-emerald">
                PRIVACY-FIRST AIOPS
              </span>
            </div>
          </div>

          {/* Use-Case Filter Pills (Netdata / Grafana style) */}
          <nav className="flex items-center gap-1 bg-surface/70 p-0.5 rounded border border-border">
            {filterPills.map((pill) => {
              const active = activePill === pill.id;
              return (
                <button
                  key={pill.id}
                  onClick={() => onSelectPill(pill.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium transition-all rounded ${
                    active
                      ? 'bg-surface-elevated text-accent-emerald border border-border shadow-sm'
                      : 'text-text-muted hover:text-text-primary hover:bg-surface-hover/60'
                  }`}
                >
                  <span className={active ? 'text-accent-emerald' : 'text-text-dim'}>
                    {pill.icon}
                  </span>
                  <span>{pill.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Right: Tenant/Token Selector + Live Polling + UTC Clock */}
        <div className="flex items-center gap-2.5">
          {/* Tenant / Token Selector */}
          <div className="flex items-center gap-1.5 rounded border border-border bg-surface px-2 py-1 text-xs">
            <Key className="h-3.5 w-3.5 text-accent-emerald" />
            <span className="text-[11px] text-text-muted font-mono">Tenant:</span>
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
              className="bg-transparent text-xs font-mono font-medium text-text-primary outline-none cursor-pointer"
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
            <div className="flex items-center gap-1.5 rounded border border-border-focus bg-surface-elevated p-1 shadow-lg">
              <input
                type="text"
                placeholder="Bearer token"
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                className="w-44 bg-canvas px-2 py-0.5 text-xs font-mono text-text-primary border border-border rounded outline-none focus:border-accent-emerald"
              />
              <button
                onClick={() => {
                  onSelectToken(currentTenant, customInput);
                  setCustomTokenOpen(false);
                }}
                className="rounded bg-accent-emerald/20 px-2 py-0.5 text-xs font-medium text-accent-emerald hover:bg-accent-emerald/30 border border-accent-emerald/40"
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

          {/* Live Polling Toggle (Netdata style glowing pill) */}
          <button
            onClick={onTogglePolling}
            title={isPolling ? 'Live auto-refresh enabled (3s)' : 'Live polling paused'}
            className={`flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-mono transition-all ${
              isPolling
                ? 'border-accent-emerald/40 bg-accent-emerald/10 text-accent-emerald shadow-[0_0_6px_rgba(0,210,106,0.25)]'
                : 'border-border bg-surface text-text-muted hover:text-text-primary'
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                isPolling ? 'bg-accent-emerald animate-pulse-glow' : 'bg-text-dim'
              }`}
            />
            <span className="font-semibold">{isPolling ? 'LIVE 3s' : 'PAUSED'}</span>
          </button>

          {/* Manual Refresh Button */}
          <button
            onClick={onManualRefresh}
            disabled={isRefreshing}
            title="Manual sync"
            className="flex items-center justify-center rounded border border-border bg-surface p-1.5 text-text-muted hover:text-text-primary hover:border-border-focus disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin text-accent-emerald' : ''}`} />
          </button>

          {/* Last Sync UTC Clock */}
          <div className="flex items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-[11px] text-text-muted font-mono tabular-nums">
            <Clock className="h-3 w-3 text-text-dim" />
            <span>{lastSyncTime ? lastSyncTime.slice(11, 19) + ' UTC' : '--:--:-- UTC'}</span>
          </div>
        </div>
      </div>
    </header>
  );
};
