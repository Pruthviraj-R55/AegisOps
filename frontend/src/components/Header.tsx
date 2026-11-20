import React from 'react';
import {
  KeyRound,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { ActiveNavView } from '../types/telemetry';

interface HeaderProps {
  currentView: ActiveNavView;
  currentTenant: string;
  currentToken: string;
  onOpenTokenModal: () => void;
  isPolling: boolean;
  onTogglePolling: () => void;
  onManualRefresh: () => void;
  isRefreshing: boolean;
  lastSyncTime: string | null;
  collectorOnline: boolean;
}

const VIEW_TITLES: Record<ActiveNavView, { category: string; title: string }> = {
  overview: { category: 'Monitoring', title: 'Executive Fleet Overview' },
  infrastructure: { category: 'Monitoring', title: 'Hardware & Infrastructure' },
  network: { category: 'Monitoring', title: 'Network Telemetry' },
  security: { category: 'Monitoring', title: 'Security & Audit Stream' },
  incidents: { category: 'Intelligence', title: 'Correlated Incidents' },
  anomalies: { category: 'Intelligence', title: 'Anomaly Detections' },
  collectors: { category: 'System', title: 'Collector Fleets & SLAs' },
  egress: { category: 'System', title: 'Tier 1 Egress & Privacy Proof' },
  settings: { category: 'System', title: 'Configuration & Settings' },
};

export const Header: React.FC<HeaderProps> = ({
  currentView,
  currentToken,
  onOpenTokenModal,
  isPolling,
  onTogglePolling,
  onManualRefresh,
  isRefreshing,
  collectorOnline,
}) => {
  const [utcTime, setUtcTime] = React.useState('');

  React.useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setUtcTime(now.toISOString().slice(11, 19) + ' UTC');
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);

  const meta = VIEW_TITLES[currentView] || { category: 'Observability', title: 'Dashboard' };

  // Mask token for display
  const maskedToken = currentToken
    ? `${currentToken.slice(0, 4)}...${currentToken.slice(-4)}`
    : 'None';

  return (
    <header className="h-14 border-b border-border bg-surface px-6 flex items-center justify-between sticky top-0 z-20">
      {/* Breadcrumb & Title */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-muted font-medium">{meta.category}</span>
        <span className="text-xs text-border font-bold">/</span>
        <h1 className="text-sm font-semibold text-text-primary">{meta.title}</h1>
      </div>

      {/* Header Actions Strip */}
      <div className="flex items-center gap-3">
        {/* Zero-Egress Privacy Assurance Pill */}
        <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded bg-accent-light text-accent text-xs font-medium">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
          <span>Zero Raw Logs Egress</span>
        </div>

        {/* Collector Status Indicator */}
        <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded border border-border text-[11px] font-mono text-text-secondary bg-surface-secondary">
          <span
            className={`w-2 h-2 rounded-full ${
              collectorOnline ? 'bg-semantic-excellent' : 'bg-text-muted'
            }`}
          />
          <span>Tier 1: {collectorOnline ? '8100' : 'Offline'}</span>
        </div>

        {/* Tenant Token Switcher Button */}
        <button
          onClick={onOpenTokenModal}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-border bg-surface hover:bg-surface-hover text-xs font-mono text-text-primary transition-colors"
          title="Click to view or switch Tenant Bearer Token"
        >
          <KeyRound className="h-3.5 w-3.5 text-text-muted" />
          <span className="text-text-muted">Token:</span>
          <span className="font-semibold text-accent">{maskedToken}</span>
        </button>

        {/* Live Polling Toggle */}
        <button
          onClick={onTogglePolling}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono font-medium border transition-colors ${
            isPolling
              ? 'border-semantic-excellent/30 bg-[#EAF5F0] text-semantic-excellent hover:bg-[#DDF0E7]'
              : 'border-border bg-surface-secondary text-text-muted hover:bg-surface-hover'
          }`}
          title={isPolling ? 'Polling active (3s). Click to pause.' : 'Polling paused. Click to resume.'}
        >
          {isPolling ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-semantic-excellent animate-pulse" />
              <span>LIVE 3s</span>
              <Pause className="h-3 w-3 ml-0.5 opacity-60" />
            </>
          ) : (
            <>
              <Play className="h-3 w-3 text-text-muted" />
              <span>PAUSED</span>
            </>
          )}
        </button>

        {/* Manual Refresh Button */}
        <button
          onClick={onManualRefresh}
          disabled={isRefreshing}
          className="p-1.5 rounded border border-border bg-surface hover:bg-surface-hover text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50"
          title="Force immediate refresh"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin text-accent' : ''}`} />
        </button>

        {/* UTC Clock */}
        <div className="hidden xl:flex items-center px-2 py-1 rounded bg-surface-secondary border border-border text-[11px] font-mono text-text-secondary tabular-nums">
          {utcTime || '--:--:-- UTC'}
        </div>
      </div>
    </header>
  );
};
