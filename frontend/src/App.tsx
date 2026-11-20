import React from 'react';
import { SaasClient } from './api/client';
import { CollectorClient } from './api/collector';
import { TopCommandBar } from './components/TopCommandBar';
import { KpiFleetStrip } from './components/KpiFleetStrip';
import { ServicesWorkspace, TelemetryDataPoint } from './components/ServicesWorkspace';
import { IncidentsDrawer } from './components/IncidentsDrawer';
import { CollectorsFleetView } from './components/CollectorsFleetView';
import { EgressProofPanel } from './components/EgressProofPanel';
import { CollectorItem, DashboardOverview, IncidentItem, ServiceItem } from './types/saas';
import { AlertCircle } from 'lucide-react';

const SAAS_URL = import.meta.env.VITE_SAAS_API_URL || 'http://127.0.0.1:8000';
const COLLECTOR_URL = import.meta.env.VITE_COLLECTOR_API_URL || 'http://127.0.0.1:8100';
const DEFAULT_TOKEN = import.meta.env.VITE_DEFAULT_TENANT_TOKEN || 'dev-secret-token-12345';

export const App: React.FC = () => {
  const [currentTenant, setCurrentTenant] = React.useState('development-tenant');
  const [currentToken, setCurrentToken] = React.useState(DEFAULT_TOKEN);
  const [activeTab, setActiveTab] = React.useState('telemetry');
  const [isPolling, setIsPolling] = React.useState(true);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [lastSyncTime, setLastSyncTime] = React.useState<string | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  // Data states
  const [overview, setOverview] = React.useState<DashboardOverview | null>(null);
  const [services, setServices] = React.useState<ServiceItem[]>([]);
  const [incidents, setIncidents] = React.useState<IncidentItem[]>([]);
  const [collectors, setCollectors] = React.useState<CollectorItem[]>([]);
  const [selectedService, setSelectedService] = React.useState<string | null>(null);

  // Time-series history accumulator for charts (strictly ordered by event_time)
  const [telemetryHistory, setTelemetryHistory] = React.useState<Record<string, TelemetryDataPoint[]>>({});

  // Clients
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

      // Accumulate time-series points per service
      setTelemetryHistory((prevHistory) => {
        const nextHistory = { ...prevHistory };

        servRes.items.forEach((svc) => {
          const list = nextHistory[svc.service] ? [...nextHistory[svc.service]] : [];
          const eventTime = svc.last_event_time || nowIso;
          const displayTime = eventTime.slice(11, 19);

          // Only add if new timestamp
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
            });

            // Sort strictly by event_time (RFC 3339)
            list.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

            // Keep rolling 40 samples
            if (list.length > 40) {
              list.shift();
            }
            nextHistory[svc.service] = list;
          }
        });

        return nextHistory;
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
    fetchData();
  }, [currentToken]);

  // Polling interval (3 seconds for <10s freshness SLA)
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

  return (
    <div className="min-h-screen bg-canvas text-text-primary flex flex-col font-sans">
      {/* Top Command Bar */}
      <TopCommandBar
        currentTenant={currentTenant}
        currentToken={currentToken}
        onSelectToken={handleSelectToken}
        isPolling={isPolling}
        onTogglePolling={() => setIsPolling((p) => !p)}
        onManualRefresh={fetchData}
        isRefreshing={isRefreshing}
        lastSyncTime={lastSyncTime}
        activeTab={activeTab}
        onSelectTab={setActiveTab}
      />

      {/* Main Workspace Body */}
      <main className="flex-1 p-4 space-y-4 max-w-[1720px] w-full mx-auto">
        {/* Error Notification Banner */}
        {errorMessage && (
          <div className="flex items-center gap-2 rounded border border-health-poor/40 bg-health-poor/10 p-3 text-xs text-health-poor">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <div className="flex-1">
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

        {/* Global KPI Strip (Always visible across all tabs) */}
        <KpiFleetStrip overview={overview} isLoading={isRefreshing} />

        {/* Tab Views */}
        {activeTab === 'telemetry' && (
          <ServicesWorkspace
            services={services}
            selectedService={selectedService}
            onSelectService={setSelectedService}
            telemetryHistory={telemetryHistory}
            isLoading={isRefreshing}
          />
        )}

        {activeTab === 'incidents' && (
          <IncidentsDrawer incidents={incidents} isLoading={isRefreshing} />
        )}

        {activeTab === 'collectors' && (
          <CollectorsFleetView collectors={collectors} isLoading={isRefreshing} />
        )}

        {activeTab === 'egress' && (
          <EgressProofPanel collectorClient={collectorClient} />
        )}
      </main>

      {/* High-density footer */}
      <footer className="border-t border-border bg-surface px-4 py-2 text-[11px] text-text-muted flex flex-wrap items-center justify-between gap-2 mono-metric">
        <div>
          <span>AegisOps Console v0.1.0</span>
          <span className="text-text-dim mx-2">|</span>
          <span>SaaS Origin: <code className="text-text-primary">{SAAS_URL}</code></span>
          <span className="text-text-dim mx-2">|</span>
          <span>Tier 1 Collector Origin: <code className="text-text-primary">{COLLECTOR_URL}</code></span>
        </div>
        <div>
          <span>RFC 3339 UTC Tabular Telemetry</span>
          <span className="text-text-dim mx-2">|</span>
          <span className="text-health-excellent">Privacy-First Architecture</span>
        </div>
      </footer>
    </div>
  );
};
