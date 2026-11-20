import React from 'react';
import {
  Activity,
  AlertTriangle,
  Cpu,
  FileCheck,
  Radio,
  Settings,
  Shield,
  TrendingUp,
  Wifi,
} from 'lucide-react';
import { ActiveNavView } from '../types/telemetry';

interface SidebarProps {
  currentView: ActiveNavView;
  onSelectView: (view: ActiveNavView) => void;
  activeIncidentCount: number;
  collectorOnline: boolean;
  currentTenant: string;
}

interface NavItem {
  id: ActiveNavView;
  label: string;
  icon: React.ElementType;
  badge?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onSelectView,
  activeIncidentCount,
  collectorOnline,
  currentTenant,
}) => {
  const monitoringItems: NavItem[] = [
    { id: 'overview', label: 'Overview', icon: Activity },
    { id: 'infrastructure', label: 'Infrastructure', icon: Cpu },
    { id: 'network', label: 'Network', icon: Wifi },
    { id: 'security', label: 'Security', icon: Shield },
  ];

  const intelligenceItems: NavItem[] = [
    {
      id: 'incidents',
      label: 'Incidents',
      icon: AlertTriangle,
      badge: activeIncidentCount > 0 ? activeIncidentCount : undefined,
    },
    { id: 'anomalies', label: 'Anomalies', icon: TrendingUp },
  ];

  const systemItems: NavItem[] = [
    { id: 'collectors', label: 'Collectors', icon: Radio },
    { id: 'egress', label: 'Egress Proof', icon: FileCheck },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const renderNavGroup = (title: string, items: NavItem[]) => (
    <div className="mb-6">
      <div className="px-3 mb-1.5 text-[10px] font-semibold tracking-wider text-text-muted uppercase">
        {title}
      </div>
      <nav className="space-y-0.5">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onSelectView(item.id)}
              className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-accent-light text-accent font-semibold'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    isActive ? 'text-accent' : 'text-text-muted'
                  }`}
                />
                <span>{item.label}</span>
              </div>
              {item.badge !== undefined && (
                <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-[#FDF2F2] text-[#C2414B] border border-[#C2414B]/30">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>
    </div>
  );

  return (
    <aside className="w-[230px] shrink-0 border-r border-border bg-surface flex flex-col justify-between h-screen sticky top-0 select-none">
      <div>
        {/* Brand Bar */}
        <div className="h-14 border-b border-border px-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-accent flex items-center justify-center text-white">
              <Shield className="h-3.5 w-3.5 stroke-[2.5]" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-sm text-text-primary tracking-tight leading-none">
                AegisOps
              </span>
              <span className="text-[10px] text-text-muted font-mono tracking-tight leading-tight mt-0.5">
                Tier 2 Console
              </span>
            </div>
          </div>
          <span className="rounded bg-surface-secondary border border-border px-1.5 py-0.5 text-[9px] font-mono font-semibold text-accent">
            v1.0.0
          </span>
        </div>

        {/* Navigation Sections */}
        <div className="p-3 pt-4">
          {renderNavGroup('Monitoring', monitoringItems)}
          {renderNavGroup('Intelligence', intelligenceItems)}
          {renderNavGroup('System', systemItems)}
        </div>
      </div>

      {/* Footer Info Strip */}
      <div className="p-3 border-t border-border bg-surface-secondary space-y-2">
        {/* Collector Health Pill */}
        <div className="flex items-center justify-between px-2 py-1.5 rounded border border-border bg-surface text-[11px] font-mono">
          <span className="text-text-muted">Local Collector</span>
          <span className="flex items-center gap-1.5 font-semibold">
            <span
              className={`w-2 h-2 rounded-full ${
                collectorOnline ? 'bg-semantic-excellent' : 'bg-text-muted'
              }`}
            />
            <span className={collectorOnline ? 'text-semantic-excellent' : 'text-text-muted'}>
              {collectorOnline ? 'ONLINE' : 'OFFLINE'}
            </span>
          </span>
        </div>

        {/* Current Tenant Badge */}
        <div className="px-2 py-1 text-[10px] font-mono text-text-muted truncate">
          Tenant: <span className="text-text-primary font-medium">{currentTenant}</span>
        </div>
      </div>
    </aside>
  );
};
