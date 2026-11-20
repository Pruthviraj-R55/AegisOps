import React from 'react';
import { SaasClient } from './api/client';
import { CollectorClient } from './api/collector';
import { FilterPill, TopCommandBar } from './components/TopCommandBar';
import { KpiHeroStrip } from './components/KpiHeroStrip';
import { HardwareInfraPanel } from './components/HardwareInfraPanel';
import { NetworkTelemetryPanel } from './components/NetworkTelemetryPanel';
import { SecurityLogStreamPanel } from './components/SecurityLogStreamPanel';
import { ServiceHealthMatrix } from './components/ServiceHealthMatrix';
import { IncidentsDrawer } from './components/IncidentsDrawer';
import { EgressProofPanel } from './components/EgressProofPanel';
import { CollectorsFleetView } from './components/CollectorsFleetView';
import { CollectorItem, DashboardOverview, IncidentItem, ServiceItem } from './types/saas';
import { SanitizedEventLog, TelemetryDataPoint } from './types/telemetry';
import { padBaselineHistory } from './utils/baseline';
import { AlertCircle } from 'lucide-react';

const SAAS_URL = import.meta.env.VITE_SAAS_API_URL || 'http://127.0.0.1:8000';
const COLLECTOR_URL = import.meta.env.VITE_COLLECTOR_API_URL || 'http://127.0.0.1:8100';
const DEFAULT_TOKEN =
  import.meta.env.VITE_SAAS_TOKEN ||
  import.meta.env.VITE_DEFAULT_TENANT_TOKEN ||
  'dev-secret-token-12345';

export const App: React.FC = () => {
  const [currentTenant, setCurrentTenant] = React.useState('development-tenant');
  const [currentToken, setCurrentToken] = React.useState(DEFAULT_TOKEN);
  const [activePill, setActivePill] = React.useState<FilterPill>('all');
  const [isPolling, setIsPolling] = React.useState(true);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [lastSyncTime, setLastSyncTime] = React.useState<string | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  // SaaS Data
  const [overview, setOverview] = React.useState<DashboardOverview | null>(null);
  const [services, setServices] = React.useState<ServiceItem[]>([]);
  const [incidents, setIncidents] = React.useState<IncidentItem[]>([]);
  const [collectors, setCollectors] = React.useState<CollectorItem[]>([]);
  const [selectedService, setSelectedService] = React.useState<string | null>(null);

  // Time-series history accumulator for charts
  const [telemetryHistory, setTelemetryHistory] = React.useState<Record<string, TelemetryDataPoint[]>>({});
  const [eventLogs, setEventLogs] = React.useState<SanitizedEventLog[]>([]);

  // API Clients
  const saasClient = React.useMemo(() => new SaasClient(SAAS_URL, currentToken), [currentToken]);
  const collectorClient = React.useMemo(() => new CollectorClient(COLLECTOR_URL), []);

  const fetchData = React.useCallback(async () => {
    setIsRefreshing(true);
    setErrorMessage(null);

    try {
      const [ovRes, servRes, incRes, collRes] = await Promise.all([
        saasClient.getOverview(),
        saasClient.getServices(100),
        saasClient.getIncidents(50),
        saasClient.getCollectors(50),
      ]);

      setOverview(ovRes);
      setServices(servRes.items);
      setIncidents(incRes.items);
      setCollectors(collRes.items);

      const nowIso = new Date().toISOString();
      setLastSyncTime(nowIso);

      // Accumulate time-series points per service with baseline padding
      setTelemetryHistory((prevHistory) => {
        const nextHistory = { ...prevHistory };

        servRes.items.forEach((svc) => {
          let list = nextHistory[svc.service] ? [...nextHistory[svc.service]] : [];
          const eventTime = svc.last_event_time || nowIso;
          const displayTime = eventTime.slice(11, 19);

          const alreadyExists = list.some((pt) => pt.timestamp === eventTime);
          if (!alreadyExists) {
            list.push({
              timestamp: eventTime,
              displayTime,
              cpu: svc.metrics.cpu_percent ?? 0,
              memory: svc.metrics.memory_percent ?? 0,
              disk: svc.metrics.disk_percent ?? 0,
              latency: svc.metrics.latency_ms ?? 0,
              packetLoss: svc.metrics.packet_loss_percent ?? 0,
              failedLogins: (svc as any).security?.failed_login_count ?? 0,
              isBaseline: false,
            });

            // Smooth baseline padding if few samples
            list = padBaselineHistory(svc, list);

            // Keep rolling 50 samples
            if (list.length > 50) {
              list = list.slice(list.length - 50);
            }
            nextHistory[svc.service] = list;
          }
        });

        return nextHistory;
      });

      // Update Sanitized Event Logs Stream
      setEventLogs((prev) => {
        const newLogs: SanitizedEventLog[] = servRes.items.slice(0, 8).map((s, idx) => ({
          id: `log-${Date.now()}-${idx}`,
          event_time: (s.last_event_time || nowIso).slice(11, 19) + ' UTC',
          service: s.service,
          environment: s.environment,
          health: s.health,
          score: s.health_score,
          cpu_percent: s.metrics.cpu_percent,
          latency_ms: s.metrics.latency_ms,
          status: s.stale
            ? 'stale'
            : s.health === 'poor' || (s.metrics.cpu_percent ?? 0) > 85
            ? 'anomalous'
            : 'normal',
          summary: `Observed CPU ${s.metrics.cpu_percent?.toFixed(1) ?? '--'}% | Latency ${s.metrics.latency_ms?.toFixed(1) ?? '--'}ms | Score ${s.health_score}/100`,
        }));

        const merged = [...newLogs, ...prev];
        return merged.slice(0, 30);
      });

      if (!selectedService && servRes.items.length > 0) {
        setSelectedService(servRes.items[0].service);
      }
    } catch (err: any) {
      setErrorMessage(
        err?.detail || err?.message || 'Failed to query AegisOps SaaS API. Verify connection and token.'
      );
    } finally {
      setIsRefreshing(false);
    }
  }, [saasClient, selectedService]);

  // Initial fetch and token switch reload
  React.useEffect(() => {
    setTelemetryHistory({});
    setEventLogs([]);
    fetchData();
  }, [currentToken]);

  // Polling interval (3 seconds for real-time <10s freshness SLA)
  React.useEffect(() => {
    if (!isPolling) return;
    const interval = setInterval(() => {
      fetchData();
    }, 3000);
    return () => clearInterval(interval);
  }, [isPolling, fetchData]);

  const handleSelectToken = (tenant: string, token: string) => {
    setCurrentTenant(tenant);
    setCurrentToken(token);
  };

  const activeServiceObj =
    services.find((s) => s.service === selectedService) ||
    services[0] ||
    null;

  const currentHistory = activeServiceObj
    ? telemetryHistory[activeServiceObj.service] || []
    : [];

  return (
    <div className="min-h-screen bg-canvas text-text-primary flex flex-col font-sans selection:bg-accent-emerald/20 selection:text-accent-emerald">
      {/* Sticky Glass-Dark Header */}
      <TopCommandBar
        currentTenant={currentTenant}
        currentToken={currentToken}
        onSelectToken={handleSelectToken}
        isPolling={isPolling}
        onTogglePolling={() => setIsPolling((p) => !p)}
        onManualRefresh={fetchData}
        isRefreshing={isRefreshing}
        lastSyncTime={lastSyncTime}
        activePill={activePill}
        onSelectPill={setActivePill}
      />

      {/* Main Workspace Body */}
      <main className="flex-1 p-4 space-y-4 max-w-[1720px] w-full mx-auto">
        {/* Error Notification Banner */}
        {errorMessage && (
          <div className="flex items-center gap-2 rounded border border-accent-crimson/40 bg-accent-crimson/10 p-3 text-xs text-accent-crimson animate-fade-in-up">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <div className="flex-1 font-mono">
              <span className="font-bold">SaaS API Alert: </span>
              <span>{errorMessage}</span>
            </div>
            <button
              onClick={() => setErrorMessage(null)}
              className="text-text-muted hover:text-text-primary font-mono text-xs px-1"
            >
              ✕
            </button>
          </div>
        )}

        {/* Compact Hero / Fleet Status Banner (4 crisp KPI cards with sparklines & gauges) */}
        <section className="reveal-section animate-fade-in-up">
          <KpiHeroStrip overview={overview} services={services} isLoading={isRefreshing} />
        </section>

        {/* Deduplicated Service Health Matrix (Clean 1-row-per-service view) */}
        {(activePill === 'all' || activePill === 'hardware' || activePill === 'network') && (
          <section className="reveal-section animate-fade-in-up">
            <ServiceHealthMatrix
              services={services}
              selectedService={selectedService}
              onSelectService={setSelectedService}
              isLoading={isRefreshing}
            />
          </section>
        )}

        {/* Grafana-Style Multi-Panel Chart Grid (Hardware & Network Panels) */}
        {activeServiceObj && (activePill === 'all' || activePill === 'hardware' || activePill === 'network') && (
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 reveal-section animate-fade-in-up">
            {(activePill === 'all' || activePill === 'hardware') && (
              <HardwareInfraPanel
                serviceName={activeServiceObj.service}
                history={currentHistory}
                currentDisk={activeServiceObj.metrics.disk_percent ?? 38.5}
              />
            )}
            {(activePill === 'all' || activePill === 'network') && (
              <NetworkTelemetryPanel
                serviceName={activeServiceObj.service}
                history={currentHistory}
              />
            )}
          </section>
        )}

        {/* Pillar 3: Security Anomaly Signals & Live Sanitized Event Log Stream */}
        {(activePill === 'all' || activePill === 'security') && (
          <section className="reveal-section animate-fade-in-up">
            <SecurityLogStreamPanel
              history={currentHistory}
              logs={eventLogs}
            />
          </section>
        )}

        {/* Correlated Incidents & Safe Remediation Workflow Section */}
        {(activePill === 'all' || activePill === 'security') && (
          <section className="reveal-section animate-fade-in-up">
            <IncidentsDrawer incidents={incidents} isLoading={isRefreshing} />
          </section>
        )}

        {/* Collector Fleet Overview */}
        {activePill === 'all' && (
          <section className="reveal-section animate-fade-in-up">
            <CollectorsFleetView collectors={collectors} isLoading={isRefreshing} />
          </section>
        )}

        {/* Live Tier 1 Egress Proof Section */}
        {(activePill === 'all' || activePill === 'egress') && (
          <section className="reveal-section animate-fade-in-up">
            <EgressProofPanel collectorClient={collectorClient} />
          </section>
        )}
      </main>

      {/* Utilitarian Netdata Footer */}
      <footer className="border-t border-border bg-surface px-4 py-2.5 text-[11px] text-text-muted flex flex-wrap items-center justify-between gap-2 mono-metric">
        <div>
          <span className="font-bold text-text-primary">AegisOps Console</span>
          <span className="text-text-dim mx-2">|</span>
          <span>SaaS API: <code className="text-accent-cyan">{SAAS_URL}</code></span>
          <span className="text-text-dim mx-2">|</span>
          <span>Tier 1 Collector: <code className="text-accent-emerald">{COLLECTOR_URL}</code></span>
        </div>
        <div className="flex items-center gap-3">
          <span>RFC 3339 UTC Tabular SLA</span>
          <span className="text-text-dim">|</span>
          <span className="text-accent-emerald flex items-center gap-1 font-semibold">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-emerald" />
            Zero Raw Logs Egress
          </span>
        </div>
      </footer>
    </div>
  );
};
