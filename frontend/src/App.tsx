import React from 'react';
import { SaasClient } from './api/client';
import { CollectorClient } from './api/collector';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { TokenModal } from './components/TokenModal';
import { OverviewView } from './views/OverviewView';
import { InfrastructureView } from './views/InfrastructureView';
import { NetworkView } from './views/NetworkView';
import { SecurityView } from './views/SecurityView';
import { IncidentsView } from './views/IncidentsView';
import { AnomaliesView } from './views/AnomaliesView';
import { CollectorsView } from './views/CollectorsView';
import { EgressProofView } from './views/EgressProofView';
import { SettingsView } from './views/SettingsView';
import { CollectorItem, DashboardOverview, IncidentItem, ServiceItem } from './types/saas';
import { ActiveNavView, SanitizedEventLog, TelemetryDataPoint } from './types/telemetry';
import { AlertCircle } from 'lucide-react';

const SAAS_URL = import.meta.env.VITE_SAAS_API_URL || 'http://127.0.0.1:8000';
const COLLECTOR_URL = import.meta.env.VITE_COLLECTOR_API_URL || 'http://127.0.0.1:8100';
const DEFAULT_TOKEN =
  import.meta.env.VITE_SAAS_TOKEN ||
  import.meta.env.VITE_DEFAULT_TENANT_TOKEN ||
  'dev-secret-token-12345';

export const App: React.FC = () => {
  const [currentView, setCurrentView] = React.useState<ActiveNavView>('overview');
  const [currentTenant, setCurrentTenant] = React.useState('development-tenant');
  const [currentToken, setCurrentToken] = React.useState(DEFAULT_TOKEN);
  const [isTokenModalOpen, setIsTokenModalOpen] = React.useState(false);

  const [isPolling, setIsPolling] = React.useState(true);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [lastSyncTime, setLastSyncTime] = React.useState<string | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [collectorOnline, setCollectorOnline] = React.useState(false);

  // SaaS Data
  const [overview, setOverview] = React.useState<DashboardOverview | null>(null);
  const [services, setServices] = React.useState<ServiceItem[]>([]);
  const [incidents, setIncidents] = React.useState<IncidentItem[]>([]);
  const [collectors, setCollectors] = React.useState<CollectorItem[]>([]);
  const [selectedService, setSelectedService] = React.useState<string | null>(null);

  // Genuine Real Telemetry Samples accumulator (NO baseline padding)
  const [telemetryHistory, setTelemetryHistory] = React.useState<Record<string, TelemetryDataPoint[]>>({});
  const [eventLogs, setEventLogs] = React.useState<SanitizedEventLog[]>([]);

  // API Clients
  const saasClient = React.useMemo(() => new SaasClient(SAAS_URL, currentToken), [currentToken]);
  const collectorClient = React.useMemo(() => new CollectorClient(COLLECTOR_URL), []);

  // Probe Collector Online Status
  const checkCollectorStatus = React.useCallback(async () => {
    try {
      const health = await collectorClient.getHealth();
      setCollectorOnline(health.operational_status === 'running');
    } catch {
      setCollectorOnline(false);
    }
  }, [collectorClient]);

  // Fetch SaaS Data
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

      // Accumulate real-time points strictly from genuine responses
      setTelemetryHistory((prevHistory) => {
        const nextHistory = { ...prevHistory };

        servRes.items.forEach((svc) => {
          const list = nextHistory[svc.service] ? [...nextHistory[svc.service]] : [];
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
              bandwidth: svc.metrics.bandwidth_mbps ?? 0,
              failedLogins: (svc as any).security?.failed_login_count ?? 0,
            });

            // Keep rolling 50 samples max
            if (list.length > 50) {
              list.shift();
            }
            nextHistory[svc.service] = list;
          }
        });

        return nextHistory;
      });

      // Update Sanitized Event Logs Stream
      setEventLogs((prev) => {
        const newLogs: SanitizedEventLog[] = servRes.items.slice(0, 6).map((s, idx) => ({
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
        return merged.slice(0, 40);
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
    checkCollectorStatus();
  }, [currentToken, checkCollectorStatus]);

  // Polling interval (3 seconds for real-time <10s freshness SLA)
  React.useEffect(() => {
    if (!isPolling) return;
    const interval = setInterval(() => {
      fetchData();
      checkCollectorStatus();
    }, 3000);
    return () => clearInterval(interval);
  }, [isPolling, fetchData, checkCollectorStatus]);

  const handleSaveToken = (tenant: string, token: string) => {
    setCurrentTenant(tenant);
    setCurrentToken(token);
  };

  const activeIncidentsCount = incidents.filter((i) => i.status === 'active').length;

  return (
    <div className="flex h-screen bg-app text-text-primary font-sans antialiased selection:bg-accent/15 selection:text-accent overflow-hidden">
      {/* Fixed 230px Navigation Sidebar */}
      <Sidebar
        currentView={currentView}
        onSelectView={setCurrentView}
        activeIncidentCount={activeIncidentsCount}
        collectorOnline={collectorOnline}
        currentTenant={currentTenant}
      />

      {/* Main Content Pane */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* Understated Header */}
        <Header
          currentView={currentView}
          currentTenant={currentTenant}
          currentToken={currentToken}
          onOpenTokenModal={() => setIsTokenModalOpen(true)}
          isPolling={isPolling}
          onTogglePolling={() => setIsPolling((p) => !p)}
          onManualRefresh={fetchData}
          isRefreshing={isRefreshing}
          lastSyncTime={lastSyncTime}
          collectorOnline={collectorOnline}
        />

        {/* Workspace Body */}
        <main className="flex-1 p-6 max-w-7xl w-full mx-auto space-y-6">
          {/* Error Notification Banner */}
          {errorMessage && (
            <div className="flex items-center gap-2.5 rounded-lg border border-[#C2414B]/30 bg-[#FDF2F2] p-3 text-xs text-[#C2414B]">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <div className="flex-1 font-mono">
                <span className="font-bold">SaaS API Alert: </span>
                <span>{errorMessage}</span>
              </div>
              <button
                onClick={() => setErrorMessage(null)}
                className="text-[#C2414B] hover:opacity-80 font-mono text-xs px-1"
              >
                ✕
              </button>
            </div>
          )}

          {/* View Router */}
          {currentView === 'overview' && (
            <OverviewView
              overview={overview}
              services={services}
              incidents={incidents}
              telemetryHistory={telemetryHistory}
              selectedService={selectedService}
              onSelectService={setSelectedService}
              onNavigateToIncidents={() => setCurrentView('incidents')}
              isLoading={isRefreshing}
            />
          )}

          {currentView === 'infrastructure' && (
            <InfrastructureView
              services={services}
              selectedService={selectedService}
              onSelectService={setSelectedService}
              telemetryHistory={telemetryHistory}
              isLoading={isRefreshing}
            />
          )}

          {currentView === 'network' && (
            <NetworkView
              services={services}
              selectedService={selectedService}
              onSelectService={setSelectedService}
              telemetryHistory={telemetryHistory}
              isLoading={isRefreshing}
            />
          )}

          {currentView === 'security' && (
            <SecurityView logs={eventLogs} isLoading={isRefreshing} />
          )}

          {currentView === 'incidents' && (
            <IncidentsView incidents={incidents} isLoading={isRefreshing} />
          )}

          {currentView === 'anomalies' && (
            <AnomaliesView services={services} isLoading={isRefreshing} />
          )}

          {currentView === 'collectors' && (
            <CollectorsView
              collectors={collectors}
              collectorClient={collectorClient}
              isLoading={isRefreshing}
            />
          )}

          {currentView === 'egress' && (
            <EgressProofView collectorClient={collectorClient} />
          )}

          {currentView === 'settings' && (
            <SettingsView
              currentTenant={currentTenant}
              currentToken={currentToken}
              onSaveToken={handleSaveToken}
              saasUrl={SAAS_URL}
              collectorUrl={COLLECTOR_URL}
            />
          )}
        </main>
      </div>

      {/* Tenant Bearer Token Switcher Modal */}
      <TokenModal
        isOpen={isTokenModalOpen}
        onClose={() => setIsTokenModalOpen(false)}
        currentTenant={currentTenant}
        currentToken={currentToken}
        onSaveToken={handleSaveToken}
      />
    </div>
  );
};
