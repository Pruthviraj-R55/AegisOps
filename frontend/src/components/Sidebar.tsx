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
  X,
} from 'lucide-react';
import { ActiveNavView } from '../types/telemetry';

interface SidebarProps {
  currentView: ActiveNavView;
  onSelectView: (view: ActiveNavView) => void;
  activeIncidentCount: number;
  collectorStatus: 'online' | 'stale' | 'offline' | 'unavailable';
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
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
  collectorStatus,
  mobileOpen = false,
  onCloseMobile = () => undefined,
}) => {
  const monitoringItems: NavItem[] = [
    { id: 'overview', label: 'Overview', icon: Activity },
    { id: 'infrastructure', label: 'Infrastructure', icon: Cpu },
    { id: 'performance', label: 'Performance', icon: TrendingUp },
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
                  ? 'bg-[#343530] text-paper font-semibold border-l-2 border-signal'
                  : 'text-[#C7C6BE] hover:text-paper hover:bg-[#2B2C28] border-l-2 border-transparent'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    isActive ? 'text-signal' : 'text-[#8F9088]'
                  }`}
                />
                <span>{item.label}</span>
              </div>
              {item.badge !== undefined && (
                <span className="px-1.5 py-0.2 text-[10px] font-mono font-bold bg-signal/15 text-[#F1A59E] border border-signal/50">
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
    <>
    {mobileOpen && <button aria-label="Close navigation" onClick={onCloseMobile} className="fixed inset-0 z-40 bg-ink/65 lg:hidden" />}
    <aside className={`${mobileOpen ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0 fixed lg:sticky z-50 lg:z-auto inset-y-0 left-0 w-[258px] shrink-0 border-r border-[#3B3C37] bg-ink flex flex-col justify-between h-screen transition-transform duration-200 select-none`}>
      <div>
        {/* Brand Bar */}
        <div className="h-[72px] border-b border-[#3B3C37] px-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 border border-signal/60 bg-signal flex items-center justify-center text-paper">
              <Shield className="h-3.5 w-3.5 stroke-[2.5]" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-sm text-paper tracking-tight leading-none">
                AegisOps
              </span>
              <span className="text-[10px] text-[#9A9B93] font-mono tracking-tight leading-tight mt-1">
                Tier 2 Console
              </span>
            </div>
          </div>
          <button onClick={onCloseMobile} aria-label="Close navigation" className="lg:hidden p-1 text-[#B9B9B1]"><X className="h-4 w-4" /></button>
          <span className="border border-[#464741] px-2 py-1 text-[9px] font-mono font-semibold tracking-wide text-[#B9B9B1]">
            v1.0.0
          </span>
        </div>

        {/* Navigation Sections */}
        <div className="p-4 pt-6">
          {renderNavGroup('Monitoring', monitoringItems)}
          {renderNavGroup('Intelligence', intelligenceItems)}
          {renderNavGroup('System', systemItems)}
        </div>
      </div>

      {/* Footer Info Strip */}
      <div className="p-4 border-t border-[#3B3C37] bg-[#1C1D1A] space-y-2">
        {/* Collector Health Pill */}
        <div className="flex items-center justify-between px-2 py-2 border border-[#3B3C37] text-[10px] font-mono">
          <span className="text-[#9A9B93]">SaaS collectors</span>
          <span className="flex items-center gap-1.5 font-semibold text-paper">
            <span
              className={`w-2 h-2 ${
              collectorStatus === 'online' ? 'bg-signal' : collectorStatus === 'stale' ? 'bg-[#9A9B93]' : 'bg-[#55564F]'
              }`}
            />
            <span className="text-paper">
              {collectorStatus.toUpperCase()}
            </span>
          </span>
        </div>

        {/* Tenant scope is always determined by the server-side credential. */}
        <div className="px-2 py-1 text-[10px] font-mono text-[#8F9088] truncate">
          Scope <span className="text-[#D0CFC8] font-medium">session-bound</span>
        </div>
      </div>
    </aside>
    </>
  );
};
